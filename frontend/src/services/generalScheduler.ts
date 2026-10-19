import { computeBktEstimate, computeMasteryEstimate } from "./learnerEstimator";
import type { Grade } from '@/types/domain';
import type { PlanningPayload } from '@/types/planning';
import type { GeneralSelection,GeneralDraft,GradeNeed,RotationBlock } from '@/types/generalSchedule';

export function validateGeneralSelection(s:GeneralSelection){
  if(!s||!Number.isInteger(s.availableMinutes)||s.availableMinutes<5||s.availableMinutes>480)throw new Error('Choose 5 to 480 whole minutes.');
  if(!Array.isArray(s.grades)||!s.grades.length||s.grades.length>5||new Set(s.grades).size!==s.grades.length||s.grades.some(g=>![1,2,3,4,5].includes(g)))throw new Error('Select at least one grade.');
  if(!['balanced','learning-needs'].includes(s.priority))throw new Error('Choose a planning priority.');
  if(s.focusGrade!==undefined&&!s.grades.includes(s.focusGrade))throw new Error('The focus grade must be one of the selected grades.');
  const parsed=new Date(`${s.date}T12:00:00Z`);
  if(typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s.date)throw new Error('Choose a valid planning date.');
}
const basics:Record<Grade,string>={1:'Counting and addition',2:'Place value and subtraction',3:'Multiplication and sharing',4:'Fractions and measurement',5:'Decimals, fractions and area'};
const prerequisitesOf=(concept:{prerequisite_id:string|null; prerequisite_ids?:string[]})=>concept.prerequisite_ids?.length?concept.prerequisite_ids:(concept.prerequisite_id?[concept.prerequisite_id]:[]);

type RankedConcept = { c: PlanningPayload['concepts'][number]; weak:number; missing:number; score:number };

/** Rank concepts using the same BKT evidence path as the live scheduler. */
export function rankGradeConcepts(p:PlanningPayload|undefined, grade:Grade, date:string):RankedConcept[] {
  const students=p?.students??[];
  const absent=new Set(p?.attendance.filter(a=>a.date===date&&a.status==='absent').map(a=>a.student_id));
  const attending=students.filter(s=>!absent.has(s.id));
  const concepts=(p?.concepts??[]).filter(c=>c.grade===grade).sort((a,b)=>a.id.localeCompare(b.id));
  const mastery=(student:string,concept:string)=>{
    const rows=p?.assessments.filter(a=>a.student_id===student&&a.concept_id===concept)??[];
    if(rows.length)return (computeBktEstimate??computeMasteryEstimate)(rows.map(a=>({...a,created_at:a.created_at??a.updated_at}))).mastery_estimate??undefined;
    return p?.competencies.find(c=>c.student_id===student&&c.concept_id===concept)?.mastery;
  };
  return concepts.map(c=>{
    const values=attending.map(s=>mastery(s.id,c.id));
    const weak=values.filter(v=>v!==undefined&&v<0.6).length;
    const missing=values.filter(v=>v===undefined).length;
    return {c,weak,missing,score:values.reduce<number>((sum,v)=>sum+(v===undefined?0.3:Math.max(0,0.8-v)),0)};
  }).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id));
}

