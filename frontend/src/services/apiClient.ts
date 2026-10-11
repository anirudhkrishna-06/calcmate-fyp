import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
let selected:string | null=null;
const key="calcmate.api-address.v1";
export function normalizeApiUrl(value:string) {
  let url:URL;
  try {url=new URL(value.trim());} catch {throw new Error("Enter a full server address, such as https://school.example.org.");}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error("Use an HTTP(S) address without credentials or query parameters.");
  return value.trim().replace(/\/+$/,"");
}
export function apiBaseUrl() {
  const value=selected ?? process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  return normalizeApiUrl(value || (Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000"));
}
export async function loadApiConfiguration() {selected=await SecureStore.getItemAsync(key);}
export async function configureApi(value:string) {
  const url=normalizeApiUrl(value);
  await SecureStore.setItemAsync(key,url);selected=url;
}
export function accountTransportAllowed(base=apiBaseUrl()) {
  if(!base)return false;
  const url=new URL(base);
  const octets=url.hostname.split(".");
  const ipv4=octets.length===4 && octets.every(part=>/^\d{1,3}$/.test(part) && Number(part)<=255);
  const [a,b]=octets.map(Number);
  const privateLan=ipv4 && (a===10 || (a===192 && b===168) || (a===172 && b>=16 && b<=31));
  return url.protocol==="https:" || (url.protocol==="http:" &&
    (["127.0.0.1","localhost","[::1]","10.0.2.2"].includes(url.hostname) || privateLan));
}
export class ApiError extends Error {constructor(message:string,public status:number,public code?:string) {super(message);}}
export async function apiRequest(path:string,options:RequestInit={},base=apiBaseUrl(),timeout=10000):Promise<unknown> {
  if(!base)throw new ApiError("Connect your school server to continue. Demo works without a server.",0);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(`${base}${path}`,{...options,headers:{"Content-Type":"application/json",...options.headers},signal:controller.signal});
    let data:unknown;
    try {data=await response.json();} catch {throw new ApiError("The server returned an unreadable response.",response.status);}
    if(!response.ok) {
      const detail=(data as {detail?:unknown})?.detail;
      const structured=detail && typeof detail==="object" ? detail as {message?:string;code?:string} : null;
      const message=response.status===404 ? "Account service is not available on this server." : typeof detail==="string" ? detail : structured?.message || "Check the submitted information.";
      throw new ApiError(message,response.status,structured?.code);
    }
    return data;
  } catch(error) {
    if(error instanceof ApiError)throw error;
    throw new ApiError(controller.signal.aborted ? "The server took too long to respond. Try again." : "Server unavailable. Check your connection and server address.",0);
  } finally {clearTimeout(timer);}
}
export async function accountAvailability() {
  if(!accountTransportAllowed())throw new Error("Use HTTPS or a private LAN development address.");
  const response=await apiRequest("/auth/config") as {available?:boolean;approvalRequired?:boolean};
  if(typeof response.available!=="boolean" || response.approvalRequired!==true)throw new Error("This server does not support approved teacher accounts.");
  if(!response.available)throw new Error("The server is reachable, but accounts are disabled over HTTP. Set CALCMATE_ALLOW_INSECURE_AUTH=true on your development server or use HTTPS.");
  return true;
}
export async function checkConnection() {
  const health=await apiRequest("/health") as {status?:string;corpus_available?:boolean;retrieval_dependencies_available?:boolean;generation_available?:boolean;configured_model?:string;generation_message?:string};
  if(health.status!=="ok")throw new Error("This is not a compatible Calcmate server.");
  let accounts=false;let accountError="";try {accounts=await accountAvailability();} catch(error) {accountError=error instanceof Error ? error.message : "Account service unavailable.";}
  return {accounts,accountError,ragReady:health.corpus_available===true && health.retrieval_dependencies_available===true,
    generationReady:health.generation_available===true,model:health.configured_model,generationMessage:health.generation_message};
}
