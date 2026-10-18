"""Adapt legacy SQL business fixtures to the authenticated snapshot API in tests.

Authentication itself is exercised with real sessions in test_classroom_integration.
"""
import datetime
import sqlite3
from unittest.mock import patch
from fastapi.testclient import TestClient
from src.auth_api import require_teacher
from src.classroom_contracts import curriculum_version


class AuthenticatedEvidenceClient(TestClient):
    def __init__(self, app, database):
        super().__init__(app, base_url="https://testserver")
        self.database = database
        self.previous_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[require_teacher] = lambda: {"workspace_id": "w1", "teacher_id": "t1"}
        self.classroom_auth_patch = patch("src.rag_api.require_teacher", return_value={"workspace_id": "w1", "teacher_id": "t1"})
        self.classroom_auth_patch.start()

    def close(self):
        self.classroom_auth_patch.stop()
        self.app.dependency_overrides = self.previous_overrides
        super().close()

    def post(self, url, **kwargs):
        payload = kwargs.get("json", {})
        if url.startswith("/learner") or payload.get("workspace_id") or payload.get("student_id"):
            with sqlite3.connect(self.database) as conn:
                conn.row_factory = sqlite3.Row
                students = [dict(s) for s in conn.execute("SELECT id,name,grade FROM students WHERE workspace_id='w1'")]
                states = list(conn.execute("SELECT * FROM learner_concept_states WHERE workspace_id='w1'"))
            now = "2026-10-15T10:00:00.000Z"
            assessments = [{"id": f"fixture-{i}-{j}", "student_id": s["student_id"], "concept_id": s["concept_id"], "date": "2026-10-15", "score": s["mastery_estimate"], "maximum": 1, "created_at": now, "updated_at": now} for i, s in enumerate(states) if s["mastery_estimate"] is not None for j in range(s["evidence_count"])]
            payload = {k: v for k, v in payload.items() if k not in {"db_path", "student_states"}}
            payload["workspace_id"] = "w1"
            payload["classroom_evidence"] = {"version": 1, "workspace_id": "w1", "captured_at": now, "as_of": datetime.date.today().isoformat(), "curriculum_version": curriculum_version(), "estimator_version": "score-ratio-v1:1", "students": students, "assessments": assessments, "attendance": []}
            if url.startswith("/learner"):
                payload.setdefault("student_id", "s1")
            kwargs["json"] = payload
        return super().post(url, **kwargs)
