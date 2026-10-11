const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const net=require('node:net');
const {spawn}=require('node:child_process');const {DatabaseSync}=require('node:sqlite');const Module=require('node:module');const ts=require('typescript');
const repository=path.resolve(__dirname,'../..');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'calcmate-http-'));
const credentials=new Map();const cache=new Map();const originalLoad=Module._load;const originalFetch=global.fetch;let server,native,network=true;
const environment={...process.env,CALCMATE_AUTH_DB:path.join(directory,'accounts.db'),CALCMATE_ALLOW_INSECURE_AUTH:'true',CALCMATE_ADMIN_PASSWORD:'integration-test-admin',CALCMATE_PRESENTATION_ROSTER:'true',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',CALCMATE_RAG_MODEL:process.env.CALCMATE_RAG_MODEL||'llama3.2:3b'};
const python=path.join(repository,'venv/Scripts/python.exe');
Module._load=function(request,parent,isMain){
  if(request==='react-native')return {Platform:{OS:'android'}};
  if(request==='expo-secure-store')return {getItemAsync:async k=>credentials.get(k)??null,setItemAsync:async(k,v)=>credentials.set(k,v),deleteItemAsync:async k=>credentials.delete(k)};
  if(request==='@react-native-community/netinfo')return {fetch:async()=>({isConnected:network})};
  if(request==='expo-sqlite')return {openDatabaseAsync:async()=>{
    const db=new DatabaseSync(path.join(directory,'local.db'));native??=db;
    return {closeAsync:async()=>db.close(),execAsync:async sql=>db.exec(sql),getFirstAsync:async(sql,...params)=>db.prepare(sql).get(...params)??null,getAllAsync:async(sql,...params)=>db.prepare(sql).all(...params),runAsync:async(sql,...params)=>db.prepare(sql).run(...params)};
  }};
  let resolved;if(request.startsWith('@/'))resolved=path.resolve(__dirname,'../src',request.slice(2));
  else if(request.startsWith('.')&&parent?.filename.endsWith('.ts'))resolved=path.resolve(path.dirname(parent.filename),request);
  if(!resolved)return originalLoad.call(this,request,parent,isMain);
  resolved=[`${resolved}.ts`,path.join(resolved,'index.ts')].find(fs.existsSync);if(!resolved)throw new Error(request);
  if(cache.has(resolved))return cache.get(resolved).exports;
  const mod=new Module(resolved,parent);mod.filename=resolved;mod.paths=Module._nodeModulePaths(path.dirname(resolved));cache.set(resolved,mod);
  mod._compile(ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,resolved);return mod.exports;
};
async function freePort(){const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
async function run(){
  const port=await freePort();const base=`http://127.0.0.1:${port}`;
  const script=`import sys\nfrom pathlib import Path\nfrom src.api import app\nfrom src.rag_api import _get_runtime\ncopilot,retriever=_get_runtime()\nretriever.log_path=Path(sys.argv[2])/'retrieval.jsonl'\ncopilot.COPILOT_LOG_PATH=Path(sys.argv[2])/'copilot.jsonl'\nimport uvicorn\nuvicorn.run(app,host='127.0.0.1',port=int(sys.argv[1]),log_level='error')`;
  server=spawn(python,['-u','-c',script,String(port),directory],{cwd:repository,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';const capture=chunk=>{logs=(logs+chunk.toString()).slice(-12000);};server.stderr.on('data',capture);server.stdout.on('data',capture);
  // Cold model imports are separate from the app's unchanged request timeout.
  const startupMs=Number(process.env.CALCMATE_TEST_STARTUP_MS||300000);
  const deadline=Date.now()+startupMs;let ready=false;
  while(Date.now()<deadline){if(server.exitCode!==null)throw new Error(`API startup failed: ${logs}`);try{const response=await fetch(`${base}/health`);if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(ready,`API did not become ready in ${startupMs/1000} seconds. Runtime output: ${logs}`);
  const api=require('@/services/apiClient');await api.configureApi(base);assert.equal((await api.checkConnection()).accounts,true);
  let auth=require('@/services/authService');let storage=require('@/services/storageService');
  const email='http-test@example.com',password='http-test-long-password-123';
  await auth.signUp(email,password,{name:'HTTP Teacher',schoolName:'School',experience:4,grades:[4]});
  assert.equal(await auth.checkApproval(),'pending');assert.equal(await auth.getSession(),null);
  await assert.rejects(()=>auth.signIn(email,password),/approval/);assert.equal(await auth.getSession(),null);
  const adminHeaders={Authorization:'Bearer integration-test-admin'};
  const inbox=await (await fetch(`${base}/admin/requests`,{headers:adminHeaders})).json();assert.equal(inbox.requests.length,1);
  const approval=await fetch(`${base}/admin/requests/${inbox.requests[0].id}/approve`,{method:'POST',headers:adminHeaders});assert.equal(approval.status,200);
  assert.equal(await auth.checkApproval(),'approved');assert.equal(await auth.getSession(),null);
  const session=await auth.signIn(email,password);assert.equal(session.approved,true);assert.equal((await storage.loadStudents()).length,32);
  await auth.signIn(email,password);assert.equal((await storage.loadStudents()).length,32);
  network=false;global.fetch=async()=>{throw new Error('Airplane-mode adapter blocks all HTTP');};
  await storage.saveTeacher({...await storage.loadTeacher(),name:'Offline Edited Teacher'});
  await storage.saveStudent({name:'Local Student',grade:4,roll:'09'});
  native.close();native=undefined;cache.clear();auth=require('@/services/authService');storage=require('@/services/storageService');
  assert.equal((await auth.getSession()).teacherId,session.teacherId);assert.equal((await storage.loadTeacher()).name,'Offline Edited Teacher');assert.equal((await storage.loadStudents()).length,33);
  await require('@/services/apiClient').loadApiConfiguration();global.fetch=originalFetch;network=true;
  const chat=require('@/services/chatService');const conversation=await chat.createConversation(4);
  await chat.sendMessage(conversation.id,'What are equivalent fractions?',4);
  const rows=await chat.conversationMessages(conversation.id);assert.equal(rows.length,2);assert.equal(rows[0].status,'completed');assert.ok(rows[1].text.length>0);assert.ok(JSON.parse(rows[1].sources_json).length>0);
  await auth.changeAccountEndpoint(`http://localhost:${port}`);
  assert.equal((await auth.getSession()).apiUrl,`http://localhost:${port}`);assert.equal((await storage.loadStudents()).length,33);
  const token=(await auth.getSession()).token;await auth.signOut();await auth.flushRevocations();
  assert.equal(await auth.getSession(),null);assert.equal((await fetch(`${base}/auth/me`,{headers:{Authorization:`Bearer ${token}`}})).status,401);
  console.log('PASS: actual frontend service -> live HTTP -> signup/pending/admin inbox approval/login and starter roster, offline SQLite reopen, real RAG/Ollama answer and sources, server logout revocation. Expo native bridges were adapted, not device-tested.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  global.fetch=originalFetch;Module._load=originalLoad;native?.close();
  if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  fs.rmSync(directory,{recursive:true,force:true});
});
