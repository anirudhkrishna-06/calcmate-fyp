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
You are a helpful teaching assistant (CALCMATE) for a primary school teacher in India.

You have been given structured, factual information about the classroom. Your job is to write a concise, teacher-friendly response. Do NOT change any numbers, student names, concept names, or mastery percentages. Do NOT invent new information.

Facts:
{facts}

Teacher question: {question}

Write a helpful, clear, 2–4 sentence answer using ONLY the facts above. Plain English. No jargon.

Answer:"""


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

    # For pure RAG intents, the LLM already ran in copilot.py
    if intent_result.intent in (CopilotIntent.GENERAL_QUESTION, CopilotIntent.EXPLAIN_CONCEPT) and rag_answer:
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

    if not facts_parts:
        return compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)

    try:
        import ollama
        _model = model or os.getenv("CALCMATE_RAG_MODEL", "llama3.2:3b")
        client = ollama.Client(timeout=float(os.getenv("CALCMATE_GENERATION_TIMEOUT", "65")))
        prompt = _LLM_COMPOSE_PROMPT.format(
            facts="\n".join(facts_parts),
            question=request.message,
        )
        resp = client.generate(model=_model, prompt=prompt,
                               options={"temperature": 0.2, "num_predict": 200})
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
    except Exception:
        return compose_deterministic(operation_result, intent_result, request, rag_answer, rag_chunks)

