import { assertScope, getDatabase, newId, Scope, withTransaction } from "./database";
import { currentGrade } from "./gradePreference";
import { requireSession } from "./authService";
import { ChatMessage, ChatRequest, Conversation, RagResponse } from "@/types/chat";
const initialized=new Map<string,Promise<void>>();
export async function chatScope():Promise<Scope> {
  const scope=await requireSession();
  await assertScope(await getDatabase(),scope);
  if (!initialized.has(scope.workspaceId)) initialized.set(scope.workspaceId,withTransaction(async tx => {
    await assertScope(tx,scope);
    await tx.runAsync("UPDATE message_details SET status='failed',error='This request was interrupted. Retry to ask again.' WHERE workspace_id=? AND status='pending'",scope.workspaceId);
  }).catch(error => { initialized.delete(scope.workspaceId); throw error; }));
  await initialized.get(scope.workspaceId); return scope;
}
export async function listConversations():Promise<Conversation[]> {
  const scope=await chatScope();
  return withTransaction(async tx => tx.getAllAsync<Conversation>("SELECT * FROM conversations WHERE workspace_id=? ORDER BY updated_at DESC,id DESC",scope.workspaceId));
}
export async function createConversation(grade=currentGrade()):Promise<Conversation> {
  if (![1,2,3,4].includes(grade)) throw new Error("Choose a grade from 1 to 4.");
  const scope=await chatScope(); const now=new Date().toISOString();
  const conversation:Conversation={id:newId(),workspace_id:scope.workspaceId,title:"New chat",grade:grade as Conversation["grade"],created_at:now,updated_at:now};
  await withTransaction(async tx => { await tx.runAsync("INSERT INTO conversations VALUES(?,?,?,?,?,?)",conversation.id,scope.workspaceId,conversation.title,grade,now,now); });
  await selectConversation(conversation.id); return conversation;
}
export async function selectConversation(id:string) {
  const scope=await chatScope();
  await withTransaction(async tx => {
    if (!await tx.getFirstAsync("SELECT id FROM conversations WHERE workspace_id=? AND id=?",scope.workspaceId,id)) throw new Error("Conversation not found.");
    await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",`chat.active:${scope.workspaceId}`,id);
  });
}
export async function restoreConversation():Promise<Conversation> {
  const scope=await chatScope();
  const saved=await withTransaction(async tx => {
    const selected=await tx.getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key=?",`chat.active:${scope.workspaceId}`);
    return tx.getFirstAsync<Conversation>("SELECT * FROM conversations WHERE workspace_id=? ORDER BY (id=?) DESC,updated_at DESC,id DESC LIMIT 1",scope.workspaceId,selected?.value ?? "");
  });
  if (!saved) return createConversation();
  await selectConversation(saved.id); return saved;
}
export async function conversationMessages(conversationId:string):Promise<ChatMessage[]> {
  const scope=await chatScope();
  return withTransaction(async tx => tx.getAllAsync<ChatMessage>(
    "SELECT m.*,d.conversation_id,d.status,d.error,d.request_json,d.sources_json,d.reply_to FROM messages m JOIN message_details d ON d.workspace_id=m.workspace_id AND d.message_id=m.id WHERE m.workspace_id=? AND d.conversation_id=? ORDER BY m.created_at,m.rowid",scope.workspaceId,conversationId));
}
export async function prepareMessage(conversationId:string, question:string, grade:number):Promise<ChatMessage> {
  const text=question.trim();
  if (!text || text.length>2000) throw new Error("Enter a question of 1 to 2000 characters.");
  if (![1,2,3,4].includes(grade)) throw new Error("Choose a grade from 1 to 4.");
  const scope=await chatScope(); const id=newId(); const now=new Date().toISOString();
  const request:ChatRequest={question:text,grade:grade as ChatRequest["grade"],subject:"Math",use_llm:true};
  await withTransaction(async tx => {
    const conversation=await tx.getFirstAsync<Conversation>("SELECT * FROM conversations WHERE workspace_id=? AND id=?",scope.workspaceId,conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    if (await tx.getFirstAsync("SELECT message_id FROM message_details WHERE workspace_id=? AND conversation_id=? AND status='pending'",scope.workspaceId,conversationId)) throw new Error("A request is already pending in this conversation.");
    await tx.runAsync("INSERT INTO messages VALUES(?,?,?,?,?,?)",id,scope.workspaceId,"teacher",text,now,now);
    await tx.runAsync("INSERT INTO message_details VALUES(?,?,?,?,?,?,?,?)",id,scope.workspaceId,conversationId,"pending",JSON.stringify(request),"[]",null,null);
    await tx.runAsync("UPDATE conversations SET title=CASE WHEN title='New chat' THEN ? ELSE title END,grade=?,updated_at=? WHERE workspace_id=? AND id=?",text.slice(0,65),grade,now,scope.workspaceId,conversationId);
  });
  return (await conversationMessages(conversationId)).find(m => m.id===id)!;
}
export async function prepareRetry(id:string):Promise<ChatMessage> {
  const scope=await chatScope();
  return withTransaction(async tx => {
    const message=await tx.getFirstAsync<ChatMessage>("SELECT m.*,d.* FROM messages m JOIN message_details d ON m.id=d.message_id AND m.workspace_id=d.workspace_id WHERE m.workspace_id=? AND m.id=?",scope.workspaceId,id);
    if (!message || message.role!=="teacher" || message.status!=="failed" || !message.request_json) throw new Error("This message cannot be retried.");
    if (await tx.getFirstAsync("SELECT message_id FROM message_details WHERE workspace_id=? AND conversation_id=? AND status='pending'",scope.workspaceId,message.conversation_id)) throw new Error("A request is already pending in this conversation.");
    await tx.runAsync("UPDATE message_details SET status='pending',error=NULL WHERE workspace_id=? AND message_id=?",scope.workspaceId,id);
    return {...message,status:"pending",error:null};
  });
}
export async function completeMessage(message:ChatMessage,response:RagResponse) {
  const now=new Date().toISOString();
  await withTransaction(async tx => {
    const id=`assistant-${message.id}`;
    await tx.runAsync("INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO NOTHING",id,message.workspace_id,"assistant",response.answer,now,now);
    await tx.runAsync("INSERT INTO message_details VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,message_id) DO NOTHING",id,message.workspace_id,message.conversation_id,"completed",null,JSON.stringify(response.chunks),null,message.id);
    await tx.runAsync("UPDATE message_details SET status='completed',error=NULL WHERE workspace_id=? AND message_id=?",message.workspace_id,message.id);
    await tx.runAsync("UPDATE conversations SET updated_at=? WHERE workspace_id=? AND id=?",now,message.workspace_id,message.conversation_id);
  });
}
export async function failMessage(message:ChatMessage,error:string) {
  await withTransaction(async tx => { await tx.runAsync("UPDATE message_details SET status='failed',error=? WHERE workspace_id=? AND message_id=? AND status='pending'",error,message.workspace_id,message.id); });
}
