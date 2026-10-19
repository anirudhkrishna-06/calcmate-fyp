import type { PlanningPayload } from '@/types/planning';
import { curriculumVersion } from "../data/curriculum";
import NetInfo from "@react-native-community/netinfo";
import { apiRequest } from "./apiClient";
import { readClassroomEvidence } from "./classroomEvidenceService";
import type { GeneralSelection,GeneralSchedule,RotationBlock } from '@/types/generalSchedule';
import { assertScope,newId,withTransaction,repository } from './database';
import { requireSession } from './authService';
import { readPlanningPayload } from './scheduleService';
import { localRepository } from './storageService';
import { buildGeneralSchedule,validateGeneralDraft,validateGeneralSelection } from './generalScheduler';

export async function createGeneralSchedule(selection:GeneralSelection){
  validateGeneralSelection(selection);
  const session=await requireSession();
  const evidence:PlanningPayload[]=[];
  for(const grade of selection.grades)evidence.push(await readPlanningPayload({grade,date:selection.date,subject:'Math',availableMinutes:Math.min(240,Math.max(20,selection.availableMinutes))}));
  if(evidence.some(p=>p.workspaceId!==session.workspaceId||p.teacherId!==session.teacherId))throw new Error('Account changed. Try creating the schedule again.');
  if(evidence.some(p=>p.localRevision!==evidence[0]?.localRevision))throw new Error('Classroom evidence changed while planning. Generate the schedule again.');
  let draft={...buildGeneralSchedule(selection,evidence),localRevision:evidence[0]?.localRevision,curriculumVersion};
  const network=await NetInfo.fetch();
  if(session.mode==='real'&&network.isConnected!==false){
    const classroom=await readClassroomEvidence(selection.grades,selection.date);
    draft=await apiRequest('/planning/general',{method:'POST',headers:{Authorization:`Bearer ${session.token}`},body:JSON.stringify({selection,classroom_evidence:classroom})}) as typeof draft;
    const current=await requireSession();if(current.workspaceId!==session.workspaceId||current.token!==session.token)throw new Error('Account changed while generating this schedule.');
  }
  const schedule:GeneralSchedule={...draft,id:newId(),createdAt:new Date().toISOString(),workspaceId:session.workspaceId,teacherId:session.teacherId};
  validateGeneralDraft(schedule);
  await repository('schedules',session).save({data:JSON.stringify(schedule)},schedule.id);
  return schedule;
}
export async function listGeneralSchedules(){
  return (await (await localRepository('schedules')).list()).map(r=>JSON.parse(r.data)).filter((s):s is GeneralSchedule=>s.kind==='general-schedule'&&s.version===1&&!s.weeklyScheduleId).sort((a,b)=>b.selection.date.localeCompare(a.selection.date)||b.createdAt.localeCompare(a.createdAt));
}
export async function loadGeneralSchedule(id:string){
  const session=await requireSession();
  const row=await (await localRepository('schedules')).get(id);
  if(!row)throw new Error('Schedule not found.');
  const schedule=JSON.parse(row.data) as GeneralSchedule;
  validateGeneralDraft(schedule);
  if(schedule.workspaceId!==session.workspaceId||schedule.teacherId!==session.teacherId)throw new Error('This schedule belongs to another teacher.');
  return schedule;
}
export async function saveGeneralBlocks(id:string,blocks:RotationBlock[]){
  const session=await requireSession();
  return withTransaction(async tx=>{
    await assertScope(tx,session);
    const row=await tx.getFirstAsync<{data:string}>('SELECT data FROM schedules WHERE workspace_id=? AND id=?',session.workspaceId,id);
    if(!row)throw new Error('Schedule no longer exists.');
    const original=JSON.parse(row.data) as GeneralSchedule;
    if(original.workspaceId!==session.workspaceId||original.teacherId!==session.teacherId)throw new Error('This schedule belongs to another teacher.');
    const next={...original,blocks};validateGeneralDraft(next);
    if(blocks.length!==original.blocks.length||blocks.some(b=>!original.blocks.some(o=>o.id===b.id)))throw new Error('Schedule blocks are incomplete.');
    if(blocks.some((b,i)=>b.status!==original.blocks[i].status))await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",`classroom.revision:${session.workspaceId}`);
    await tx.runAsync('UPDATE schedules SET data=?,updated_at=? WHERE workspace_id=? AND id=?',JSON.stringify(next),new Date().toISOString(),session.workspaceId,id);
    return next;
  });
}

export async function isScheduleOutdated(schedule:GeneralSchedule){
 const session=await requireSession();
 if(schedule.workspaceId!==session.workspaceId)throw new Error('This schedule belongs to another teacher.');
 return withTransaction(async tx=>{
   await assertScope(tx,session);
   const revision=Number((await tx.getFirstAsync<{value:string}>('SELECT value FROM app_meta WHERE key=?',`classroom.revision:${session.workspaceId}`))?.value??0);
   return schedule.localRevision!==revision||schedule.curriculumVersion!==curriculumVersion;
 });
}
