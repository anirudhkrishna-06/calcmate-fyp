import type { GeneralSelection,GeneralSchedule,RotationBlock } from '@/types/generalSchedule';
import { assertScope,newId,withTransaction,repository } from './database';
import { requireSession } from './authService';
import { readPlanningPayload } from './scheduleService';
import { localRepository } from './storageService';
import { buildGeneralSchedule,validateGeneralDraft,validateGeneralSelection } from './generalScheduler';

export async function createGeneralSchedule(selection:GeneralSelection){
  validateGeneralSelection(selection);
  const session=await requireSession();
  const evidence=[];
  for(const grade of selection.grades)evidence.push(await readPlanningPayload({grade,date:selection.date,subject:'Math',availableMinutes:Math.min(240,Math.max(20,selection.availableMinutes))}));
  if(evidence.some(p=>p.workspaceId!==session.workspaceId||p.teacherId!==session.teacherId))throw new Error('Account changed. Try creating the schedule again.');
  const schedule:GeneralSchedule={...buildGeneralSchedule(selection,evidence),id:newId(),createdAt:new Date().toISOString(),workspaceId:session.workspaceId,teacherId:session.teacherId};
  validateGeneralDraft(schedule);
  await repository('schedules',session).save({data:JSON.stringify(schedule)},schedule.id);
  return schedule;
}
export async function listGeneralSchedules(){
  return (await (await localRepository('schedules')).list()).map(r=>JSON.parse(r.data)).filter((s):s is GeneralSchedule=>s.kind==='general-schedule'&&s.version===1).sort((a,b)=>b.selection.date.localeCompare(a.selection.date)||b.createdAt.localeCompare(a.createdAt));
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
    await tx.runAsync('UPDATE schedules SET data=?,updated_at=? WHERE workspace_id=? AND id=?',JSON.stringify(next),new Date().toISOString(),session.workspaceId,id);
    return next;
  });
}