/** Pure local rotation planner. Each sequential slot has one teacher assignment and a task for every grade. */
export function buildGeneralSchedule(selection:GeneralSelection,evidence:PlanningPayload[]):GeneralDraft{
  validateGeneralSelection(selection);
  const grades=[...selection.grades].sort((a,b)=>a-b);
  const allConcepts=evidence.flatMap(p=>p.concepts);
  const needs:GradeNeed[]=grades.map(grade=>{
    const p=evidence.find(p=>p.selection.grade===grade);
    const students=p?.students??[];
    const absent=new Set(p?.attendance.filter(a=>a.date===selection.date&&a.status==='absent').map(a=>a.student_id));
    const attending=students.filter(s=>!absent.has(s.id));
    const ranked=rankGradeConcepts(p,grade,selection.date);
    let focus=ranked[0];
    if(selection.focusConceptId){
      const requested=ranked.find(r=>r.c.id===selection.focusConceptId);
      if(requested)focus=requested;
    }
    const visited=new Set<string>();
    while(focus&&prerequisitesOf(focus.c)[0]&&!visited.has(focus.c.id)){
      visited.add(focus.c.id);
      const prerequisite=ranked.find(r=>prerequisitesOf(focus.c).includes(r.c.id)&&r.weak>0);
      if(!prerequisite)break;
      focus=prerequisite;
    }
    const concept=focus?.c.title??basics[grade];
    const weak=focus?.weak??0,missing=focus?.missing??attending.length;
    const prerequisiteGap=!!focus&&allConcepts.some(c=>prerequisitesOf(c).includes(focus.c.id))&&weak>0;
    const pressure=attending.length?(weak+missing*0.35)/attending.length:0;
    const weight=1+pressure*(selection.priority==='learning-needs'?3:1)+(prerequisiteGap?0.6:0)+Math.min(attending.length,40)/100;
    const reason=students.length===0?'No students enrolled; use a short readiness check.':attending.length===0?'All recorded absent; check attendance before teaching.':weak?`${weak} of ${attending.length} students need revision${prerequisiteGap?'; prerequisite first':''}.`:missing?'Assessment gaps; begin with a readiness check.':'Recorded evidence supports guided practice.';
    return {grade,students:students.length,attending:attending.length,missing,weak,prerequisiteGap,conceptId:focus?.c.id??null,concept,objective:`Explain and practise ${concept.toLowerCase()}.`,weight,reason};
  });
  const pending=[...needs].sort((a,b)=>Number(b.prerequisiteGap)-Number(a.prerequisiteGap)||b.weight-a.weight||a.grade-b.grade);
  const ordered:GradeNeed[]=[];
  // Stable topological order puts a selected weak prerequisite before its dependent grade.
  while(pending.length){
    const ready=pending.findIndex(n=>!pending.some(other=>other!==n&&other.weak>0&&other.conceptId&&allConcepts.some(c=>c.id===n.conceptId&&prerequisitesOf(c).includes(other.conceptId!))));
    ordered.push(pending.splice(ready<0?0:ready,1)[0]);
  }
  const common=selection.availableMinutes>=30?5:0;
  const guided=selection.availableMinutes-common;
  const firstRound=selection.focusGrade!==undefined?1:Math.min(grades.length,Math.max(1,Math.floor((guided+1)/6)));
  // Longer lessons use repeated rotations rather than an hour of unattended worksheets.
  const rounds=firstRound===grades.length?Math.min(Math.floor(8/grades.length),Math.max(1,Math.ceil(guided/(grades.length*25)))):1;
  const chosen=selection.focusGrade!==undefined
    ? [ordered.find(n=>n.grade===selection.focusGrade)??ordered[0]]
    : Array.from({length:rounds},()=>ordered.slice(0,firstRound)).flat();
  const count=chosen.length;
  const transitions=count-1;
  const budget=guided-transitions;
  const base=Math.min(8,Math.floor(budget/count));
  const remainder=budget-base*count;
  const totalWeight=chosen.reduce((s,n)=>s+n.weight,0);
  const durations=chosen.map(n=>base+Math.floor(remainder*n.weight/totalWeight));
  let spare=budget-durations.reduce((a,b)=>a+b,0);
  // Largest remainders distribute all remaining whole minutes without changing teacher order.
  const fractions=chosen.map((n,i)=>({i,f:remainder*n.weight/totalWeight-Math.floor(remainder*n.weight/totalWeight)})).sort((a,b)=>b.f-a.f||a.i-b.i);
  for(const {i} of fractions){if(spare<=0)break;durations[i]++;spare--;}
  const blocks:RotationBlock[]=[];
  const add=(kind:RotationBlock['kind'],minutes:number,teacher:GradeNeed|null,activity:string,reason:string)=>{
    const index=blocks.length;
    const practiceRound=blocks.filter(b=>b.kind==='instruction').length;
    blocks.push({id:`block-${index+1}`,kind,durationMinutes:minutes,teacherGrade:teacher?.grade??null,teacherActivity:activity,reason,status:'planned',activities:needs.map(n=>{
      const activityType = n.grade===teacher?.grade ? undefined : kind==='opening' ? 'group' : kind==='closing' ? 'assessment' : kind==='transition' ? 'independent' : n.grade===1 ? 'pair' : practiceRound%2===0 ? 'pair' : 'worksheet';
      const activity = kind==='opening'?'Join the number talk and collect materials.':kind==='closing'?'Complete a two-question exit check and hand it in.':kind==='transition'?'Finish the current question and prepare the next task.':n.grade===teacher?.grade?`Work with the teacher on ${n.concept.toLowerCase()}.`:n.grade===1?`Practise ${n.concept.toLowerCase()} with counters or picture cards; show a partner three answers.`:practiceRound%2===0?`Pair practice in ${n.concept.toLowerCase()}: take turns solving four examples; compare methods and mark one question to ask.`:`Independent ${n.concept.toLowerCase()} worksheet: solve four examples, explain one answer, then try an extension question.`;
      return {grade:n.grade,concept:n.concept,conceptId:n.conceptId,objective:n.objective,activity,activityType};
    })});
  };
  if(common)add('opening',3,null,'Lead a common number talk; set out tasks for each grade.','Prepare all grades for independent work.');
  chosen.forEach((n,i)=>{if(i)add('transition',1,null,'Check independent groups and switch the teacher group.','Allow time to move between grades.');add('instruction',durations[i],n,`${n.missing?'Check readiness, then':'Model one example, then'} guide practice in ${n.concept.toLowerCase()}.`,n.reason);});
  if(common)add('closing',2,null,'Review one solution per grade and collect exit questions.','Check understanding across the classroom.');
  const warnings:string[]=[];
  const without=grades.filter(g=>!chosen.some(n=>n.grade===g));
  if(without.length)warnings.push(`Too little time for every grade: Grades ${without.join(', ')} have independent tasks only. Add time or select fewer grades.`);
  else if(durations.some(d=>d<8))warnings.push('Teacher sessions are shorter than 8 minutes. Add time for meaningful individual instruction.');
  if(needs.some(n=>!n.students))warnings.push('Some grades have no enrolled students. Activities use grade-level readiness checks.');
  if(needs.some(n=>n.students&&n.attending===0))warnings.push('Some grades are recorded absent. Confirm attendance before using this schedule.');
  return {engine:'local-heuristic',policyVersion:'local-rotation-v2',kind:'general-schedule',version:1,selection:{...selection,grades},needs,warnings,blocks};
}

