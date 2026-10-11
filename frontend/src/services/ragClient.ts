import NetInfo from "@react-native-community/netinfo";
import { ChatRequest, RagChunk, RagResponse } from "@/types/chat";
import { apiBaseUrl } from "./apiClient";
import { getSession,subscribeSession } from "./authService";
export { apiBaseUrl } from "./apiClient";
export function validateRagResponse(value:unknown):RagResponse {
  if (!value || typeof value !== "object") throw new Error("The AI service returned a malformed response.");
  const response=value as Partial<RagResponse>;
  if (typeof response.answer !== "string" || !response.answer.trim() || !Array.isArray(response.chunks)) throw new Error("The AI service returned a malformed response.");
  for (const c of response.chunks as RagChunk[]) {
    if (!c || typeof c !== "object" || !Number.isInteger(c.chunk_id) || typeof c.text !== "string" || !Number.isInteger(c.grade) ||
      typeof c.subject !== "string" || typeof c.source_pdf !== "string" || !c.source_pdf.trim() || !Number.isInteger(c.chunk_index) ||
      typeof c.score !== "number" || !Number.isFinite(c.score) || typeof c.used_fallback !== "boolean") throw new Error("The AI service returned invalid source metadata.");
  }
  return {answer:response.answer,chunks:response.chunks};
}
export async function requestRag(request:ChatRequest, timeoutMs=90000):Promise<RagResponse> {
  const network=await NetInfo.fetch();
  if (network.isConnected === false) throw new Error("Offline. No on-device AI engine is installed. Your question is saved; retry when the API is reachable.");
  const base=apiBaseUrl();
  if (!base) throw new Error("AI responses are unavailable: no API address is configured. Your question is saved on this device.");
  const session=await getSession();
  const controller=new AbortController(); const timer=setTimeout(() => controller.abort(),timeoutMs);
  const unsubscribe=subscribeSession(next=>{if(!next || next.workspaceId!==session?.workspaceId)controller.abort();});
  try {
    let response:Response;
    try { response=await fetch(`${base}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request),signal:controller.signal}); }
    catch {
      if (controller.signal.aborted) throw new Error("The AI request timed out. Your question is saved; retry when ready.");
      throw new Error("Cannot reach the AI service. Your question is saved; check the network and device API address.");
    }
    if (!response.ok) {
      if (response.status === 503) {
        let detail="The RAG runtime or Ollama model is unavailable.";
        try {const data=await response.json();if(typeof data.detail==="string")detail=data.detail;}catch { /* Keep the readable default. */ }
        throw new Error(`${detail} Your question is saved for retry.`);
      }
      if (response.status === 422) throw new Error("The AI service rejected this question or grade.");
      throw new Error(`The AI service returned HTTP ${response.status}. Your question is saved for retry.`);
    }
    let result:unknown;
    try { result=await response.json(); } catch {
      if (controller.signal.aborted) throw new Error("The AI request timed out. Your question is saved; retry when ready.");
      throw new Error("The AI service returned invalid JSON.");
    }
    return validateRagResponse(result);
  } finally { clearTimeout(timer);unsubscribe(); }
}
