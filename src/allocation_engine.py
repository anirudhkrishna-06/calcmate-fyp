"""Deterministic multigrade allocation over the same evidence used by the copilot."""
from datetime import date
import math
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from src.auth_api import require_teacher
from src.classroom_contracts import ClassroomEvidence, assert_workspace, estimate
from src.knowledge_graph import load_kg
from src.allocation_policy import observed_pressure, POLICY_VERSION

router = APIRouter(prefix="/planning", tags=["planning"])


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    availableMinutes: int = Field(ge=5, le=480)
    grades: list[int] = Field(min_length=1, max_length=5)
    priority: Literal["balanced", "learning-needs"]

    @model_validator(mode="after")
    def valid_grades(self):
        if len(set(self.grades)) != len(self.grades) or any(g not in range(1, 6) for g in self.grades):
            raise ValueError("Choose distinct Grades 1-5")
        return self


class PlanningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection: Selection
    classroom_evidence: ClassroomEvidence


def build_schedule(selection: Selection, evidence: ClassroomEvidence):
    if evidence.as_of != selection.date:
        raise HTTPException(422, "Evidence date must match the planning date.")
    kg = load_kg()
    states = {}
    for a in evidence.assessments:
        states.setdefault((a.student_id, a.concept_id), []).append(a)
    mastery = {key: estimate(rows)["mastery_estimate"] for key, rows in states.items()}
    absent = {a.student_id for a in evidence.attendance if a.date == selection.date and a.status == "absent"}
    needs = []
    for grade in sorted(selection.grades):
        students = [s for s in evidence.students if s.grade == grade]
        attending = [s for s in students if s.id not in absent]
        def info(cid):
            vals = [mastery.get((s.id, cid)) for s in attending]
            return {"id": cid, "weak": sum(v is not None and v < .6 for v in vals), "missing": vals.count(None), "score": observed_pressure(vals) + (.25 if cid in evidence.deferred_concepts else 0)}
        ranked = sorted((info(cid) for cid, n in kg.nodes(data=True) if int(n["grade"]) == grade), key=lambda c: (-c["score"], c["id"]))
        focus = ranked[0]
        visited = set()
        while focus["id"] not in visited:
            visited.add(focus["id"])
            gaps = [info(cid) for cid in kg.predecessors(focus["id"]) if any(mastery.get((s.id, cid)) is None or mastery[(s.id, cid)] < .6 for s in attending)]
            if not gaps:
                break
            focus = sorted(gaps, key=lambda c: (-c["score"], c["id"]))[0]
        concept = kg.nodes[focus["id"]].get("concept", focus["id"])
        gap = bool(visited - {focus["id"]})
        pressure = (focus["weak"] + focus["missing"] * .35) / len(attending) if attending else 0
        weight = 1 + pressure * (3 if selection.priority == "learning-needs" else 1) + min(.6, kg.out_degree(focus["id"]) * .1) + (0.6 if gap else 0)
        reason = "No enrolled students; begin with a readiness check." if not students else "All recorded absent; confirm attendance." if not attending else f'{focus["weak"]} of {len(attending)} attending students need support; {focus["missing"]} have no assessment evidence.'
        if focus["id"] in evidence.deferred_concepts:
            weight += .25
            reason += " Previously postponed instruction is awaiting follow-up."
        if gap:
            reason += " Address the prerequisite before its dependent concept."
        needs.append({"grade": grade, "students": len(students), "attending": len(attending), "weak": focus["weak"], "missing": focus["missing"], "prerequisiteGap": gap, "conceptId": focus["id"], "concept": concept, "objective": f"Explain and practise {concept.lower()}.", "weight": weight, "reason": reason})
    ordered = sorted(needs, key=lambda n: (not bool(n["attending"]), not n["prerequisiteGap"], -n["weight"], n["grade"]))
    # Dependencies among selected focuses determine teacher order.
    pending, ordered = ordered, []
    while pending:
        ready = next((n for n in pending if not any(o != n and kg.has_edge(o["conceptId"], n["conceptId"]) for o in pending)), pending[0])
        ordered.append(ready)
        pending.remove(ready)
    common = 5 if selection.availableMinutes >= 30 else 0
    guided = selection.availableMinutes - common
    first = min(len(needs), max(1, (guided + 1) // 6))
    rounds = min(max(1, 8 // len(needs)), max(1, math.ceil(guided / (len(needs) * 25)))) if first == len(needs) else 1
    chosen = ordered[:first] * rounds
    budget = guided - len(chosen) + 1
    base = min(8, budget // len(chosen))
    remainder = budget - base * len(chosen)
    total = sum(n["weight"] for n in chosen)
    exact = [remainder * n["weight"] / total for n in chosen]
    durations = [base + math.floor(v) for v in exact]
    spare = budget - sum(durations)
    for i in sorted(range(len(chosen)), key=lambda i: (-(exact[i] % 1), i))[:spare]:
        durations[i] += 1
    blocks = []
    def add(kind, minutes, teacher=None):
        activities = [{"grade": n["grade"], "conceptId": n["conceptId"], "concept": n["concept"], "objective": n["objective"], "activity": (f'Work with the teacher on {n["concept"].lower()}.' if teacher and teacher["grade"] == n["grade"] else f'Pair practice with objects or worked examples on {n["concept"].lower()}; record one question for the teacher.')} for n in needs]
        text = (('Check readiness first, then model' if teacher['missing'] else 'Model') + f' and guide practice in {teacher["concept"].lower()}.') if teacher else {"opening": "Lead a common number talk and prepare materials.", "closing": "Collect an exit assessment and review one solution.", "transition": "Check independent groups and switch teacher group."}[kind]
        blocks.append({"id": f"block-{len(blocks)+1}", "kind": kind, "durationMinutes": minutes, "teacherGrade": teacher["grade"] if teacher else None, "teacherActivity": text, "reason": teacher["reason"] if teacher else "Coordinate all selected grades.", "status": "planned", "activities": activities})
    if common:
        add("opening", 3)
    for i, teacher in enumerate(chosen):
        if i:
            add("transition", 1)
        add("instruction", durations[i], teacher)
    if common:
        add("closing", 2)
    warnings = []
    if first < len(needs):
        warnings.append("Too little time for every grade: some grades have independent tasks only.")
    if min(durations) < 8:
        warnings.append("Teacher sessions are shorter than 8 minutes; add time for individual instruction.")
    if any(not n["students"] for n in needs):
        warnings.append("Some grades have no enrolled students; use readiness checks.")
    if any(n["students"] and not n["attending"] for n in needs):
        warnings.append("Some grades are recorded absent; confirm attendance before teaching.")
    return {"kind": "general-schedule", "version": 1, "selection": {**selection.model_dump(mode="json"), "grades": sorted(selection.grades)}, "needs": needs, "blocks": blocks, "warnings": warnings, "engine": "observed-evidence", "localRevision": evidence.local_revision, "curriculumVersion": evidence.curriculum_version, "policyVersion": POLICY_VERSION, "evidenceRevision": evidence.revision, "estimatorVersion": evidence.estimator_version}


@router.post("/general")
def general(req: PlanningRequest, teacher=Depends(require_teacher)):
    assert_workspace(req.classroom_evidence.workspace_id, teacher)
    return build_schedule(req.selection, req.classroom_evidence)
