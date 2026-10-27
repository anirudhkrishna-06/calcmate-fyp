const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.style={};this.value='';this.textContent='';this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this[key]=value;}
  querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...(child.querySelectorAll?.(tag)??[])]);}
}
const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
let rows=[{id:'a1',email:'one@example.com',createdAt:123,profile:{name:'Ananya',schoolName:'School One',grades:[1],experience:2}},{id:'a2',email:'two@example.com',profile:{name:'Diya',schoolName:'School Two',grades:[2],experience:3}}];
let authorized=false;const posts=[];let history=[];
const context={document:{getElementById:element,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},confirm:()=>true,setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{
  authorized=options.headers.Authorization==='Bearer test-code';if(!authorized)return {ok:false,status:401,json:async()=>({detail:'Wrong code'})};
  if(options.method==='POST'){const data=JSON.parse(options.body);posts.push(data);history=rows.filter(r=>data.accountIds.includes(r.id)).map(r=>({...r,status:'approved',reviewedAt:456}));rows=rows.filter(r=>!data.accountIds.includes(r.id));return {ok:true,json:async()=>({count:data.accountIds.length})};}
  return {ok:true,json:async()=>({requests:url.includes('status=approved')?history:rows})};
}};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/admin.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
async function run(){
  element('code').value='test-code';await element('login-form').onsubmit({preventDefault(){}});assert.equal(element('count').textContent,'2 pending requests');assert.equal(element('code').value,'');
  element('search').value='school two';element('search').oninput();assert.equal(element('requests').querySelectorAll('article').length,1);
  element('select-all').onclick();assert.equal(element('approve-selected').textContent,'Approve selected (1)');
  await element('refresh').onclick();assert.equal(element('approve-selected').textContent,'Approve selected (1)');
  await element('approve-selected').onclick();assert.deepEqual(posts,[{accountIds:['a2']}]);assert.equal(element('count').textContent,'1 pending request');assert.equal(element('approve-selected').disabled,true);
  element('status').value='approved';await element('status').onchange();assert.equal(element('count').textContent,'1 approved request');assert.equal(element('requests').querySelectorAll('button').length,0);assert.equal(element('requests').querySelectorAll('input').length,0);assert.equal(element('approve-selected').disabled,true);
  element('logout').onclick();assert.equal(element('count').textContent,'Sign in to view requests');assert.equal(element('requests').children.length,0);
  console.log('PASS: actual admin page script with DOM/fetch adapters: protected login, search, selection retained across refresh, bulk approval and sign out. Browser pixels unverified.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
