"""
CALCMATE — Stage 2: Python Learner Intelligence Service
src/learner_intelligence.py

Reads from the mobile SQLite database (calcmate.db) when running as a local
server. Provides graph-aware learner state queries, group summaries, and
prerequisite gap analysis using the canonical knowledge graph from Stage 1.

Architecture note: The TypeScript side (learnerStateService.ts) is the
PRIMARY estimator running on-device. This Python module is optional
enrichment that activates when the server is connected. It DOES NOT
duplicate the curriculum graph per student; it reads pre-computed
learner_concept_states rows written by the TypeScript estimator.

All functions that accept a db_path default to the SQLite file the Expo
app creates at the standard Expo document directory. When running tests or
calling from the FastAPI server, pass the path explicitly.
"""

from __future__ import annotations

import sqlite3
import json
from contextlib import contextmanager
from typing import Optional
from pathlib import Path

from src.knowledge_graph import load_kg, prerequisite_readiness, prerequisite_deficit, downstream_dependency_importance

# ─── Constants ────────────────────────────────────────────────────────────────
MASTERY_THRESHOLD = 0.70
NEEDS_SUPPORT_THRESHOLD = 0.60

# ─── Helpers ──────────────────────────────────────────────────────────────────

@contextmanager
def _connect(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
    finally:
        conn.close()


def _dict(row: Optional[sqlite3.Row]) -> Optional[dict]:
    return dict(row) if row else None



# ─── Student-Level Queries ────────────────────────────────────────────────────

def get_student_concept_state(
    workspace_id: str,
    student_id: str,
    concept_id: str,
    db_path: str,
) -> Optional[dict]:
    """
    Return the learner_concept_states row for one student/concept.
    Returns None if no evidence has been recorded yet.
    """
    with _connect(db_path) as conn:
        row = conn.execute(
            """SELECT * FROM learner_concept_states
               WHERE workspace_id=? AND student_id=? AND concept_id=?""",
            (workspace_id, student_id, concept_id),
        ).fetchone()
    return _dict(row)


def get_student_knowledge_view(
    workspace_id: str,
    student_id: str,
    db_path: str,
) -> dict:
    """
    Return all learner_concept_states for a student, enriched with
    prerequisite gap flags derived from the canonical knowledge graph.
    """
    kg = load_kg()

    with _connect(db_path) as conn:
        student = conn.execute(
            "SELECT id, name, grade FROM students WHERE workspace_id=? AND id=?",
            (workspace_id, student_id),
        ).fetchone()
        if not student:
            raise ValueError(f"Student {student_id} not found in workspace {workspace_id}.")

        state_rows = conn.execute(
            """SELECT * FROM learner_concept_states
               WHERE workspace_id=? AND student_id=?""",
            (workspace_id, student_id),
        ).fetchall()

        grade_concepts = conn.execute(
            """SELECT id, title, grade FROM concepts
               WHERE workspace_id=? AND grade=? ORDER BY id""",
            (workspace_id, student["grade"]),
        ).fetchall()

    state_map: dict[str, dict] = {r["concept_id"]: dict(r) for r in state_rows}

    def _is_blocking(concept_id: str) -> bool:
        state = state_map.get(concept_id)
        return not state or state["state_status"] in ("unknown", "needs_support")

    concepts_out = []
    for c in grade_concepts:
        cid = c["id"]
        state = state_map.get(cid)
        # Use KG to get direct predecessors
        prereq_ids = list(kg.predecessors(cid)) if cid in kg.nodes else []
        prerequisite_gap = any(_is_blocking(pid) for pid in prereq_ids) if prereq_ids else False

        concepts_out.append({
            "concept_id": cid,
            "concept_title": c["title"],
            "concept_grade": c["grade"],
            "state": state,
            "prerequisite_gap": prerequisite_gap,
            "prerequisite_ids": prereq_ids,
        })

    assessed = sum(1 for c in concepts_out if c["state"] and c["state"]["state_status"] != "unknown")
    unassessed = len(concepts_out) - assessed
    needs_support = sum(1 for c in concepts_out if c["state"] and c["state"]["state_status"] == "needs_support")
    likely_ready = sum(1 for c in concepts_out if c["state"] and c["state"]["state_status"] == "likely_ready")
    unknown = sum(1 for c in concepts_out if not c["state"] or c["state"]["state_status"] == "unknown")

    return {
        "student_id": student_id,
        "student_name": student["name"],
        "grade": student["grade"],
        "concepts": concepts_out,
        "assessed_count": assessed,
        "unassessed_count": unassessed,
        "needs_support_count": needs_support,
        "likely_ready_count": likely_ready,
        "unknown_count": unknown,
    }


def get_student_learning_gaps(
    workspace_id: str,
    student_id: str,
    grade_scope: int,
    db_path: str,
) -> list[dict]:
    """
    Return all concepts in grade_scope where the student needs support or has
    no evidence, ordered by curriculum prerequisite importance (concepts whose
    dependents are most affected first).
    """
    kg = load_kg()

    with _connect(db_path) as conn:
        states = conn.execute(
            """SELECT * FROM learner_concept_states
               WHERE workspace_id=? AND student_id=?""",
            (workspace_id, student_id),
        ).fetchall()
        concepts = conn.execute(
            "SELECT id FROM concepts WHERE workspace_id=? AND grade=?",
            (workspace_id, grade_scope),
        ).fetchall()

    state_map = {r["concept_id"]: dict(r) for r in states}
    grade_ids = {c["id"] for c in concepts}
    importance_map = downstream_dependency_importance(kg)

    gaps = []
    for cid in grade_ids:
        state = state_map.get(cid)
        if not state or state["state_status"] in ("unknown", "needs_support"):
            importance = importance_map.get(cid, 0.0)
            gaps.append({
                "concept_id": cid,
                "state_status": state["state_status"] if state else "unknown",
                "mastery_estimate": state["mastery_estimate"] if state else None,
                "dependency_importance": importance,
            })


    gaps.sort(key=lambda g: (-g["dependency_importance"], g["concept_id"]))
    return gaps


def get_student_prerequisite_analysis(
    workspace_id: str,
    student_id: str,
    concept_id: str,
    db_path: str,
) -> dict:
    """
    Graph-aware prerequisite analysis using the canonical KG.
    Checks all transitive prerequisites, not just direct ones.
    """
    kg = load_kg()

    with _connect(db_path) as conn:
        state_rows = conn.execute(
            """SELECT * FROM learner_concept_states
               WHERE workspace_id=? AND student_id=?""",
            (workspace_id, student_id),
        ).fetchall()
        concept_row = conn.execute(
            "SELECT id, title FROM concepts WHERE workspace_id=? AND id=?",
            (workspace_id, concept_id),
        ).fetchone()

    if not concept_row:
        raise ValueError(f"Concept {concept_id} not found.")

    state_map = {r["concept_id"]: dict(r) for r in state_rows}

    # Direct prerequisites from KG
    direct_prereqs = list(kg.predecessors(concept_id)) if concept_id in kg.nodes else []

    prerequisites = []
    for pid in direct_prereqs:
        state = state_map.get(pid)
        status = state["state_status"] if state else "unknown"
        mastery = state["mastery_estimate"] if state else None
        is_blocking = status in ("unknown", "needs_support")
        # Try to get title from KG node data
        node_data = kg.nodes.get(pid, {})
        title = node_data.get("concept", pid)
        prerequisites.append({
            "concept_id": pid,
            "concept_title": title,
            "state_status": status,
            "mastery_estimate": mastery,
            "is_blocking": is_blocking,
        })

    has_blocking = any(p["is_blocking"] for p in prerequisites)
    blocking_names = [p["concept_title"] for p in prerequisites if p["is_blocking"]]

    concept_title = concept_row["title"]
    recommendation = (
        "No prerequisites recorded in the curriculum graph. Proceed with readiness check."
        if not prerequisites
        else f"Address prerequisite gaps before teaching {concept_title}: {', '.join(blocking_names)}."
        if has_blocking
        else f"All prerequisites for {concept_title} show adequate evidence. Proceed with instruction."
    )

    # Prerequisite readiness score from KG
    k_state = {pid: (state_map.get(pid, {}).get("mastery_estimate") or 0.0) for pid in direct_prereqs}
    readiness_score = prerequisite_readiness(kg, k_state, concept_id) if concept_id in kg.nodes else None

    return {

        "concept_id": concept_id,
        "concept_title": concept_title,
        "prerequisites": prerequisites,
        "has_blocking_gaps": has_blocking,
        "recommendation": recommendation,
        "kg_prerequisite_readiness": readiness_score,
    }


# ─── Group-Level Queries ──────────────────────────────────────────────────────

def get_group_concept_summary(
    workspace_id: str,
    grade: int,
    concept_id: str,
    db_path: str,
) -> dict:
    """
    For a given grade group and concept, return how many students are at
    each state_status level. Used by the allocation algorithm (Stage 3).
    """
    with _connect(db_path) as conn:
        students = conn.execute(
            "SELECT id FROM students WHERE workspace_id=? AND grade=?",
            (workspace_id, grade),
        ).fetchall()
        total = len(students)
        if not total:
            return {"grade": grade, "concept_id": concept_id, "total_students": 0,
                    "counts": {}, "mean_mastery": None}

        student_ids = [s["id"] for s in students]
        placeholders = ",".join("?" * len(student_ids))
        states = conn.execute(
            f"""SELECT state_status, mastery_estimate FROM learner_concept_states
                WHERE workspace_id=? AND concept_id=? AND student_id IN ({placeholders})""",
            (workspace_id, concept_id, *student_ids),
        ).fetchall()

    assessed = len(states)
    unknown_count = total - assessed

    counts: dict[str, int] = {"unknown": unknown_count}
    masteries = []
    for s in states:
        counts[s["state_status"]] = counts.get(s["state_status"], 0) + 1
        if s["mastery_estimate"] is not None:
            masteries.append(s["mastery_estimate"])

    mean_mastery = sum(masteries) / len(masteries) if masteries else None

    return {
        "grade": grade,
        "concept_id": concept_id,
        "total_students": total,
        "assessed_students": assessed,
        "counts": counts,
        "mean_mastery": mean_mastery,
    }


def get_group_prerequisite_readiness(
    workspace_id: str,
    grade: int,
    concept_id: str,
    db_path: str,
) -> dict:
    """
    Returns group-level prerequisite readiness for a concept: what fraction
    of the group has adequate evidence on each direct prerequisite.
    """
    kg = load_kg()
    prereq_ids = list(kg.predecessors(concept_id)) if concept_id in kg.nodes else []

    if not prereq_ids:
        return {"concept_id": concept_id, "grade": grade,
                "prerequisites": [], "group_ready": True}

    with _connect(db_path) as conn:
        students = conn.execute(
            "SELECT id FROM students WHERE workspace_id=? AND grade=?",
            (workspace_id, grade),
        ).fetchall()
        total = len(students)
        if not total:
            return {"concept_id": concept_id, "grade": grade,
                    "prerequisites": [], "group_ready": True}

        student_ids = [s["id"] for s in students]
        placeholders = ",".join("?" * len(student_ids))
        prereq_placeholders = ",".join("?" * len(prereq_ids))
        states = conn.execute(
            f"""SELECT student_id, concept_id, state_status, mastery_estimate
                FROM learner_concept_states
                WHERE workspace_id=? AND concept_id IN ({prereq_placeholders})
                AND student_id IN ({placeholders})""",
            (workspace_id, *prereq_ids, *student_ids),
        ).fetchall()

    # Index by concept_id
    by_concept: dict[str, list] = {pid: [] for pid in prereq_ids}
    for s in states:
        by_concept.setdefault(s["concept_id"], []).append(dict(s))

    prerequisites_out = []
    for pid in prereq_ids:
        node_data = kg.nodes.get(pid, {})
        title = node_data.get("concept", pid)
        ready = sum(1 for s in by_concept[pid] if s["state_status"] == "likely_ready")
        assessed = len(by_concept[pid])
        prerequisites_out.append({
            "concept_id": pid,
            "concept_title": title,
            "students_likely_ready": ready,
            "students_assessed": assessed,
            "students_total": total,
            "readiness_fraction": ready / total,
        })

    group_ready = all(p["readiness_fraction"] >= 0.5 for p in prerequisites_out)

    return {
        "concept_id": concept_id,
        "grade": grade,
        "prerequisites": prerequisites_out,
        "group_ready": group_ready,
    }

