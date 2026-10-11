import { ChatMessage } from "@/types/chat";
import { prepareMessage,prepareRetry,completeMessage,failMessage } from "./chatRepository";
import { requestRag } from "./ragClient";
export { listConversations,createConversation,selectConversation,restoreConversation,conversationMessages } from "./chatRepository";
const sending=new Set<string>();
async function deliver(message:ChatMessage) {
  if (sending.has(message.id)) throw new Error("This request is already being sent.");
  sending.add(message.id);
  try { await completeMessage(message,await requestRag(JSON.parse(message.request_json!))); }
  catch(error) { await failMessage(message,error instanceof Error ? error.message : "The AI request failed."); }
  finally { sending.delete(message.id); }
}
export async function sendMessage(conversationId:string,question:string,grade:number,onSaved?:()=>Promise<void>) {
  const message=await prepareMessage(conversationId,question,grade);
  try { await onSaved?.(); } finally { await deliver(message); }
}
export async function retryMessage(messageId:string,onSaved?:()=>Promise<void>) {
  const message=await prepareRetry(messageId);
  try { await onSaved?.(); } finally { await deliver(message); }
}
