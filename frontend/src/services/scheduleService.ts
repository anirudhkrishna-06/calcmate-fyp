import { ScheduleItem } from "@/types/domain";
import { Lesson,PlanningPayload, PlanningSelection, SavedPlan, SchedulingEngine } from "@/types/planning";
import { assertScope, withTransaction, StudentRecord, AttendanceRecord, AssessmentRecord, CompetencyRecord, ConceptRecord, newId } from "./database";
import { requireSession } from "./authService";
import { localRepository } from "./storageService";
import { generateMockPlan, validatePlanningSelection } from "./mockPlanner";
export const mockSchedulingEngine:SchedulingEngine = { generate:async payload => generateMockPlan(payload) };
export async function readPlanningPayload(selection:PlanningSelection):Promise<PlanningPayload> {
  validatePlanningSelection(selection);
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx,session);
    const w = session.workspaceId;
    const cutoff = new Date(`${selection.date}T23:59:59.999`).toISOString();
    const students = await tx.getAllAsync<StudentRecord>("SELECT * FROM students WHERE workspace_id=? AND grade=? ORDER BY id",w,selection.grade);
    const attendance = await tx.getAllAsync<AttendanceRecord>("SELECT a.* FROM attendance a JOIN students s ON s.workspace_id=a.workspace_id AND s.id=a.student_id WHERE a.workspace_id=? AND s.grade=? AND a.date<=? ORDER BY a.date,a.id",w,selection.grade,selection.date);
    const assessments = await tx.getAllAsync<AssessmentRecord>("SELECT a.* FROM assessments a JOIN students s ON s.workspace_id=a.workspace_id AND s.id=a.student_id WHERE a.workspace_id=? AND s.grade=? AND a.date<=? ORDER BY a.date,a.id",w,selection.grade,selection.date);
    const competencies = await tx.getAllAsync<CompetencyRecord>("SELECT c.* FROM competencies c JOIN students s ON s.workspace_id=c.workspace_id AND s.id=c.student_id WHERE c.workspace_id=? AND s.grade=? AND c.updated_at<=? ORDER BY c.id",w,selection.grade,cutoff);
    const concepts = await tx.getAllAsync<ConceptRecord>("SELECT * FROM concepts WHERE workspace_id=? ORDER BY id",w);
    return {version:1,workspaceId:w,teacherId:session.teacherId,selection:{...selection},students,attendance,assessments,competencies,concepts};
  });
}
export async function generateSchedule(payload:PlanningPayload, engine:SchedulingEngine = mockSchedulingEngine):Promise<SavedPlan> {
  const session = await requireSession();
  if (payload.workspaceId !== session.workspaceId || payload.teacherId !== session.teacherId) throw new Error("Planning evidence belongs to a different workspace.");
  const draft = await engine.generate(payload);
  const plan:SavedPlan = {...draft,kind:"lesson-plan",version:1,id:newId(),createdAt:new Date().toISOString(),payload};
  await (await localRepository("schedules")).save({data:JSON.stringify(plan)},plan.id);
  return plan;
}
export async function getScheduleSummary():Promise<{ plans:SavedPlan[]; legacy:ScheduleItem[] }> {
  const records = await (await localRepository("schedules")).list();
  const data = records.map(record => JSON.parse(record.data));
  return {
    plans:data.filter((p):p is SavedPlan => p.kind === "lesson-plan" && p.version === 1).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    legacy:data.filter(p => p.kind !== "lesson-plan" && typeof p.durationMinutes === "number")
  };
}
export async function loadSavedPlan(id:string):Promise<SavedPlan> {
  const record = await (await localRepository("schedules")).get(id);
  if (!record) throw new Error("Saved plan not found in this workspace.");
  const plan = JSON.parse(record.data);
  if (plan.kind !== "lesson-plan" || plan.version !== 1) throw new Error("This record is an older teaching block.");
  return plan;
}
export async function savePlanLessons(id:string,lessons:Lesson[]):Promise<SavedPlan>{
  if(!lessons.length||lessons.length>50)throw new Error("A plan needs between 1 and 50 activities.");
  for(const lesson of lessons){
    if(!lesson.title.trim()||lesson.title.length>200||!lesson.objective.trim()||lesson.objective.length>2000)throw new Error("Complete the activity title and objective.");
    if(!Number.isInteger(lesson.durationMinutes)||lesson.durationMinutes<1||lesson.durationMinutes>240)throw new Error("Each activity needs 1 to 240 whole minutes.");
    if(!Array.isArray(lesson.activities)||!lesson.activities.length||lesson.activities.some(a=>!a.trim()||a.length>2000))throw new Error("Add a description for each activity.");
    if(lesson.status&&!['planned','completed','partial','postponed'].includes(lesson.status))throw new Error("Choose a valid lesson status.");
  }
  const session=await requireSession();
  return withTransaction(async tx=>{
    await assertScope(tx,session);
    const record=await tx.getFirstAsync<{data:string}>("SELECT data FROM schedules WHERE workspace_id=? AND id=?",session.workspaceId,id);
    if(!record)throw new Error("Plan no longer exists in this workspace.");
    const plan=JSON.parse(record.data) as SavedPlan;
    if(plan.kind!=="lesson-plan"||plan.version!==1)throw new Error("This is an older teaching block.");
    // Preserve evidence and provenance; edits only affect the teacher's timeline.
    if(lessons.length!==plan.lessons.length||new Set(lessons.map(l=>l.order)).size!==lessons.length)throw new Error("Activity list is incomplete.");
    const next={...plan,lessons:lessons.map((lesson,index)=>({...lesson,order:index+1})),selection:{...plan.selection,availableMinutes:lessons.reduce((sum,l)=>sum+l.durationMinutes,0)}};
    validatePlanningSelection(next.selection);
    await tx.runAsync("UPDATE schedules SET data=?,updated_at=? WHERE workspace_id=? AND id=?",JSON.stringify(next),new Date().toISOString(),session.workspaceId,id);
    return next;
  });
}
