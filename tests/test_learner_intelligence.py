"""
Tests for Stage 2 Learner Intelligence and Learner API Router.
Verifies learner knowledge state queries, graph-grounded prerequisite analysis,
and group summary endpoints.
"""

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from evidence_helpers import AuthenticatedEvidenceClient

from src.api import app
import src.learner_intelligence as li


def _setup_test_db(db_path: Path):
    """Create a minimal SQLite database mirroring the Calcmate mobile schema."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON;")
    with conn:
        conn.executescript("""
            CREATE TABLE workspaces (
                id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, mode TEXT NOT NULL,
                seeded_at TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE students (
                id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                name TEXT NOT NULL, grade INTEGER NOT NULL, roll TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, id)
            );
            CREATE TABLE concepts (
                id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                title TEXT NOT NULL, grade INTEGER NOT NULL, prerequisite_id TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, id)
            );
            CREATE TABLE learner_concept_states (
                id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                student_id TEXT NOT NULL, concept_id TEXT NOT NULL,
                mastery_estimate REAL,
                evidence_count INTEGER NOT NULL DEFAULT 0,
                last_evidence_at TEXT,
                estimator_name TEXT NOT NULL DEFAULT 'score-ratio-v1',
                estimator_version TEXT NOT NULL DEFAULT '1',
                state_status TEXT NOT NULL DEFAULT 'unknown',
                evidence_sufficiency TEXT NOT NULL DEFAULT 'none',
                updated_at TEXT NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, id),
                UNIQUE(workspace_id, student_id, concept_id)
            );
        """)
        # Seed test workspace
        now = "2026-10-14T12:00:00.000Z"
        conn.execute("INSERT INTO workspaces VALUES('w1', 't1', 'real', NULL, ?)", (now,))
        conn.execute("INSERT INTO students VALUES('s1', 'w1', 'Aarav Sharma', 2, '01', ?, ?)", (now, now))
        conn.execute("INSERT INTO students VALUES('s2', 'w1', 'Diya Patel', 2, '02', ?, ?)", (now, now))

        # Seed concepts matching canonical IDs
        # M103 -> M201 -> M202 -> M203
        conn.execute("INSERT INTO concepts VALUES('M201', 'w1', 'Numbers up to 100', 2, 'M103', ?, ?)", (now, now))
        conn.execute("INSERT INTO concepts VALUES('M202', 'w1', 'Place value - tens and ones', 2, 'M201', ?, ?)", (now, now))
        conn.execute("INSERT INTO concepts VALUES('M203', 'w1', 'Addition without regrouping', 2, 'M202', ?, ?)", (now, now))

        # Seed learner concept states:
        # s1: M201 is likely_ready (0.85), M202 is needs_support (0.45)
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs-1', 'w1', 's1', 'M201', 0.85, 3, '2026-10-10',
                'score-ratio-v1', '1', 'likely_ready', 'moderate', ?, ?
            )
        """, (now, now))
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs-2', 'w1', 's1', 'M202', 0.45, 2, '2026-10-10',
                'score-ratio-v1', '1', 'needs_support', 'moderate', ?, ?
            )
        """, (now, now))
        # Note: M203 is deliberately unassessed for s1 (unknown state)
    conn.close()


class LearnerIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "calcmate_test.db"
        _setup_test_db(self.db_path)
        self.client = AuthenticatedEvidenceClient(app,self.db_path)

    def tearDown(self):
        self.client.close()
        try:
            self.tmp_dir.cleanup()
        except (PermissionError, OSError):
            pass


    def test_get_student_concept_state(self):
        # Known state
        state = li.get_student_concept_state("w1", "s1", "M201", str(self.db_path))
        self.assertIsNotNone(state)
        self.assertEqual(state["state_status"], "likely_ready")
        self.assertAlmostEqual(state["mastery_estimate"], 0.85)
        self.assertEqual(state["evidence_count"], 3)

        # Unassessed concept -> None
        unassessed = li.get_student_concept_state("w1", "s1", "M203", str(self.db_path))
        self.assertIsNone(unassessed)

    def test_get_student_knowledge_view_and_prerequisite_gaps(self):
        view = li.get_student_knowledge_view("w1", "s1", str(self.db_path))
        self.assertEqual(view["student_id"], "s1")
        self.assertEqual(view["student_name"], "Aarav Sharma")
        self.assertEqual(view["grade"], 2)

        # M201, M202, M203 are in Grade 2
        concepts_by_id = {c["concept_id"]: c for c in view["concepts"]}
        self.assertIn("M201", concepts_by_id)
        self.assertIn("M202", concepts_by_id)
        self.assertIn("M203", concepts_by_id)

        # M203 requires M202. Since s1's M202 is 'needs_support', M203 MUST have a prerequisite_gap flag!
        self.assertTrue(concepts_by_id["M203"]["prerequisite_gap"])

        # M203 state itself is None (unknown evidence -> unknown, never zero mastery)
        self.assertIsNone(concepts_by_id["M203"]["state"])

    def test_get_student_prerequisite_analysis(self):
        analysis = li.get_student_prerequisite_analysis("w1", "s1", "M203", str(self.db_path))
        self.assertEqual(analysis["concept_id"], "M203")
        self.assertTrue(analysis["has_blocking_gaps"])
        self.assertIn("Address prerequisite gaps", analysis["recommendation"])

    def test_get_group_concept_summary(self):
        summary = li.get_group_concept_summary("w1", 2, "M201", str(self.db_path))
        self.assertEqual(summary["total_students"], 2)
        self.assertEqual(summary["assessed_students"], 1)
        self.assertEqual(summary["counts"]["likely_ready"], 1)
        self.assertEqual(summary["counts"]["unknown"], 1)

    def test_api_prerequisite_analysis_payload_mode(self):
        """Test API endpoint with payload-based mode (client sends its known states, no DB needed)."""
        payload = {
            "concept_id": "M203",
            "student_states": {
                "M202": {
                    "state_status": "needs_support",
                    "mastery_estimate": 0.40
                }
            }
        }
        res = self.client.post("/learner/prerequisite-analysis", json=payload)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["concept_id"], "M203")
        self.assertTrue(data["has_blocking_gaps"])
        self.assertIn("Address prerequisite gaps", data["recommendation"])

    def test_api_prerequisite_analysis_db_mode(self):
        """Test API endpoint with DB mode."""
        payload = {
            "concept_id": "M203",
            "student_id": "s1",
            "workspace_id": "w1",
            "db_path": str(self.db_path)
        }
        res = self.client.post("/learner/prerequisite-analysis", json=payload)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["concept_id"], "M203")
        self.assertTrue(data["has_blocking_gaps"])


if __name__ == "__main__":
    unittest.main()
