const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Execute the actual repositories/migrations against SQLite, adapting only the Expo native bridge.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calcmate-test-'));
const filename = path.join(directory, 'workspace.db');
let native;
const credentials = new Map();
const originalLoad = Module._load;
let pickerMode='save'; let corruptWrite=false; const files=new Map();
let network={isConnected:true,isInternetReachable:true};
function adapter() {
  const db = new DatabaseSync(filename);
  native ??= db;
  const api = {
    async closeAsync() { db.close(); },
    async execAsync(sql) { db.exec(sql); },
    async getFirstAsync(sql, ...params) { return db.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, ...params) { return db.prepare(sql).all(...params); },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async withExclusiveTransactionAsync(task) {
      db.exec('BEGIN IMMEDIATE');
      try { await task(api); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return api;
}
const cache = new Map();
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return {Platform:{OS:'android'}};
  if (request === '@react-native-community/netinfo') return {fetch:async () => network};
  if (request === 'expo-file-system') return {
    Paths:{ document:{uri:'file:///private/documents'},cache:{uri:'file:///private/cache'} },
    Directory:class {
      static async pickDirectoryAsync() {
        if (pickerMode==='cancel') throw Object.assign(new Error('Cancelled'),{code:'ERR_PICKER_CANCELLED'});
        if (pickerMode==='error') throw new Error('Permission denied');
        if (pickerMode==='private') return {uri:'file:///private/documents'};
        return {uri:'content://chosen-folder',createFile(name) {
          const uri=`content://chosen-folder/${name}`;
          return { uri,write(text) { files.set(uri,corruptWrite ? 'invalid-json' : text); },async text() { return files.get(uri); },delete() { files.delete(uri); } };
        }};
      }
    }
  };
  if (request === 'expo-sqlite') return { openDatabaseAsync:async () => adapter() };
  if (request === 'expo-secure-store') return {
    getItemAsync:async key => credentials.get(key) ?? null,
    setItemAsync:async (key, value) => { credentials.set(key,value); }
    ,deleteItemAsync:async key => {credentials.delete(key);}
  };
  let resolved;
  if (request.startsWith('@/')) resolved = path.resolve(__dirname, '../src', request.slice(2)) + '.ts';
  else if (request.startsWith('.') && parent?.filename.endsWith('.ts')) resolved = path.resolve(path.dirname(parent.filename),request) + '.ts';
  if (!resolved) return originalLoad.call(this, request, parent, isMain);
  if (!fs.existsSync(resolved)) resolved=path.join(resolved.slice(0,-3),'index.ts');
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = new Module(resolved,parent); mod.filename=resolved; mod.paths=Module._nodeModulePaths(path.dirname(resolved)); cache.set(resolved,mod);
  const code=ts.transpileModule(fs.readFileSync(resolved,'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
  mod._compile(code,resolved); return mod.exports;
};
function services() {
  return { db:require('@/services/database'), demo:require('@/services/demoService'), auth:require('@/services/authService'), storage:require('@/services/storageService') };
}
async function run() {
  const originalFetch=global.fetch;
  let localHttpCalls=0;
  network={isConnected:false,isInternetReachable:false};
  global.fetch=async () => {localHttpCalls++;throw new Error('Local classroom operations must not use HTTP');};
  let { db,demo,auth,storage } = services();
  // Upgrade a real version-2 database containing messages; keep its records intact.
  const oldDatabase=new DatabaseSync(filename); oldDatabase.exec(db.migrations.slice(0,2).join('\n'));
  oldDatabase.exec('PRAGMA user_version=2');
  oldDatabase.prepare("INSERT INTO workspaces(id,teacher_id,mode,created_at) VALUES('upgrade-workspace','upgrade-teacher','demo','2025-01-01')").run();
  oldDatabase.prepare("INSERT INTO messages VALUES('old-message','upgrade-workspace','teacher','Old question','2025-01-01','2025-01-01')").run();
  oldDatabase.close();
  await assert.rejects(() => storage.loadStudents(), /session/);
  await auth.exploreDemo();
  const database = await db.getDatabase();
  assert.equal((await database.getFirstAsync('PRAGMA user_version')).user_version, db.migrations.length);
  assert.equal((await database.getFirstAsync("SELECT title FROM conversations WHERE workspace_id='upgrade-workspace'")).title,'Earlier chat');

  assert.equal((await database.getFirstAsync("SELECT text FROM messages WHERE id='old-message'")).text,'Old question');
  assert.equal((await storage.loadStudents()).length,32);
  const snapshot=await storage.dashboard();
  assert.deepEqual(snapshot.grades.map(g => [g.grade,g.total]),[[1,8],[2,8],[3,8],[4,8]]);
  assert.equal(snapshot.recorded,32); assert.equal(snapshot.present,28); assert.equal(snapshot.revision,12);
  await demo.seedDemo(); await auth.exploreDemo(); assert.equal((await storage.loadStudents()).length,32);
  const teacher=await storage.loadTeacher(); await storage.saveTeacher({ ...teacher,name:'Edited Teacher' });
  await assert.rejects(() => storage.saveTeacher({ ...teacher,grades:[] }), /grade/);
  const id=await storage.saveStudent({ name:'Offline Student',grade:2,roll:'09' });
  await storage.saveStudent({ name:'Renamed Student',grade:2,roll:'09' },id);
  assert.equal((await storage.loadStudents('Renamed',2)).length,1);
  assert.equal((await storage.dashboard()).students,33);
  assert.equal((await storage.dashboard()).grades.find(g => g.grade===2).total,9);
  await assert.rejects(() => storage.saveStudent({ name:'Duplicate',grade:2,roll:'09' }), /roll number/);
  await storage.saveAttendance('demo-student-1',db.today(),'present');
  assert.equal((await storage.dashboard()).present,29);
  await storage.saveAttendance(id,db.today(),'late');
  const classroom=require('@/services/classroomService');
  await classroom.saveClassAttendance(2,db.today(),[{studentId:'demo-student-9',status:'late'},{studentId:id,status:'late'}]);
  assert.equal((await classroom.attendanceRegister(2,db.today())).find(s=>s.id==='demo-student-9').status,'late');
  assert.equal((await classroom.classroomSummary(2)).students,9);
  await assert.rejects(()=>classroom.saveClassAttendance(2,db.today(),[{studentId:id,status:'absent'},{studentId:'demo-student-17',status:'present'}]),/class/);
  assert.equal((await classroom.attendanceRegister(2,db.today())).find(s=>s.id===id).status,'late');
  await assert.rejects(()=>classroom.saveClassAttendance(2,db.today(),[{studentId:id,status:'present'},{studentId:id,status:'absent'}]),/Duplicate/);
  await assert.rejects(() => storage.saveAttendance(id,'2026-02-30','present'), /date/);
  await storage.saveAssessment({ student_id:id,concept_id:'place',date:db.today(),score:6,maximum:10 });
  const assessments=await (await storage.localRepository('assessments')).list();
  const assessment=assessments.find(a => a.student_id===id);
  await storage.saveAssessment({ ...assessment,score:8 },assessment.id);
  assert.equal((await (await storage.localRepository('competencies')).list()).find(c => c.student_id===id).mastery,0.8);
  await storage.saveAssessment({ student_id:id,concept_id:'place',date:'2025-01-01',score:2,maximum:10 });
  assert.equal((await (await storage.localRepository('competencies')).list()).find(c => c.student_id===id).mastery,0.8);
  await storage.removeAssessment(assessment.id);
  assert.equal((await (await storage.localRepository('competencies')).list()).find(c => c.student_id===id).mastery,0.2);
  const before=(await (await storage.localRepository('assessments')).list()).length;
  await assert.rejects(() => storage.saveAssessment({ student_id:id,concept_id:'missing',date:db.today(),score:3,maximum:10 }), /FOREIGN KEY/);
  assert.equal((await (await storage.localRepository('assessments')).list()).length,before);
  await assert.rejects(() => storage.saveAssessment({ student_id:id,concept_id:'place',date:db.today(),score:11,maximum:10 }), /Score/);
  await storage.saveCompetency(id,'place',42); await storage.saveObservation(id,'Saved offline.');
  const batch={grade:1,conceptId:'count',date:db.today(),maximum:10,entries:[{studentId:'demo-student-1',score:4},{studentId:'demo-student-2',score:9}]};
  const countBefore=(await (await storage.localRepository('assessments')).list()).length;
  await storage.saveClassAssessments(batch);
  assert.equal((await (await storage.localRepository('assessments')).list()).length,countBefore+2);
  const progress=await classroom.classLearningEvidence(1);
  assert.ok(progress.progress.find(p=>p.concept.id==='count').revision.some(s=>s.id==='demo-student-1'));
  assert.ok(progress.progress.find(p=>p.concept.id==='count').secure>=1);
  const batchBefore=JSON.stringify(await (await storage.localRepository('assessments')).list());
  await assert.rejects(()=>storage.saveClassAssessments({...batch,entries:[{studentId:'demo-student-1',score:7},{studentId:id,score:8}]}),/class/);
  assert.equal(JSON.stringify(await (await storage.localRepository('assessments')).list()),batchBefore);
  await assert.rejects(()=>storage.saveClassAssessments({...batch,entries:[{studentId:'demo-student-1',score:11}]}),/Marks/);
  await assert.rejects(()=>storage.saveClassAssessments({...batch,conceptId:'place'}),/concept/);
  await assert.rejects(()=>storage.saveClassAssessments({...batch,entries:[batch.entries[0],batch.entries[0]]}),/Duplicate/);
  assert.equal((await storage.loadStudents('01',1)).length,1);
  const recovery=require('@/services/classroomDrafts');
  assert.equal(recovery.recoverAttendanceDraft({date:db.today(),changes:{s:'absent'}}),true);
  assert.equal(recovery.recoverAttendanceDraft({date:'2026-02-30',changes:{s:'absent'}}),false);
  assert.equal(recovery.recoverAttendanceDraft({date:db.today(),changes:{}}),false);
  assert.equal(recovery.recoverMarksDraft({concept:'count',date:db.today(),maximum:'10',marks:{s:'0'}}),true);
  assert.equal(recovery.recoverMarksDraft({concept:'count',date:db.today(),maximum:'10',marks:{s:{}}}),false);
  const preference=require('@/services/gradePreference');await preference.initializeGrade();await preference.selectGrade(3);
  assert.equal(preference.currentGrade(),3);
  assert.equal((await database.getFirstAsync("SELECT value FROM app_meta WHERE key='selected-grade-v1'")).value,'3');
  const scope=demo.demoScope;
  for (const [table,input] of [ ['schedules',{ data:JSON.stringify({ title:'Local lesson' }) }], ['messages',{role:'teacher',text:'Saved question'}] ]) {
    const repo=db.repository(table,scope); const key=await repo.save(input); assert.ok(await repo.get(key));
    await repo.save(input,key); assert.equal((await repo.list()).length,1);
  }
  await database.runAsync("INSERT INTO workspaces(id,teacher_id,mode,created_at) VALUES('real-workspace','real-teacher','real',?)",new Date().toISOString());
  const real=db.repository('students',{workspaceId:'real-workspace',teacherId:'real-teacher'});
  assert.equal((await real.list()).length,0);
  await real.save({name:'Isolated',grade:1,roll:'01'},id);
  assert.equal((await real.get(id)).name,'Isolated');
  await assert.rejects(() => db.repository('students',{workspaceId:scope.workspaceId,teacherId:'real-teacher'}).list(), /cannot access/);
  const backup=await storage.exportWorkspace(); assert.equal(backup.students.length,33); assert.ok(!JSON.stringify(backup).includes('Isolated'));
  const scheduler=require('@/services/scheduleService'); const planner=require('@/services/mockPlanner');
  const payload=await scheduler.readPlanningPayload({grade:3,subject:'Math',date:db.today(),availableMinutes:60});
  assert.equal(payload.students.length,8); assert.ok(payload.students.every(s => s.grade===3));
  assert.ok(payload.assessments.length>0); assert.ok(payload.competencies.length>0); assert.ok(payload.attendance.length>0);
  const draft=planner.generateMockPlan(payload); assert.deepEqual(planner.generateMockPlan(payload),draft);
  assert.equal(draft.lessons.reduce((sum,l) => sum+l.durationMinutes,0),60);
  assert.ok(draft.lessons.findIndex(l => l.conceptId==='multiply') < draft.lessons.findIndex(l => l.conceptId==='divide'));
  const strong=structuredClone(payload); strong.competencies.forEach(c => c.mastery=1); strong.assessments.forEach(a => a.score=a.maximum);
  assert.ok(planner.generateMockPlan(strong).lessons.every(l => !l.title.startsWith('Revision')));
  const unknown=structuredClone(payload); unknown.assessments=[]; unknown.competencies=[]; unknown.attendance=[];
  assert.ok(planner.summarizePlanning(unknown).missing.length>0);
  assert.ok(planner.generateMockPlan(unknown).lessons.some(l => l.title.startsWith('Readiness check')));
  const absent=structuredClone(payload); absent.attendance=absent.students.map(s => ({student_id:s.id,date:db.today(),status:'absent'}));
  assert.throws(() => planner.generateMockPlan(absent),/absences/);
  const historical=await scheduler.readPlanningPayload({grade:3,subject:'Math',date:'2025-01-01',availableMinutes:60});
  assert.equal(historical.competencies.length,0); assert.equal(historical.assessments.length,0);
  const cycle=structuredClone(payload); cycle.concepts.find(c => c.id==='count').prerequisite_id='divide';
  assert.throws(() => planner.generateMockPlan(cycle),/cycle/);
  await assert.rejects(() => scheduler.readPlanningPayload({grade:3,subject:'Math',date:'2026-02-30',availableMinutes:60}),/date/);
  let plan=await scheduler.generateSchedule(payload); assert.equal(plan.label,'DEMO/MOCK');
  const edited=structuredClone(plan.lessons).reverse();edited[0].title='Teacher edited exit check';edited[0].activities=['Use a short oral understanding check.'];edited[0].status='completed';edited[1].status='partial';
  plan=await scheduler.savePlanLessons(plan.id,edited);
  assert.equal(plan.lessons[0].title,'Teacher edited exit check');assert.equal(plan.lessons[0].status,'completed');
  assert.equal(plan.lessons[1].status,'partial');assert.equal(plan.lessons[0].order,1);assert.equal(plan.label,'DEMO/MOCK');
  assert.deepEqual(plan.payload,JSON.parse(JSON.stringify(payload)));
  await assert.rejects(()=>scheduler.savePlanLessons(plan.id,plan.lessons.map(l=>({...l,durationMinutes:0}))),/minutes/);
  assert.equal((await scheduler.loadSavedPlan(plan.id)).lessons[0].status,'completed');
  const changed=payload.competencies[0];
  await storage.saveCompetency(changed.student_id,changed.concept_id,10);
  const refreshed=await scheduler.readPlanningPayload(payload.selection);
  assert.equal(refreshed.competencies.find(c => c.id===changed.id).mastery,0.1);
  assert.notDeepEqual(refreshed.competencies,payload.competencies);
  await assert.rejects(() => scheduler.generateSchedule({...payload,workspaceId:'real-workspace'}),/different workspace/);
  const generalService=require('@/services/generalScheduleService');
  let general=await generalService.createGeneralSchedule({grades:[1,2,3,4],date:db.today(),availableMinutes:90,priority:'learning-needs'});
  assert.equal(general.blocks.reduce((s,b)=>s+b.durationMinutes,0),90);
  assert.equal((await generalService.listGeneralSchedules()).length,1);
  assert.equal((await scheduler.getScheduleSummary()).plans.length,1);
  assert.deepEqual((await generalService.loadGeneralSchedule(general.id)).selection.grades,[1,2,3,4]);
  const generalEdits=structuredClone(general.blocks);generalEdits[0].teacherActivity='Teacher edited opening';generalEdits[0].status='completed';generalEdits[1].status='postponed';
  general=await generalService.saveGeneralBlocks(general.id,generalEdits);
  await assert.rejects(()=>generalService.saveGeneralBlocks(general.id,general.blocks.map((b,i)=>i?b:{...b,durationMinutes:b.durationMinutes+1})),/exactly/);
  assert.equal((await generalService.loadGeneralSchedule(general.id)).blocks[0].status,'completed');
  const formatter=require('@/services/backupFormat'); const exporter=require('@/services/backupService');
  const exported=formatter.validateBackupJson(formatter.serializeBackup(await storage.exportWorkspace()));
  assert.equal(exported.students.length,33); assert.equal(exported.schedules.length,3); assert.equal(exported.chatHistory.length,1);
  const injected=structuredClone(await storage.exportWorkspace()); injected.profiles[0].data=JSON.stringify({name:'Teacher',password:'hidden-password',access_token:'hidden-token'});
  assert.ok(!formatter.serializeBackup(injected).includes('hidden-'));
  const saved=await exporter.createLocalBackup(); assert.equal(saved.status,'saved'); assert.ok(saved.path.startsWith('content://chosen-folder'));
  formatter.validateBackupJson(files.get(saved.path));
  pickerMode='cancel'; assert.equal((await exporter.createLocalBackup()).status,'cancelled');
  pickerMode='error'; await assert.rejects(() => exporter.createLocalBackup(),/select/);
  pickerMode='private'; await assert.rejects(() => exporter.createLocalBackup(),/private storage/);
  pickerMode='save'; corruptWrite=true; await assert.rejects(() => exporter.createLocalBackup(),/verified/); corruptWrite=false;
  const raw=credentials.get('calcmate.session.v2'); assert.ok(!raw.includes('password'));
  assert.equal(localHttpCalls,0);
  await assert.rejects(() => auth.signIn('teacher@example.com','long-password-123'), /server/);
  await assert.rejects(() => auth.signUp('teacher@example.com','long-password-123',{name:'Teacher',schoolName:'School',experience:1,grades:[1]}), /server/);
  native.close(); native = undefined; cache.clear();
  ({ db,demo,auth,storage } = services());
  assert.equal((await auth.getSession()).mode,'demo');
  const restoredPreference=require('@/services/gradePreference');await restoredPreference.initializeGrade();assert.equal(restoredPreference.currentGrade(),3);
  assert.equal((await storage.loadTeacher()).name,'Edited Teacher');
  assert.equal((await storage.loadStudents()).length,33);
  assert.equal((await storage.loadStudents('Renamed')).length,1);
  assert.deepEqual(await require('@/services/scheduleService').loadSavedPlan(plan.id),JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(await require('@/services/generalScheduleService').loadGeneralSchedule(general.id),JSON.parse(JSON.stringify(general)));
  assert.equal((await (await storage.localRepository('attendance')).list()).find(a => a.student_id===id && a.date===db.today()).status,'late');
  assert.equal((await (await storage.localRepository('assessments')).list()).find(a => a.student_id===id).score,2);
  assert.equal((await (await storage.localRepository('observations')).list()).find(o => o.student_id===id).note,'Saved offline.');
  assert.equal((await (await storage.localRepository('competencies')).list()).find(c => c.student_id===id).mastery,0.42);
  await (await storage.localRepository('students')).remove(id);
  for (const table of ['attendance','assessments','competencies','observations']) {
    assert.equal((await (await storage.localRepository(table)).list()).filter(r => r.student_id===id).length,0);
  }
  assert.equal((await storage.loadStudents()).length,32);
  const repo=await storage.localRepository('messages'); const message=(await repo.list())[0]; await repo.remove(message.id); assert.equal((await repo.list()).length,0);
  assert.equal(localHttpCalls,2); // Explicit login/signup now attempt the default server.
  let chat=require('@/services/chatService'); const rag=require('@/services/ragClient');
  network={isConnected:true,isInternetReachable:true}; process.env.EXPO_PUBLIC_API_BASE_URL='http://rag.test:8000';
  const c1=await chat.createConversation(4); assert.equal((await chat.conversationMessages(c1.id)).length,0);
  const source={chunk_id:7,text:'Equal groups',grade:4,subject:'Math',source_pdf:'math.pdf',chunk_index:1,score:0.8,used_fallback:false};
  const response={answer:'## Multiplication\nUse **equal groups** and $2 \\times 3=6$.',chunks:[source]};
  let release; let posted;
  global.fetch=async (url,options) => {assert.equal(url,'http://rag.test:8000/chat');posted=JSON.parse(options.body);return new Promise(resolve => {release=() => resolve({ok:true,json:async () => response});});};
  const pendingSend=chat.sendMessage(c1.id,'Explain multiplication',4);
  while(!release) await new Promise(resolve => setTimeout(resolve,1));
  let rows=await chat.conversationMessages(c1.id); assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');
  await assert.rejects(() => chat.sendMessage(c1.id,'Duplicate request',4),/pending/);
  release(); await pendingSend;
  assert.deepEqual(Object.keys(posted).sort(),['grade','question','subject','use_llm','workspace_id']);
  rows=await chat.conversationMessages(c1.id);assert.equal(rows.length,2);assert.equal(rows[0].status,'completed');assert.deepEqual(JSON.parse(rows[1].sources_json),[source]);
  global.fetch=async () => {throw new TypeError('Network failed');};
  await chat.sendMessage(c1.id,'Teach division',3);rows=await chat.conversationMessages(c1.id);
  const failed=rows.find(r => r.status==='failed');assert.ok(failed.error.includes('Cannot reach')); const beforeRetry=rows.length;
  global.fetch=async (url,options) => {assert.equal(JSON.parse(options.body).grade,3);return {ok:true,json:async () => response};};
  const retries=await Promise.allSettled([chat.retryMessage(failed.id),chat.retryMessage(failed.id)]);
  assert.equal(retries.filter(r => r.status==='rejected').length,1);
  rows=await chat.conversationMessages(c1.id);assert.equal(rows.length,beforeRetry+1);assert.equal(rows.filter(r => r.id===failed.id).length,1);
  for (const status of [422,500,503]) {
    global.fetch=async () => ({ok:false,status});await chat.sendMessage(c1.id,`Error ${status}`,4);
    assert.ok((await chat.conversationMessages(c1.id)).some(r => r.text===`Error ${status}` && r.status==='failed'));
  }
  global.fetch=async () => ({ok:true,json:async () => {throw new SyntaxError('bad');}});await chat.sendMessage(c1.id,'Invalid JSON',4);
  assert.ok((await chat.conversationMessages(c1.id)).some(r => r.error?.includes('invalid JSON')));
  global.fetch=async () => ({ok:true,json:async () => ({answer:'Bad metadata',chunks:[{source_pdf:'invented'}]})});await chat.sendMessage(c1.id,'Malformed sources',4);
  assert.ok((await chat.conversationMessages(c1.id)).some(r => r.error?.includes('source metadata')));
  global.fetch=async (url,options) => new Promise((resolve,reject) => {options.signal.addEventListener('abort',() => reject(new Error('Abort')));});
  await assert.rejects(() => rag.requestRag({question:'Timeout',grade:4,subject:'Math'},5),/timed out/);
  network={isConnected:false,isInternetReachable:false};global.fetch=async () => {throw new Error('Offline must not fetch');};
  const c2=await chat.createConversation(2);await chat.sendMessage(c2.id,'Offline question',2);
  assert.ok((await chat.conversationMessages(c2.id))[0].error.includes('Offline'));
  assert.ok((await chat.conversationMessages(c1.id)).length>2);
  await chat.selectConversation(c1.id);assert.equal((await chat.restoreConversation()).id,c1.id);
  const markdown=require('@/services/assistantMarkdown'); const html=markdown.assistantDocument('# Heading\n- One\n- Two\n\n```ts\nlet x=1;\n```\n\n$\\frac{1}{2}$\n\n<script>alert(1)</script>');
  assert.ok(html.includes('<h1>') && html.includes('<ul>') && html.includes('<pre>') && html.includes('<math'));
  assert.ok(!html.includes('<script>alert(1)'));
  const chatBackup=formatter.validateBackupJson(formatter.serializeBackup(await storage.exportWorkspace()));
  assert.equal(chatBackup.conversations.length,2);assert.ok(chatBackup.chatMessageDetails.some(d => d.reply_to===failed.id));
  await require('@/services/chatRepository').prepareMessage(c2.id,'Interrupted question',2);await chat.selectConversation(c2.id);
  native.close();native=undefined;cache.clear();({db,demo,auth,storage}=services());chat=require('@/services/chatService');
  assert.equal((await chat.restoreConversation()).id,c2.id);
  assert.ok((await chat.conversationMessages(c2.id)).some(r => r.text==='Interrupted question' && r.status==='failed' && r.error.includes('interrupted')));
  assert.deepEqual(JSON.parse((await chat.conversationMessages(c1.id)).find(r => r.role==='assistant').sources_json),[source]);
  const restore=require('@/services/restoreService');
  const restoreJson=formatter.serializeBackup(await storage.exportWorkspace());
  await storage.saveTeacher({...await storage.loadTeacher(),name:'Changed after backup'});
  await restore.restoreBackupJson(restoreJson);
  assert.equal((await storage.loadTeacher()).name,'Edited Teacher');
  assert.deepEqual(await require('@/services/generalScheduleService').loadGeneralSchedule(general.id),JSON.parse(JSON.stringify(general)));
  assert.equal((await chat.conversationMessages(c1.id)).find(r=>r.role==='assistant').text,response.answer);
  const legacyRestore=JSON.parse(restoreJson);legacyRestore.version=1;delete legacyRestore.conversations;delete legacyRestore.chatMessageDetails;
  await restore.restoreBackupJson(JSON.stringify(legacyRestore));
  assert.equal((await chat.conversationMessages(`legacy-${demo.demoScope.workspaceId}`)).length,legacyRestore.chatHistory.length);
  await restore.restoreBackupJson(restoreJson);
  const invalidPlan=JSON.parse(restoreJson);invalidPlan.schedules.find(s=>s.data.kind==='lesson-plan').data.selection=null;
  await assert.rejects(()=>restore.restoreBackupJson(JSON.stringify(invalidPlan)),/Invalid saved lesson plan/);
  const invalidGeneral=JSON.parse(restoreJson);invalidGeneral.schedules.find(s=>s.data.kind==='general-schedule').data.blocks[0].durationMinutes++;
  await assert.rejects(()=>restore.restoreBackupJson(JSON.stringify(invalidGeneral)),/exactly/);
  const wrongGeneral=JSON.parse(restoreJson);wrongGeneral.schedules.find(s=>s.data.kind==='general-schedule').data.teacherId='another-teacher';
  await assert.rejects(()=>restore.restoreBackupJson(JSON.stringify(wrongGeneral)),/owner/);
  assert.equal((await require('@/services/generalScheduleService').loadGeneralSchedule(general.id)).blocks[0].teacherActivity,'Teacher edited opening');
  assert.equal((await storage.loadTeacher()).name,'Edited Teacher');
  const wrongWorkspace=JSON.parse(restoreJson);wrongWorkspace.students[0].workspace_id='real-workspace';
  await assert.rejects(()=>restore.restoreBackupJson(JSON.stringify(wrongWorkspace)),/another workspace/);
  const invalidRestore=JSON.parse(restoreJson);invalidRestore.attendance[0].student_id='missing-student';
  await assert.rejects(()=>restore.restoreBackupJson(JSON.stringify(invalidRestore)),/FOREIGN KEY/);
  assert.equal((await storage.loadStudents()).length,32);
  assert.equal((await storage.loadTeacher()).name,'Edited Teacher');
  global.fetch=originalFetch;delete process.env.EXPO_PUBLIC_API_BASE_URL;
  await auth.signOut();assert.equal(await auth.getSession(),null);await assert.rejects(()=>storage.loadStudents(),/session/);
  await auth.exploreDemo();assert.equal((await storage.loadStudents()).length,32);
  const validReal={mode:'real',approved:true,workspaceId:'real-workspace',teacherId:'real-teacher',token:'test-token',validUntil:new Date(Date.now()+60000).toISOString()};
  for (const invalid of [{...validReal,approved:false},{...validReal,token:''},{...validReal,validUntil:null},{...validReal,validUntil:'invalid-date'}]) {
    credentials.set('calcmate.session.v2',JSON.stringify(invalid));
    assert.equal(await auth.getSession(),null);
    await assert.rejects(() => storage.loadStudents(),/session/);
  }
  credentials.set('calcmate.session.v2',JSON.stringify(validReal));
  assert.equal((await auth.getSession()).mode,'real');
  assert.equal((await storage.loadStudents())[0].name,'Isolated');
  const signupProfile={name:'Approved Teacher',schoolName:'School',experience:2,grades:[1]};
  process.env.EXPO_PUBLIC_API_BASE_URL='http://203.0.113.8:8000';
  let insecureCalls=0;
  global.fetch=async()=>{insecureCalls++;throw new Error('Credentials must not leave the app');};
  await assert.rejects(()=>auth.signUp('teacher@example.com','long-password-123',signupProfile),/HTTPS/);
  await assert.rejects(()=>auth.signIn('teacher@example.com','long-password-123'),/HTTPS/);
  credentials.set('calcmate.session.v2',JSON.stringify({...validReal,apiUrl:process.env.EXPO_PUBLIC_API_BASE_URL}));
  await auth.refreshSession();
  credentials.set('calcmate.revocations.v1',JSON.stringify([{token:'test-token',base:process.env.EXPO_PUBLIC_API_BASE_URL,expires:validReal.validUntil}]));
  await auth.flushRevocations();
  assert.equal(insecureCalls,0);
  credentials.delete('calcmate.revocations.v1');
  const api=require('@/services/apiClient');
  for(const base of ['http://192.168.1.8:8000','http://10.1.2.3:8000','http://172.16.0.2:8000'])assert.equal(api.accountTransportAllowed(base),true);
  for(const base of ['http://192.168.evil.test','http://10.example.com','http://172.32.0.1'])assert.equal(api.accountTransportAllowed(base),false);
  process.env.EXPO_PUBLIC_API_BASE_URL='http://192.168.1.8:8000';
  global.fetch=async()=>({ok:false,status:403,json:async()=>({detail:{code:'pending-approval',message:'Awaiting administrator approval.'}})});
  await assert.rejects(()=>auth.signIn('teacher@example.com','long-password-123'),error=>error.code==='pending-approval');
  assert.equal(await auth.pendingAccount(),'teacher@example.com');
  global.fetch=async()=>({ok:true,json:async()=>({available:false,approvalRequired:true})});
  await assert.rejects(()=>api.accountAvailability(),/CALCMATE_ALLOW_INSECURE_AUTH=true/);
  process.env.EXPO_PUBLIC_API_BASE_URL='https://accounts.test';
  global.fetch=async()=>({ok:true,json:async()=>({status:'pending-approval'})});
  assert.equal((await auth.signUp('teacher@example.com','long-password-123',signupProfile)).status,'pending-approval');
  global.fetch=async()=>({ok:true,json:async()=>({...validReal,approved:false,profile:signupProfile})});
  await assert.rejects(()=>auth.signIn('teacher@example.com','long-password-123'),/approved/);
  global.fetch=async()=>({ok:true,json:async()=>({...validReal,profile:{...signupProfile,id:'real-teacher',preferredSubject:'Math'}})});
  await auth.signIn('teacher@example.com','long-password-123');
  assert.equal((await storage.loadTeacher()).name,'Approved Teacher');
  assert.equal((await storage.loadStudents()).length,1);
  assert.ok(!credentials.get('calcmate.session.v2').includes('long-password'));
  let finishRefresh;
  global.fetch=async url=>url.endsWith('/auth/me') ? new Promise(resolve=>{finishRefresh=resolve;}) : ({ok:true,json:async()=>({status:'signed-out'})});
  const refreshing=auth.refreshSession();
  while(!finishRefresh)await new Promise(resolve=>setImmediate(resolve));
  await auth.signOut();
  finishRefresh({ok:true,json:async()=>({...validReal})});await refreshing;
  assert.equal(await auth.getSession(),null);
  global.fetch=async()=>({ok:true,json:async()=>({...validReal,profile:{...signupProfile,id:'real-teacher',preferredSubject:'Math'}})});
  await auth.signIn('teacher@example.com','long-password-123');
  // A failed offline logout removes local access and queues server revocation securely.
  global.fetch=async()=>{throw new Error('offline');};await auth.signOut();await auth.flushRevocations();
  assert.equal(await auth.getSession(),null);assert.ok(credentials.get('calcmate.revocations.v1').includes('test-token'));
  global.fetch=async()=>({ok:true,json:async()=>({status:'signed-out'})});await auth.flushRevocations();
  assert.equal(credentials.get('calcmate.revocations.v1'),'[]');global.fetch=originalFetch;delete process.env.EXPO_PUBLIC_API_BASE_URL;
  // Starter roster seeds once per approved workspace and preserves later edits/deletions.
  const workspace=require('@/services/workspaceService');
  const starterScope={workspaceId:'starter-workspace',teacherId:'starter-teacher'};
  const starterProfile={...signupProfile,id:'starter-teacher',preferredSubject:'Math',grades:[1,2,3,4]};
  await workspace.initializeTeacherWorkspace(starterScope,starterProfile,true);
  const starterStudents=db.repository('students',starterScope);
  assert.equal((await starterStudents.list()).length,32);
  assert.equal((await starterStudents.get('starter-student-1')).name,'Aarav Sharma');
  await starterStudents.save({name:'Teacher edited name',grade:1,roll:'01'},'starter-student-1');
  await starterStudents.remove('starter-student-2');
  await workspace.initializeTeacherWorkspace(starterScope,starterProfile,true);
  assert.equal((await starterStudents.list()).length,31);
  assert.equal((await starterStudents.get('starter-student-1')).name,'Teacher edited name');
  await starterStudents.save({name:'New Indian Student',grade:1,roll:'09'});
  assert.equal((await starterStudents.list()).length,32);
  credentials.set('calcmate.session.v2',JSON.stringify({mode:'real',approved:true,workspaceId:'real-workspace',teacherId:'real-teacher',token:'test-token',validUntil:'2000-01-01T00:00:00Z'}));
  assert.equal(await auth.getSession(),null); await assert.rejects(() => storage.loadStudents(), /session/);
  console.log('PASS: offline CRUD, bulk marks rollback/progress, persistent grade, lesson editing/status/reorder, general rotation creation/edit/status/restart/backup/restore validation, seed idempotence, class attendance/rollback, backup isolation/rollback, signup/approval/logout/revocation, HTTPS credential guard, session expiry, chat retry/history/sources/errors and Markdown/MathML.');
}
run().catch(error => { console.error(error); process.exitCode=1; }).finally(() => {
  native?.close(); Module._load=originalLoad; fs.rmSync(directory,{recursive:true,force:true});
});
