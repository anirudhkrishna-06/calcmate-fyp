import { assertScope,withTransaction,today,StudentRecord,AssessmentRecord,AttendanceRecord } from './database';
import { requireSession } from './authService';
import { curriculumVersion } from '../data/curriculum';
import { estimatorVersion } from './learnerEstimator';

export async function readClassroomEvidence(grades:number[],asOf=today(),studentContextId?:string){
 const scope=await requireSession();
 return withTransaction(async tx=>{
  await assertScope(tx,scope);
  const students=(await tx.getAllAsync<StudentRecord>('SELECT * FROM students WHERE workspace_id=? ORDER BY id',scope.workspaceId)).filter(s=>grades.includes(s.grade));
  const ids=new Set(students.map(s=>s.id));
  const assessments=(await tx.getAllAsync<AssessmentRecord>('SELECT * FROM assessments WHERE workspace_id=? AND date<=? ORDER BY id',scope.workspaceId,asOf)).filter(a=>ids.has(a.student_id));
  const attendance=(await tx.getAllAsync<AttendanceRecord>('SELECT * FROM attendance WHERE workspace_id=? AND date<=? ORDER BY date,student_id',scope.workspaceId,asOf)).filter(a=>ids.has(a.student_id));
  const decisions=new Map<string,string>();
  for(const row of await tx.getAllAsync<{data:string}>('SELECT data FROM schedules WHERE workspace_id=? ORDER BY updated_at,id',scope.workspaceId)){
    const saved=JSON.parse(row.data);
    if(saved.kind!=='general-schedule'||saved.selection.date>asOf)continue;
    for(const block of saved.blocks)if(['completed','postponed'].includes(block.status))for(const a of block.activities)if(a.conceptId&&grades.includes(a.grade))decisions.set(a.conceptId,block.status);
  }
  const localRevision=Number((await tx.getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key=?",`classroom.revision:${scope.workspaceId}`))?.value??0);
  if(studentContextId&&!students.some(s=>s.id===studentContextId))throw new Error('Selected student is outside the classroom evidence scope.');
  const studentContext=studentContextId?students.find(s=>s.id===studentContextId):undefined;
  const observations=studentContext&&studentContextId?await tx.getAllAsync<{note:string}>('SELECT note FROM observations WHERE workspace_id=? AND student_id=? ORDER BY created_at DESC,id DESC LIMIT 100',scope.workspaceId,studentContextId):[];
  const evidence={local_revision:localRevision,deferred_concepts:[...decisions].filter(([,status])=>status==='postponed').map(([id])=>id).sort(),version:1 as const,workspace_id:scope.workspaceId,captured_at:new Date().toISOString(),as_of:asOf,curriculum_version:curriculumVersion,estimator_version:estimatorVersion,
   student_context_id:studentContextId,student_context:studentContext?{name:studentContext.name,grade:studentContext.grade,roll:studentContext.roll,observations:observations.map(o=>o.note)}:undefined,
   students:students.map(({id,name,grade})=>({id,name,grade,observations:id===studentContextId?observations.map(o=>o.note):[]})),
   assessments:assessments.map(({id,student_id,concept_id,date,score,maximum,created_at,updated_at})=>({id,student_id,concept_id,date,score,maximum,created_at,updated_at})),
   attendance:attendance.map(({student_id,date,status})=>({student_id,date,status}))};
  if(students.length>500||assessments.length>12000||attendance.length>20000||JSON.stringify(evidence).length>2*1024*1024)throw new Error('Classroom evidence exceeds the server size limit. The request has not been sent.');
  return evidence;
 });
}
export type ClassroomEvidence=Awaited<ReturnType<typeof readClassroomEvidence>>;