export function validateGeneralDraft(d:GeneralDraft){
  validateGeneralSelection(d.selection);
  if(d.kind!=='general-schedule'||d.version!==1||!Array.isArray(d.blocks)||!d.blocks.length||d.blocks.length>20||!Array.isArray(d.warnings)||d.warnings.some(w=>typeof w!=='string'||w.length>2000)||!Array.isArray(d.needs))throw new Error('Invalid general schedule.');
  if(d.needs.length!==d.selection.grades.length||new Set(d.needs.map(n=>n.grade)).size!==d.needs.length||d.needs.some(n=>!n||!d.selection.grades.includes(n.grade)||!Number.isFinite(n.weight)||n.weight<=0||![n.students,n.attending,n.missing,n.weak].every(v=>Number.isInteger(v)&&v>=0)||n.attending>n.students||n.missing>n.attending||n.weak>n.attending||typeof n.concept!=='string'||typeof n.reason!=='string'))throw new Error('Invalid schedule evidence summary.');
  const text=(v:unknown)=>typeof v==='string'&&!!v.trim()&&v.length<=2000;
  if(new Set(d.blocks.map(b=>b.id)).size!==d.blocks.length)throw new Error('Duplicate schedule blocks.');
  for(const b of d.blocks){
    if(!b||!text(b.id)||!Number.isInteger(b.durationMinutes)||b.durationMinutes<1||!text(b.teacherActivity)||!text(b.reason)||!['opening','instruction','transition','closing'].includes(b.kind)||!['planned','completed','postponed'].includes(b.status))throw new Error('Complete each schedule block.');
    if(b.kind==='instruction'?!d.selection.grades.includes(b.teacherGrade as Grade):b.teacherGrade!==null)throw new Error('Choose one teacher grade for each instruction block.');
    if(!Array.isArray(b.activities)||b.activities.length!==d.selection.grades.length||new Set(b.activities.map(a=>a.grade)).size!==b.activities.length||b.activities.some(a=>!d.selection.grades.includes(a.grade)||!text(a.concept)||!text(a.objective)||!text(a.activity)))throw new Error('Every grade needs an activity in every block.');
  }
  if(d.blocks.reduce((s,b)=>s+b.durationMinutes,0)!==d.selection.availableMinutes)throw new Error(`Activities must total exactly ${d.selection.availableMinutes} minutes.`);
}
