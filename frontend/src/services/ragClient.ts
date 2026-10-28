import { readClassroomEvidence } from "./classroomEvidenceService";
import NetInfo from "@react-native-community/netinfo";
import { ChatRequest, RagChunk, RagResponse, RescheduleAction, RescheduleTask, RescheduledSlot } from "@/types/chat";
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
  let reschedule_action: RagResponse["reschedule_action"] = null;
  const sd = response.structured_data;
  if (sd && sd["action"] === "invoke_local_scheduler") {
    const grades = Array.isArray(sd["suggested_grades"]) ? (sd["suggested_grades"] as number[]).filter(g => Number.isInteger(g) && g >= 1 && g <= 5) : [];
    const mins = typeof sd["available_minutes"] === "number" ? sd["available_minutes"] : 45;
    const pri = sd["priority"] === "learning-needs" ? "learning-needs" : "balanced";
    const dt = typeof sd["date"] === "string" ? sd["date"] : new Date().toISOString().slice(0, 10);
    if (grades.length > 0) {
      schedule_action = { action: "invoke_local_scheduler", suggested_grades: grades, available_minutes: mins, priority: pri, date: dt };
    }
  }
  if (sd && sd["action"] === "reschedule_plan" && typeof sd["leave_date"] === "string" && typeof sd["rescheduled_date"] === "string") {
    const tasks = Array.isArray(sd["leave_day_tasks"]) ? sd["leave_day_tasks"] : [];
    const slots = Array.isArray(sd["rescheduled_slots"]) ? sd["rescheduled_slots"] : [];
    const grades = Array.isArray(sd["grades"]) ? sd["grades"].filter(g => Number.isInteger(g) && g >= 1 && g <= 5) : [];
    if (grades.length && tasks.every(t => t && typeof t === "object") && slots.every(s => s && typeof s === "object")) {
      reschedule_action = {
        action: "reschedule_plan", leave_date: sd["leave_date"], rescheduled_date: sd["rescheduled_date"],
        leave_mode: "independent_peer_practice", grades,
        zero_direct_instruction: sd["zero_direct_instruction"] === true,
        leave_day_tasks: tasks as RescheduleTask[],
        rescheduled_slots: slots as RescheduledSlot[],
      };
    }
  }
  // Accept all optional Stage 3 copilot fields without strict validation.
  return {
    answer: response.answer,
    chunks: response.chunks,
    mode: response.mode,
    evidence_revision: response.evidence_revision,
    intent: response.intent,
    evidence_found: response.evidence_found ?? null,
    graph_finding: response.graph_finding ?? null,
    recommended_next_step: response.recommended_next_step ?? null,
    ncert_resource: response.ncert_resource ?? null,
    limitations: Array.isArray(response.limitations) ? response.limitations : [],
    schedule_action,
    reschedule_action,
  };
}

export async function requestRag(request:ChatRequest, timeoutMs=240000):Promise<RagResponse> {
  const network=await NetInfo.fetch();
  if (network.isConnected === false) throw new Error("Offline. No on-device AI engine is installed. Your question is saved; retry when the API is reachable.");
  const base=apiBaseUrl();
  if (!base) throw new Error("AI responses are unavailable: no API address is configured. Your question is saved on this device.");
  const session=await getSession();
  if(request.workspace_id&&request.workspace_id!==session?.workspaceId)throw new Error('Account changed. Reopen Assistant before retrying.');
  const outgoing={...request};
  if(session?.mode==='real'){
    outgoing.workspace_id=session.workspaceId;
    // Classroom-wide counts and explicitly requested other grades need the
    // complete workspace, including grades outside the current screen/profile.
    outgoing.classroom_evidence=await readClassroomEvidence([1,2,3,4,5]);
  }else{delete outgoing.workspace_id;delete outgoing.student_id;delete outgoing.classroom_evidence;}
  const current=await getSession();
  if(current?.workspaceId!==session?.workspaceId||current?.token!==session?.token)throw new Error('Account changed. Reopen Assistant before retrying.');
  const controller=new AbortController(); const timer=setTimeout(() => controller.abort(),timeoutMs);
  const unsubscribe=subscribeSession(next=>{if(!next || next.workspaceId!==session?.workspaceId || next.token!==session?.token)controller.abort();});
  try {
    let response:Response;
    try { response=await fetch(`${base}/chat`,{method:"POST",headers:{"Content-Type":"application/json",...(session?.token?{Authorization:`Bearer ${session.token}`}:{})},body:JSON.stringify(outgoing),signal:controller.signal}); }
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
      if(response.status===401||response.status===403)throw new Error("Your classroom session is no longer valid. Log in again; your question is saved.");
      if (response.status === 422) {
        let detail='The AI service rejected this question or grade.';
        try{const data=await response.json();if(typeof data.detail==='string')detail=data.detail;}catch{/* Keep the readable default. */}
        throw new Error(detail);
      }
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
