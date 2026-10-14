"""
CALCMATE — Stage 2: Learner Intelligence API Router
src/learner_api.py

Exposes endpoints for student knowledge view, group summaries, and
graph-grounded prerequisite gap analysis. Operates in two modes:
1. Payload-based mode: Client sends local state; API uses the NCERT KG to
   compute prerequisite readiness and gap analysis without persisting student data.
2. DB-based mode: Reads from local SQLite when available.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.knowledge_graph import load_kg, prerequisite_readiness, downstream_dependency_importance
import src.learner_intelligence as li

router = APIRouter(prefix="/learner", tags=["learner-intelligence"])

# ─── Pydantic Request/Response Models ──────────────────────────────────────────

class PrerequisiteAnalysisRequest(BaseModel):
    concept_id: str
    student_id: Optional[str] = None
    workspace_id: Optional[str] = None
    # For payload-based mode (client sends its known states):
    student_states: Optional[Dict[str, Dict[str, Any]]] = Field(
        default=None,
        description="Map of concept_id -> state dict (state_status, mastery_estimate, etc.)"
    )
    db_path: Optional[str] = None


class PrerequisiteItem(BaseModel):
    concept_id: str
    concept_title: str
    state_status: str
    mastery_estimate: Optional[float]
    is_blocking: bool


class PrerequisiteAnalysisResponse(BaseModel):
    concept_id: str
    concept_title: str
    prerequisites: List[PrerequisiteItem]
    has_blocking_gaps: bool
    recommendation: str
    kg_prerequisite_readiness: Optional[float] = None


class GroupPrereqSummaryRequest(BaseModel):
    grade: int
    concept_id: str
    workspace_id: Optional[str] = None
    db_path: Optional[str] = None


class StudentViewRequest(BaseModel):
    workspace_id: str
    student_id: str
    db_path: str


class GroupSummaryRequest(BaseModel):
    workspace_id: str
    grade: int
    concept_id: str
    db_path: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/prerequisite-analysis", response_model=PrerequisiteAnalysisResponse)
async def analyze_prerequisites(req: PrerequisiteAnalysisRequest):
    """
    Evaluate prerequisite gaps for a student on a specific concept.
    Can use database lookup if db_path/workspace_id/student_id are provided,
    or in-memory payload lookup if student_states is provided.
    """
    kg = load_kg()
    if req.concept_id not in kg.nodes:
        raise HTTPException(status_code=404, detail=f"Concept '{req.concept_id}' not found in canonical KG.")

    node_data = kg.nodes[req.concept_id]
    concept_title = node_data.get("concept", req.concept_id)

    # 1. DB mode
    if req.db_path and req.workspace_id and req.student_id:
        try:
            res = li.get_student_prerequisite_analysis(
                workspace_id=req.workspace_id,
                student_id=req.student_id,
                concept_id=req.concept_id,
                db_path=req.db_path,
            )
            return res
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    # 2. Payload-based mode (offline-first mobile sends its local state map)
    direct_prereqs = list(kg.predecessors(req.concept_id))
    states = req.student_states or {}

    prereqs_out: List[PrerequisiteItem] = []
    for pid in direct_prereqs:
        p_data = kg.nodes.get(pid, {})
        p_title = p_data.get("concept", pid)
        p_state = states.get(pid, {})
        status = p_state.get("state_status", "unknown")
        mastery = p_state.get("mastery_estimate")
        is_blocking = status in ("unknown", "needs_support")

        prereqs_out.append(PrerequisiteItem(
            concept_id=pid,
            concept_title=p_title,
            state_status=status,
            mastery_estimate=mastery,
            is_blocking=is_blocking
        ))

    has_blocking = any(p.is_blocking for p in prereqs_out)
    blocking_names = [p.concept_title for p in prereqs_out if p.is_blocking]

    recommendation = (
        "No prerequisites recorded in the curriculum graph. Proceed with readiness check."
        if not prereqs_out
        else f"Address prerequisite gaps before teaching {concept_title}: {', '.join(blocking_names)}."
        if has_blocking
        else f"All prerequisites for {concept_title} show adequate evidence. Proceed with instruction."
    )

    k_state = {pid: (states.get(pid, {}).get("mastery_estimate") or 0.0) for pid in direct_prereqs}
    readiness_score = prerequisite_readiness(kg, k_state, req.concept_id)

    return PrerequisiteAnalysisResponse(
        concept_id=req.concept_id,
        concept_title=concept_title,
        prerequisites=prereqs_out,
        has_blocking_gaps=has_blocking,
        recommendation=recommendation,
        kg_prerequisite_readiness=readiness_score,
    )



@router.post("/student-view")
async def get_student_view(req: StudentViewRequest):
    """
    Return full student knowledge view from local database.
    """
    try:
        return li.get_student_knowledge_view(
            workspace_id=req.workspace_id,
            student_id=req.student_id,
            db_path=req.db_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/group-summary")
async def get_group_summary(req: GroupSummaryRequest):
    """
    Return summary of student states for a specific grade and concept.
    """
    try:
        return li.get_group_concept_summary(
            workspace_id=req.workspace_id,
            grade=req.grade,
            concept_id=req.concept_id,
            db_path=req.db_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/group-prerequisite-readiness")
async def get_group_prereq_readiness(req: GroupPrereqSummaryRequest):
    """
    Return group-level readiness for a concept based on prerequisites.
    """
    if not req.db_path or not req.workspace_id:
        raise HTTPException(status_code=400, detail="db_path and workspace_id are required.")
    try:
        return li.get_group_prerequisite_readiness(
            workspace_id=req.workspace_id,
            grade=req.grade,
            concept_id=req.concept_id,
            db_path=req.db_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
