"""
CALCMATE — Stage 3: Response Composer
src/response_composer.py

Composes a teacher-facing CopilotResponse from an OperationResult.

Two modes:
1. compose_deterministic: always works, no LLM dependency.
   Assembles a clear, factual answer from structured fields only.

2. compose_with_llm: uses Ollama to improve readability.
   The LLM receives only the structured evidence and formatting instructions.
   It cannot change mastery values, student names, or curriculum facts.
   Falls back to compose_deterministic on any LLM failure.
"""
from __future__ import annotations

import os
import json
from typing import Optional

from src.copilot_contract import (
    CopilotIntent, CopilotRequest, IntentResult,
    OperationResult, OperationStatus, CopilotResponse,
)

# ─── Deterministic Composer ───────────────────────────────────────────────────

_INTENT_PREFIXES = {
    CopilotIntent.GET_ASSESSMENT_HISTORY:        "Assessment history",
    CopilotIntent.CLASSROOM_RECORD_QUERY:       "Classroom records",
    CopilotIntent.FIND_STUDENTS_BY_CONCEPT:       "Student group status",
    CopilotIntent.GET_STUDENT_CONCEPT_STATE:      "Student concept state",
    CopilotIntent.GET_STUDENT_PROGRESS:           "Student progress",
    CopilotIntent.EXPLAIN_LEARNING_DIFFICULTY:    "Learning difficulty analysis",
    CopilotIntent.EXPLAIN_PREREQUISITES:          "Prerequisite analysis",
    CopilotIntent.EXPLAIN_CONCEPT:                "Concept explanation",
    CopilotIntent.CLASSROOM_LEARNING_SUMMARY:     "Classroom summary",
    CopilotIntent.GROUP_PREREQUISITE_READINESS:   "Group readiness",
    CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY:  "Teaching activity",
    CopilotIntent.RETRIEVE_NCERT_RESOURCE:        "NCERT resource",
    CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE:"Instructional schedule",
    CopilotIntent.RESCHEDULE_INSTRUCTIONAL_PLAN:"Instructional reschedule",
    CopilotIntent.GENERAL_QUESTION:               "",
    CopilotIntent.UNSUPPORTED:                    "",
    CopilotIntent.AMBIGUOUS:                      "",
}


def compose_deterministic(
    operation_result: OperationResult,
    intent_result: IntentResult,
    request: CopilotRequest,
    rag_answer: Optional[str] = None,
    rag_chunks: Optional[list] = None,
) -> CopilotResponse:
    """
    Build a CopilotResponse using only structured fields. No LLM.

    For GENERAL_QUESTION and EXPLAIN_CONCEPT intents, incorporates the
    existing RAG answer when available.
    """
    parts: list[str] = []

    prefix = _INTENT_PREFIXES.get(intent_result.intent, "")

    is_error = operation_result.status == OperationStatus.ERROR
    is_unavailable = operation_result.status == OperationStatus.UNAVAILABLE

    # ── Error / unavailable ────────────────────────────────────────────────────
    if is_error:
        # Internal exception text can contain SQL/schema details and is not a
        # useful or safe classroom response. Keep it in server logs instead.
        import logging
        if operation_result.error_detail:
            logging.getLogger("calcmate.copilot").error(
                "Copilot operation failed: %s", operation_result.error_detail
            )
        answer = "I couldn't complete that classroom request. Please try again."
        return CopilotResponse(
            answer=answer,
            limitations=operation_result.limitations,
            intent=intent_result.intent.value,
            used_llm=False,
        )

    if is_unavailable:
        answer = "This information is not currently accessible."
        if operation_result.evidence_summary:
            answer += f"\n\n{operation_result.evidence_summary}"
        if operation_result.recommended_next_step:
            answer += f"\n\n✅ **Next step:** {operation_result.recommended_next_step}"
        return CopilotResponse(
            answer=answer,
            limitations=operation_result.limitations,
            intent=intent_result.intent.value,
            used_llm=False,
        )

    # ── General question: return RAG answer directly ─────────────────────────
    if intent_result.intent in (CopilotIntent.GENERAL_QUESTION, CopilotIntent.EXPLAIN_CONCEPT):
        if rag_answer:
            return CopilotResponse(
                answer=rag_answer,
                evidence_found=operation_result.evidence_summary,
                limitations=operation_result.limitations,
                intent=intent_result.intent.value,
                used_llm=False,
                chunks=rag_chunks or [],
            )

    # ── Structured answer ─────────────────────────────────────────────────────
    if prefix:
        parts.append(f"**{prefix}**")
    if operation_result.evidence_summary:
        parts.append(operation_result.evidence_summary)
    if operation_result.graph_finding:
        parts.append(f"📊 {operation_result.graph_finding}")
    if operation_result.ncert_resource:
        src = operation_result.ncert_resource
        snippet = src.get("text_snippet", "")
        if snippet:
            parts.append(f"📖 NCERT ({src.get('source_pdf','')}, Grade {src.get('grade','')}):\n> {snippet[:200]}…")
    if operation_result.recommended_next_step:
        parts.append(f"✅ **Next step:** {operation_result.recommended_next_step}")
    if operation_result.limitations:
        for lim in operation_result.limitations:
            parts.append(f"ℹ️ {lim}")

    answer = "\n\n".join(parts) if parts else "No information available."

    # If RAG answer also exists (fallback enrichment for general questions)
    if rag_answer and intent_result.intent not in (
        CopilotIntent.CLASSROOM_LEARNING_SUMMARY,
        CopilotIntent.FIND_STUDENTS_BY_CONCEPT,
        CopilotIntent.GET_STUDENT_CONCEPT_STATE,
        CopilotIntent.GET_STUDENT_PROGRESS,
        CopilotIntent.GROUP_PREREQUISITE_READINESS,
    ):
        answer += f"\n\n---\n\n{rag_answer}"

    chunks = rag_chunks or []

    return CopilotResponse(
        answer=answer,
        evidence_found=operation_result.evidence_summary,
        graph_finding=operation_result.graph_finding,
        recommended_next_step=operation_result.recommended_next_step,
        ncert_resource=operation_result.ncert_resource,
        limitations=operation_result.limitations,
        intent=intent_result.intent.value,
        used_llm=False,
        chunks=chunks,
    )


