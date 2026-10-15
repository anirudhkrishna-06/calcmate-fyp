import NetInfo from "@react-native-community/netinfo";
import { ChatRequest, RagChunk, RagResponse } from "@/types/chat";
import { apiBaseUrl } from "./apiClient";
import { getSession,subscribeSession } from "./authService";
export { apiBaseUrl } from "./apiClient";
export function validateRagResponse(value:unknown):RagResponse {
  if (!value || typeof value !== "object") throw new Error("The AI service returned a malformed response.");
  const response=value as Partial<RagResponse> & { structured_data?: Record<string,unknown> };
  if (typeof response.answer !== "string" || !response.answer.trim() || !Array.isArray(response.chunks)) throw new Error("The AI service returned a malformed response.");
  for (const c of response.chunks as RagChunk[]) {
    if (!c || typeof c !== "object" || !Number.isInteger(c.chunk_id) || typeof c.text !== "string" || !Number.isInteger(c.grade) ||
      typeof c.subject !== "string" || typeof c.source_pdf !== "string" || !c.source_pdf.trim() || !Number.isInteger(c.chunk_index) ||
      typeof c.score !== "number" || !Number.isFinite(c.score) || typeof c.used_fallback !== "boolean") throw new Error("The AI service returned invalid source metadata.");
  }
  // Stage 4: Extract schedule_action from structured_data when backend signals invoke_local_scheduler.
  let schedule_action: RagResponse["schedule_action"] = null;
  const sd = response.structured_data;
  if (sd && sd["action"] === "invoke_local_scheduler") {
    const grades = Array.isArray(sd["suggested_grades"]) ? (sd["suggested_grades"] as number[]).filter(g => Number.isInteger(g) && g >= 1 && g <= 4) : [];
    const mins = typeof sd["available_minutes"] === "number" ? sd["available_minutes"] : 45;
    const pri = sd["priority"] === "learning-needs" ? "learning-needs" : "balanced";
    const dt = typeof sd["date"] === "string" ? sd["date"] : new Date().toISOString().slice(0, 10);
    if (grades.length > 0) {
      schedule_action = { action: "invoke_local_scheduler", suggested_grades: grades, available_minutes: mins, priority: pri, date: dt };
    }
  }
  // Accept all optional Stage 3 copilot fields without strict validation.
  return {
    answer: response.answer,
    chunks: response.chunks,
    mode: response.mode,
    intent: response.intent,
    evidence_found: response.evidence_found ?? null,
    graph_finding: response.graph_finding ?? null,
    recommended_next_step: response.recommended_next_step ?? null,
    ncert_resource: response.ncert_resource ?? null,
    limitations: Array.isArray(response.limitations) ? response.limitations : [],
    schedule_action,
  };
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
