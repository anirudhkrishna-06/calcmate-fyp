import { assertScope,withTransaction,today,StudentRecord,AssessmentRecord,AttendanceRecord } from './database';
import { requireSession } from './authService';
import { curriculumVersion } from '../data/curriculum';
import { estimatorVersion } from './learnerEstimator';

export async function readClassroomEvidence(grades:number[],asOf=today()){
 const scope=await requireSession();
 return withTransaction(async tx=>{
  await assertScope(tx,scope);
  const students=(await tx.getAllAsync<StudentRecord>('SELECT * FROM students WHERE workspace_id=? ORDER BY id',scope.workspaceId)).filter(s=>grades.includes(s.grade));
  const ids=new Set(students.map(s=>s.id));
  const assessments=(await tx.getAllAsync<AssessmentRecord>('SELECT * FROM assessments WHERE workspace_id=? AND date<=? ORDER BY id',scope.workspaceId,asOf)).filter(a=>ids.has(a.student_id));
  const attendance=(await tx.getAllAsync<AttendanceRecord>('SELECT * FROM attendance WHERE workspace_id=? AND date=? ORDER BY student_id',scope.workspaceId,asOf)).filter(a=>ids.has(a.student_id));
  const decisions=new Map<string,string>();
  for(const row of await tx.getAllAsync<{data:string}>('SELECT data FROM schedules WHERE workspace_id=? ORDER BY updated_at,id',scope.workspaceId)){
    const saved=JSON.parse(row.data);
    if(saved.kind!=='general-schedule'||saved.selection.date>asOf)continue;
    for(const block of saved.blocks)if(['completed','postponed'].includes(block.status))for(const a of block.activities)if(a.conceptId&&grades.includes(a.grade))decisions.set(a.conceptId,block.status);
  }
  const localRevision=Number((await tx.getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key=?",`classroom.revision:${scope.workspaceId}`))?.value??0);
  const evidence={local_revision:localRevision,deferred_concepts:[...decisions].filter(([,status])=>status==='postponed').map(([id])=>id).sort(),version:1 as const,workspace_id:scope.workspaceId,captured_at:new Date().toISOString(),as_of:asOf,curriculum_version:curriculumVersion,estimator_version:estimatorVersion,
   students:students.map(({id,name,grade})=>({id,name,grade})),
   assessments:assessments.map(({id,student_id,concept_id,date,score,maximum,created_at,updated_at})=>({id,student_id,concept_id,date,score,maximum,created_at,updated_at})),
   attendance:attendance.map(({student_id,date,status})=>({student_id,date,status}))};
  if(students.length>500||assessments.length>12000||attendance.length>4000||JSON.stringify(evidence).length>2*1024*1024)throw new Error('Classroom evidence is too large. Select fewer grades.');
  return evidence;
 });
}
export type ClassroomEvidence=Awaited<ReturnType<typeof readClassroomEvidence>>;
