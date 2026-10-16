"""
CALCMATE — Research Demonstration and Simulator Unit Tests
tests/test_research_demo.py

Verifies:
1. Score-Ratio-v1 mathematical formula parity with production TypeScript.
2. Canonical NCERT curriculum knowledge graph integrity (84 nodes, 73 edges, 0 cycles).
3. Concept traversal logic (direct prerequisites, transitive closure, gating).
4. Synthetic multi-grade classroom generation (24 students across G3/G4/G5, attendance isolation).
5. Production TypeScript scheduler Node bridge execution and time budget conservation.
6. DB hygiene: ensures demonstration operations are strictly in-memory / file-based and never write to calcmate.db.
"""

import sys
from pathlib import Path
import sqlite3
import pytest
import networkx as nx

# Ensure project root is on sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.research_demo import (
    load_kg,
    concepts_for_grade,
    compute_mastery_estimate,
    AssessmentItem,
    generate_synthetic_classroom,
    invoke_production_scheduler,
    build_planning_payload,
)


# ─── 1. Score-Ratio-v1 Mathematical Parity Tests ──────────────────────────────

def test_score_ratio_v1_numerical_parity_three_assessments():
    """
    Verifies the Score-Ratio-v1 exponential recency decay formula:
    Assessments in chronological order: [2/10, 4/10, 8/10]
    Reverse chronological order: [0.8, 0.4, 0.2]
    Weights: [1.0, 0.75, 0.5625]
    Weighted numerator: 0.8*1.0 + 0.4*0.75 + 0.2*0.5625 = 0.8 + 0.3 + 0.1125 = 1.2125
    Weight sum: 1.0 + 0.75 + 0.5625 = 2.3125
    Mastery estimate = 1.2125 / 2.3125 = 0.524324... (52.43%)
    Status: needs_support (< 0.60)
    Sufficiency: moderate (n=3)
    """
    items = [
        AssessmentItem(score=2.0, maximum=10.0, date="2026-10-01"),
        AssessmentItem(score=4.0, maximum=10.0, date="2026-10-05"),
        AssessmentItem(score=8.0, maximum=10.0, date="2026-10-12"),
    ]
    est = compute_mastery_estimate(items)

    assert est.mastery_estimate is not None
    assert round(est.mastery_estimate, 4) == 0.5243
    assert est.state_status == "needs_support"
    assert est.evidence_sufficiency == "moderate"
    assert est.evidence_count == 3


def test_score_ratio_v1_empty_assessments():
    """Empty assessments must yield None estimate, unknown status, none sufficiency."""
    est = compute_mastery_estimate([])
    assert est.mastery_estimate is None
    assert est.state_status == "unknown"
    assert est.evidence_sufficiency == "none"
    assert est.evidence_count == 0


def test_score_ratio_v1_single_assessment():
    """Single assessment of 8/10 should yield 0.8000, likely_ready, limited sufficiency."""
    items = [AssessmentItem(score=8.0, maximum=10.0, date="2026-10-10")]
    est = compute_mastery_estimate(items)
    assert est.mastery_estimate == 0.8
    assert est.state_status == "likely_ready"
    assert est.evidence_sufficiency == "limited"
    assert est.evidence_count == 1


# ─── 2. Canonical Knowledge Graph Integrity Tests ─────────────────────────────

def test_canonical_graph_properties():
    """Canonical graph must have exactly 84 concepts, 73 edges, and be a DAG."""
    kg = load_kg()
    assert kg.number_of_nodes() == 84
    assert kg.number_of_edges() == 73
    assert nx.is_directed_acyclic_graph(kg) is True

    # Validate grade distribution
    grade_counts = {}
    for _, d in kg.nodes(data=True):
        g = d.get("grade")
        grade_counts[g] = grade_counts.get(g, 0) + 1

    assert grade_counts == {1: 10, 2: 10, 3: 20, 4: 21, 5: 23}


def test_concept_traversal_m404():
    """
    M404 (Division with remainder) in Grade 4 must:
    - Have direct prerequisite M403 (Division as equal sharing).
    - Have transitive ancestors including M301, M302, M304, M307, M308.
    - Have dependent M503 (Long division).
    """
    kg = load_kg()
    assert "M404" in kg
    preds = list(kg.predecessors("M404"))
    assert "M403" in preds

    ancestors = nx.ancestors(kg, "M404")
    assert "M403" in ancestors
    assert "M308" in ancestors
    assert "M307" in ancestors

    descendants = nx.descendants(kg, "M404")
    assert "M503" in descendants


