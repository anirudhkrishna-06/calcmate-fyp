const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const filename=path.resolve(__dirname,'../src/services/generalScheduler.ts');
const mod=new Module(filename,module);mod.filename=filename;
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {buildGeneralSchedule,validateGeneralDraft,validateGeneralSelection}=mod.exports;
const date='2026-10-11';
function evidence(grade,mastery=0.9,count=8){
  const concept={id:`c${grade}`,grade,title:`Concept ${grade}`,prerequisite_id:null};
  const students=Array.from({length:count},(_,i)=>({id:`s${grade}-${i}`,grade}));
  return {selection:{grade,date},students,concepts:[concept],attendance:[],assessments:[],competencies:students.map(s=>({student_id:s.id,concept_id:concept.id,mastery,updated_at:date}))};
}
const payload=[1,2,3,4].map(g=>evidence(g));
const selection={date,grades:[1,2,3,4],availableMinutes:90,priority:'balanced'};
let cases=0;
for(let minutes=5;minutes<=480;minutes++)for(const grades of [[1],[1,3],[1,2,4],[1,2,3,4]]){
  const schedule=buildGeneralSchedule({...selection,grades,availableMinutes:minutes},payload);
  validateGeneralDraft(schedule);
  let end=0;let previousEnd=0;
  for(const block of schedule.blocks){
    const start=end;end+=block.durationMinutes;
    assert.ok(start>=previousEnd);previousEnd=end;
    assert.deepEqual(block.activities.map(a=>a.grade),grades);
    assert.ok(block.activities.every(a=>a.activity&&a.concept&&a.objective));
    if(block.kind==='instruction')assert.ok(grades.includes(block.teacherGrade));else assert.equal(block.teacherGrade,null);
  }
  assert.equal(end,minutes);
  if(minutes>=grades.length*8+grades.length-1+5)assert.deepEqual([...new Set(schedule.blocks.filter(b=>b.teacherGrade).map(b=>b.teacherGrade))].sort(),grades);
  cases++;
}
const stable=buildGeneralSchedule(selection,payload);
assert.ok(stable.blocks.some(b=>b.activities.some(a=>a.activity.startsWith('Pair practice'))));
assert.ok(stable.blocks.some(b=>b.activities.some(a=>a.activity.startsWith('Independent'))));
assert.deepEqual(buildGeneralSchedule({...selection,grades:[4,3,2,1]},[...payload].reverse()),stable);
const weakPayload=payload.map(p=>evidence(p.selection.grade,p.selection.grade===4?0.15:0.9));
const weak=buildGeneralSchedule({...selection,priority:'learning-needs'},weakPayload);
assert.equal(weak.blocks.find(b=>b.teacherGrade).teacherGrade,4);
const minutesFor=(schedule,g)=>schedule.blocks.filter(b=>b.teacherGrade===g).reduce((s,b)=>s+b.durationMinutes,0);
assert.ok(minutesFor(weak,4)>minutesFor(stable,4));
assert.ok(minutesFor(weak,4)>minutesFor(weak,1));
const balancedWeak=buildGeneralSchedule(selection,weakPayload);
assert.ok(minutesFor(weak,4)>minutesFor(balancedWeak,4));
const prerequisite=[evidence(1,0.3),evidence(2,0.1)];prerequisite[1].concepts[0].prerequisite_id='c1';
assert.equal(buildGeneralSchedule({...selection,grades:[1,2]},prerequisite).blocks.find(b=>b.teacherGrade).teacherGrade,1);
const missing=payload.map(p=>({...p,competencies:[],assessments:[]}));
const incomplete=buildGeneralSchedule(selection,missing);validateGeneralDraft(incomplete);assert.ok(incomplete.needs.every(n=>n.missing===8&&n.weak===0));
const unregistered=buildGeneralSchedule(selection,[]);validateGeneralDraft(unregistered);assert.ok(unregistered.warnings.length);
const brief=buildGeneralSchedule({...selection,availableMinutes:10},weakPayload);assert.ok(brief.warnings.some(w=>w.includes('independent tasks only')));
assert.ok(buildGeneralSchedule({...selection,availableMinutes:180},payload).blocks.filter(b=>b.kind==='instruction').length>4);
const absent=evidence(4,0.1);absent.attendance=absent.students.map(s=>({student_id:s.id,date,status:'absent'}));
const attendance=buildGeneralSchedule(selection,[...payload.slice(0,3),absent]);assert.equal(attendance.needs.find(n=>n.grade===4).attending,0);assert.notEqual(attendance.blocks.find(b=>b.teacherGrade).teacherGrade,4);
const assessed=evidence(4);assessed.assessments=assessed.students.map(s=>({id:s.id,student_id:s.id,concept_id:'c4',date,updated_at:'2026-10-12',score:1,maximum:10}));
assert.equal(buildGeneralSchedule(selection,[...payload.slice(0,3),assessed]).needs.find(n=>n.grade===4).weak,8);
for(const override of [{availableMinutes:0},{availableMinutes:481},{availableMinutes:5.5},{grades:[]},{grades:[1,1]},{grades:[5]},{date:'2026-02-30'},{date:'2026-99-99'},{priority:'random'}])assert.throws(()=>validateGeneralSelection({...selection,...override}));
const broken=structuredClone(stable);broken.blocks[0].durationMinutes++;assert.throws(()=>validateGeneralDraft(broken),/exactly/);
const uncovered=structuredClone(stable);uncovered.blocks[0].activities.pop();assert.throws(()=>validateGeneralDraft(uncovered),/Every grade/);
const duplicate=structuredClone(stable);duplicate.blocks[1].id=duplicate.blocks[0].id;assert.throws(()=>validateGeneralDraft(duplicate),/Duplicate/);
console.log(`PASS: ${cases} rotation timing/coverage cases; deterministic order, needs-based allocation, prerequisite priority, short-duration warnings, repeated rotations, attendance and assessment evidence, incomplete data, edit validation.`);
