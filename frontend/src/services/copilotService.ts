/**
 * CALCMATE — Stage 3: Frontend Copilot Service
 * frontend/src/services/copilotService.ts
 *
 * Helper to build structured CopilotRequest payloads from the current
 * app context (grade, student_id, concept_id, screen).
 *
 * This service does NOT replace chatService.ts or ragClient.ts.
 * It provides buildCopilotRequest() so that caller screens can attach
 * the correct context fields before calling requestRag().
 */

import { ChatRequest } from "@/types/chat";
import { Grade } from "@/types/domain";

export type CopilotContext = {
  grade: Grade;
  workspaceId?: string;
  studentId?: string;
  conceptId?: string;
  screenContext?: string;
};

/**
 * Build a ChatRequest with Stage 3 copilot context attached.
 * Falls back gracefully when context fields are absent.
 */
export function buildCopilotRequest(
  question: string,
  context: CopilotContext,
): ChatRequest {
  return {
    question,
    grade: context.grade,
    subject: "Math",
    use_llm: true,
    workspace_id: context.workspaceId,
    student_id: context.studentId,
    concept_id: context.conceptId,
    screen_context: context.screenContext,
  };
}

/**
 * Display-friendly label for a copilot intent identifier.
 */
export function intentLabel(intent: string | undefined | null): string {
  if (!intent) return "";
  const labels: Record<string, string> = {
    find_students_by_concept:       "Student group status",
    get_student_concept_state:      "Student concept state",
    get_student_progress:           "Student progress",
    get_assessment_history:        "Assessment history",
    classroom_record_query:        "Classroom records",
    explain_learning_difficulty:    "Learning difficulty",
    explain_prerequisites:          "Prerequisites",
    explain_concept:                "Concept explanation",
    classroom_learning_summary:     "Classroom summary",
    group_prerequisite_readiness:   "Group readiness",
    recommend_curriculum_activity:  "Teaching activity",
    retrieve_ncert_resource:        "NCERT resource",
    generate_instructional_schedule:"Instructional schedule",
    general_question:               "",
    unsupported:                    "",
    ambiguous:                      "",
  };
  return labels[intent] ?? intent.replace(/_/g, " ");
}

