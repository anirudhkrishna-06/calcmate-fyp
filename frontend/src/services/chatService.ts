import { ChatMessage, RagResponse } from "@/types/chat";
import { Grade } from "@/types/domain";
import { prepareMessage,prepareRetry,completeMessage,failMessage } from "./chatRepository";
import { requestRag } from "./ragClient";
import { createGeneralSchedule } from "./generalScheduleService";
export { listConversations,createConversation,selectConversation,restoreConversation,conversationMessages } from "./chatRepository";
const sending=new Set<string>();
async function deliver(message:ChatMessage, onResponse?:(r:RagResponse)=>Promise<void>) {
  if (sending.has(message.id)) throw new Error("This request is already being sent.");
  sending.add(message.id);
  try {
    const response=await requestRag(JSON.parse(message.request_json!));
    let metadata: Record<string, unknown> | undefined = undefined;
    if (response.schedule_action && response.schedule_action.action === "invoke_local_scheduler") {
      try {
        const sa = response.schedule_action;
        const schedule = await createGeneralSchedule({
          date: sa.date,
          availableMinutes: sa.available_minutes,
          grades: sa.suggested_grades as Grade[],
          priority: sa.priority,
        });
        metadata = { schedule };
      } catch (schedErr) {
        metadata = { schedule_error: schedErr instanceof Error ? schedErr.message : "Schedule generation failed" };
      }
    }
    if (onResponse) { try { await onResponse(response); } catch { /* best-effort */ } }
    await completeMessage(message,response,metadata);
  }
  catch(error) { await failMessage(message,error instanceof Error ? error.message : "The AI request failed."); }
  finally { sending.delete(message.id); }
}
export async function sendMessage(
  conversationId: string,
  question: string,
  grade: number,
  onSaved?: () => Promise<void>,
  onResponse?: (r: RagResponse) => Promise<void>,
  context?: { student_id?: string; concept_id?: string; screen_context?: string }
) {
  const message = await prepareMessage(conversationId, question, grade, context);
  try { await onSaved?.(); } finally { await deliver(message, onResponse); }
}
export async function retryMessage(messageId:string,onSaved?:()=>Promise<void>,onResponse?:(r:RagResponse)=>Promise<void>) {
  const message=await prepareRetry(messageId);
  try { await onSaved?.(); } finally { await deliver(message,onResponse); }
}

