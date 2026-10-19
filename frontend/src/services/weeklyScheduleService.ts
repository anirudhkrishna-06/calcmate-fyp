/**
 * Weekly Schedule Service
 *
 * Persists and retrieves WeeklySchedule records in the local SQLite schedules
 * table (same table used by GeneralSchedule — distinguished by kind field).
 *
 * Key behaviours:
 *  - createWeeklySchedule: generates + saves a new weekly schedule
 *  - listWeeklySchedules: returns sorted summaries
 *  - loadWeeklySchedule: loads a full record by id
 *  - regenerateWeeklySchedule: rebuilds the schedule (e.g. after new data)
 *  - isWeeklyScheduleOutdated: checks classroom revision vs saved revision
 */

import { requireSession } from './authService';
import { newId, withTransaction, assertScope, today } from './database';
import type { Grade } from '@/types/domain';
import type { WeeklySchedule, WeeklyScheduleSummary } from '@/types/weeklySchedule';
import { generateWeeklySchedule, mondayOf, PERIODS_PER_DAY } from './weeklyScheduleEngine';
import { curriculumVersion } from '../data/curriculum';

const WEEKLY_KIND = 'weekly-schedule-v1';
const weeklyDebug = (message: string, details?: unknown) => {
  if (details === undefined) console.info(`[WeeklySchedule] ${message}`);
  else console.info(`[WeeklySchedule] ${message}`, details);
};

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createWeeklySchedule(
  grades: Grade[],
  anchorDate: string,
): Promise<WeeklySchedule> {
  weeklyDebug('create:start', { grades, anchorDate });
  const session = await requireSession();
  const now = new Date().toISOString();

  const draft = await generateWeeklySchedule(grades, anchorDate);
  weeklyDebug('create:generated', { days: draft.days.length, periods: draft.days.reduce((sum, day) => sum + Object.keys(day.periodSchedules).length, 0) });

  const localRevision = await getLocalRevision(session.workspaceId);

  const schedule: WeeklySchedule = {
    ...draft,
    id: newId(),
    workspaceId: session.workspaceId,
    teacherId: session.teacherId,
    createdAt: now,
    updatedAt: now,
  };

  const periodRows = preparePeriodRows(schedule);

  const payload = { kind: WEEKLY_KIND, curriculumVersion, localRevision, ...schedule };

  await withTransaction(async tx => {
    weeklyDebug('create:transaction:start', { id: schedule.id, periodRows: periodRows.length });
    await assertScope(tx, session);
    await tx.runAsync(
      'INSERT INTO schedules(id, workspace_id, data, created_at, updated_at) VALUES(?,?,?,?,?)',
      schedule.id, session.workspaceId, JSON.stringify(payload), now, now,
    );
    for (const row of periodRows) {
      await tx.runAsync(
        'INSERT INTO schedules(id, workspace_id, data, created_at, updated_at) VALUES(?,?,?,?,?)',
        row.id, session.workspaceId, JSON.stringify(row), now, now,
      );
    }
  });

  weeklyDebug('create:complete', { id: schedule.id });
  return schedule;
}

// ─── Regenerate ───────────────────────────────────────────────────────────────

export async function regenerateWeeklySchedule(id: string): Promise<WeeklySchedule> {
  const existing = await loadWeeklySchedule(id);
  const session = await requireSession();
  const now = new Date().toISOString();

  const draft = await generateWeeklySchedule(
    existing.grades as Grade[],
    existing.weekStartDate,
  );

  const localRevision = await getLocalRevision(session.workspaceId);

  const updated: WeeklySchedule = {
    ...existing,
    ...draft,
    updatedAt: now,
  };

  const oldPeriodIds = existing.days.flatMap(day => Object.values(day.periodSchedules).map(s => s.id));
  const periodRows = preparePeriodRows(updated);

  const payload = { kind: WEEKLY_KIND, curriculumVersion, localRevision, ...updated };

  await withTransaction(async tx => {
    await assertScope(tx, session);
    await tx.runAsync(
      'UPDATE schedules SET data=?, updated_at=? WHERE workspace_id=? AND id=?',
      JSON.stringify(payload), now, session.workspaceId, id,
    );
    for (const oldId of oldPeriodIds) {
      await tx.runAsync('DELETE FROM schedules WHERE workspace_id=? AND id=?', session.workspaceId, oldId);
    }
    for (const row of periodRows) {
      await tx.runAsync(
        'INSERT INTO schedules(id, workspace_id, data, created_at, updated_at) VALUES(?,?,?,?,?)',
        row.id, session.workspaceId, JSON.stringify(row), now, now,
      );
    }
  });

  return updated;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listWeeklySchedules(): Promise<WeeklyScheduleSummary[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const rows = await tx.getAllAsync<{ id: string; data: string }>(
      'SELECT id, data FROM schedules WHERE workspace_id=? ORDER BY created_at DESC',
      session.workspaceId,
    );
    const results: WeeklyScheduleSummary[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data);
        if (parsed.kind !== WEEKLY_KIND) continue;
        const ws = parsed as WeeklySchedule & { kind: string };
        const daysWithSchedule = ws.days.filter(
          d => Object.keys(d.periodSchedules).length > 0,
        ).length;
        results.push({
          id: ws.id,
          weekStartDate: ws.weekStartDate,
          grades: ws.grades,
          createdAt: ws.createdAt,
          daysWithSchedule,
          totalPeriods: daysWithSchedule * PERIODS_PER_DAY,
        });
      } catch {
        // skip malformed
      }
    }
    return results;
  });
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadWeeklySchedule(id: string): Promise<WeeklySchedule> {
  weeklyDebug('load:start', { id });
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const row = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM schedules WHERE workspace_id=? AND id=?',
      session.workspaceId, id,
    );
    if (!row) throw new Error('Weekly schedule not found.');
    weeklyDebug('load:row-found', { id, bytes: row.data.length });
    const parsed = JSON.parse(row.data);
    if (parsed.kind !== WEEKLY_KIND) throw new Error('Record is not a weekly schedule.');
    // Strip internal metadata before returning
    const { kind: _k, curriculumVersion: _cv, localRevision: _lr, ...ws } = parsed;
    weeklyDebug('load:complete', { id, days: ws.days?.length, grades: ws.grades });
    return ws as WeeklySchedule;
  });
}

