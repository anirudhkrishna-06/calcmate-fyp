/**
 * Weekly Schedule Engine
 *
 * Defines the fixed school-day time structure (Mon-Fri, 09:00–14:00)
 * and generates a WeeklySchedule by calling buildGeneralSchedule for
 * every teaching period on every day.
 *
 * Time structure:
 *   09:00  Period 1  (40 min)
 *   09:40  Changeover (5 min)
 *   09:45  Period 2  (40 min)
 *   10:25  Changeover (5 min)
 *   10:30  Snack Break (20 min)
 *   10:50  Period 3  (40 min)
 *   11:30  Changeover (5 min)
 *   11:35  Period 4  (40 min)
 *   12:15  Lunch Break (45 min)
 *   13:00  Period 5  (40 min)
 *   13:40  Changeover (5 min)
 *   13:45  Wrap-up (15 min)
 *   14:00  End
 */

import type { TimeSlot, DaySchedule, WeeklySchedule, SlotKind } from '@/types/weeklySchedule';
import type { GeneralSchedule } from '@/types/generalSchedule';
import type { Grade } from '@/types/domain';
import { buildGeneralSchedule, rankGradeConcepts } from './generalScheduler';
import { readPlanningPayload } from './scheduleService';

// ─── Fixed Day Template ──────────────────────────────────────────────────────

interface SlotDef { start: string; duration: number; kind: SlotKind; label: string; periodIndex?: number }

const DAY_TEMPLATE: SlotDef[] = [
  { start: '09:00', duration: 40, kind: 'period',     label: 'Period 1',       periodIndex: 0 },
  { start: '09:40', duration:  5, kind: 'changeover', label: 'Changeover'                     },
  { start: '09:45', duration: 40, kind: 'period',     label: 'Period 2',       periodIndex: 1 },
  { start: '10:25', duration:  5, kind: 'changeover', label: 'Changeover'                     },
  { start: '10:30', duration: 20, kind: 'snack',      label: 'Snack Break'                    },
  { start: '10:50', duration: 40, kind: 'period',     label: 'Period 3',       periodIndex: 2 },
  { start: '11:30', duration:  5, kind: 'changeover', label: 'Changeover'                     },
  { start: '11:35', duration: 40, kind: 'period',     label: 'Period 4',       periodIndex: 3 },
  { start: '12:15', duration: 45, kind: 'lunch',      label: 'Lunch Break'                    },
  { start: '13:00', duration: 40, kind: 'period',     label: 'Period 5',       periodIndex: 4 },
  { start: '13:40', duration:  5, kind: 'changeover', label: 'Changeover'                     },
  { start: '13:45', duration: 15, kind: 'wraup',      label: 'Wrap-up & Exit'                 },
];

/** Number of 40-min teaching periods per day */
export const PERIODS_PER_DAY = DAY_TEMPLATE.filter(s => s.kind === 'period').length; // 5

/** Minutes per teaching period */
export const PERIOD_MINUTES = 40;

/** Convert 'HH:MM' → total minutes from midnight */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Convert minutes from midnight → 'HH:MM' */
function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Build the full resolved slot list for a single day */
export function buildDaySlots(): TimeSlot[] {
  return DAY_TEMPLATE.map(def => {
    const startMin = toMinutes(def.start);
    return {
      startTime: def.start,
      endTime: fromMinutes(startMin + def.duration),
      durationMinutes: def.duration,
      kind: def.kind,
      label: def.label,
      periodIndex: def.periodIndex,
    };
  });
}

/** Returns 'Mon', 'Tue', etc. for dayOfWeek 1-5 */
export function dayLabel(dow: number): string {
  return ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][dow] ?? '';
}

/** Full day name */
export function dayFullLabel(dow: number): string {
  return ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][dow] ?? '';
}

/** Get the ISO date string (YYYY-MM-DD) for each weekday of the week that contains `anchorDate` */
export function weekDates(anchorDate: string): { date: string; dow: 1|2|3|4|5 }[] {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const dow = anchor.getUTCDay(); // 0=Sun
  // Monday of this week
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return [1, 2, 3, 4, 5].map(d => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + (d - 1));
    return {
      date: day.toISOString().slice(0, 10),
      dow: d as 1|2|3|4|5,
    };
  });
}

/** Monday ISO date for the week containing `anchorDate` */
export function mondayOf(anchorDate: string): string {
  return weekDates(anchorDate)[0].date;
}

// ─── Schedule Generator ───────────────────────────────────────────────────────

