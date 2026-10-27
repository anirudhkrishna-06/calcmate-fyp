import type { SQLiteDatabase } from 'expo-sqlite';
import type { AssessmentRecord } from './database';

export const MASTERY_THRESHOLD=0.70;
export const NEEDS_SUPPORT_THRESHOLD=0.60;
export const estimatorVersion='bkt-v1:1';
export type MasteryEstimateResult={mastery_estimate:number|null;evidence_count:number;last_evidence_at:string|null;state_status:'unknown'|'insufficient'|'needs_support'|'likely_ready';evidence_sufficiency:'none'|'limited'|'moderate'|'sufficient'};
export function computeMasteryEstimate(rows:Pick<AssessmentRecord,'id'|'score'|'maximum'|'date'|'created_at'>[]):MasteryEstimateResult{
 const ordered=[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 let sum=0,weights=0;
 ordered.forEach((a,i)=>{const weight=0.75**i;sum+=a.score/a.maximum*weight;weights+=weight;});
 const mastery=weights?sum/weights:null,count=ordered.length;
 return {mastery_estimate:mastery,evidence_count:count,last_evidence_at:ordered[0]?.date??null,state_status:mastery===null?'unknown':mastery>=0.70?'likely_ready':mastery>=0.60?'insufficient':'needs_support',evidence_sufficiency:!count?'none':count>=4?'sufficient':count>=2?'moderate':'limited'};
}
/** Bayesian Knowledge Tracing estimate used by the live learner state. The legacy
 * score-ratio function remains exported for backwards-compatible plan records. */
export function computeBktEstimate(rows:Pick<AssessmentRecord,'id'|'score'|'maximum'|'date'|'created_at'>[]):MasteryEstimateResult {
 const ordered=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 let p=0.20; const learn=0.12, slip=0.10, guess=0.20;
 for(const row of ordered){
  const observed=Math.max(0.01,Math.min(0.99,row.score/row.maximum));
  const masteredLikelihood=p*(slip+(1-slip)*observed);
  const unmasteredLikelihood=(1-p)*(guess+(1-guess)*observed*0.35);
  const posterior=masteredLikelihood/(masteredLikelihood+unmasteredLikelihood);
  p=posterior+(1-posterior)*learn;
 }
 const count=ordered.length;
 return {mastery_estimate:count?p:null,evidence_count:count,last_evidence_at:ordered.at(-1)?.date??null,state_status:!count?'unknown':p>=0.70?'likely_ready':p>=0.60?'insufficient':'needs_support',evidence_sufficiency:!count?'none':count>=4?'sufficient':count>=2?'moderate':'limited'};
}
export async function persistLearnerState(tx:SQLiteDatabase,w:string,student:string,concept:string){
 const rows=await tx.getAllAsync<AssessmentRecord>('SELECT * FROM assessments WHERE workspace_id=? AND student_id=? AND concept_id=?',w,student,concept);
 const r=computeBktEstimate(rows),now=new Date().toISOString();
 await tx.runAsync(`INSERT INTO learner_concept_states(id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
 VALUES(?,?,?,?,?,?,?,'bkt-v1','1',?,?,?,?) ON CONFLICT(workspace_id,student_id,concept_id) DO UPDATE SET mastery_estimate=excluded.mastery_estimate,evidence_count=excluded.evidence_count,last_evidence_at=excluded.last_evidence_at,estimator_name=excluded.estimator_name,estimator_version=excluded.estimator_version,state_status=excluded.state_status,evidence_sufficiency=excluded.evidence_sufficiency,updated_at=excluded.updated_at`,
 `lcs-${student}-${concept}`,w,student,concept,r.mastery_estimate,r.evidence_count,r.last_evidence_at,r.state_status,r.evidence_sufficiency,now,now);
 if(r.mastery_estimate===null)await tx.runAsync('DELETE FROM competencies WHERE workspace_id=? AND student_id=? AND concept_id=?',w,student,concept);
 else await tx.runAsync(`INSERT INTO competencies VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,student_id,concept_id) DO UPDATE SET mastery=excluded.mastery,updated_at=excluded.updated_at`,`competency-${student}-${concept}`,w,student,concept,r.mastery_estimate,now,now);
 return r;
}
export async function rebuildWorkspaceStates(tx:SQLiteDatabase,w:string){
 // Earlier manually entered competencies become explicit, auditable assessment evidence.
 const manual=await tx.getAllAsync<{id:string;student_id:string;concept_id:string;mastery:number;created_at:string;updated_at:string}>(`SELECT c.* FROM competencies c WHERE workspace_id=? AND NOT EXISTS(SELECT 1 FROM assessments a WHERE a.workspace_id=c.workspace_id AND a.student_id=c.student_id AND a.concept_id=c.concept_id)`,w);
 for(const c of manual)await tx.runAsync('INSERT OR IGNORE INTO assessments VALUES(?,?,?,?,?,?,?,?,?)',`legacy-score-${c.id}`,w,c.student_id,c.concept_id,c.updated_at.slice(0,10),c.mastery,1,c.created_at,c.updated_at);
 await tx.runAsync('DELETE FROM learner_concept_states WHERE workspace_id=?',w);
 for(const p of await tx.getAllAsync<{student_id:string;concept_id:string}>('SELECT DISTINCT student_id,concept_id FROM assessments WHERE workspace_id=?',w))await persistLearnerState(tx,w,p.student_id,p.concept_id);
}