// ─── Outdated check ───────────────────────────────────────────────────────────

export async function isWeeklyScheduleOutdated(id: string): Promise<boolean> {
  weeklyDebug('outdated-check:start', { id });
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const row = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM schedules WHERE workspace_id=? AND id=?',
      session.workspaceId, id,
    );
    if (!row) return true;
    const parsed = JSON.parse(row.data);
    const savedRevision: number = parsed.localRevision ?? -1;
    const savedCv: string = parsed.curriculumVersion ?? '';
    // Keep this read inside the existing transaction. Calling getLocalRevision
    // here would open a second queued transaction and deadlock the database
    // writer while this transaction is still waiting.
    const currentRevision = Number((await tx.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key=?',
      `classroom.revision:${session.workspaceId}`,
    ))?.value ?? 0);
    const outdated = savedRevision !== currentRevision || savedCv !== curriculumVersion;
    weeklyDebug('outdated-check:complete', { id, savedRevision, currentRevision, outdated });
    return outdated;
  });
}

/** Resolve the saved weekly plan to the current or next teaching period. */
export async function getTodaysWeeklyPlan() {
  const date = today();
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday < 1 || weekday > 5) return null;
  const schedules = await listWeeklySchedules();
  const currentWeek = schedules.find(item => {
    const start = new Date(`${item.weekStartDate}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 4);
    const target = new Date(`${date}T00:00:00Z`);
    return target >= start && target <= end;
  });
  if (!currentWeek) return null;
  const weekly = await loadWeeklySchedule(currentWeek.id);
  const day = weekly.days.find(item => item.date === date);
  if (!day) return null;
  const minutes = new Date().getHours() * 60 + new Date().getMinutes();
  const periods = day.slots.filter(slot => slot.kind === 'period' && slot.periodIndex !== undefined);
  const first = periods[0];
  const last = periods[periods.length - 1];
  const startMinutes = first ? Number(first.startTime.slice(0, 2)) * 60 + Number(first.startTime.slice(3)) : 540;
  const schoolEndMinutes = 14 * 60;
  const active = periods.find(slot => {
    const start = Number(slot.startTime.slice(0, 2)) * 60 + Number(slot.startTime.slice(3));
    const end = Number(slot.endTime.slice(0, 2)) * 60 + Number(slot.endTime.slice(3));
    return minutes >= start && minutes < end;
  });
  const next = active ?? periods.find(slot => {
    const start = Number(slot.startTime.slice(0, 2)) * 60 + Number(slot.startTime.slice(3));
    return minutes < start;
  });
  if (minutes < startMinutes && first) {
    return { weekly, day, slot: first, schedule: day.periodSchedules[first.periodIndex!], state: 'pre-class' as const };
  }
  if (!next && last && minutes < schoolEndMinutes) {
    return { weekly, day, slot: last, schedule: day.periodSchedules[last.periodIndex!], state: 'post-class' as const };
  }
  if (!next) return { weekly, day, slot: null, schedule: null, state: 'outside' as const };
  return {
    weekly,
    day,
    slot: next,
    schedule: day.periodSchedules[next.periodIndex!],
    state: active ? 'in-class' as const : 'pre-class' as const,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getLocalRevision(workspaceId: string): Promise<number> {
  const session = await requireSession();
  return withTransaction(async tx => {
    const row = await tx.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key=?',
      `classroom.revision:${workspaceId}`,
    );
    return Number(row?.value ?? 0);
  });
}

export { mondayOf };

function preparePeriodRows(schedule: WeeklySchedule) {
  const rows: { id: string; data: string }[] = [];
  for (const day of schedule.days) {
    for (const slot of Object.values(day.periodSchedules)) {
      const id = newId();
      slot.id = id;
      rows.push({ id, data: JSON.stringify({ ...slot, kind: 'general-schedule', weeklyScheduleId: schedule.id }) });
    }
  }
  return rows;
}
