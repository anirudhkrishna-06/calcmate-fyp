import * as SecureStore from "expo-secure-store";
import { demoScope, seedDemo } from "./demoService";
import { Scope } from "./database";
import { Teacher } from "@/types/domain";
import { apiBaseUrl,accountTransportAllowed,apiRequest,ApiError,normalizeApiUrl,configureApi } from "./apiClient";
import { initializeTeacherWorkspace } from "./workspaceService";
const SESSION_KEY="calcmate.session.v2";const REVOCATIONS="calcmate.revocations.v1";
export type AuthSession=Scope & {mode:"demo"|"real";approved:boolean;createdAt:string;validUntil:string|null;token?:string;apiUrl?:string;profile?:Teacher;presentationRoster?:boolean};
export type SignupInput={name:string;schoolName:string;experience:number;grades:number[]};
export const sessionPolicy="Approved accounts can reopen cached records offline for up to 24 hours after login. Approval changes are checked when the server is reachable. Logout locks local records without deleting them; offline server revocation waits for reconnection.";
let active:AuthSession|null=null;
let generation=0;
const listeners=new Set<(session:AuthSession|null)=>void>();
let sessionWork:Promise<unknown>=Promise.resolve();
function sessionTransaction<T>(work:()=>Promise<T>):Promise<T> {
  const result=sessionWork.then(work);sessionWork=result.catch(()=>{});return result;
}
export function subscribeSession(listener:(session:AuthSession|null)=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}
function notify(session:AuthSession|null) {generation++;active=session;listeners.forEach(listener=>listener(session));}
function valid(session:AuthSession) {
  if(!session || typeof session.workspaceId!=="string" || typeof session.teacherId!=="string")return false;
  if(session.mode==="demo")return session.workspaceId===demoScope.workspaceId && session.teacherId===demoScope.teacherId;
  return session.mode==="real" && session.approved===true && typeof session.token==="string" && !!session.token &&
    typeof session.validUntil==="string" && Date.parse(session.validUntil)>Date.now();
}
export async function getSession():Promise<AuthSession|null> {
  const version=generation;
  const raw=await SecureStore.getItemAsync(SESSION_KEY);
  if(version!==generation)return active;
  if(!raw)return active=null;
  try {const session=JSON.parse(raw) as AuthSession;if(valid(session)) {if(session.mode==="demo")await seedDemo();if(version!==generation)return active;return active=session;}} catch { /* Invalid credentials never unlock a workspace. */ }
  return active=null;
}
export async function requireSession() {
  const session=active ?? await getSession();
  if(!session || !valid(session)) {notify(null);throw new Error("A valid teacher session is required.");}
  return session;
}
export async function exploreDemo() {
  await seedDemo();
  const session:AuthSession={...demoScope,mode:"demo",approved:false,createdAt:new Date().toISOString(),validUntil:null};
  await sessionTransaction(async()=>{await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify(session));notify(session);});return session;
}
function validate(email:string,password:string) {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw new Error("Enter a valid email address.");
  if(password.length<8 || password.length>128)throw new Error("Use a password of 8 to 128 characters.");
}
function validateProfile(value:unknown):value is Teacher {
  const p=value as Teacher;
  return !!p && typeof p.name==="string" && !!p.name.trim() && typeof p.schoolName==="string" &&
    !!p.schoolName.trim() && p.preferredSubject==="Math" && Number.isInteger(p.experience) && p.experience!>=0 &&
    p.experience!<=60 && Array.isArray(p.grades) && p.grades.length>0 && p.grades.every(g=>[1,2,3,4].includes(g));
}
export async function signUp(email:string,password:string,profile:SignupInput):Promise<{status:"pending-approval"}> {
  validate(email,password);
    if(!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))throw new Error('Include both letters and numbers in your password.');
  if(!accountTransportAllowed())throw new Error("Account access requires a HTTPS school server or a private LAN development server.");
  const response=await apiRequest("/auth/signup",{method:"POST",body:JSON.stringify({email:email.trim(),password,...profile})}) as {status?:string;approvalToken?:string};
  if(response.status!=="pending-approval")throw new Error("The server returned an invalid approval response.");
  await SecureStore.setItemAsync("calcmate.pending-account.v1",email.trim());
  if(typeof response.approvalToken==='string'&&response.approvalToken.length>=32)await SecureStore.setItemAsync('calcmate.approval-tracking.v1',JSON.stringify({token:response.approvalToken,base:apiBaseUrl(),email:email.trim()}));
  else await SecureStore.deleteItemAsync('calcmate.approval-tracking.v1');
  return {status:"pending-approval"};
}
export async function signIn(email:string,password:string):Promise<AuthSession> {
  validate(email,password);
  if(!accountTransportAllowed())throw new Error("Account access requires a HTTPS school server or a private LAN development server.");
  await flushRevocations();
  let result:AuthSession;
  try {result=await apiRequest("/auth/login",{method:"POST",body:JSON.stringify({email:email.trim(),password})}) as AuthSession;}
  catch(error) {
    if(error instanceof ApiError && error.code==="pending-approval")await SecureStore.setItemAsync("calcmate.pending-account.v1",email.trim());
    throw error;
  }
  if(!valid(result)||result.mode!=="real"||!validateProfile(result.profile))throw new Error("The server did not return an approved teacher session.");
  const session={...result,apiUrl:apiBaseUrl()!};
  await initializeTeacherWorkspace(session,session.profile!,session.presentationRoster===true);
  await SecureStore.deleteItemAsync("calcmate.pending-account.v1");
  await SecureStore.deleteItemAsync('calcmate.approval-tracking.v1');
  await sessionTransaction(async()=>{await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify(session));notify(session);});return session;
}
export async function pendingAccount() {return SecureStore.getItemAsync("calcmate.pending-account.v1");}
export async function checkApproval():Promise<'pending'|'approved'|'rejected'|'manual'>{
  const raw=await SecureStore.getItemAsync('calcmate.approval-tracking.v1');if(!raw)return 'manual';
  const tracking=JSON.parse(raw);
  if(tracking.email!==await pendingAccount()||!accountTransportAllowed(tracking.base))return 'manual';
  try{
    const response=await apiRequest('/auth/approval',{headers:{Authorization:`Bearer ${tracking.token}`}},tracking.base,5000) as {status?:string};
    if(!['pending','approved','rejected'].includes(response.status??''))throw new Error('Could not read approval status.');
    return response.status as 'pending'|'approved'|'rejected';
  }catch(error){if(error instanceof ApiError&&(error.status===401||error.status===404))return 'manual';throw error;}
}
export async function changeAccountEndpoint(address:string){
  const base=normalizeApiUrl(address);const session=await getSession();
  if(!session||session.mode==="demo"){await configureApi(base);return;}
  if(!accountTransportAllowed(base))throw new Error("Use HTTPS or a private LAN server for account access.");
  // Allow LAN/IP changes without removing the account. A different server must
  // authenticate this exact teacher token and workspace before the address moves.
  const response=await apiRequest("/auth/me",{headers:{Authorization:`Bearer ${session.token}`}},base) as AuthSession;
  if(response.teacherId!==session.teacherId||response.workspaceId!==session.workspaceId||response.approved!==true)throw new Error("This server does not recognize your approved teacher account.");
  const next={...session,apiUrl:base,validUntil:response.validUntil};
  if(!valid(next))throw new Error("Your account session must be renewed before changing servers.");
  await sessionTransaction(async()=>{
    if((await getSession())?.token!==session.token)throw new Error("Your account changed while checking the server. Try again.");
    await configureApi(base);await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify(next));notify(next);
  });
}
type Revocation={token:string;base:string;expires:string};
let revocationWork:Promise<unknown>=Promise.resolve();
function revocationTransaction<T>(work:()=>Promise<T>):Promise<T> {
  const result=revocationWork.then(work);revocationWork=result.catch(()=>{});return result;
}
export function flushRevocations() {return revocationTransaction(async()=>{
  const raw=await SecureStore.getItemAsync(REVOCATIONS);if(!raw)return;
  let entries:Revocation[]=[];try {entries=JSON.parse(raw);} catch {return;}
  const remaining:Revocation[]=[];
  for(const entry of entries) {
    if(Date.parse(entry.expires)<=Date.now())continue;
    if(!accountTransportAllowed(entry.base)){remaining.push(entry);continue;}
    try {await apiRequest("/auth/logout",{method:"POST",headers:{Authorization:`Bearer ${entry.token}`}},entry.base,4000);}
    catch {remaining.push(entry);}
  }
  await SecureStore.setItemAsync(REVOCATIONS,JSON.stringify(remaining));
});}
export async function signOut() {
  const session=await getSession();
  if(session?.mode==="real" && session.token && session.apiUrl && session.validUntil) {
    const entry:Revocation={token:session.token,base:session.apiUrl,expires:session.validUntil};
    await revocationTransaction(async()=>{
    let entries:Revocation[]=[];try {entries=JSON.parse(await SecureStore.getItemAsync(REVOCATIONS) ?? "[]");} catch { /* Recover a corrupt queue. */ }
    entries.push(entry);
    await SecureStore.setItemAsync(REVOCATIONS,JSON.stringify(entries));
    });
  }
  await sessionTransaction(async()=>{await SecureStore.deleteItemAsync(SESSION_KEY);notify(null);});
  void flushRevocations().catch(()=>{});
}
export async function refreshSession() {
  const session=await getSession();
  if(!session || session.mode==="demo" || !session.apiUrl)return session;
  if(!accountTransportAllowed(session.apiUrl))return session;
  try {
    const response=await apiRequest("/auth/me",{headers:{Authorization:`Bearer ${session.token}`}},session.apiUrl,5000) as AuthSession;
    if(response.teacherId!==session.teacherId || response.workspaceId!==session.workspaceId || response.approved!==true || !response.validUntil)throw new ApiError("Session identity mismatch.",401);
    const next={...session,validUntil:response.validUntil,presentationRoster:response.presentationRoster ?? session.presentationRoster};
    if(next.presentationRoster && session.profile)await initializeTeacherWorkspace(session,session.profile,true);
    if(!valid(next))throw new ApiError("Session expired.",401);
    // A logout during this request must never reopen the old session.
    return sessionTransaction(async()=>{
      if((await getSession())?.token!==session.token)return null;
      await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify(next));notify(next);return next;
    });
  } catch(error) {
    if(error instanceof ApiError && [401,403].includes(error.status)) {if((await getSession())?.token===session.token)await signOut();return null;}
    return session;
  }
}
