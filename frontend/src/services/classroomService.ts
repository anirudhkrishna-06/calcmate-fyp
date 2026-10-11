import { assertScope,today,withTransaction,AttendanceRecord,ConceptRecord } from "./database";
import { requireSession } from "./authService";
import { loadTeacher,loadStudents,validateDate } from "./storageService";
import { getScheduleSummary } from "./scheduleService";
import { listGeneralSchedules } from './generalScheduleService';
export async function classroomSummary(grade=0) {
  const session=await requireSession();
  const summary=await withTransaction(async tx=>{
    await assertScope(tx,session);const w=session.workspaceId;
    const counts=await tx.getFirstAsync<{students:number;revision:number;present:number;recorded:number}>(`SELECT
      (SELECT COUNT(*) FROM students WHERE workspace_id=? AND (?=0 OR grade=?)) students,
      (SELECT COUNT(DISTINCT c.student_id) FROM competencies c JOIN students s ON s.id=c.student_id AND s.workspace_id=c.workspace_id WHERE c.workspace_id=? AND c.mastery<0.6 AND (?=0 OR s.grade=?)) revision,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id=a.student_id AND s.workspace_id=a.workspace_id WHERE a.workspace_id=? AND a.date=? AND a.status IN ('present','late') AND (?=0 OR s.grade=?)) present,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id=a.student_id AND s.workspace_id=a.workspace_id WHERE a.workspace_id=? AND a.date=? AND (?=0 OR s.grade=?)) recorded`,w,grade,grade,w,grade,grade,w,today(),grade,grade,w,today(),grade,grade);
    const grades=await tx.getAllAsync<{grade:number;total:number}>("SELECT grade,COUNT(*) total FROM students WHERE workspace_id=? GROUP BY grade ORDER BY grade",w);
    const revisionStudents=await tx.getAllAsync<{id:string;name:string;concept:string}>(`SELECT s.id,s.name,k.title concept FROM students s JOIN competencies c ON c.workspace_id=s.workspace_id AND c.student_id=s.id JOIN concepts k ON k.workspace_id=c.workspace_id AND k.id=c.concept_id WHERE s.workspace_id=? AND c.mastery<0.6 AND (?=0 OR s.grade=?) ORDER BY c.mastery,s.name LIMIT 5`,w,grade,grade);
    return {...counts!,grades,revisionStudents};
  });
  const [{plans},rotations]=await Promise.all([getScheduleSummary(),listGeneralSchedules()]);
  const matching=plans.filter(p=>!grade||p.selection.grade===grade);
  const upcoming=matching.filter(p=>p.selection.date>=today()).sort((a,b)=>a.selection.date.localeCompare(b.selection.date))[0];
  const rotation=rotations.filter(r=>r.selection.date>=today()).sort((a,b)=>a.selection.date.localeCompare(b.selection.date))[0];
  return {...summary,teacher:await loadTeacher(),mode:session.mode,presentationRoster:session.presentationRoster===true,rotation,plan:upcoming ?? matching[0],upcoming:!!upcoming};
}
export async function attendanceRegister(grade:number,date:string) {
  validateDate(date);if(![1,2,3,4].includes(grade))throw new Error("Select a grade.");
  const session=await requireSession();const students=await loadStudents("",grade);
  const records=await withTransaction(async tx=>{await assertScope(tx,session);return tx.getAllAsync<AttendanceRecord>("SELECT * FROM attendance WHERE workspace_id=? AND date=?",session.workspaceId,date);});
  return students.map(s=>({...s,status:records.find(r=>r.student_id===s.id)?.status ?? null}));
}
export async function classLearningEvidence(grade:number){
  if(![1,2,3,4].includes(grade))throw new Error("Choose a Grade 1 to 4 class.");
  const session=await requireSession();
  return withTransaction(async tx=>{
    await assertScope(tx,session);const w=session.workspaceId;
    const concepts=await tx.getAllAsync<ConceptRecord>("SELECT * FROM concepts WHERE workspace_id=? AND grade=? ORDER BY title",w,grade);
    const students=await tx.getAllAsync<{id:string;name:string;roll:string}>("SELECT id,name,roll FROM students WHERE workspace_id=? AND grade=? ORDER BY roll,name",w,grade);
    const evidence=await tx.getAllAsync<{student_id:string;concept_id:string;mastery:number}>("SELECT c.student_id,c.concept_id,c.mastery FROM competencies c JOIN students s ON s.id=c.student_id AND s.workspace_id=c.workspace_id WHERE c.workspace_id=? AND s.grade=?",w,grade);
    return {students,concepts,progress:concepts.map(concept=>{
      const recorded=evidence.filter(e=>e.concept_id===concept.id);
      const revision=recorded.filter(e=>e.mastery<0.6);
      return {concept,recorded:recorded.length,missing:students.length-recorded.length,
        secure:recorded.filter(e=>e.mastery>=0.8).length,practicing:recorded.filter(e=>e.mastery>=0.6&&e.mastery<0.8).length,
        revision:revision.map(e=>({...students.find(s=>s.id===e.student_id)!,mastery:e.mastery}))};
    })};
  });
}
export async function saveClassAttendance(grade:number,date:string,entries:{studentId:string;status:AttendanceRecord["status"]}[]) {
  validateDate(date);if(![1,2,3,4].includes(grade)||!entries.length)throw new Error("Select a class and mark at least one student.");
  if(new Set(entries.map(e=>e.studentId)).size!==entries.length)throw new Error("Duplicate attendance entry.");
  const session=await requireSession();const now=new Date().toISOString();
  await withTransaction(async tx=>{
    await assertScope(tx,session);
    for(const entry of entries) {
      if(!["present","absent","late"].includes(entry.status))throw new Error("Invalid attendance status.");
      if(!await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND id=? AND grade=?",session.workspaceId,entry.studentId,grade))throw new Error("A student no longer belongs to this class. Reload before saving.");
      await tx.runAsync(`INSERT INTO attendance VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,student_id,date) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`,
        `attendance-${entry.studentId}-${date}`,session.workspaceId,entry.studentId,date,entry.status,now,now);
    }
  });
}