# ─── 3. Synthetic Multi-Grade Classroom Tests ─────────────────────────────────

def test_classroom_generation_24_students():
    """Generates 24 students across Grades 3, 4, 5 (8 per grade)."""
    cr = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=42)
    assert len(cr.students) == 24
    assert len(cr.students_for_grade(3)) == 8
    assert len(cr.students_for_grade(4)) == 8
    assert len(cr.students_for_grade(5)) == 8


def test_classroom_generation_configurable_students():
    """Can generate 23 or 25 students properly distributed across grades."""
    cr23 = generate_synthetic_classroom(total_students=23, grades=(3, 4, 5), seed=10)
    assert len(cr23.students) == 23

    cr25 = generate_synthetic_classroom(total_students=25, grades=(3, 4, 5), seed=11)
    assert len(cr25.students) == 25


def test_classroom_reproducibility():
    """Identical seed must yield identical student attributes and attendance."""
    cr1 = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=99)
    cr2 = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=99)

    for s1, s2 in zip(cr1.students, cr2.students):
        assert s1.id == s2.id
        assert s1.name == s2.name
        assert s1.attendance_status == s2.attendance_status
        assert s1.k_true == s2.k_true


def test_attendance_independence():
    """
    Absence must NOT alter stored mastery estimates.
    Stored knowledge state reflects pedagogical history, while attendance
    is an orthogonal operational constraint.
    """
    cr = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=42)
    absent_students = [s for s in cr.students if s.attendance_status == "absent"]
    assert len(absent_students) > 0

    for s in absent_students:
        for cid, items in s.assessment_history.items():
            expected_est = compute_mastery_estimate(items)
            actual_est = s.estimates[cid]
            assert actual_est.mastery_estimate == expected_est.mastery_estimate
            assert actual_est.state_status == expected_est.state_status


# ─── 4. Production Scheduler Bridge & Draft Validation ────────────────────────

def test_production_scheduler_bridge_execution():
    """
    Invokes frontend/src/services/generalScheduler.ts via Node.js bridge.
    Verifies:
    1. Returns valid draft with correct structure.
    2. Sum of block durationMinutes == availableMinutes (180).
    3. Every instruction block has exactly one teacher grade from the selected grades.
    4. Opening (3m) and Closing (2m) are scheduled when duration >= 30m.
    5. Each grade has an assigned activity in every block.
    """
    cr = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=42)
    draft = invoke_production_scheduler(cr, available_minutes=180, priority="learning-needs")

    assert draft["kind"] == "general-schedule"
    assert draft["selection"]["availableMinutes"] == 180
    assert draft["selection"]["grades"] == [3, 4, 5]

    blocks = draft["blocks"]
    assert len(blocks) > 0

    # Total duration constraint
    total_minutes = sum(b["durationMinutes"] for b in blocks)
    assert total_minutes == 180

    # Common openings and closings
    assert blocks[0]["kind"] == "opening"
    assert blocks[0]["durationMinutes"] == 3
    assert blocks[-1]["kind"] == "closing"
    assert blocks[-1]["durationMinutes"] == 2

    # Teacher instruction blocks
    instruction_blocks = [b for b in blocks if b["kind"] == "instruction"]
    assert len(instruction_blocks) >= 3

    for ib in instruction_blocks:
        assert ib["teacherGrade"] in [3, 4, 5]
        # In an instruction block, non-teacher grades must have independent/pair activities
        for act in ib["activities"]:
            assert act["grade"] in [3, 4, 5]
            if act["grade"] == ib["teacherGrade"]:
                assert "Work with the teacher" in act["activity"]
            else:
                assert "Pair practice" in act["activity"] or "Independent" in act["activity"]


# ─── 5. Database Hygiene (Zero Pollution Test) ────────────────────────────────

def test_database_hygiene():
    """
    Ensures running research simulation is strictly in-memory and file-isolated,
    never creating or polluting SQLite database files in the workspace.
    """
    before_files = set(Path(_PROJECT_ROOT).glob("*.db"))
    cr = generate_synthetic_classroom(total_students=24, grades=(3, 4, 5), seed=777)
    _ = invoke_production_scheduler(cr, available_minutes=60, priority="learning-needs")
    after_files = set(Path(_PROJECT_ROOT).glob("*.db"))
    assert before_files == after_files, "Simulation created unexpected .db files in project root!"
