import { validateBackupJson } from "./backupFormat";
import { requireSession } from "./authService";
import { assertScope,withTransaction,Scope } from "./database";
import { Teacher,ScheduleItem } from "@/types/domain";
import { SavedPlan } from "@/types/planning";
import { validatePlanningSelection } from "./mockPlanner";
import { validateDate } from "./storageService";
import { validateRagResponse } from "./ragClient";
import { validateGeneralDraft } from './generalScheduler';
import type { GeneralSchedule } from '@/types/generalSchedule';
type Row=Record<string,string|number|null>;
function validateSchedule(value:unknown,id:unknown,scope:Scope) {
  const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(s=>typeof s==="string"&&!!s.trim());
  const p=value as SavedPlan;
  if(!p||typeof p!=="object"||Array.isArray(p))throw new Error("Invalid saved schedule.");
  if((value as GeneralSchedule).kind==='general-schedule'){
    const general=value as GeneralSchedule;validateGeneralDraft(general);
    if(general.id!==id||general.workspaceId!==scope.workspaceId||general.teacherId!==scope.teacherId||!Number.isFinite(Date.parse(general.createdAt)))throw new Error('Invalid general schedule owner.');
    return;
  }
  if(p.kind!=="lesson-plan") {
    const legacy=value as ScheduleItem;
    // Earlier exports may contain non-displayable records; retain them unchanged.
    if(legacy.durationMinutes===undefined)return;
    if(typeof legacy.title!=="string"||!legacy.title.trim()||typeof legacy.focus!=="string"||![1,2,3,4].includes(legacy.grade)||!Number.isInteger(legacy.durationMinutes)||legacy.durationMinutes<=0||!strings(legacy.studentIds))throw new Error("Invalid older teaching block.");
    return;
  }
  if(p.version!==1||p.id!==id||!Number.isFinite(Date.parse(p.createdAt))||typeof p.engine!=="string"||!["DEMO/MOCK","ENGINE"].includes(p.label)||!p.selection||!p.summary||!p.payload)throw new Error("Invalid saved lesson plan.");
  validatePlanningSelection(p.selection);
  if(!strings(p.summary.missing)||!Array.isArray(p.summary.weakConcepts)||p.summary.weakConcepts.some(c=>!c||typeof c.id!=="string"||typeof c.title!=="string"||!Number.isInteger(c.students)||c.students<0))throw new Error("Invalid plan evidence summary.");
  for(const key of ["students","eligible","absent","attendanceRecorded","assessmentCount","competencyCount","studentsWithAssessments"] as const) {
    if(!Number.isInteger(p.summary[key])||p.summary[key]<0)throw new Error("Invalid plan evidence counts.");
  }
  if(p.payload.version!==1||p.payload.workspaceId!==scope.workspaceId||p.payload.teacherId!==scope.teacherId)throw new Error("Plan evidence belongs to another workspace.");
  for(const rows of [p.payload.students,p.payload.attendance,p.payload.assessments,p.payload.competencies,p.payload.concepts]) {
    if(!Array.isArray(rows)||rows.some(r=>!r||r.workspace_id!==scope.workspaceId))throw new Error("Invalid plan evidence records.");
  }
  if(!Array.isArray(p.lessons)||p.lessons.some(l=>!l||!Number.isInteger(l.order)||l.order<1||typeof l.title!=="string"||!l.title.trim()||typeof l.objective!=="string"||!Number.isInteger(l.durationMinutes)||l.durationMinutes<=0||(l.status!==undefined&&!["planned","completed","partial","postponed"].includes(l.status))||!strings(l.activities)||!strings(l.reasons)||!strings(l.studentIds))||new Set(p.lessons.map(l=>l.order)).size!==p.lessons.length)throw new Error("Invalid saved lesson blocks.");
}
const tables:[string,string,string[]][]=[
  ["profiles","teacherProfiles",["id","workspace_id","data","created_at","updated_at"]],
  ["students","students",["id","workspace_id","name","grade","roll","created_at","updated_at"]],
  ["concepts","mathsConcepts",["id","workspace_id","title","grade","prerequisite_id","created_at","updated_at"]],
  ["attendance","attendance",["id","workspace_id","student_id","date","status","created_at","updated_at"]],
  ["assessments","assessments",["id","workspace_id","student_id","concept_id","date","score","maximum","created_at","updated_at"]],
  ["competencies","competencies",["id","workspace_id","student_id","concept_id","mastery","created_at","updated_at"]],
  ["observations","observations",["id","workspace_id","student_id","note","created_at","updated_at"]],
  ["schedules","schedules",["id","workspace_id","data","created_at","updated_at"]],
  ["messages","chatHistory",["id","workspace_id","role","text","created_at","updated_at"]],
  ["conversations","conversations",["id","workspace_id","title","grade","created_at","updated_at"]],
  ["message_details","chatMessageDetails",["message_id","workspace_id","conversation_id","status","request_json","sources_json","error","reply_to"]]
];
export async function restoreBackupJson(json:string) {
  if(json.length>10*1024*1024)throw new Error("Backup exceeds the 10 MB limit.");
  const backup=validateBackupJson(json);const session=await requireSession();
  if(backup.workspace.id!==session.workspaceId||backup.workspace.mode!==session.mode)throw new Error("This backup belongs to a different workspace. Log in to its original account first.");
  const profile=backup.teacherProfiles.find((p:Row)=>p.id===session.teacherId)?.data as Teacher;
  if(backup.teacherProfiles.length!==1||!profile||profile.id!==session.teacherId||typeof profile.name!=="string"||!profile.name.trim()||typeof profile.schoolName!=="string"||!profile.schoolName.trim()||profile.preferredSubject!=="Math"||!Array.isArray(profile.grades)||!profile.grades.length||profile.grades.some(g=>![1,2,3,4].includes(g))||!Number.isInteger(profile.experience)||profile.experience!<0||profile.experience!>60)throw new Error("The backup has an invalid teacher profile.");
  const restoredProfile:Teacher={id:session.teacherId,name:profile.name,schoolName:profile.schoolName,experience:profile.experience,grades:profile.grades,preferredSubject:"Math"};
  const normalized=new Map<string,Row[]>();
  for(const [table,key,fields] of tables) {
    const rows=(backup[key] ?? []) as Record<string,unknown>[];
    if(rows.length>50000)throw new Error("Too many records in backup.");
    normalized.set(table,rows.map(row=>{
      if(!row||row.workspace_id!==session.workspaceId)throw new Error("Backup includes records from another workspace.");
      const clean:Row={};
      for(const field of fields) {
        let value=row[field];
        if(field==="data") {
          if(table==="schedules")validateSchedule(value,row.id,session);
          value=JSON.stringify(table==="profiles" ? restoredProfile : value);
        }
        if(value!==null&&typeof value!=="string"&&typeof value!=="number")throw new Error(`Invalid backup ${table}.${field}.`);
        if(typeof value==="number"&&!Number.isFinite(value))throw new Error("Invalid numeric record.");
        clean[field]=value as Row[string];
      }
      const text=(field:string)=>typeof clean[field]==="string" && !!(clean[field] as string).trim();
      const number=(field:string)=>typeof clean[field]==="number" && Number.isFinite(clean[field]);
      if(!text("created_at") && table!=="message_details")throw new Error("Missing record timestamp.");
      if(!text(table==="message_details" ? "message_id" : "id"))throw new Error("Missing record ID.");
      if(["students","concepts","conversations"].includes(table) && ![1,2,3,4].includes(clean.grade as number))throw new Error("Invalid record grade.");
      if(table==="students" && (!text("name")||!text("roll")||String(clean.name).length>100||String(clean.roll).length>12))throw new Error("Invalid student record.");
      if(table==="concepts"&&!text("title"))throw new Error("Invalid concept.");
      if(["attendance","assessments"].includes(table))validateDate(String(clean.date));
      if(table==="attendance"&&!["present","absent","late"].includes(String(clean.status)))throw new Error("Invalid attendance.");
      if(table==="assessments"&&(!number("score")||!number("maximum")||Number(clean.maximum)<=0||Number(clean.score)<0||Number(clean.score)>Number(clean.maximum)))throw new Error("Invalid assessment.");
      if(table==="competencies"&&(!number("mastery")||Number(clean.mastery)<0||Number(clean.mastery)>1))throw new Error("Invalid competency.");
      if(table==="observations"&&(!text("note")||String(clean.note).length>2000))throw new Error("Invalid observation.");
      if(table==="messages"&&(!text("text")||!["teacher","assistant"].includes(String(clean.role))))throw new Error("Invalid message.");
      if(table==="conversations"&&!text("title"))throw new Error("Invalid conversation.");
      if(table==="message_details") {
        validateRagResponse({answer:"source validation",chunks:JSON.parse(String(clean.sources_json))});
        if(clean.request_json!==null) {
          const request=JSON.parse(String(clean.request_json));
          if(typeof request.question!=="string"||!request.question.trim()||request.question.length>2000||![1,2,3,4].includes(request.grade)||request.subject!=="Math")throw new Error("Invalid saved request.");
          clean.request_json=JSON.stringify({question:request.question,grade:request.grade,subject:"Math",use_llm:request.use_llm!==false});
        }
      }
      if(table==="message_details"&&clean.status==="pending") {clean.status="failed";clean.error="Restored request was interrupted. Retry to ask again.";}
      return clean;
    }));
  }
  if(backup.version===2 && normalized.get("messages")!.length!==normalized.get("message_details")!.length)throw new Error("Backup chat records are incomplete.");
  await withTransaction(async tx=>{
    await assertScope(tx,session);
    if(await tx.getFirstAsync("SELECT message_id FROM message_details WHERE workspace_id=? AND status='pending' LIMIT 1",session.workspaceId))throw new Error("Finish pending assistant requests before restoring. Open Assistant to retry interrupted requests.");
    await tx.execAsync("PRAGMA defer_foreign_keys=ON;");
    await tx.runAsync("DELETE FROM app_meta WHERE instr(key,?)=1",`draft-v1:${session.workspaceId}:`);
    for(const [table] of [...tables].reverse())await tx.runAsync(`DELETE FROM ${table} WHERE workspace_id=?`,session.workspaceId);
    for(const [table,,fields] of tables)for(const row of normalized.get(table)!) {
      await tx.runAsync(`INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(()=>"?").join(",")})`,...fields.map(f=>row[f]));
    }
    if(backup.version===1 && backup.chatHistory.length) {
      const id=`legacy-${session.workspaceId}`;
      await tx.runAsync("INSERT INTO conversations SELECT ?,workspace_id,'Earlier chat',4,MIN(created_at),MAX(updated_at) FROM messages WHERE workspace_id=? GROUP BY workspace_id",id,session.workspaceId);
      await tx.runAsync("INSERT INTO message_details(message_id,workspace_id,conversation_id,status) SELECT id,workspace_id,?,'completed' FROM messages WHERE workspace_id=?",id,session.workspaceId);
    }
    await tx.runAsync("DELETE FROM app_meta WHERE key=?",`chat.active:${session.workspaceId}`);
  });
  return {students:backup.students.length};
}
