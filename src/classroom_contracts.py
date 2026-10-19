"""Bounded mobile evidence and the shared, observable BKT estimator."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime
from hashlib import sha256
import json
import sqlite3
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.knowledge_graph import load_kg

ESTIMATOR_VERSION = "bkt-v1:1"
snapshot_connection: ContextVar[sqlite3.Connection | None] = ContextVar("classroom_snapshot", default=None)


class EvidenceRow(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class StudentEvidence(EvidenceRow):
    id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=100)
    grade: int = Field(ge=1, le=5)


class AssessmentEvidence(EvidenceRow):
    id: str = Field(min_length=1, max_length=512)
    student_id: str = Field(min_length=1, max_length=160)
    concept_id: str = Field(min_length=1, max_length=30)
    date: date
    score: float = Field(ge=0)
    maximum: float = Field(gt=0)
    created_at: str = Field(min_length=1, max_length=40)
    updated_at: str = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def valid_score(self):
        if self.score > self.maximum:
            raise ValueError("Score exceeds maximum")
        datetime.fromisoformat(self.created_at.replace("Z", "+00:00"))
        datetime.fromisoformat(self.updated_at.replace("Z", "+00:00"))
        return self


class AttendanceEvidence(EvidenceRow):
    student_id: str
    date: date
    status: Literal["present", "absent", "late"]


def curriculum_version():
    kg = load_kg()
    return sha256(json.dumps([sorted(kg.nodes), sorted(kg.edges)]).encode()).hexdigest()[:16]


class ClassroomEvidence(EvidenceRow):
    version: Literal[1] = 1
    workspace_id: str = Field(min_length=1, max_length=180)
    captured_at: datetime
    as_of: date
    curriculum_version: str
    local_revision: int = Field(default=0,ge=0)
    estimator_version: Literal["score-ratio-v1:1", "bkt-v1:1"] = ESTIMATOR_VERSION
    students: list[StudentEvidence] = Field(max_length=500)
    assessments: list[AssessmentEvidence] = Field(max_length=12000)
    attendance: list[AttendanceEvidence] = Field(max_length=4000)
    deferred_concepts: list[str] = Field(default_factory=list,max_length=100)

    @model_validator(mode="after")
    def validate_records(self):
        ids = {s.id for s in self.students}
        kg = load_kg()
        if len(ids) != len(self.students) or len({a.id for a in self.assessments}) != len(self.assessments):
            raise ValueError("Duplicate classroom records")
        if self.curriculum_version != curriculum_version():
            raise ValueError("Curriculum version mismatch; update the app and server together")
        for a in self.assessments:
            if a.student_id not in ids or a.concept_id not in kg or a.date > self.as_of:
                raise ValueError("Assessment is outside the supplied classroom or evidence date")
        if any(c not in kg for c in self.deferred_concepts):
            raise ValueError("Deferred instruction references an unknown concept")
        seen = set()
        for a in self.attendance:
            key = (a.student_id, a.date)
            if a.student_id not in ids or a.date > self.as_of or key in seen:
                raise ValueError("Invalid or duplicate attendance evidence")
            seen.add(key)
        if len(self.model_dump_json().encode()) > 2 * 1024 * 1024:
            raise ValueError("Classroom evidence exceeds 2 MB; select fewer grades")
        return self

    @property
    def revision(self):
        data = self.model_dump(mode="json", exclude={"captured_at"})
        for key in ("students", "assessments", "attendance"):
            data[key] = sorted(data[key], key=lambda r: json.dumps(r, sort_keys=True))
        return sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:20]


def assert_workspace(workspace_id: str | None, teacher: dict):
    if workspace_id and workspace_id != teacher["workspace_id"]:
        raise HTTPException(403, "This classroom belongs to another teacher.")


def estimate(assessments, estimator_version: str = "score-ratio-v1:1"):
    ordered = sorted(assessments, key=lambda a: (str(a.date), a.created_at, a.id))
    count = len(ordered)
    if estimator_version == "bkt-v1:1":
        mastery = .20
        for assessment in ordered:
            observed = max(.01, min(.99, assessment.score / assessment.maximum))
            mastered_likelihood = mastery * (.10 + .90 * observed)
            unmastered_likelihood = (1 - mastery) * (.20 + .80 * observed * .35)
            posterior = mastered_likelihood / (mastered_likelihood + unmastered_likelihood)
            mastery = posterior + (1 - posterior) * .12
    else:
        mastery = (sum(a.score / a.maximum * .75 ** i for i, a in enumerate(reversed(ordered))) /
                   sum(.75 ** i for i in range(count))) if count else None
    mastery = mastery if count else None
    return {"mastery_estimate": mastery, "evidence_count": count,
            "last_evidence_at": str(ordered[0].date) if count else None,
            "state_status": "unknown" if mastery is None else "likely_ready" if mastery >= .7 else "insufficient" if mastery >= .6 else "needs_support",
            "evidence_sufficiency": "none" if not count else "sufficient" if count >= 4 else "moderate" if count >= 2 else "limited"}


@contextmanager
def evidence_database(evidence: ClassroomEvidence):
    """Adapt existing SQL reasoning to an isolated in-memory request snapshot."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
      CREATE TABLE students(id TEXT,workspace_id TEXT,name TEXT,grade INTEGER);
      CREATE TABLE concepts(id TEXT,workspace_id TEXT,title TEXT,grade INTEGER);
      CREATE TABLE attendance(student_id TEXT,workspace_id TEXT,date TEXT,status TEXT);
      CREATE TABLE learner_concept_states(student_id TEXT,concept_id TEXT,workspace_id TEXT,
        mastery_estimate REAL,evidence_count INTEGER,last_evidence_at TEXT,state_status TEXT,
        evidence_sufficiency TEXT,estimator_name TEXT,estimator_version TEXT,updated_at TEXT);
    """)
    w = evidence.workspace_id
    kg = load_kg()
    conn.executemany("INSERT INTO students VALUES(?,?,?,?)", [(s.id, w, s.name, s.grade) for s in evidence.students])
    conn.executemany("INSERT INTO concepts VALUES(?,?,?,?)", [(cid, w, n.get("concept", cid), int(n["grade"])) for cid, n in kg.nodes(data=True)])
    conn.executemany("INSERT INTO attendance VALUES(?,?,?,?)",[(a.student_id,w,str(a.date),a.status) for a in evidence.attendance])
    grouped={}
    for a in evidence.assessments:
        grouped.setdefault((a.student_id,a.concept_id),[]).append(a)
    for (student,concept), rows in grouped.items():
        state = estimate(rows, evidence.estimator_version)
        conn.execute("INSERT INTO learner_concept_states VALUES(?,?,?,?,?,?,?,?,?,?,?)", (student, concept, w,
          state["mastery_estimate"], state["evidence_count"], state["last_evidence_at"], state["state_status"],
          state["evidence_sufficiency"], "bkt-v1", "1", evidence.captured_at.isoformat()))
    token = snapshot_connection.set(conn)
    try:
        yield "request-snapshot"
    finally:
        snapshot_connection.reset(token)
        conn.close()