# ─── LLM-Assisted Composer ────────────────────────────────────────────────────

_LLM_COMPOSE_PROMPT = """\
You are CALCMATE, an inspiring, empathetic, and expert teaching copilot for a primary school teacher in India.

You have been given structured, factual classroom evidence. Your job is to write an engaging, warm, and motivating response for the teacher.
Strict guardrails:
- Do NOT alter any numbers, student names, concept names, or mastery percentages.
- Do NOT invent student data or false citations.
- Refer to the selected learner by name. Use he/she only when the teacher's records explicitly establish those pronouns; otherwise use the student's name or they.
- Refer to the selected learner by the name in the student context. Use he/she only when the teacher's records explicitly establish those pronouns; otherwise use the student's name or they.

Facts:
{facts}

Teacher question: {question}

Student context (when present): {student_context}

Write an uplifting, supportive, and actionable answer for the teacher using the facts above. Highlight clear next steps and celebrate progress! Plain English, encouraging tone.

Answer:"""

_STUDENT_AI_PROMPT = """\
You are StudentAI, a skilled primary Maths learning-support partner for a teacher in India.

Help the teacher make a thoughtful next move for this one learner. Be warm, specific, and practical. Explain what the classroom evidence suggests, what it does not establish, and offer a small actionable teaching move plus a way to check understanding when that fits the question.

Evidence rules:
- Use only the supplied student profile, assessment records, attendance, teacher notes, curriculum facts, and operation result. Do not invent history, causes, abilities, diagnoses, or personal details.
- Distinguish recorded scores from estimated mastery and from your teaching interpretation. Cite dates and scores exactly when useful; don't imply a single score proves mastery.
- If evidence is sparse or absent, say so and suggest one low effort diagnostic check before making a strong recommendation.
- Keep the response focused on the teacher's actual question. Avoid generic praise or filler. Give examples at the learner's grade level.
- Refer to the student by name; use he/she only if the supplied profile explicitly records pronouns, otherwise use the name or they.

Student profile and complete available evidence:
{student_context}

Recent messages in this same student chat (use only to resolve follow-ups):
{conversation_history}

Structured operation result:
{facts}

Teacher's question: {question}

Answer with a clear recommendation and its evidence. Use concise headings or steps only when they make the answer easier to act on."""


