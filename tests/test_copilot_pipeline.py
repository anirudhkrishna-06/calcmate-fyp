"""
Tests for Stage 3 Copilot Pipeline:
- Intent Extractor (deterministic extraction & concept alias resolution)
- Copilot Operations (graph & learner intelligence dispatch)
- Response Composer (deterministic factual formatting)
- FastAPI /chat endpoint (routing between plain RAG and structured Copilot)
"""

import os
import sqlite3
import tempfile
import datetime
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from evidence_helpers import AuthenticatedEvidenceClient

from src.copilot_contract import (
    CopilotIntent,
    CopilotRequest,
    IntentResult,
    OperationResult,
    OperationStatus,
)
from src.intent_extractor import extract_intent, resolve_concept_id
from src.copilot_operations import (
    dispatch,
    op_find_students_by_concept,
    op_get_student_concept_state,
    op_explain_prerequisites,
    op_classroom_learning_summary,
    op_group_prerequisite_readiness,
    op_generate_instructional_schedule,
)
from src.response_composer import compose_deterministic
from src.rag_api import app


def _setup_copilot_test_db(db_path: Path):
    """Create a minimal SQLite database mirroring Calcmate mobile schema."""
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
        now = "2026-10-15T10:00:00.000Z"
        conn.execute("INSERT INTO workspaces VALUES('w1', 't1', 'real', NULL, ?)", (now,))
        conn.execute("INSERT INTO students VALUES('s1', 'w1', 'Aarav Sharma', 2, '01', ?, ?)", (now, now))
        conn.execute("INSERT INTO students VALUES('s2', 'w1', 'Diya Patel', 2, '02', ?, ?)", (now, now))

        # Concepts: M201 -> M202 -> M203
        conn.execute("INSERT INTO concepts VALUES('M201', 'w1', 'Numbers up to 100', 2, 'M103', ?, ?)", (now, now))
        conn.execute("INSERT INTO concepts VALUES('M202', 'w1', 'Place value - tens and ones', 2, 'M201', ?, ?)", (now, now))
        conn.execute("INSERT INTO concepts VALUES('M203', 'w1', 'Addition of two-digit numbers without regrouping', 2, 'M202', ?, ?)", (now, now))

        # Learner states:
        # s1: M201 likely_ready, M202 needs_support
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs1', 'w1', 's1', 'M201', 0.85, 3, ?, 'score-ratio-v1', '1', 'likely_ready', 'moderate', ?, ?
            )
        """, (now, now, now))
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs2', 'w1', 's1', 'M202', 0.45, 2, ?, 'score-ratio-v1', '1', 'needs_support', 'moderate', ?, ?
            )
        """, (now, now, now))
        # s2: M201 likely_ready, M202 likely_ready
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs3', 'w1', 's2', 'M201', 0.90, 4, ?, 'score-ratio-v1', '1', 'likely_ready', 'sufficient', ?, ?
            )
        """, (now, now, now))
        conn.execute("""
            INSERT INTO learner_concept_states VALUES(
                'lcs4', 'w1', 's2', 'M202', 0.80, 3, ?, 'score-ratio-v1', '1', 'likely_ready', 'moderate', ?, ?
            )
        """, (now, now, now))
    conn.close()


class CopilotPipelineTests(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_calcmate.db"
        _setup_copilot_test_db(self.db_path)
        self.client = AuthenticatedEvidenceClient(app,self.db_path)

    def tearDown(self):
        self.client.close()
        try:
            self.temp_dir.cleanup()
        except (PermissionError, OSError):
            pass

    # ── 1. Intent Extraction Tests ──────────────────────────────────────────

    def test_intent_find_students_by_concept(self):
        req = CopilotRequest(message="Who is struggling with place value in Grade 2?", grade=2)
        result = extract_intent(req)
        self.assertEqual(result.intent, CopilotIntent.FIND_STUDENTS_BY_CONCEPT)
        self.assertEqual(result.parameters.get("grade"), 2)
        self.assertIn("place value", result.parameters.get("concept_phrase", "").lower())

    def test_intent_explain_prerequisites(self):
        req = CopilotRequest(message="What are the prerequisites for M203?", grade=2)
        result = extract_intent(req)
        self.assertEqual(result.intent, CopilotIntent.EXPLAIN_PREREQUISITES)
        self.assertEqual(result.parameters.get("concept_id"), "M203")

    def test_intent_generate_schedule(self):
        req = CopilotRequest(message="Generate an instructional schedule for Grade 2", grade=2)
        result = extract_intent(req)
        self.assertEqual(result.intent, CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE)
        self.assertEqual(result.parameters.get("grade"), 2)

    def test_intent_classroom_summary(self):
        req = CopilotRequest(message="Give me a classroom summary for Grade 2", grade=2)
        result = extract_intent(req)
        self.assertEqual(result.intent, CopilotIntent.CLASSROOM_LEARNING_SUMMARY)

    def test_intent_attention_queries_use_classroom_summary(self):
        for question in (
            "Who needs more attention today?",
            "Which students need attention?",
            "Where is the majority of my students weak?",
            "How are my students right now?",
            "  WHICH   LEARNERS ARE STRUGGLING?!  ",
            "Show me the students who need support.",
            "Who should I check on today?",
        ):
            with self.subTest(question=question):
                result = extract_intent(CopilotRequest(message=question, grade=2))
                self.assertEqual(result.intent, CopilotIntent.CLASSROOM_LEARNING_SUMMARY)

    def test_concept_specific_support_query_keeps_student_concept_route(self):
        result = extract_intent(CopilotRequest(message="Who needs help on place value?", grade=2))
        self.assertEqual(result.intent, CopilotIntent.FIND_STUDENTS_BY_CONCEPT)

    def test_intent_teach_next_uses_deterministic_scheduler(self):
        result = extract_intent(CopilotRequest(message="What should I teach next?", grade=2))
        self.assertEqual(result.intent, CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE)

    def test_intent_group_readiness(self):
        req = CopilotRequest(message="Is the group ready for addition without regrouping?", grade=2)
        result = extract_intent(req)
        self.assertEqual(result.intent, CopilotIntent.GROUP_PREREQUISITE_READINESS)

    def test_concept_alias_resolution(self):
        # Direct canonical ID
        self.assertEqual(resolve_concept_id("M201"), "M201")
        # Name matching
        cid = resolve_concept_id("place value", grade_hint=2)
        self.assertEqual(cid, "M202")

    # ── 2. Operations Tests ──────────────────────────────────────────────────

    def test_op_find_students_by_concept(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            req = CopilotRequest(
                message="Who needs help on place value?",
                grade=2,
                workspace_id="w1",
                concept_id="M202",
                use_llm=False,
            )
            intent = IntentResult(
                intent=CopilotIntent.FIND_STUDENTS_BY_CONCEPT,
                parameters={"concept_id": "M202", "grade": 2, "concept_phrase": "Place value"},
            )
            op_res = op_find_students_by_concept(intent, req)
            self.assertEqual(op_res.status, OperationStatus.OK)
            self.assertIn("2 students total", op_res.evidence_summary)
            self.assertIn("1 need support", op_res.evidence_summary)
            self.assertIn("1 likely ready", op_res.evidence_summary)

    def test_op_get_student_concept_state(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            req = CopilotRequest(
                message="How is Aarav doing on place value?",
                grade=2,
                workspace_id="w1",
                student_id="s1",
                concept_id="M202",
                use_llm=False,
            )
            intent = IntentResult(
                intent=CopilotIntent.GET_STUDENT_CONCEPT_STATE,
                parameters={"student_id": "s1", "concept_id": "M202", "concept_phrase": "Place value"},
            )
            op_res = op_get_student_concept_state(intent, req)
            self.assertEqual(op_res.status, OperationStatus.OK)
            self.assertIn("needs_support", op_res.evidence_summary)
            self.assertIn("45%", op_res.evidence_summary)

    def test_op_explain_prerequisites(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            req = CopilotRequest(
                message="What comes before M203?",
                grade=2,
                concept_id="M203",
                workspace_id="w1",
                use_llm=False,
            )
            intent = IntentResult(
                intent=CopilotIntent.EXPLAIN_PREREQUISITES,
                parameters={"concept_id": "M203", "concept_phrase": "Addition without regrouping"},
            )
            op_res = op_explain_prerequisites(intent, req)
            self.assertEqual(op_res.status, OperationStatus.OK)
            self.assertIn("M202", op_res.structured_data["prerequisite_ids"])
            self.assertIn("Place value", op_res.graph_finding)

    def test_op_generate_instructional_schedule(self):
        req = CopilotRequest(message="Make a schedule", grade=2, use_llm=False)
        intent = IntentResult(
            intent=CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE,
            parameters={"grade": 2},
        )
        op_res = op_generate_instructional_schedule(intent, req)
        self.assertEqual(op_res.status, OperationStatus.OK)
        self.assertEqual(op_res.structured_data.get("action"), "invoke_local_scheduler")
        self.assertIn(2, op_res.structured_data.get("suggested_grades", []))
        self.assertIn("Schedule request", op_res.evidence_summary)

    def test_attention_endpoint_uses_learner_evidence_not_rag(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)), \
             patch("src.rag_api._get_runtime") as rag_runtime:
            resp = self.client.post("/chat", json={
                "question": "Who needs more attention today?",
                "grade": 2,
                "workspace_id": "w1",
                "use_llm": False,
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["intent"], "classroom_learning_summary")
            self.assertEqual(data["chunks"], [])
            self.assertIn("Aarav Sharma", data["answer"])
            self.assertIn("needs support", data["answer"])
            self.assertIn("Insufficient evidence requiring a check", data["answer"])
            self.assertIn("Diya Patel", data["answer"])
            rag_runtime.assert_not_called()

    def test_summary_reports_recorded_attendance_without_inferencing_mastery(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""CREATE TABLE attendance (
                id TEXT PRIMARY KEY, workspace_id TEXT, student_id TEXT,
                date TEXT, status TEXT
            )""")
            conn.execute(
                "INSERT INTO attendance VALUES(?,?,?,?,?)",
                ("a1", "w1", "s1", datetime.date.today().isoformat(), "absent"),
            )
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            req = CopilotRequest(message="Who needs attention?", grade=2, workspace_id="w1", use_llm=False)
            intent = IntentResult(intent=CopilotIntent.CLASSROOM_LEARNING_SUMMARY, parameters={"grade": 2})
            result = op_classroom_learning_summary(intent, req)
            self.assertEqual(result.status, OperationStatus.OK)
            self.assertIn("Attendance recorded today: 0 present, 0 late, 1 absent", result.evidence_summary)
            self.assertNotIn("absent", result.structured_data["attention_candidates"][0]["reason"])

    def test_summary_does_not_mutate_learner_state(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            before = sqlite3.connect(self.db_path).execute(
                "SELECT student_id, concept_id, state_status, mastery_estimate FROM learner_concept_states ORDER BY id"
            ).fetchall()
            req = CopilotRequest(message="How are my students doing?", grade=2, workspace_id="w1", use_llm=False)
            intent = IntentResult(intent=CopilotIntent.CLASSROOM_LEARNING_SUMMARY, parameters={"grade": 2})
            result = op_classroom_learning_summary(intent, req)
            after = sqlite3.connect(self.db_path).execute(
                "SELECT student_id, concept_id, state_status, mastery_estimate FROM learner_concept_states ORDER BY id"
            ).fetchall()
            self.assertEqual(result.status, OperationStatus.OK)
            self.assertEqual(before, after)

    def test_scheduler_action_is_exposed_to_frontend_contract(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)), \
             patch("src.rag_api._get_runtime") as rag_runtime:
            resp = self.client.post("/chat", json={
                "question": "What should I teach next?",
                "grade": 2,
                "workspace_id": "w1",
                "use_llm": False,
            })
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["intent"], "generate_instructional_schedule")
            self.assertEqual(resp.json()["structured_data"]["action"], "invoke_local_scheduler")
            rag_runtime.assert_not_called()

    def test_curriculum_activity_keeps_rag_sources(self):
        from types import SimpleNamespace
        chunk = SimpleNamespace(
            chunk_id=11, text="NCERT activity for angles", grade=4, subject="Math",
            source_pdf="math4.pdf", chunk_index=2, score=0.88, used_fallback=False,
        )
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)), \
             patch("src.copilot_operations._retrieve_for_concept", return_value=[{
                 "chunk_id": 11, "text": chunk.text, "grade": 4, "subject": "Math",
                 "source_pdf": chunk.source_pdf, "chunk_index": 2, "score": 0.88,
                 "used_fallback": False,
             }]), \
             patch("src.rag_api._get_runtime") as rag_runtime:
            rag_runtime.return_value = (
                SimpleNamespace(
                    DEFAULT_MODEL="test-model",
                    answer_question=lambda *args, **kwargs: ("NCERT activity answer", [chunk]),
                ),
                "mock-retriever",
            )
            resp = self.client.post("/chat", json={
                "question": "Give me an NCERT activity for teaching angles in Grade 4.",
                "grade": 4,
                "workspace_id": "w1",
                "use_llm": False,
            })
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["intent"], "recommend_curriculum_activity")
            self.assertEqual(resp.json()["chunks"][0]["source_pdf"], "math4.pdf")
            self.assertIn("angles", resp.json()["answer"].lower())
            self.assertTrue(resp.json()["structured_data"]["deterministic_activity"])
            # The concept-filtered operation supplies these sources directly;
            # a second free-text retrieval can replace them with the wrong topic.
            rag_runtime.assert_not_called()

    # ── 3. Response Composer Tests ───────────────────────────────────────────

    def test_compose_deterministic(self):
        op_res = OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.OK,
            evidence_summary="Grade 2, concept 'place value': 2 students total — 1 need support, 1 likely ready.",
            graph_finding="Group mean mastery: 62%.",
            recommended_next_step="Review 1 student needing support.",
            limitations=["The NCERT retrieval corpus covers Grades 3–5. No textbook content is indexed for Grade 2."],
        )
        intent = IntentResult(
            intent=CopilotIntent.FIND_STUDENTS_BY_CONCEPT,
            parameters={"grade": 2, "concept_id": "M202"},
        )
        req = CopilotRequest(message="Who is struggling with place value?", grade=2, use_llm=False)
        response = compose_deterministic(op_res, intent, req)

        self.assertIn("**Student group status**", response.answer)
        self.assertIn("1 need support", response.answer)
        self.assertIn("Group mean mastery: 62%", response.answer)
        self.assertIn("Review 1 student", response.answer)
        self.assertIn("covers Grades 3–5", response.answer)
        self.assertFalse(response.used_llm)

    # ── 4. End-to-End /chat Endpoint Tests ───────────────────────────────────

    def test_chat_endpoint_routes_copilot_request(self):
        with patch("src.copilot_operations._find_db", return_value=str(self.db_path)):
            payload = {
                "question": "Who is struggling with place value?",
                "grade": 2,
                "workspace_id": "w1",
                "use_llm": False,
            }
            resp = self.client.post("/chat", json=payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["mode"], "copilot")
            self.assertEqual(data["intent"], "find_students_by_concept")
            self.assertIn("1 need support", data["answer"])
            self.assertIsInstance(data["limitations"], list)

    def test_chat_endpoint_plain_rag_backward_compatibility(self):
        # Plain request without workspace_id passes through original RAG path
        with patch("src.rag_api._get_runtime") as mock_rt:
            from types import SimpleNamespace
            chunk = SimpleNamespace(
                chunk_id=1, text="Fraction chunk", grade=4, subject="Math",
                source_pdf="math4.pdf", chunk_index=0, score=0.88, used_fallback=False
            )
            mock_backend = SimpleNamespace(
                DEFAULT_MODEL="test-model",
                answer_question=lambda *args, **kwargs: ("Plain RAG answer", [chunk]),
            )
            mock_rt.return_value = (mock_backend, "mock_retriever")

            payload = {
                "question": "What is a fraction?",
                "grade": 4,
                "use_llm": False,
            }
            resp = self.client.post("/chat", json=payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["mode"], "generated")
            self.assertEqual(data["answer"], "Plain RAG answer")


if __name__ == "__main__":
    unittest.main()