/**
 * Generate a full weekly schedule.
 * For each teaching period on each weekday:
 *   1. Load classroom evidence for that date + grades
 *   2. Run buildGeneralSchedule (local heuristic)
 *   3. Store the resulting GeneralSchedule on the period slot
 *
 * This is intentionally a "forward plan" — it generates from the current
 * knowledge state onwards, not from lesson 1.
 */
export async function generateWeeklySchedule(
  grades: Grade[],
  anchorDate: string,
): Promise<Omit<WeeklySchedule, 'id' | 'workspaceId' | 'teacherId' | 'createdAt' | 'updatedAt'>> {
  const days = weekDates(anchorDate);
  const daySchedules: DaySchedule[] = [];

  const focusCount: Partial<Record<Grade, number>> = {};
  const usedConcepts: Partial<Record<Grade, string[]>> = {};

  for (const { date, dow } of days) {
    const slots = buildDaySlots();
    const periodSchedules: Record<number, GeneralSchedule> = {};

    // Load evidence once per day (all grades)
    const evidencePerGrade = await Promise.all(
      grades.map(g => readPlanningPayload({ grade: g, date, subject: 'Math', availableMinutes: PERIOD_MINUTES }))
    );

    // Build a schedule for each period — same evidence, independent rotation
    // (In reality the teacher might have updated data between periods, but for
    //  a weekly forward plan we use the day's evidence snapshot.)
    const dayOverview = buildGeneralSchedule(
      { date, grades, availableMinutes: PERIOD_MINUTES, priority: 'learning-needs' },
      evidencePerGrade,
    );

    for (const slot of slots) {
      if (slot.kind !== 'period' || slot.periodIndex === undefined) continue;
      const periodIdx = slot.periodIndex;

      const rankedNeeds = dayOverview.needs.map(need => ({
        need,
        score: need.weight / (1 + (focusCount[need.grade] ?? 0)) + (need.prerequisiteGap ? 0.35 : 0),
      })).sort((a, b) => b.score - a.score || a.need.grade - b.need.grade);
      const focus = rankedNeeds[0]?.need;
      if (!focus) continue;

      const gradePayload = evidencePerGrade.find(p => p.selection.grade === focus.grade);
      const rankedConcepts = rankGradeConcepts(gradePayload, focus.grade, date);
      const prior = new Set(usedConcepts[focus.grade] ?? []);
      const attending = gradePayload?.students.filter(student => !gradePayload.attendance.some(entry => entry.student_id === student.id && entry.date === date && entry.status === 'absent')).length ?? 0;
      const byId = new Map(rankedConcepts.map(item => [item.c.id, item]));
      const prerequisitesReady = (item: typeof rankedConcepts[number]) => (item.c.prerequisite_ids ?? (item.c.prerequisite_id ? [item.c.prerequisite_id] : [])).every(id => (byId.get(id)?.missing ?? attending) < attending);
      const repeatedGap = rankedConcepts[0]?.weak > 0 ? rankedConcepts[0] : undefined;
      const nextConcept = repeatedGap && periodIdx % 2 === 0
        ? repeatedGap
        : rankedConcepts.find(item => !prior.has(item.c.id) && prerequisitesReady(item)) ?? rankedConcepts.find(item => !prior.has(item.c.id)) ?? rankedConcepts[0];
      if (nextConcept) usedConcepts[focus.grade] = [...(usedConcepts[focus.grade] ?? []), nextConcept.c.id];
      focusCount[focus.grade] = (focusCount[focus.grade] ?? 0) + 1;

      const draft = buildGeneralSchedule(
        {
          date,
          grades,
          availableMinutes: PERIOD_MINUTES,
          priority: 'learning-needs',
          focusGrade: focus.grade,
          focusConceptId: nextConcept?.c.id ?? focus.conceptId,
        },
        evidencePerGrade,
      );

      // Attach a minimal GeneralSchedule shape (no DB id yet — assigned by service)
      periodSchedules[periodIdx] = {
        ...draft,
        id: `weekly-draft-${date}-p${periodIdx}`,
        createdAt: new Date().toISOString(),
        workspaceId: evidencePerGrade[0]?.workspaceId ?? '',
        teacherId: evidencePerGrade[0]?.teacherId ?? '',
      };
    }

    daySchedules.push({
      date,
      dayOfWeek: dow,
      dayLabel: dayFullLabel(dow),
      slots,
      periodSchedules,
      isOutdated: false,
    });
  }

  return {
    weekStartDate: days[0].date,
    grades: [...grades].sort(),
    days: daySchedules,
  };
}
