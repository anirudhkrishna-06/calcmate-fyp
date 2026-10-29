import type { ClassroomEvidence } from "@/services/classroomEvidenceService";
import { Grade } from "./domain";
/** Base chat request — backward compatible. Stage 3 adds optional copilot context fields. */
export type ChatRequest = {
  question: string;
  grade: Grade;
  subject: "Math";
  k?: number;
  use_llm?: boolean;
  // Stage 3 copilot context (optional — plain RAG works without these)
  workspace_id?: string;
  student_id?: string;
  concept_id?: string;
  screen_context?: string;
  classroom_evidence?:ClassroomEvidence;
  conversation_history?:{role:"user"|"assistant";content:string}[];
};
export type RagChunk = { source_url?:string|null;source_pages?:string|null;resource_kind?:string; chunk_id:number; text:string; grade:number; subject:string; source_pdf:string; chunk_index:number; score:number; used_fallback:boolean };
/** Stage 4: structured action signal from backend to invoke the on-device scheduler. */
export type ScheduleAction = {
  action: "invoke_local_scheduler";
  suggested_grades: number[];
  available_minutes: number;
  priority: "balanced" | "learning-needs";
  date: string;
};
export type RescheduleTask = { grade:number; concept_id?:string|null; concept:string; mastery?:number; activity:string };
export type RescheduledSlot = { grade:number; concept_id?:string|null; concept:string; priority:string; duration_minutes:number; reason:string };
export type RescheduleAction = {
  action:"reschedule_plan";
  leave_date:string;
  rescheduled_date:string;
  leave_mode:"independent_peer_practice";
  grades:number[];
  zero_direct_instruction:boolean;
  leave_day_tasks:RescheduleTask[];
  rescheduled_slots:RescheduledSlot[];
};

/** Stage 3: extended response with structured copilot fields. All new fields are optional for backward compatibility. */
export type RagResponse = {
  answer: string;
  evidence_revision?:string|null;
  chunks: RagChunk[];
  // Stage 3 copilot fields (absent for plain RAG responses)
  mode?: "generated" | "retrieval-only" | "copilot";
  intent?: string;
  evidence_found?: string | null;
  graph_finding?: string | null;
  recommended_next_step?: string | null;
  ncert_resource?: { source_pdf: string; grade: number; text_snippet: string } | null;
  limitations?: string[];
  // Stage 4: present only when intent==="generate_instructional_schedule"
  schedule_action?: ScheduleAction | null;
  reschedule_action?: RescheduleAction | null;
};
export type Conversation = { id:string; workspace_id:string; title:string; grade:Grade; student_id?:string|null; created_at:string; updated_at:string };
export type ChatMessage = {
  id:string; workspace_id:string; conversation_id:string; role:"teacher" | "assistant"; text:string;
  status:"pending" | "completed" | "failed"; error:string | null; request_json:string | null;
  sources_json:string; reply_to:string | null; created_at:string; updated_at:string;
};
