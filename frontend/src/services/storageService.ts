import { Teacher, Grade, Student, ScheduleItem } from "@/types/domain";
import { requireSession } from "./authService";
import type { SQLiteDatabase } from "expo-sqlite";
import { assertScope, getDatabase, repository, today, newId, withTransaction, AttendanceRecord, AssessmentRecord } from "./database";

export async function initializeStorage() { await getDatabase(); }
export async function storageSummary(){
  const session=await requireSession();const db=await getDatabase();await assertScope(db,session);
  return (await db.getFirstAsync<{students:number;assessments:number;plans:number}>(`SELECT
    (SELECT COUNT(*) FROM students WHERE workspace_id=?) students,
    (SELECT COUNT(*) FROM assessments WHERE workspace_id=?) assessments,
    (SELECT COUNT(*) FROM schedules WHERE workspace_id=?) plans`,session.workspaceId,session.workspaceId,session.workspaceId))!;
}
export async function localRepository<K extends Parameters<typeof repository>[0]>(table: K) {
  return repository(table, await requireSession());
}
export async function loadTeacher(): Promise<Teacher> {
  const session = await requireSession();
  const record = await repository("profiles", session).get(session.teacherId);
  if (!record) throw new Error("Teacher profile is not available on this device.");
  return JSON.parse(record.data);
}
export async function saveTeacher(teacher: Teacher) {
  const session = await requireSession();
  if (!teacher.name.trim() || !teacher.schoolName.trim()) throw new Error("Name and school are required.");
  if (!Number.isInteger(teacher.experience) || teacher.experience! < 0 || teacher.experience! > 60) throw new Error("Experience must be between 0 and 60 years.");
  if (!teacher.grades.length || teacher.grades.some(g => ![1,2,3,4].includes(g))) throw new Error("Select at least one grade.");
  if (teacher.preferredSubject !== "Math") throw new Error("Only Maths is supported.");
  await repository("profiles", session).save({ data: JSON.stringify({ ...teacher, id: session.teacherId, name: teacher.name.trim(), schoolName: teacher.schoolName.trim() }) }, session.teacherId);
}
export async function loadStudents(search = "", grade?: number): Promise<Student[]> {
  const session = await requireSession();
  const db = await getDatabase(); await assertScope(db, session);
  const rows = await db.getAllAsync<{ id: string; name: string; grade: Grade; roll: string; mastery: number | null; focus: string | null; seen: string | null;weak_count:number }>(
    `SELECT s.*, (SELECT COUNT(*) FROM competencies c WHERE c.workspace_id=s.workspace_id AND c.student_id=s.id AND c.mastery<0.6) weak_count, (SELECT AVG(mastery) FROM competencies c WHERE c.workspace_id=s.workspace_id AND c.student_id=s.id) mastery,
      (SELECT title FROM concepts k JOIN competencies c ON c.workspace_id=k.workspace_id AND c.concept_id=k.id
       WHERE c.workspace_id=s.workspace_id AND c.student_id=s.id ORDER BY c.mastery,k.id LIMIT 1) focus,
      (SELECT MAX(date) FROM attendance a WHERE a.workspace_id=s.workspace_id AND a.student_id=s.id AND a.status IN ('present','late')) seen
     FROM students s WHERE s.workspace_id=? AND (?=0 OR s.grade=?) AND (instr(lower(s.name),lower(?))>0 OR instr(lower(s.roll),lower(?))>0) ORDER BY s.grade,s.roll,s.name`,
     session.workspaceId, grade ?? 0, grade ?? 0, search.trim(),search.trim());
  return rows.map(r => ({ id:r.id, name:r.name, grade:r.grade, rollNumber:r.roll,
    mastery:r.mastery ?? 0, hasEvidence:r.mastery !== null, needsRevision:r.weak_count>0, currentUnit:r.focus ?? "No assessment yet", lastSeenLabel:r.seen ?? "Not recorded" }));
}
export async function saveStudent(input: { name: string; grade: number; roll: string }, id?: string) {
  if (!input.name.trim() || !input.roll.trim()) throw new Error("Name and roll number are required.");
  if (![1,2,3,4].includes(input.grade)) throw new Error("Choose a grade from 1 to 4.");
  try { return await (await localRepository("students")).save({ ...input, name: input.name.trim(), roll:input.roll.trim() }, id); }
  catch (error) { if (String(error).includes("UNIQUE")) throw new Error("This roll number is already used in this grade."); throw error; }
}
export async function saveAttendance(studentId: string, date: string, status: AttendanceRecord["status"]) {
  validateDate(date);
  const repo = await localRepository("attendance");
  const old = (await repo.list()).find(a => a.student_id === studentId && a.date === date);
  await repo.save({ student_id: studentId, date, status }, old?.id ?? `attendance-${studentId}-${date}`);
}
export function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value || value > today()) {
    throw new Error("Enter a valid date (YYYY-MM-DD), no later than today.");
  }
}
export async function saveAssessment(input: Omit<AssessmentRecord, "id" | "workspace_id" | "created_at" | "updated_at">, id?: string) {
  validateDate(input.date);
  if (!Number.isFinite(input.score) || !Number.isFinite(input.maximum) || input.maximum <= 0 || input.score < 0 || input.score > input.maximum) throw new Error("Score must be between zero and the maximum.");
  const session = await requireSession(); const db = await getDatabase(); await assertScope(db,session);
  const key = id ?? newId(); const now = new Date().toISOString();
  await withTransaction(async tx => {
    const old = await tx.getFirstAsync<AssessmentRecord>("SELECT * FROM assessments WHERE workspace_id=? AND id=?",session.workspaceId,key);
    if (old && old.student_id !== input.student_id) throw new Error("An assessment belongs to its original student.");
    await tx.runAsync(`INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,id) DO UPDATE SET score=excluded.score,maximum=excluded.maximum,date=excluded.date,concept_id=excluded.concept_id,updated_at=excluded.updated_at`,
      key,session.workspaceId,input.student_id,input.concept_id,input.date,input.score,input.maximum,now,now);
    if (old && old.concept_id !== input.concept_id) await refreshCompetency(tx,session.workspaceId,input.student_id,old.concept_id);
    await refreshCompetency(tx,session.workspaceId,input.student_id,input.concept_id);
  });
}
export async function saveClassAssessments(input:{grade:number;conceptId:string;date:string;maximum:number;entries:{studentId:string;score:number}[]}) {
  validateDate(input.date);
  if(![1,2,3,4].includes(input.grade) || !input.entries.length)throw new Error("Select a class and enter at least one mark.");
  if(!Number.isFinite(input.maximum)||input.maximum<=0||input.maximum>1000)throw new Error("Maximum marks must be greater than zero and at most 1000.");
  if(new Set(input.entries.map(e=>e.studentId)).size!==input.entries.length)throw new Error("Duplicate student marks.");
  if(input.entries.some(e=>!Number.isFinite(e.score)||e.score<0||e.score>input.maximum))throw new Error(`Marks must be between 0 and ${input.maximum}.`);
  const session=await requireSession();const now=new Date().toISOString();
  await withTransaction(async tx=>{
    await assertScope(tx,session);const w=session.workspaceId;
    if(!await tx.getFirstAsync("SELECT id FROM concepts WHERE workspace_id=? AND id=? AND grade=?",w,input.conceptId,input.grade))throw new Error("Choose a Maths concept for this grade.");
    for(const entry of input.entries){
      if(!await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND id=? AND grade=?",w,entry.studentId,input.grade))throw new Error("A student no longer belongs to this class. Reload the register.");
      await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)",newId(),w,entry.studentId,input.conceptId,input.date,entry.score,input.maximum,now,now);
      await refreshCompetency(tx,w,entry.studentId,input.conceptId);
    }
  });
  return input.entries.length;
}
async function refreshCompetency(tx: SQLiteDatabase, workspaceId: string, studentId: string, conceptId: string) {
  const latest = await tx.getFirstAsync<AssessmentRecord>("SELECT * FROM assessments WHERE workspace_id=? AND student_id=? AND concept_id=? ORDER BY date DESC,created_at DESC,id DESC LIMIT 1",workspaceId,studentId,conceptId);
  if (!latest) {
    await tx.runAsync("DELETE FROM competencies WHERE workspace_id=? AND student_id=? AND concept_id=?",workspaceId,studentId,conceptId);
  } else {
    const now = new Date().toISOString();
    await tx.runAsync(`INSERT INTO competencies VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,student_id,concept_id) DO UPDATE SET mastery=excluded.mastery,updated_at=excluded.updated_at`,
      `competency-${studentId}-${conceptId}`,workspaceId,studentId,conceptId,latest.score/latest.maximum,now,now);
  }
}
export async function removeAssessment(id: string) {
  const session = await requireSession(); const db = await getDatabase(); await assertScope(db,session);
  await withTransaction(async tx => {
    const old = await tx.getFirstAsync<AssessmentRecord>("SELECT * FROM assessments WHERE workspace_id=? AND id=?",session.workspaceId,id);
    if (!old) return;
    await tx.runAsync("DELETE FROM assessments WHERE workspace_id=? AND id=?",session.workspaceId,id);
    await refreshCompetency(tx,session.workspaceId,old.student_id,old.concept_id);
  });
}
export async function saveCompetency(studentId: string, conceptId: string, percentage: number) {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error("Competency must be between 0 and 100.");
  const repo = await localRepository("competencies");
  const old = (await repo.list()).find(c => c.student_id === studentId && c.concept_id === conceptId);
  await repo.save({ student_id:studentId, concept_id:conceptId, mastery:percentage/100 },old?.id ?? `competency-${studentId}-${conceptId}`);
}
export async function saveObservation(studentId: string, note: string, id?: string) {
  if (!note.trim() || note.length > 2000) throw new Error("Enter an observation of 1 to 2000 characters.");
  await (await localRepository("observations")).save({ student_id:studentId, note:note.trim() },id);
}
export async function loadScheduleItems(): Promise<ScheduleItem[]> {
  return (await (await localRepository("schedules")).list()).map(r => JSON.parse(r.data));
}
export async function dashboard() {
  const session = await requireSession(); const db = await getDatabase(); await assertScope(db,session);
  const w = session.workspaceId;
  const totals = await db.getFirstAsync<{ students:number; revision:number; present:number; recorded:number }>(
    `SELECT (SELECT COUNT(*) FROM students WHERE workspace_id=?) students,
    (SELECT COUNT(DISTINCT student_id) FROM competencies WHERE workspace_id=? AND mastery<0.6) revision,
    (SELECT COUNT(*) FROM attendance WHERE workspace_id=? AND date=? AND status IN ('present','late')) present,
    (SELECT COUNT(*) FROM attendance WHERE workspace_id=? AND date=?) recorded`,w,w,w,today(),w,today());
  const grades = await db.getAllAsync<{ grade:number; total:number }>("SELECT grade,COUNT(*) total FROM students WHERE workspace_id=? GROUP BY grade ORDER BY grade",w);
  return { teacher:await loadTeacher(), ...totals!, grades };
}
export async function exportWorkspace() {
  const session = await requireSession();
  const result: Record<string, unknown> = { version:2, workspaceId:session.workspaceId, mode:session.mode, createdAt:new Date().toISOString() };
  const db = await getDatabase(); await assertScope(db,session);
  await withTransaction(async tx => {
    for (const table of ["profiles","students","concepts","attendance","assessments","competencies","observations","schedules","messages","conversations","message_details"]) {
      result[table] = await tx.getAllAsync(`SELECT * FROM ${table} WHERE workspace_id=?`,session.workspaceId);
    }
  });
  return result;
}
