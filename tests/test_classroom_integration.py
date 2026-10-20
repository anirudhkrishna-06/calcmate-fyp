"""Real session authorization and observed-evidence reasoning, with isolated data."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from src.api import app
from src.auth_api import connection
from src.classroom_contracts import ClassroomEvidence, curriculum_version, estimate, AssessmentEvidence
from src.allocation_engine import Selection, build_schedule


class ClassroomIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"CALCMATE_AUTH_DB": str(Path(self.tmp.name) / "auth.db"), "CALCMATE_ALLOW_INSECURE_AUTH": "true"})
        self.env.start()
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer classroom-test-token"}
        with connection() as db:
            db.execute("INSERT INTO accounts VALUES(?,?,?,?,1,0)", ("a", "a@example.com", "test-only", json.dumps({"id": "a"})))
            db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (hashlib.sha256(b"classroom-test-token").hexdigest(), "a", 4000000000, 1700000000))
        self.evidence = {"version": 1, "workspace_id": "teacher-a", "captured_at": "2026-10-18T09:00:00Z", "as_of": "2026-10-18", "curriculum_version": curriculum_version(), "estimator_version": "score-ratio-v1:1", "students": [{"id": "s1", "name": "Learner A", "grade": 2}, {"id": "s2", "name": "Learner B", "grade": 2}], "assessments": [], "attendance": []}
        self.add_score("s1", "M202", .2)
        self.add_score("s2", "M202", .9)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.tmp.cleanup()

    def add_score(self, student, concept, score):
        self.evidence["assessments"].append({"id": f"a-{len(self.evidence['assessments'])}", "student_id": student, "concept_id": concept, "date": "2026-10-18", "score": score, "maximum": 1, "created_at": "2026-10-18T08:00:00Z", "updated_at": "2026-10-18T08:00:00Z"})

    def payload(self):
        return {"workspace_id": "teacher-a", "classroom_evidence": self.evidence, "student_id": "s1"}

    def test_classroom_access_requires_real_approved_session(self):
        self.assertEqual(self.client.post("/learner/student-view", json=self.payload()).status_code, 401)
        self.assertEqual(self.client.post("/learner/student-view", json=self.payload(), headers=self.headers).status_code, 200)
        with connection() as db:
            db.execute("UPDATE accounts SET approved=0")
        self.assertEqual(self.client.post("/learner/student-view", json=self.payload(), headers=self.headers).status_code, 401)

    def test_workspace_and_server_paths_are_rejected(self):
        bad = self.payload()
        bad["workspace_id"] = "teacher-b"
        self.assertEqual(self.client.post("/learner/student-view", json=bad, headers=self.headers).status_code, 403)
        bad = self.payload()
        bad["db_path"] = "private.db"
        with patch("src.learner_intelligence._connect") as open_db:
            # Pydantic rejects the forbidden public path before endpoint lookup.
            response = self.client.post("/learner/student-view", json=bad, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("private.db", str(open_db.call_args_list))

    def test_snapshot_rejects_foreign_students_invalid_scores_and_versions(self):
        for mutate in (lambda e: e["assessments"][0].update(student_id="other"), lambda e: e["assessments"][0].update(score=2), lambda e: e.update(curriculum_version="old"), lambda e: e["assessments"][0].update(date="2026-10-19")):
            evidence = copy.deepcopy(self.evidence)
            mutate(evidence)
            payload = self.payload()
            payload["classroom_evidence"] = evidence
            self.assertEqual(self.client.post("/learner/student-view", json=payload, headers=self.headers).status_code, 422)

    def test_assistant_uses_supplied_records_and_names(self):
        response = self.client.post("/chat", headers=self.headers, json={"question": "Who needs support with place value?", "grade": 2, "use_llm": False, "workspace_id": "teacher-a", "classroom_evidence": self.evidence})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("Learner A", response.json()["answer"])
        self.assertIn("1 need support", response.json()["answer"])
        self.assertTrue(response.json()["evidence_revision"])

    def test_estimator_and_unknown_zero_distinction(self):
        self.evidence["assessments"] = []
        self.add_score("s1", "M202", .1)
        self.evidence["assessments"][0]["date"] = "2026-10-17"
        self.add_score("s1", "M202", .9)
        evidence = ClassroomEvidence(**self.evidence)
        self.assertAlmostEqual(estimate(evidence.assessments)["mastery_estimate"], .5571428571428572)
        self.assertIsNone(estimate([])["mastery_estimate"])
        self.evidence["assessments"][0]["score"] = 0
        self.assertEqual(estimate(ClassroomEvidence(**self.evidence).assessments[:1])["mastery_estimate"], 0)

    def test_allocation_timing_grade_five_and_evidence_revision(self):
        evidence = ClassroomEvidence(**self.evidence)
        for grades in ([1], [1, 2], [1, 2, 3, 4, 5]):
            for minutes in (5, 10, 30, 90, 480):
                draft = build_schedule(Selection(date="2026-10-18", grades=grades, availableMinutes=minutes, priority="learning-needs"), evidence)
                self.assertEqual(sum(b["durationMinutes"] for b in draft["blocks"]), minutes)
                self.assertTrue(all(b["durationMinutes"] > 0 and len(b["activities"]) == len(grades) for b in draft["blocks"]))
        self.add_score("s1", "M202", .8)
        self.assertNotEqual(evidence.revision, ClassroomEvidence(**self.evidence).revision)

    def test_classroom_facts_are_not_rewritten_by_an_llm(self):
        with patch('src.response_composer.compose_with_llm',side_effect=AssertionError('Classroom facts must remain deterministic')) as compose:
            response=self.client.post('/chat',headers=self.headers,json={'question':'Who needs support with place value?','grade':2,'use_llm':True,'workspace_id':'teacher-a','classroom_evidence':self.evidence})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('Learner A',response.json()['answer'])
        compose.assert_not_called()

    def test_shared_estimator_fixtures(self):
        cases=json.loads((Path(__file__).parent/'learner_estimator_cases.json').read_text())
        for case in cases:
            rows=[AssessmentEvidence(**row,student_id='s1',concept_id='M202') for row in case['assessments']]
            actual=estimate(rows)
            if case['expected'] is None:
                self.assertIsNone(actual['mastery_estimate'])
            else:
                self.assertAlmostEqual(actual['mastery_estimate'],case['expected'])
            self.assertEqual(actual['state_status'],case['status'])

    @unittest.skipUnless(os.getenv('CALCMATE_TEST_REAL_RAG')=='1','Enable actual cached-model retrieval')
    def test_foundational_resource_coverage_and_grade_filtering(self):
        from src.retrieve import get_default_retriever
        from src.resource_coverage import coverage
        retriever=get_default_retriever()
        for grade,question in [(1,'Group long and round classroom objects by shape'),(2,'Trace flat shapes and identify corners')]:
            chunks=retriever.retrieve(question,grade=grade,subject='Math',k=2,log_call=False)
            self.assertTrue(chunks)
            self.assertTrue(all(c.grade==grade and not c.used_fallback for c in chunks))
            self.assertTrue(all(c.resource_kind in {'source_summary','textbook_excerpt'} and c.source_url.startswith('https://ncert.nic.in/') for c in chunks))
        self.assertTrue(all(coverage()[str(g)]['chunks']>0 for g in range(1,6)))

    @unittest.skipUnless(os.getenv('CALCMATE_TEST_REAL_RAG')=='1','Enable actual cached-model retrieval')
    def test_curriculum_retrieval_is_restricted_to_requested_concept(self):
        from src.copilot_operations import _retrieve_for_concept
        from src.retrieve import get_default_retriever
        for cid, grade in [('M408', 4), ('M403', 4)]:
            with self.subTest(concept=cid):
                chunks = _retrieve_for_concept(cid, grade)
                self.assertTrue(chunks)
                self.assertTrue(all(c['grade'] == grade and cid in c['concept_ids'] for c in chunks))
        # The Grade 1 length tag currently points at a weak shape summary;
        # do not display it as supporting evidence for length comparisons.
        self.assertEqual(_retrieve_for_concept('M107', 1), [])
        # An empty concept filter cannot silently return unrelated material.
        self.assertEqual(get_default_retriever().retrieve('division', grade=4, subject='Math', concept_ids=['M999'], log_call=False), [])
        for kwargs in ({'grade': 4}, {'subject': 'Math'}, {}):
            chunks = get_default_retriever().retrieve('equivalent fractions', concept_ids=['M408'], log_call=False, **kwargs)
            self.assertTrue(chunks)
            self.assertTrue(all('M408' in c.concept_ids for c in chunks))
        response = self.client.post('/chat', headers=self.headers, json=dict(question='Explain M408.', grade=4, use_llm=False, workspace_id='teacher-a', classroom_evidence=self.evidence))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['chunks'])
        self.assertTrue(all(c['grade'] == 4 and c['source_pdf'] == 'demm105.pdf' for c in response.json()['chunks']))

    def test_planner_authorization_and_determinism(self):
        payload = {"selection": {"date": "2026-10-18", "grades": [2], "availableMinutes": 45, "priority": "learning-needs"}, "classroom_evidence": self.evidence}
        self.assertEqual(self.client.post("/planning/general", json=payload).status_code, 401)
        first = self.client.post("/planning/general", json=payload, headers=self.headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), self.client.post("/planning/general", json=payload, headers=self.headers).json())


if __name__ == "__main__":
    unittest.main()
