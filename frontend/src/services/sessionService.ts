import { assertScope, withTransaction, newId, today, ClassSessionRecord, SessionAttendanceEventRecord, SessionOutcomeRecord } from "./database";
import { requireSession } from "./authService";

export interface ActiveSessionSummary {
  session: ClassSessionRecord;
  attendanceEvents: SessionAttendanceEventRecord[];
  outcomes: SessionOutcomeRecord[];
}

export function effectiveElapsedSeconds(session: Pick<ClassSessionRecord, "status" | "elapsed_seconds" | "updated_at">, nowMs = Date.now()) {
  const stored = Math.max(0, Math.floor(session.elapsed_seconds || 0));
  if (session.status !== "active") return stored;
  const updated = Date.parse(session.updated_at);
  if (!Number.isFinite(updated)) return stored;
  return stored + Math.max(0, Math.floor((nowMs - updated) / 1000));
}

export async function startClassSession(scheduleId?: string, grade?: number): Promise<ClassSessionRecord> {
  const session = await requireSession();
  const now = new Date().toISOString();
  const id = newId();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const existing = await tx.getFirstAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND date=? AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1",
      session.workspaceId, today()
    );
    if (existing) {
      if ((scheduleId && existing.schedule_id && scheduleId !== existing.schedule_id) || (grade && existing.grade && grade !== existing.grade)) {
        throw new Error("Another class session is already active today. Resume or complete it first.");
      }
      return existing;
    }
    if (scheduleId && !await tx.getFirstAsync("SELECT id FROM schedules WHERE workspace_id=? AND id=?", session.workspaceId, scheduleId)) {
      throw new Error("The selected schedule is no longer available in this workspace.");
    }
    await tx.runAsync(
      `INSERT INTO class_sessions(id, workspace_id, schedule_id, grade, date, started_at, status, current_block_index, elapsed_seconds, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      id, session.workspaceId, scheduleId ?? null, grade ?? null, today(), now, 'active', 0, 0, now, now
    );
    return (await tx.getFirstAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",
      session.workspaceId, id
    ))!;
  });
}

export async function getActiveSession(): Promise<ClassSessionRecord | null> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    return tx.getFirstAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND date=? AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1",
      session.workspaceId, today()
    );
  });
}

export async function getSessionById(sessionId: string): Promise<ClassSessionRecord | null> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    return tx.getFirstAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",
      session.workspaceId, sessionId
    );
  });
}

export async function updateSessionProgress(sessionId: string, currentBlockIndex: number, elapsedSeconds: number): Promise<void> {
  const session = await requireSession();
  const now = new Date().toISOString();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    if (!Number.isInteger(currentBlockIndex) || currentBlockIndex < 0 || !Number.isInteger(elapsedSeconds) || elapsedSeconds < 0) throw new Error("Invalid session progress.");
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current) throw new Error("Session not found.");
    if (current.status === "completed") throw new Error("Completed sessions cannot be changed.");
    if (current.schedule_id) {
      const row = await tx.getFirstAsync<{data:string}>("SELECT data FROM schedules WHERE workspace_id=? AND id=?",session.workspaceId,current.schedule_id);
      if (row) {
        const schedule = JSON.parse(row.data) as { blocks?: unknown[] };
        if (!Array.isArray(schedule.blocks) || currentBlockIndex >= schedule.blocks.length) throw new Error("Invalid rotation block.");
      }
    }
    await tx.runAsync(
      "UPDATE class_sessions SET current_block_index=?, elapsed_seconds=?, updated_at=? WHERE workspace_id=? AND id=?",
      currentBlockIndex, elapsedSeconds, now, session.workspaceId, sessionId
    );
  });
}

export async function pauseClassSession(sessionId: string, elapsedSeconds?: number): Promise<void> {
  const session = await requireSession();
  const now = new Date().toISOString();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current || current.status !== "active") throw new Error("Only an active session can be paused.");
    const persistedElapsed = elapsedSeconds === undefined ? effectiveElapsedSeconds(current) : elapsedSeconds;
    if (!Number.isInteger(persistedElapsed) || persistedElapsed < 0) throw new Error("Invalid elapsed time.");
    if (persistedElapsed !== undefined) {
      await tx.runAsync(
        "UPDATE class_sessions SET status='paused', elapsed_seconds=?, updated_at=? WHERE workspace_id=? AND id=?",
        persistedElapsed, now, session.workspaceId, sessionId
      );
    }
  });
}

export async function resumeClassSession(sessionId: string): Promise<void> {
  const session = await requireSession();
  const now = new Date().toISOString();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current || current.status !== "paused") throw new Error("Only a paused session can be resumed.");
    await tx.runAsync(
      "UPDATE class_sessions SET status='active', updated_at=? WHERE workspace_id=? AND id=?",
      now, session.workspaceId, sessionId
    );
  });
}

export async function completeClassSession(sessionId: string, elapsedSeconds?: number): Promise<ClassSessionRecord> {
  const session = await requireSession();
  const now = new Date().toISOString();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current) throw new Error("Session not found.");
    if (current.status === "completed") return current;
    const finalElapsed = elapsedSeconds ?? effectiveElapsedSeconds(current);
    if (!Number.isInteger(finalElapsed) || finalElapsed < 0) throw new Error("Invalid elapsed time.");
    if (finalElapsed !== undefined) {
      await tx.runAsync(
        "UPDATE class_sessions SET status='completed', ended_at=?, elapsed_seconds=?, updated_at=? WHERE workspace_id=? AND id=?",
        now, finalElapsed, now, session.workspaceId, sessionId
      );
    }
    return (await tx.getFirstAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",
      session.workspaceId, sessionId
    ))!;
  });
}

export async function recordSessionAttendanceEvent(
  sessionId: string,
  studentId: string,
  eventType: 'arrived' | 'left' | 'returned'
): Promise<SessionAttendanceEventRecord> {
  const session = await requireSession();
  const now = new Date().toISOString();
  const id = newId();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current || current.status === "completed") throw new Error("Session is not available for attendance events.");
    const student = await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND id=?",session.workspaceId,studentId);
    if (!student) throw new Error("Student not found in this workspace.");
    const last = await tx.getFirstAsync<{event_type: 'arrived' | 'left' | 'returned'}>("SELECT event_type FROM session_attendance_events WHERE workspace_id=? AND session_id=? AND student_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1",session.workspaceId,sessionId,studentId);
    if (last?.event_type === eventType || (eventType === "returned" && last?.event_type !== "left") || (eventType === "left" && last?.event_type === "left") || (eventType === "arrived" && last)) {
      throw new Error("Attendance event is not valid after the student's previous event.");
    }
    await tx.runAsync(
      "INSERT INTO session_attendance_events(id, workspace_id, session_id, student_id, event_type, recorded_at) VALUES(?,?,?,?,?,?)",
      id, session.workspaceId, sessionId, studentId, eventType, now
    );
    return (await tx.getFirstAsync<SessionAttendanceEventRecord>(
      "SELECT * FROM session_attendance_events WHERE workspace_id=? AND id=?",
      session.workspaceId, id
    ))!;
  });
}

export async function getSessionAttendanceEvents(sessionId: string): Promise<SessionAttendanceEventRecord[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    return tx.getAllAsync<SessionAttendanceEventRecord>(
      "SELECT * FROM session_attendance_events WHERE workspace_id=? AND session_id=? ORDER BY recorded_at ASC",
      session.workspaceId, sessionId
    );
  });
}

export async function saveSessionOutcomes(
  sessionId: string,
  outcomes: { blockId: string; delivered: boolean; notes?: string }[],
  studentFocusIds?: string[],
  overallObservation?: string
): Promise<void> {
  const session = await requireSession();
  const now = new Date().toISOString();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT id,status FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current) throw new Error("Session not found.");
    for (const outcome of outcomes) {
      const existing = await tx.getFirstAsync<{id:string}>("SELECT id FROM session_outcomes WHERE workspace_id=? AND session_id=? AND block_id=? ORDER BY updated_at DESC LIMIT 1",session.workspaceId,sessionId,outcome.blockId);
      if (existing) {
        await tx.runAsync("UPDATE session_outcomes SET delivered=?,notes=?,updated_at=? WHERE workspace_id=? AND id=?",outcome.delivered ? 1 : 0,outcome.notes ?? null,now,session.workspaceId,existing.id);
      } else {
        const id = newId();
        await tx.runAsync(
        `INSERT INTO session_outcomes(id, workspace_id, session_id, block_id, delivered, notes, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        id, session.workspaceId, sessionId, outcome.blockId, outcome.delivered ? 1 : 0, outcome.notes ?? null, now, now
        );
      }
    }
    if (overallObservation && overallObservation.trim() && studentFocusIds && studentFocusIds.length > 0) {
      for (const studentId of studentFocusIds) {
        const obsId = newId();
        await tx.runAsync(
          "INSERT INTO observations(id, workspace_id, student_id, note, created_at, updated_at) VALUES(?,?,?,?,?,?)",
          obsId, session.workspaceId, studentId, overallObservation.trim(), now, now
        );
      }
    }
  });
}

export async function getSessionOutcomes(sessionId: string): Promise<SessionOutcomeRecord[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    return tx.getAllAsync<SessionOutcomeRecord>(
      "SELECT * FROM session_outcomes WHERE workspace_id=? AND session_id=? ORDER BY created_at ASC",
      session.workspaceId, sessionId
    );
  });
}

