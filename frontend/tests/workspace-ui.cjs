const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const React=require('react');const {create,act}=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
let session=null,listener,alert,available=true,approved=false,signupCount=0,savedAttendance,savedMarks,savedLessons,savedRotation,createdSelection,restored=false,selectedGrade=1,preventDirty=false,preventCallback;
let approvalStatus='pending';
const gradeListeners=new Set();const draftStore=new Map();
class ApiError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code;}}
const routes=[];const teacher={id:'t1',name:'Teacher Rao',schoolName:'School',grades:[1,2],experience:3,preferredSubject:'Math'};
const students=[{id:'s1',name:'Aarav',rollNumber:'01',grade:1,status:null,hasEvidence:true,mastery:0.85,currentUnit:'Counting'},{id:'s2',name:'Diya',rollNumber:'02',grade:1,status:'absent',hasEvidence:true,mastery:0.4,currentUnit:'Counting'}];
const auth={
  checkApproval:async()=>approvalStatus,
  requireSession:async()=>{if(!session)throw Error("Session required");return session;},getSession:async()=>session,refreshSession:async()=>session,pendingAccount:async()=>null,sessionPolicy:'Approved offline access expires in 24 hours.',
  subscribeSession(callback){listener=callback;return ()=>{listener=null;};},
  async exploreDemo(){session={mode:'demo',workspaceId:'demo',teacherId:'t1'};listener?.(session);},
  async signIn(){if(!approved)throw new ApiError('Awaiting administrator approval.',403,'pending-approval');session={mode:'real',workspaceId:'real',teacherId:'t1'};listener?.(session);},
  async signUp(email,password,profile){assert.ok(password.length>=8);assert.equal(profile.name,'New Teacher');signupCount++;return {status:'pending-approval'};},
  async signOut(){session=null;listener?.(null);},flushRevocations:async()=>{}
};
const native={Keyboard:{dismiss(){}},Platform:{OS:'android'},StyleSheet:{create:x=>x},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',Modal:'Modal',ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',ActivityIndicator:'ActivityIndicator',
  Alert:{alert(title,message,buttons){alert={title,message,buttons};}},AppState:{addEventListener(){return {remove(){}};}}
};
function Stack(props){return React.createElement('Stack',null,props.children);}
Stack.Screen=props=>React.createElement('Route',props);Stack.Protected=props=>props.guard?props.children:null;
const router={replace:route=>routes.push(route),push:route=>routes.push(route),back(){},setParams(){}};
const expo={router,Stack,useLocalSearchParams:()=>({grade:'1'}),useFocusEffect:callback=>React.useEffect(callback,[callback]),
  Link:props=>props.asChild?React.cloneElement(props.children,{onPress:()=>router.push(props.href)}):React.createElement('Link',{...props,onPress:()=>router.push(props.href)},props.children)};
