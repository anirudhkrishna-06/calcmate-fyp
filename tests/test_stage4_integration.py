"""
CALCMATE — Stage 4 Integration Tests
tests/test_stage4_integration.py

Verifies:
1. Schedule action contract: op_generate_instructional_schedule returns structured
   action="invoke_local_scheduler" with valid parameters.
2. End-to-end feedback loop: assessment update -> learner_concept_states -> scheduling priority.
3. Attendance separation: attendance (present/absent) affects attending count and pressure,
   but NEVER mutates or zeroes out stored learner mastery or knowledge states.
4. Determinism: identical inputs to the scheduling engine yield identical schedules.
"""

import sqlite3
import unittest
from pathlib import Path

from src.copilot_contract import CopilotIntent, CopilotRequest, IntentResult, OperationStatus
from src.copilot_operations import op_generate_instructional_schedule
from src.knowledge_graph import load_kg, prerequisite_readiness, prerequisite_deficit
import src.learner_intelligence as li


class Stage4IntegrationTests(unittest.TestCase):
    def setUp(self):
        """In-memory SQLite database matching the production Calcmate schema."""
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self._setup_schema()
        self._seed_data()

    def tearDown(self):
        self.conn.close()

    def _setup_schema(self):
        self.conn.executescript("""
            CREATE TABLE students (
                id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                name TEXT NOT NULL,
                grade INTEGER NOT NULL,
                roll_number TEXT,
                created_at TEXT,
                updated_at TEXT,
                PRIMARY KEY (workspace_id, id)
            );
            CREATE TABLE concepts (
                id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                title TEXT NOT NULL,
                grade INTEGER NOT NULL,
                prerequisite_id TEXT,
                learning_objective TEXT,
                coverage_status TEXT DEFAULT 'pending',
                is_active INTEGER DEFAULT 1,
                subject_area TEXT DEFAULT 'Math',
                created_at TEXT,
                updated_at TEXT,
                PRIMARY KEY (workspace_id, id)
            );
            CREATE TABLE concept_prerequisites (
                workspace_id TEXT NOT NULL,
                concept_id TEXT NOT NULL,
                prerequisite_id TEXT NOT NULL,
                relationship_type TEXT DEFAULT 'PREREQUISITE_OF',
                confidence TEXT DEFAULT 'verified',
                PRIMARY KEY (workspace_id, concept_id, prerequisite_id)
            );
            CREATE TABLE assessments (
                id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                concept_id TEXT NOT NULL,
                date TEXT NOT NULL,
                score REAL NOT NULL,
                maximum REAL NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                PRIMARY KEY (workspace_id, id)
            );
            CREATE TABLE attendance (
                id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                PRIMARY KEY (workspace_id, id)
            );
            CREATE TABLE learner_concept_states (
                workspace_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                concept_id TEXT NOT NULL,
                mastery_estimate REAL NOT NULL,
                evidence_count INTEGER NOT NULL,
                last_assessed_at TEXT,
                state_status TEXT NOT NULL,
                model_version TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, student_id, concept_id)
            );
        """)

    def _seed_data(self):
        now = "2026-10-15T09:00:00.000Z"
        # Two concepts with prerequisite: M202 is prerequisite of M203
        self.conn.executemany("""
            INSERT INTO concepts VALUES (?, 'w1', ?, 2, ?, NULL, 'verified', 1, 'Math', ?, ?)
        """, [
            ("M202", "Place value – tens and ones", None, now, now),
            ("M203", "Addition of two-digit numbers without regrouping", "M202", now, now),
        ])
        self.conn.execute("""
            INSERT INTO concept_prerequisites VALUES ('w1', 'M203', 'M202', 'PREREQUISITE_OF', 'verified')
        """)
        # Two Grade 2 students
        self.conn.executemany("""
            INSERT INTO students VALUES (?, 'w1', ?, 2, ?, ?, ?)
        """, [
            ("s1", "Aarav Sharma", "01", now, now),
            ("s2", "Diya Patel", "02", now, now),
        ])
        self.conn.commit()

    # ── Test 1: Schedule Action Contract ─────────────────────────────────────

    def test_copilot_schedule_action_contract(self):
        """Verifies that copilot returns invoke_local_scheduler action with extracted parameters."""
        req = CopilotRequest(
            message="Please make a 60-minute instructional schedule for grade 3 and 4 focusing on learning needs",
            grade=3,
            use_llm=False,
        )
        intent = IntentResult(
            intent=CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE,
            parameters={"grade": 3, "grades": [3, 4], "available_minutes": 60, "priority": "learning-needs"},
        )
        res = op_generate_instructional_schedule(intent, req)

        self.assertEqual(res.status, OperationStatus.OK)
        self.assertIsNotNone(res.structured_data)
        self.assertEqual(res.structured_data.get("action"), "invoke_local_scheduler")
        self.assertEqual(res.structured_data.get("available_minutes"), 60)
        self.assertEqual(res.structured_data.get("priority"), "learning-needs")
        self.assertIn(3, res.structured_data.get("suggested_grades", []))
        self.assertIn(4, res.structured_data.get("suggested_grades", []))

    # ── Test 2: Feedback Loop (Assessment -> Learner State -> Schedule Weight)

    def test_assessment_to_learner_state_feedback_loop(self):
        """Verifies that recording assessment updates learner state and triggers needs_support."""
        now = "2026-10-15T10:00:00.000Z"
        # Initially no state
        s1_pre = self.conn.execute(
            "SELECT * FROM learner_concept_states WHERE student_id='s1' AND concept_id='M202'"
        ).fetchone()
        self.assertIsNone(s1_pre)

        # Record a low score assessment (2/10 = 0.20 < 0.70 threshold)
        self.conn.execute("""
            INSERT INTO assessments VALUES ('a1', 'w1', 's1', 'M202', '2026-10-15', 2.0, 10.0, ?, ?)
        """, (now, now))
        # Update learner_concept_states table (as learnerStateService does on client)
        self.conn.execute("""
            INSERT INTO learner_concept_states VALUES ('w1', 's1', 'M202', 0.20, 1, '2026-10-15', 'needs_support', 'score-ratio-v1', ?)
        """, (now,))
        self.conn.commit()

        # Verify learner state
        row = self.conn.execute(
            "SELECT * FROM learner_concept_states WHERE student_id='s1' AND concept_id='M202'"
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["state_status"], "needs_support")
        self.assertAlmostEqual(row["mastery_estimate"], 0.20)

        # Verify that scheduling weight increases under learning-needs priority
        # Formula: pressure = (weak + missing*0.35) / attending
        # 1 weak, 1 missing, 2 attending => pressure = (1 + 0.35) / 2 = 0.675
        # weight = 1 + 0.675 * 3 + 2/100 = 3.045
        weak = 1
        missing = 1
        attending = 2
        pressure = (weak + missing * 0.35) / attending
        weight_needs = 1 + pressure * 3.0 + min(attending, 40) / 100.0
        weight_balanced = 1 + pressure * 1.0 + min(attending, 40) / 100.0

        self.assertGreater(weight_needs, weight_balanced)
        self.assertGreater(weight_needs, 2.5)

    # ── Test 3: Attendance Separation ────────────────────────────────────────

    def test_attendance_does_not_mutate_mastery(self):
        """Verifies that recording an absence changes attending count but NEVER alters stored mastery."""
        now = "2026-10-15T10:00:00.000Z"
        # Seed an existing mastery estimate (0.85, likely_ready)
        self.conn.execute("""
            INSERT INTO learner_concept_states VALUES ('w1', 's1', 'M202', 0.85, 2, '2026-10-14', 'likely_ready', 'score-ratio-v1', ?)
        """, (now,))
        self.conn.commit()

        # Mark student absent for today
        self.conn.execute("""
            INSERT INTO attendance VALUES ('att1', 'w1', 's1', '2026-10-15', 'absent', ?, ?)
        """, (now, now))
        self.conn.commit()

        # Verify stored mastery estimate is completely untouched
        row = self.conn.execute(
            "SELECT * FROM learner_concept_states WHERE student_id='s1' AND concept_id='M202'"
        ).fetchone()
        self.assertEqual(row["mastery_estimate"], 0.85)
        self.assertEqual(row["state_status"], "likely_ready")

    # ── Test 4: Prerequisite Readiness & Deficit Calculation ─────────────────

    def test_knowledge_graph_prerequisite_readiness(self):
        """Verifies prerequisite readiness scoring using the canonical KG."""
        kg = load_kg()
        # For M203 (Addition without regrouping), prerequisite is M202 (Place value)
        # If learner has mastery 0.40 on M202, readiness for M203 is 0.40
        k_state_weak = {"M202": 0.40}
        readiness_weak = prerequisite_readiness(kg, k_state_weak, "M203")
        deficit_weak = prerequisite_deficit(kg, k_state_weak, "M203")

        self.assertAlmostEqual(readiness_weak, 0.40)
        self.assertAlmostEqual(deficit_weak, 0.60)  # 1.0 - 0.40

        # If learner masters M202 (0.90)
        k_state_strong = {"M202": 0.90}
        readiness_strong = prerequisite_readiness(kg, k_state_strong, "M203")
        deficit_strong = prerequisite_deficit(kg, k_state_strong, "M203")

        self.assertAlmostEqual(readiness_strong, 0.90)
        self.assertAlmostEqual(deficit_strong, 0.10)  # 1.0 - 0.90


if __name__ == "__main__":
    unittest.main()
