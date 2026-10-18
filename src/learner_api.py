"""Authenticated reasoning over mobile classroom evidence, without file paths."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ConfigDict, BaseModel, Field
from src.auth_api import require_teacher
from src.classroom_contracts import ClassroomEvidence, assert_workspace, evidence_database
from src import learner_intelligence as li
from src.knowledge_graph import load_kg

router = APIRouter(prefix="/learner", tags=["learner-intelligence"])

class LearnerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_id: str
    classroom_evidence: ClassroomEvidence
    student_id: str | None = None
    concept_id: str | None = None
    grade: int = Field(default=1, ge=1, le=5)

def query(req, teacher, operation):
    assert_workspace(req.workspace_id, teacher)
    assert_workspace(req.classroom_evidence.workspace_id, teacher)
    if req.student_id and req.student_id not in {s.id for s in req.classroom_evidence.students}:
        raise HTTPException(404, "Student is not in the supplied classroom.")
    if req.concept_id and req.concept_id not in load_kg():
        raise HTTPException(404, "Concept is not in the canonical curriculum.")
    try:
        with evidence_database(req.classroom_evidence) as db:
            return operation(db)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@router.post("/student-view")
def student_view(req: LearnerRequest, teacher=Depends(require_teacher)):
    if not req.student_id:
        raise HTTPException(422, "Choose a student.")
    return query(req, teacher, lambda db: li.get_student_knowledge_view(req.workspace_id, req.student_id, db))

@router.post("/group-summary")
def group_summary(req: LearnerRequest, teacher=Depends(require_teacher)):
    if not req.concept_id:
        raise HTTPException(422, "Choose a concept.")
    return query(req, teacher, lambda db: li.get_group_concept_summary(req.workspace_id, req.grade, req.concept_id, db))

@router.post("/prerequisite-analysis")
def prerequisite_analysis(req: LearnerRequest, teacher=Depends(require_teacher)):
    if not req.concept_id or not req.student_id:
        raise HTTPException(422, "Choose a student and concept.")
    return query(req, teacher, lambda db: li.get_student_prerequisite_analysis(req.workspace_id, req.student_id, req.concept_id, db))

@router.post("/group-prerequisite-readiness")
def group_readiness(req: LearnerRequest, teacher=Depends(require_teacher)):
    if not req.concept_id:
        raise HTTPException(422, "Choose a concept.")
    return query(req, teacher, lambda db: li.get_group_prerequisite_readiness(req.workspace_id, req.grade, req.concept_id, db))