const plan={id:'p1',kind:'lesson-plan',version:1,label:'DEMO/MOCK',engine:'mock-v1',createdAt:'2026-10-10',selection:{grade:1,date:'2026-10-10',availableMinutes:30},summary:{missing:[]},payload:{students:[{id:'s1',name:'Aarav'}]},lessons:[{order:1,title:'Counting practice',durationMinutes:20,objective:'Count objects',activities:['Use counters'],reasons:['Recorded weak concept'],studentIds:['s1']},{order:2,title:'Exit check',durationMinutes:10,objective:'Check understanding',activities:['Ask a short question'],reasons:['Collect evidence'],studentIds:['s1']}]};
const general={id:'g1',kind:'general-schedule',version:1,selection:{date:'2026-10-10',grades:[1,2],availableMinutes:90,priority:'balanced'},warnings:[],blocks:[{id:'b1',kind:'instruction',durationMinutes:90,teacherGrade:1,teacherActivity:'Model counting',reason:'Readiness check',status:'planned',activities:[{grade:1,concept:'Counting',objective:'Count objects',activity:'Use counters with teacher'},{grade:2,concept:'Place value',objective:'Read tens and ones',activity:'Pair practice'}]}]};
const originalLoad=Module._load;const cache=new Map();
Module._load=function(request,parent,isMain){
  if(request==='react-native')return native;
  if(request==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
  if(request==='@expo/vector-icons')return {Ionicons:'Icon'};
  if(request==='expo-status-bar')return {StatusBar:'StatusBar'};
  if(request==='expo-router')return expo;
  if(request==='expo-router/react-navigation')return {useNavigation:()=>({dispatch(){}}),usePreventRemove:(dirty,callback)=>{preventDirty=dirty;preventCallback=callback;}};
  if(request==='@/services/gradePreference')return {currentGrade:()=>selectedGrade,initializeGrade:async()=>{},selectGrade:async value=>{selectedGrade=value;gradeListeners.forEach(fn=>fn());},subscribeGrade:fn=>{gradeListeners.add(fn);return ()=>gradeListeners.delete(fn);}};
  if(request==='@/services/authService')return auth;
  if(request==='@/services/apiClient')return {ApiError,apiBaseUrl:()=> 'https://school.test',loadApiConfiguration:async()=>{},accountAvailability:async()=>available};
  if(request==='@/services/database')return {today:()=> '2026-10-10',getDatabase:async()=>({getFirstAsync:async(sql,key)=>draftStore.has(key)?{value:draftStore.get(key)}:null,runAsync:async(sql,key,value)=>{draftStore.set(key,value);}})};
  if(request==='@/services/storageService')return {loadTeacher:async()=>teacher,storageSummary:async()=>({students:2,assessments:2,plans:1}),loadStudents:async search=>students.filter(s=>!search||s.name.includes(search)||s.rollNumber.includes(search)),saveClassAssessments:async value=>{savedMarks=value;return value.entries.length;}};
  if(request==='@/services/generalScheduleService')return {listGeneralSchedules:async()=>[general],loadGeneralSchedule:async()=>general,createGeneralSchedule:async selection=>{createdSelection=selection;return general;},saveGeneralBlocks:async(id,blocks)=>{savedRotation=blocks;general.blocks=blocks;return general;}};
  if(request==='@/services/classroomService')return {
    classroomSummary:async()=>({teacher,mode:session?.mode,students:2,present:0,recorded:1,revision:1,grades:[{grade:1,total:2}],revisionStudents:[{id:'s2',name:'Diya',concept:'Counting'}]}),
    classLearningEvidence:async()=>({students:students.map(s=>({...s,roll:s.rollNumber})),concepts:[{id:"count",title:"Counting",grade:1,prerequisite_id:null}],progress:[{concept:{id:"count",title:"Counting"},recorded:1,missing:1,secure:0,practicing:0,revision:[{id:"s2",name:"Diya",roll:"02",mastery:0.4}]}]}),
    attendanceRegister:async()=>students.map(s=>({...s})),saveClassAttendance:async(grade,date,entries)=>{savedAttendance=entries;entries.forEach(e=>students.find(s=>s.id===e.studentId).status=e.status);}
  };
  if(request==='@/services/scheduleService')return {
    getScheduleSummary:async()=>({plans:[plan],legacy:[]}),loadSavedPlan:async()=>plan,
    readPlanningPayload:async selection=>({selection,students:[{id:'s1',grade:1}],attendance:[],assessments:[],competencies:[],concepts:[{id:'count',grade:1,title:'Counting',prerequisite_id:null}]}),generateSchedule:async()=>plan,
    savePlanLessons:async(id,lessons)=>{savedLessons=lessons;plan.lessons=lessons;return plan;}
  };
  if(request==='@/services/backupService')return {lastBackup:async()=>null,createLocalBackup:async()=>({status:'saved',path:'content://external/backup.json'}),selectBackup:async()=>({json:'backup',students:2,exportedAt:'2026-10-10'})};
  if(request==='@/services/restoreService')return {restoreBackupJson:async()=>{restored=true;}};
  let resolved;
  if(request.startsWith('@/'))resolved=path.resolve(__dirname,'../src',request.slice(2));
  else if(request.startsWith('../app/'))resolved=path.resolve(__dirname,request);
  else if(request.startsWith('.')&&/\.tsx?$/.test(parent?.filename??''))resolved=path.resolve(path.dirname(parent.filename),request);
  if(!resolved)return originalLoad.call(this,request,parent,isMain);
  resolved=[`${resolved}.ts`,`${resolved}.tsx`,path.join(resolved,'index.ts')].find(fs.existsSync);
  if(!resolved)throw new Error(`Missing ${request}`);if(cache.has(resolved))return cache.get(resolved).exports;
  const mod=new Module(resolved,parent);mod.filename=resolved;mod.paths=Module._nodeModulePaths(path.dirname(resolved));cache.set(resolved,mod);
  mod._compile(ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,resolved);return mod.exports;
};
let renderer;
async function mount(route){if(renderer)await act(async()=>renderer.unmount());await act(async()=>{renderer=create(React.createElement(require(route).default));});return renderer.root;}
const text=root=>root.findAllByType('Text').map(n=>String(n.props.children)).join('\n');
function button(root,label){return root.findAllByType('Pressable').find(n=>n.findAllByType('Text').some(t=>t.props.children===label));}
async function input(root,label,value){await act(async()=>root.findByProps({accessibilityLabel:label}).props.onChangeText(value));}
async function run(){
  let root=await mount('../app/_layout');assert.deepEqual(root.findAllByType('Route').map(n=>n.props.name),['index','connection','(auth)']);
  root=await mount('../app/(auth)/welcome');assert.ok(text(root).includes('Calcmate'));assert.ok(button(root,'Create teacher account'));assert.ok(button(root,'Log in'));
  await act(async()=>button(root,'Explore demo').props.onPress());assert.equal(session.mode,'demo');assert.equal(routes.at(-1),'/(tabs)');
  root=await mount('../app/_layout');assert.ok(root.findAllByType('Route').some(n=>n.props.name==='chatbot'));assert.ok(!root.findAllByType('Route').some(n=>n.props.name==='(auth)'));
  root=await mount('../app/(tabs)/index');assert.ok(text(root).includes('Demo'));assert.ok(button(root,'Log out'));assert.ok(!text(root).includes('Presentation roster'));assert.ok(button(root,'Mark attendance'));assert.ok(text(root).includes('Counting'));
  root=await mount('../app/attendance');assert.equal(root.findByType('KeyboardAvoidingView').props.behavior,'height');
  await act(async()=>root.findByProps({accessibilityLabel:'Attendance date'}).props.onPress());
  assert.ok(root.findAllByType('Modal').some(modal=>modal.props.visible));
  assert.equal(root.findByProps({accessibilityLabel:'2026-10-11'}).props.disabled,true);
  await act(async()=>root.findByProps({accessibilityLabel:'2026-10-10'}).props.onPress());
  await act(async()=>button(root,'Mark all present').props.onPress());assert.equal(students[1].status,'absent');
  await act(async()=>alert.buttons.find(b=>b.text==='Mark all').onPress());assert.equal(preventDirty,true);
  await act(async()=>button(root,'Undo mark all').props.onPress());assert.equal(preventDirty,false);assert.equal(button(root,'Save attendance (0 changes)').props.disabled,true);
  await act(async()=>button(root,'Mark all present').props.onPress());await act(async()=>alert.buttons.find(b=>b.text==='Mark all').onPress());
  await act(async()=>button(root,'Save attendance (2 changes)').props.onPress());assert.equal(savedAttendance.length,2);assert.equal(students[1].status,'present');assert.ok(text(root).includes('saved on this device'));
  assert.equal(preventDirty,false);
  root=await mount('../app/(tabs)/students');assert.ok(button(root,'Attendance'));assert.ok(button(root,'Assessments'));assert.ok(button(root,'Progress'));
  assert.equal(button(root,'Students').props.accessibilityRole,'tab');assert.equal(button(root,'Students').props.accessibilityState.selected,true);
  await input(root,'Search name or roll number',' aArAv ');assert.ok(text(root).includes('Aarav'));assert.ok(!text(root).includes('Diya'));assert.ok(text(root).includes('1 of 2 students'));
  await act(async()=>button(root,'Clear filters').props.onPress());assert.ok(text(root).includes('Diya'));
  await input(root,'Search name or roll number','02');assert.ok(!text(root).includes('Aarav'));assert.ok(text(root).includes('Diya'));await act(async()=>button(root,'Clear filters').props.onPress());
  await act(async()=>root.findByProps({accessibilityLabel:'Aarav, roll 01, Secure'}).props.onPress());assert.equal(routes.at(-1),'/students/s1');
  await act(async()=>button(root,'Needs revision').props.onPress());assert.ok(!text(root).includes('Aarav'));assert.ok(text(root).includes('Diya'));assert.equal(root.findByProps({accessibilityLabel:'Needs revision, 1 students'}).props.accessibilityState.selected,true);await act(async()=>button(root,'Clear filters').props.onPress());
  await act(async()=>button(root,'Assessments').props.onPress());
  await input(root,'Marks for Aarav','4');await input(root,'Marks for Diya','8');assert.equal(preventDirty,true);
  await act(async()=>preventCallback({data:{action:{type:'GO_BACK'}}}));assert.equal(alert.title,'Leave without saving?');
  // Leaving the tab flushes its class draft; reopening restores pending marks.
  root=await mount('../app/(tabs)/settings');root=await mount('../app/(tabs)/students');await act(async()=>button(root,'Assessments').props.onPress());
  assert.equal(root.findByProps({accessibilityLabel:'Marks for Aarav'}).props.value,'4');
  assert.equal(root.findByProps({accessibilityLabel:'Marks for Diya'}).props.value,'8');
  await act(async()=>button(root,'Save marks (2 students)').props.onPress());assert.equal(savedMarks.entries.length,2);assert.equal(savedMarks.conceptId,'count');assert.equal(preventDirty,false);
  await act(async()=>button(root,'Progress').props.onPress());assert.ok(text(root).includes('check understanding'));
  root=await mount('../app/(tabs)/schedule');assert.ok(button(root,'Create General Schedule'));assert.ok(button(root,'Create Lesson Plan'));assert.ok(text(root).includes('Saved general schedules'));assert.ok(text(root).includes('Saved lesson plans'));
  await act(async()=>button(root,'Create General Schedule').props.onPress());assert.equal(routes.at(-1),'/general-schedule/new');
  root=await mount('../app/general-schedule/new');assert.equal(root.findAllByType('Pressable').filter(n=>n.props.accessibilityRole==='checkbox'&&n.props.accessibilityState.checked).length,2);
  await act(async()=>button(root,'Grade 3').props.onPress());await input(root,'Total minutes','120');await act(async()=>button(root,'Learning needs').props.onPress());
  await act(async()=>button(root,'Create schedule').props.onPress());assert.deepEqual(createdSelection.grades,[1,2,3]);assert.equal(createdSelection.availableMinutes,120);assert.equal(createdSelection.priority,'learning-needs');assert.equal(routes.at(-1),'/general-schedule/g1');
  root=await mount('../app/general-schedule/[id]');assert.ok(text(root).includes('Pair practice'));assert.equal(button(root,'Save changes').props.disabled,true);
  await act(async()=>button(root,'Edit block').props.onPress());await input(root,'Teacher activity','Edited teacher activity');await input(root,'Grade 2 activity','Use place-value counters');
  await act(async()=>button(root,'Postponed').props.onPress());assert.equal(preventDirty,true);
  await act(async()=>button(root,'Save changes').props.onPress());assert.equal(savedRotation[0].status,'postponed');assert.equal(savedRotation[0].teacherActivity,'Edited teacher activity');assert.equal(savedRotation[0].activities[1].activity,'Use place-value counters');assert.equal(preventDirty,false);
  root=await mount('../app/schedule/generated');await act(async()=>button(root,'Review learning needs').props.onPress());assert.ok(button(root,'Generate plan'));assert.equal(button(root,'Advanced / developer details'),undefined);assert.ok(!text(root).includes('workspaceId'));
  await act(async()=>button(root,'Generate plan').props.onPress());assert.equal(routes.at(-1),'/schedule/p1');
  root=await mount('../app/schedule/[id]');assert.ok(!text(root).includes('developer details'));await act(async()=>button(root,'Edit activity').props.onPress());await input(root,'Activity title','Teacher edited practice');
  await act(async()=>button(root,'Completed').props.onPress());await act(async()=>button(root,'Move later').props.onPress());
  await act(async()=>button(root,'Save lesson changes').props.onPress());assert.equal(savedLessons[1].title,'Teacher edited practice');assert.equal(savedLessons[1].status,'completed');
  root=await mount('../app/(tabs)/settings');assert.equal(button(root,'Exit demo'),undefined);assert.equal(button(root,'Log out'),undefined);assert.equal(button(root,'Advanced settings'),undefined);assert.ok(button(root,'Server connection'));
  assert.ok(text(root).indexOf('Server connection')<text(root).indexOf('Teacher profile'));
  await act(async()=>button(root,'Server connection').props.onPress());assert.equal(routes.at(-1),'/connection');
  await act(async()=>button(root,'Restore backup').props.onPress());assert.equal(restored,false);assert.ok(alert.message.includes('replaced'));
  await act(async()=>alert.buttons.find(b=>b.text==='Replace records').onPress());assert.equal(restored,true);
  await auth.signOut();assert.equal(session,null);assert.equal(students.length,2);
  available=false;root=await mount('../app/(auth)/login');assert.equal(root.findAllByType('TextInput').length,0);assert.ok(button(root,'Set up connection'));
  available=true;root=await mount('../app/(auth)/signup');
  await input(root,'Teacher name','New Teacher');await input(root,'School','School');await input(root,'Email','teacher@example.com');await input(root,'Password (8+ characters, letters and numbers)','Teach123');await input(root,'Confirm password','Teach123');
  await act(async()=>button(root,'Request approval').props.onPress());assert.equal(signupCount,1);assert.equal(routes.at(-1),'/pending');assert.equal(session,null);
  root=await mount('../app/(auth)/pending');assert.ok(button(root,'Check now'));assert.ok(text(root).includes('checks automatically'));approvalStatus='approved';await act(async()=>button(root,'Check now').props.onPress());assert.ok(text(root).includes('Account approved'));assert.ok(button(root,'Log in'));assert.equal(session,null);
  approvalStatus='rejected';root=await mount('../app/(auth)/pending');assert.ok(text(root).includes('Contact your administrator'));assert.equal(button(root,'Log in'),undefined);approvalStatus='pending';
  root=await mount('../app/(auth)/login');await input(root,'Email','teacher@example.com');await input(root,'Password','Teach123');await act(async()=>button(root,'Log in').props.onPress());assert.equal(routes.at(-1),'/pending');assert.equal(session,null);
  approved=true;await input(root,'Password','Teach123');await act(async()=>button(root,'Log in').props.onPress());assert.equal(session.mode,'real');assert.equal(routes.at(-1),'/(tabs)');
  root=await mount('../app/(tabs)/settings');assert.equal(button(root,'Log out'),undefined);
  root=await mount('../app/(tabs)/index');await act(async()=>button(root,'Log out').props.onPress());assert.equal(session,null);assert.equal(routes.at(-1),'/welcome');assert.equal(students.length,2);
  root=await mount('../app/_layout');assert.ok(!root.findAllByType('Route').some(n=>n.props.name==='(tabs)'));assert.ok(root.findAllByType('Route').some(n=>n.props.name==='(auth)'));
  await act(async()=>renderer.unmount());Module._load=originalLoad;
  console.log('PASS: screen interactions with bridge/service mocks: auth guards, signup/approval/login, Home logout/session lock, visible top server connection, navigation buttons, attendance/undo/save, marks/draft recovery, Classroom progress, Planner actions and multigrade generation, timeline edits/status/save, existing lesson edits and recovery confirmation. Device layout remains unverified.');
}
run().catch(error=>{Module._load=originalLoad;console.error(error);process.exitCode=1;});
