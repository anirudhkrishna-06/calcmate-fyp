import { persistLearnerState } from "./learnerEstimator";
import { validateDate } from "./storageService";
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

export interface PendingClassEntry {
  sessionId: string;
  scheduleId: string;
  date: string;
  startedAt: string;
  completedBlocks: number;
  totalBlocks: number;
}

/** Completed classes whose delivery record was never entered in post-class review. */
export async function listPendingClassEntries(): Promise<PendingClassEntry[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const sessions = await tx.getAllAsync<ClassSessionRecord>(
      "SELECT * FROM class_sessions WHERE workspace_id=? AND date<=? AND (status='completed' OR (date<? AND status IN ('active','paused'))) ORDER BY date DESC, updated_at DESC LIMIT 20",
      session.workspaceId, today(), today(),
    );
    const pending: PendingClassEntry[] = [];
    for (const current of sessions) {
      if (!current.schedule_id) continue;
      const row = await tx.getFirstAsync<{ data: string }>("SELECT data FROM schedules WHERE workspace_id=? AND id=?", session.workspaceId, current.schedule_id);
      if (!row) continue;
      let blocks = 0;
      try { blocks = Array.isArray(JSON.parse(row.data).blocks) ? JSON.parse(row.data).blocks.length : 0; } catch { blocks = 0; }
      if (!blocks) continue;
      const outcomes = await tx.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM session_outcomes WHERE workspace_id=? AND session_id=?", session.workspaceId, current.id);
      const completedBlocks = Number(outcomes?.count ?? 0);
      if (completedBlocks < blocks) pending.push({ sessionId: current.id, scheduleId: current.schedule_id, date: current.date, startedAt: current.started_at, completedBlocks, totalBlocks: blocks });
    }
    return pending;
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
  overallObservation?: string,
  exitAssessments:{studentId:string;conceptId:string;score:number;maximum:number;blockId:string}[]=[],
  conclude=false,
  attentionReviews:{grade:number;conceptId:string;resolution:'resolved'|'continue';blockId:string}[]=[]
): Promise<void> {
  const session = await requireSession();
  const now = new Date().toISOString();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    const current = await tx.getFirstAsync<ClassSessionRecord>("SELECT * FROM class_sessions WHERE workspace_id=? AND id=?",session.workspaceId,sessionId);
    if (!current) throw new Error("Session not found.");
    if(overallObservation&&overallObservation.length>2000)throw new Error('Keep observations within 2000 characters.');
    const scheduleRow=current.schedule_id?await tx.getFirstAsync<{data:string}>('SELECT data FROM schedules WHERE workspace_id=? AND id=?',session.workspaceId,current.schedule_id):null;
    const schedule=scheduleRow?JSON.parse(scheduleRow.data):null;
    if(new Set(outcomes.map(o=>o.blockId)).size!==outcomes.length)throw new Error('Duplicate teaching outcome.');
    for(const e of exitAssessments){
      if(!Number.isFinite(e.score)||!Number.isFinite(e.maximum)||e.maximum<=0||e.score<0||e.score>e.maximum)throw new Error('Exit marks must be between zero and the maximum.');
      const student=await tx.getFirstAsync<{grade:number}>('SELECT grade FROM students WHERE workspace_id=? AND id=?',session.workspaceId,e.studentId);
      const concept=await tx.getFirstAsync<{grade:number}>('SELECT grade FROM concepts WHERE workspace_id=? AND id=?',session.workspaceId,e.conceptId);
      if(!student||!concept||concept.grade>student.grade)throw new Error('Choose a student and an appropriate concept in this workspace.');
      if(schedule&&!schedule.blocks.some((b:{id:string;activities:{grade:number;conceptId:string}[]})=>b.id===e.blockId&&b.activities.some(a=>a.grade===student.grade&&a.conceptId===e.conceptId)))throw new Error('Exit assessment does not match the selected teaching block.');
      validateDate(current.date);
      const id=`exit-${sessionId}-${e.studentId}-${e.conceptId}-${e.blockId}`;
      await tx.runAsync(`INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET score=excluded.score,maximum=excluded.maximum,updated_at=excluded.updated_at`,id,session.workspaceId,e.studentId,e.conceptId,current.date,e.score,e.maximum,now,now);
      await tx.runAsync('INSERT OR IGNORE INTO assessment_origins VALUES(?,?,?,?)',session.workspaceId,id,sessionId,e.blockId);
      await persistLearnerState(tx,session.workspaceId,e.studentId,e.conceptId);
    }
    for (const review of attentionReviews) {
      if (!['resolved','continue'].includes(review.resolution) || !Number.isInteger(review.grade)) throw new Error('Invalid attention review.');
      const concept = await tx.getFirstAsync<{ title: string; grade: number }>('SELECT title,grade FROM concepts WHERE workspace_id=? AND id=?', session.workspaceId, review.conceptId);
      if (!concept || concept.grade !== review.grade) throw new Error('Attention review does not match the selected concept.');
      if (schedule && !schedule.blocks.some((b:{id:string;activities:{grade:number;conceptId:string|null}[]}) => b.id === review.blockId && b.activities.some(a => a.grade === review.grade && a.conceptId === review.conceptId))) throw new Error('Attention review does not match the saved teaching block.');
      const targetRows = await tx.getAllAsync<{id:string}>('SELECT id FROM students WHERE workspace_id=? AND grade=?', session.workspaceId, review.grade);
      const focusedIds = new Set(studentFocusIds ?? []);
      const matchingFocused = targetRows.filter(row => focusedIds.has(row.id)).map(row => row.id);
      const targets = matchingFocused.length ? matchingFocused : targetRows.map(row => row.id);
      for (const studentId of targets) {
        const student = await tx.getFirstAsync<{id:string;grade:number}>('SELECT id,grade FROM students WHERE workspace_id=? AND id=?', session.workspaceId, studentId);
        if (!student || student.grade !== review.grade) continue;
        // A teacher resolution is explicit classroom evidence. It is kept as a
        // labelled review mark so the BKT history remains auditable.
        const assessmentId = `teacher-review-${sessionId}-${studentId}-${review.conceptId}`;
        const score = review.resolution === 'resolved' ? 8 : 4;
        await tx.runAsync(
          `INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(workspace_id,id) DO UPDATE SET score=excluded.score,maximum=excluded.maximum,updated_at=excluded.updated_at`,
          assessmentId, session.workspaceId, studentId, review.conceptId, current.date, score, 10, now, now,
        );
        await tx.runAsync('INSERT INTO assessment_metadata(workspace_id,assessment_id,kind,title) VALUES(?,?,?,?) ON CONFLICT(workspace_id,assessment_id) DO UPDATE SET title=excluded.title', session.workspaceId, assessmentId, 'classwork', `Teacher review · ${review.resolution}`);
        await tx.runAsync('INSERT OR IGNORE INTO assessment_origins VALUES(?,?,?,?)', session.workspaceId, assessmentId, sessionId, review.blockId);
        await persistLearnerState(tx, session.workspaceId, studentId, review.conceptId);
      }
      if (review.resolution === 'continue') {
        await tx.runAsync(
          `INSERT INTO notifications(id,workspace_id,type,title,body,grade,concept_id,read_at,created_at)
           VALUES(?,?,?,?,?,?,?,NULL,?)
           ON CONFLICT(workspace_id,id) DO UPDATE SET title=excluded.title,body=excluded.body,read_at=NULL,created_at=excluded.created_at`,
          `learning-change-${sessionId}-${review.conceptId}`, session.workspaceId, 'learning_change', `Keep ${concept.title} in the next class`, `Grade ${review.grade} still needs support on ${concept.title}. The next plan will keep this concept active before moving ahead.`, review.grade, review.conceptId, now,
        );
      }
    }
    for (const outcome of outcomes) {
      if(schedule&&!schedule.blocks.some((b:{id:string})=>b.id===outcome.blockId))throw new Error('Teaching outcome does not match the saved schedule.');
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
        if(!await tx.getFirstAsync('SELECT id FROM students WHERE workspace_id=? AND id=?',session.workspaceId,studentId))throw new Error('Student is not in this workspace.');
        const obsId = `review-${sessionId}-${studentId}`;
        await tx.runAsync(
          "INSERT INTO observations(id, workspace_id, student_id, note, created_at, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
          obsId, session.workspaceId, studentId, overallObservation.trim(), now, now
        );
      }
    }
    if(conclude){
      if(schedule){const next={...schedule,blocks:schedule.blocks.map((b:{id:string})=>({...b,status:outcomes.find(o=>o.blockId===b.id)?.delivered?'completed':'postponed'}))};await tx.runAsync('UPDATE schedules SET data=?,updated_at=? WHERE workspace_id=? AND id=?',JSON.stringify(next),now,session.workspaceId,current.schedule_id);}
      await tx.runAsync("UPDATE class_sessions SET status='completed',ended_at=COALESCE(ended_at,?),elapsed_seconds=?,updated_at=? WHERE workspace_id=? AND id=?",now,effectiveElapsedSeconds(current),now,session.workspaceId,sessionId);
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

