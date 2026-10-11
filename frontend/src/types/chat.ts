import { Grade } from "./domain";
export type ChatRequest = { question:string; grade:Grade; subject:"Math"; k?:number; use_llm?:boolean };
export type RagChunk = { chunk_id:number; text:string; grade:number; subject:string; source_pdf:string; chunk_index:number; score:number; used_fallback:boolean };
export type RagResponse = { answer:string; chunks:RagChunk[] };
export type Conversation = { id:string; workspace_id:string; title:string; grade:Grade; created_at:string; updated_at:string };
export type ChatMessage = {
  id:string; workspace_id:string; conversation_id:string; role:"teacher" | "assistant"; text:string;
  status:"pending" | "completed" | "failed"; error:string | null; request_json:string | null;
  sources_json:string; reply_to:string | null; created_at:string; updated_at:string;
};
