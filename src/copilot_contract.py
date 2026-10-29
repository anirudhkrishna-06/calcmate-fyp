"""
CALCMATE — Stage 3: Copilot Contract
src/copilot_contract.py

Pydantic models for the intent-routing copilot pipeline.
All I/O types for the Stage 3 pipeline are defined here so that
intent_extractor, copilot_router, copilot_operations, and response_composer
share a single source of truth.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ─── Intent Enumeration ───────────────────────────────────────────────────────

class CopilotIntent(str, Enum):
    """All structured intents the copilot can route. Order matters for display."""
    # Student-state queries
    FIND_STUDENTS_BY_CONCEPT       = "find_students_by_concept"
    GET_STUDENT_CONCEPT_STATE      = "get_student_concept_state"
    GET_STUDENT_PROGRESS           = "get_student_progress"
    GET_ASSESSMENT_HISTORY         = "get_assessment_history"
    CLASSROOM_RECORD_QUERY        = "classroom_record_query"
    EXPLAIN_LEARNING_DIFFICULTY    = "explain_learning_difficulty"
    # Curriculum graph queries
    EXPLAIN_PREREQUISITES          = "explain_prerequisites"
    EXPLAIN_CONCEPT                = "explain_concept"
    # Group queries
    CLASSROOM_LEARNING_SUMMARY     = "classroom_learning_summary"
    GROUP_PREREQUISITE_READINESS   = "group_prerequisite_readiness"
    # Recommendations
    RECOMMEND_CURRICULUM_ACTIVITY  = "recommend_curriculum_activity"
    RETRIEVE_NCERT_RESOURCE        = "retrieve_ncert_resource"
    # Scheduling
    GENERATE_INSTRUCTIONAL_SCHEDULE = "generate_instructional_schedule"
    RESCHEDULE_INSTRUCTIONAL_PLAN = "reschedule_instructional_plan"
    # Fallback
    GENERAL_QUESTION               = "general_question"
    UNSUPPORTED                    = "unsupported"
    AMBIGUOUS                      = "ambiguous"


# ─── Request ──────────────────────────────────────────────────────────────────

class CopilotRequest(BaseModel):
    """Structured copilot request sent from the frontend."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # The teacher's natural-language message (required).
    message: str = Field(min_length=1, max_length=2000)

    # Grade context (1-5). Used for retrieval and routing.
    grade: int = Field(ge=1, le=5)

    # Subject is always Math in the current scope.
    subject: str = Field(default="Math")

    # Optional structured context from the current screen.
    workspace_id: Optional[str] = Field(default=None)
    student_id:   Optional[str] = Field(default=None)
    concept_id:   Optional[str] = Field(default=None)

    # Which screen the teacher is currently on (for routing hints).
    screen_context: Optional[str] = Field(default=None)

    # Profile context for the dedicated student-aware chat. Kept separate from
    # the learner evidence snapshot so the composer can personalize language.
    student_profile_context: Optional[dict[str, Any]] = Field(default=None)
    conversation_history: list[dict[str, str]] = Field(default_factory=list, max_length=12)

    # Whether to use the LLM for response composition.
    use_llm: bool = Field(default=True)

    # Number of RAG chunks to retrieve (for general questions).
    k: int = Field(default=3, ge=1, le=10)


# ─── Intent Result ────────────────────────────────────────────────────────────

class IntentResult(BaseModel):
    """Output of the intent extractor."""
    model_config = ConfigDict(extra="forbid")

    intent: CopilotIntent
    # Parameters extracted from the message (grade, student name, concept id, etc.)
    parameters: dict[str, Any] = Field(default_factory=dict)
    # Which parameters were required but could not be extracted.
    missing_parameters: list[str] = Field(default_factory=list)
    # Extraction confidence: "deterministic" | "llm" | "fallback"
    extraction_method: str = Field(default="deterministic")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


# ─── Operation Result ─────────────────────────────────────────────────────────

class OperationStatus(str, Enum):
    OK            = "ok"
    PARTIAL       = "partial"      # Some data missing, still useful
    UNAVAILABLE   = "unavailable"  # Required service/data not accessible
    ERROR         = "error"        # Unexpected internal error


class OperationResult(BaseModel):
    """Output of one copilot operation function."""
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    operation: str
    status: OperationStatus = OperationStatus.OK

    # Structured data payload (varies by operation).
    structured_data: Optional[dict[str, Any]] = Field(default=None)

    # Supporting evidence summary (1-2 sentences, factual, no LLM).
    evidence_summary: Optional[str] = Field(default=None)

    # Curriculum graph finding (prerequisite analysis, readiness score, etc.)
    graph_finding: Optional[str] = Field(default=None)

    # NCERT resource reference (source PDF, grade, chunk text snippet).
    ncert_resource: Optional[dict[str, Any]] = Field(default=None)

    # Known limitations of the data or corpus.
    limitations: list[str] = Field(default_factory=list)

    # Recommended teacher action.
    recommended_next_step: Optional[str] = Field(default=None)

    # Error detail (only set when status is ERROR).
    error_detail: Optional[str] = Field(default=None)


# ─── Copilot Response ─────────────────────────────────────────────────────────

class CopilotResponse(BaseModel):
    """Final response returned to the frontend via /chat."""
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    # The main natural-language answer shown to the teacher.
    answer: str

    # What evidence was used (factual summary, survives without LLM).
    evidence_found: Optional[str] = Field(default=None)

    # Curriculum graph finding (prerequisite gaps, readiness scores, etc.)
    graph_finding: Optional[str] = Field(default=None)

    # Interpretive note about confidence or data quality.
    interpretation: Optional[str] = Field(default=None)

    # What the teacher should do next.
    recommended_next_step: Optional[str] = Field(default=None)

    # NCERT source reference if applicable.
    ncert_resource: Optional[dict[str, Any]] = Field(default=None)

    # Known limitations disclosed to the teacher.
    limitations: list[str] = Field(default_factory=list)

    # Whether the LLM was used for this response.
    used_llm: bool = Field(default=False)

    # The intent that was routed (for frontend context badges).
    intent: Optional[str] = Field(default=None)

    # Chunks for the Sources panel (backward-compatible with existing RAG UI).
    chunks: list[dict[str, Any]] = Field(default_factory=list)