def compose_with_llm(
    operation_result: OperationResult,
    intent_result: IntentResult,
    request: CopilotRequest,
    rag_answer: Optional[str] = None,
    rag_chunks: Optional[list] = None,
    model: Optional[str] = None,
) -> CopilotResponse:
    """
    Use the LLM to improve readability. The LLM receives only the structured
    evidence and cannot change facts. Falls back to compose_deterministic
    on any failure.
    """
    if operation_result.status in (OperationStatus.ERROR, OperationStatus.UNAVAILABLE):
        return compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)

    is_student_ai = request.screen_context == "student_copilot" and bool(request.student_id)
    # For ordinary pure RAG intents, the curriculum model already wrote the answer.
    if not is_student_ai and intent_result.intent in (CopilotIntent.GENERAL_QUESTION, CopilotIntent.EXPLAIN_CONCEPT) and rag_answer:
        return compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)

    facts_parts = []
    if operation_result.evidence_summary:
        facts_parts.append(f"Evidence: {operation_result.evidence_summary}")
    if operation_result.graph_finding:
        facts_parts.append(f"Curriculum graph: {operation_result.graph_finding}")
    if operation_result.recommended_next_step:
        facts_parts.append(f"Recommended action: {operation_result.recommended_next_step}")
    if operation_result.ncert_resource:
        src = operation_result.ncert_resource
        facts_parts.append(
            f"NCERT source: {src.get('source_pdf','')} Grade {src.get('grade','')} — "
            f"{src.get('text_snippet','')[:150]}"
        )
    if operation_result.limitations:
        facts_parts.append(f"Limitations: {'; '.join(operation_result.limitations)}")
    if is_student_ai and rag_answer:
        facts_parts.append("Grounded curriculum explanation: " + rag_answer)

    if operation_result.structured_data:
        structured = operation_result.structured_data
        if hasattr(structured, "model_dump"):
            structured = structured.model_dump(mode="json")
        try:
            facts_parts.append("Structured evidence data: " + json.dumps(structured, ensure_ascii=False, default=str))
        except (TypeError, ValueError):
            facts_parts.append("Structured evidence data: " + str(structured))

    if not facts_parts:
        return compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)

    try:
        import ollama
        from src.copilot import resolve_active_model
        _model = resolve_active_model(model or os.getenv("CALCMATE_RAG_MODEL"))
        client = ollama.Client(timeout=float(os.getenv("CALCMATE_GENERATION_TIMEOUT", "210")))
        student_context = getattr(request,"student_profile_context",None)
        prompt = (_STUDENT_AI_PROMPT.format(
            facts="\n".join(facts_parts), question=request.message,
            student_context=json.dumps(student_context or {}, ensure_ascii=False, default=str),
            conversation_history=json.dumps(getattr(request,"conversation_history",[]), ensure_ascii=False, default=str),
        ) if is_student_ai else _LLM_COMPOSE_PROMPT.format(
            facts="\n".join(facts_parts), question=request.message,
            student_context=json.dumps(student_context, ensure_ascii=False, default=str) if student_context else "No selected student profile.",
        ))
        resp = client.generate(model=_model, prompt=prompt,
                               options={"temperature": 0.25 if is_student_ai else 0.2, "num_predict": 280 if is_student_ai else 200})
        llm_answer = resp.get("response", "").strip()
        if not llm_answer:
            raise ValueError("Empty LLM response")

        # Append limitations that LLM may have omitted
        lim_text = ""
        if operation_result.limitations:
            lim_text = "\n\n" + "\n".join(f"ℹ️ {l}" for l in operation_result.limitations)

        return CopilotResponse(
            answer=llm_answer + lim_text,
            evidence_found=operation_result.evidence_summary,
            graph_finding=operation_result.graph_finding,
            recommended_next_step=operation_result.recommended_next_step,
            ncert_resource=operation_result.ncert_resource,
            limitations=operation_result.limitations,
            intent=intent_result.intent.value,
            used_llm=True,
            chunks=rag_chunks or [],
        )
    except Exception as exc:
        import logging
        logging.getLogger("uvicorn.error").warning("Student-aware response generation failed; using grounded fallback (%s: %s)", type(exc).__name__, str(exc)[:300])
        fallback = compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)
        fallback.limitations = list(fallback.limitations) + ["The local LLM did not finish this response. This is a deterministic summary of recorded classroom evidence, not an LLM-generated answer."]
        return fallback

