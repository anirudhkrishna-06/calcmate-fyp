const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const React=require('react');const {create,act}=require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const params={};
let scrolled=0,focused=0,keyboardShow,networkListener,release,sendCount=0,retryCount=0,lastContext=null;
const conversations=[{id:'c1',title:'New chat',grade:4,updated_at:'2026-10-10'}];
const messages={c1:[]};let selected='c1';
const service={
  async restoreConversation(){return conversations.find(c=>c.id===selected);},
  async listConversations(){return [...conversations];},
  async conversationMessages(id){return [...messages[id]];},
  async selectConversation(id){selected=id;},
  async createConversation(grade){const c={id:'c2',title:'New chat',grade,updated_at:'2026-10-10'};conversations.push(c);messages.c2=[];return c;},
  async sendMessage(id,text,grade,onSaved,onResponse,context){
    lastContext=context;
    sendCount++;messages[id].push({id:'m1',role:'teacher',text,status:'pending',sources_json:'[]'});await onSaved();
    await new Promise(resolve=>{release=resolve;});messages[id][0].status='failed';messages[id][0].error='Network unavailable';
  },
  async retryMessage(id,onSaved){retryCount++;const rows=messages.c1;rows[0].status='pending';await onSaved();rows[0].status='completed';rows.push({id:'a1',role:'assistant',text:'## Equal groups\n$2 \\times 3=6$',sources_json:JSON.stringify([{source_pdf:'math.pdf',grade:4,chunk_index:1,chunk_id:1,text:'Real excerpt',used_fallback:false}])});}
};
const native={
  Platform:{OS:'android'},StyleSheet:{create:x=>x},
  Keyboard:{dismiss(){},addListener(name,callback){keyboardShow=callback;return {remove(){}};}},
  Linking:{async openURL(){}},
  Text:'Text',View:'View',Pressable:'Pressable',Modal:'Modal',ActivityIndicator:'ActivityIndicator',KeyboardAvoidingView:'KeyboardAvoidingView',
  TextInput:React.forwardRef((props,ref)=>{React.useImperativeHandle(ref,()=>({focus(){focused++;}}));return React.createElement('TextInput',props);}),
  FlatList:React.forwardRef((props,ref)=>{
    React.useImperativeHandle(ref,()=>({scrollToEnd(){scrolled++;}}));
    return React.createElement('FlatList',props,props.data.length?props.data.map((item,index)=>React.createElement(React.Fragment,{key:item.id},props.renderItem({item,index}))):props.ListEmptyComponent,props.ListFooterComponent);
  })
};
const originalLoad=Module._load;const cache=new Map();
Module._load=function(request,parent,isMain){
  if(request==='react-native')return native;
  if(request==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
  if(request==='@expo/vector-icons')return {Ionicons:'Icon'};
  if(request==='expo-router')return {router:{back(){},push(){}},useLocalSearchParams:()=>params,useFocusEffect:callback=>React.useEffect(callback,[callback])};
  if(request==='@/hooks/useGrade')return {useGrade:()=>{const [grade,setGrade]=React.useState(4);return {grade,setGrade,error:''};}};
  if(request==='@react-native-community/netinfo')return {addEventListener(callback){networkListener=callback;callback({isConnected:true});return ()=>{};}};
  if(request==='react-native-webview')return {WebView:'WebView'};
  if(request==='@/services/chatService')return service;
  if(request==='@/services/ragClient')return {apiBaseUrl:()=> 'http://configured-api'};
  let resolved;
  if(request.startsWith('@/'))resolved=path.resolve(__dirname,'../src',request.slice(2));
  else if(request==='../app/chatbot')resolved=path.resolve(__dirname,request);
  else if(request.startsWith('.')&&/\.tsx?$/.test(parent?.filename??''))resolved=path.resolve(path.dirname(parent.filename),request);
  if(!resolved)return originalLoad.call(this,request,parent,isMain);
  resolved=[`${resolved}.ts`,`${resolved}.tsx`,path.join(resolved,'index.ts')].find(fs.existsSync);
  if(!resolved)throw new Error(`Missing ${request}`);
  if(cache.has(resolved))return cache.get(resolved).exports;
  const mod=new Module(resolved,parent);mod.filename=resolved;mod.paths=Module._nodeModulePaths(path.dirname(resolved));cache.set(resolved,mod);
  mod._compile(ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,resolved);return mod.exports;
};
async function run(){
  const Chat=require('../app/chatbot').default;let renderer;
  await act(async()=>{renderer=create(React.createElement(Chat));});
  const root=renderer.root;
  const composer=()=>root.findByProps({testID:'chat-composer'});
  const send=()=>root.findByProps({testID:'chat-send'});
  const button=label=>root.findAllByType('Pressable').find(node=>node.props.accessibilityLabel===label);
  assert.equal(root.findByType('KeyboardAvoidingView').props.behavior,'height');
  assert.equal(composer().props.multiline,true);assert.equal(composer().props.style.maxHeight,140);
  assert.equal(send().props.disabled,true);
  const prompt=root.findAllByType('Pressable').find(p=>p.findAllByType('Text').some(t=>t.props.children==='Explain equivalent fractions using paper strips'));
  await act(async()=>{prompt.props.onPress();});assert.ok(composer().props.value.includes('fractions'));assert.equal(focused,1);
  await act(async()=>{send().props.onPress();send().props.onPress();});assert.equal(sendCount,1);assert.equal(send().props.disabled,true);
  assert.ok(root.findAllByType('Text').some(t=>t.props.children==='Calcmate is thinking...'));assert.equal(composer().props.value,'');
  await act(async()=>{keyboardShow();});assert.ok(scrolled>0);
  await act(async()=>{release();});assert.ok(button('Retry failed question'));
  await act(async()=>{button('Retry failed question').props.onPress();});assert.equal(retryCount,1);assert.equal(messages.c1.filter(m=>m.role==='teacher').length,1);
  assert.ok(root.findByType('WebView').props.source.html.includes('<math'));
  await act(async()=>{button('View retrieved sources').props.onPress();});assert.ok(root.findAllByType('Text').some(t=>t.props.children==='Real excerpt'));
  await act(async()=>{button('New chat').props.onPress();});assert.equal(messages.c2.length,0);assert.equal(composer().props.value,'');
  await act(async()=>{networkListener({isConnected:false});button('Conversation history').props.onPress();});
  assert.ok(root.findAllByType('Text').some(t=>String(t.props.children).includes('Offline. Saved chats')));
  const historyItem=root.findAllByType('Pressable').find(p=>p.props.style?.some?.(s=>s?.borderBottomWidth===1)&&p.findAllByType('Text').some(t=>t.props.children==='New chat'));
  await act(async()=>{historyItem.props.onPress();});assert.ok(root.findByType('WebView'));
  await act(async()=>{renderer.unmount();});
  params.prompt='Explain equivalent fractions for Grade 4 Maths using paper strips.';
  await act(async()=>{renderer=create(React.createElement(Chat,{embedded:true}));});
  assert.equal(renderer.root.findByProps({testID:'chat-composer'}).props.value,params.prompt);
  assert.equal(renderer.root.findAllByType('Pressable').some(p=>p.props.accessibilityLabel==='Back'),false);
  assert.equal(sendCount,1); // Context drafts never send without teacher action.
  await act(async()=>{renderer.unmount();});
  // Increment 2: verify context object is forwarded when studentId/conceptId params are present
  params.prompt=undefined;params.studentId='test-student-1';params.conceptId='M408';params.screenContext='student_detail';
  sendCount=0;lastContext=null;
  await act(async()=>{renderer=create(React.createElement(Chat));});
  await act(async()=>{renderer.root.findByProps({testID:'chat-composer'}).props.onChangeText('How is this student doing?');});
  await act(async()=>{renderer.root.findByProps({testID:'chat-send'}).props.onPress();});
  assert.equal(lastContext?.student_id,'test-student-1','context.student_id must be forwarded');
  assert.equal(lastContext?.concept_id,'M408','context.concept_id must be forwarded');
  assert.equal(lastContext?.screen_context,'student_detail','context.screen_context must be forwarded');
  await act(async()=>{renderer.unmount();});Module._load=originalLoad;
  console.log('PASS: chat UI composer/keyboard structure, prompt focus, pending state, duplicate guard, retry, source rendering, explicit context drafts and embedded tab, new chat, history switching and offline banner, structured copilot context forwarding. Native keyboard pixels require device QA.');
}
run().catch(error=>{Module._load=originalLoad;console.error(error);process.exitCode=1;});
