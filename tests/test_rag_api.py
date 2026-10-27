import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from src import rag_api


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(rag_api.app)

    def test_health_without_loading_models(self):
        with patch.object(rag_api, "_get_runtime", side_effect=AssertionError("must stay lazy")):
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_validation(self):
        for request in ({"question": "  ", "grade": 4}, {"question": "Fractions", "grade": 9},
                        {"question": "Fractions", "grade": 4, "subject": "English"},
                        {"question": "Fractions", "grade": 4, "stream": True}):
            self.assertEqual(self.client.post("/chat", json=request).status_code, 422)

    def test_verified_function_mapping(self):
        chunk = SimpleNamespace(chunk_id=1, text="A passage", grade=4, subject="Math",
                                source_pdf="example.pdf", chunk_index=2, score=0.8, used_fallback=False)
        calls = []
        def answer(*args, **kwargs):
            calls.append((args, kwargs))
            return "Backend answer", [chunk]
        backend = SimpleNamespace(DEFAULT_MODEL="test-model", answer_question=answer)
        with patch.object(rag_api, "_get_runtime", return_value=(backend, "retriever")):
            response = self.client.post("/chat", json={"question": "Fractions", "grade": 4, "use_llm": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "Backend answer")
        self.assertFalse(calls[0][1]["stream"])
        self.assertFalse(calls[0][1]["use_llm"])
        self.assertNotIn("concept_ids", response.json()["chunks"][0])

    def test_runtime_errors_are_redacted(self):
        with patch.object(rag_api, "_get_runtime", side_effect=RuntimeError("private-secret")):
            response = self.client.post("/chat", json={"question": "Fractions", "grade": 4})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-secret", response.text)
        backend = SimpleNamespace(DEFAULT_MODEL="test", answer_question=lambda *a, **kw: ("[generation failed: private-secret]", []))
        with patch.object(rag_api, "_get_runtime", return_value=(backend, None)):
            response = self.client.post("/chat", json={"question": "Fractions", "grade": 4})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-secret", response.text)

    def test_generation_failure_returns_labelled_sources(self):
        chunk = SimpleNamespace(chunk_id=1, text="Two equal parts make a whole.", grade=4, subject="Math",
                                source_pdf="fractions.pdf", chunk_index=0, score=0.8, used_fallback=False)
        backend = SimpleNamespace(DEFAULT_MODEL="test", answer_question=lambda *a, **kw: ("[generation failed: private-secret]", [chunk]))
        with patch.object(rag_api, "_get_runtime", return_value=(backend, None)):
            response = self.client.post("/chat", json={"question": "Fractions", "grade": 4})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "retrieval-only")
        self.assertIn("Two equal parts", response.json()["answer"])
        self.assertIn("rather than an AI explanation", response.json()["answer"])
        self.assertNotIn("private-secret", response.text)
        with patch.dict(os.environ, {"CALCMATE_RAG_ALLOW_RETRIEVAL_FALLBACK": "false"}), patch.object(rag_api, "_get_runtime", return_value=(backend, None)):
            self.assertEqual(self.client.post("/chat", json={"question": "Fractions", "grade": 4}).status_code, 503)

    def test_model_readiness_reports_missing_or_ready(self):
        import io
        import json
        with patch.dict(os.environ, {"CALCMATE_RAG_MODEL": "llama3.2:3b"}), patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps({"models": [{"name": "llama3.2:3b"}]}).encode())):
            self.assertTrue(rag_api.generation_status()[0])
        with patch("urllib.request.urlopen", side_effect=OSError("not running")):
            status = rag_api.generation_status()
        self.assertFalse(status[0])
        self.assertIn("ollama serve", status[2])

    def test_cors(self):
        response = self.client.options("/chat", headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:8081")

    @unittest.skipUnless(os.getenv("CALCMATE_TEST_REAL_RAG") == "1", "Set CALCMATE_TEST_REAL_RAG=1 for actual cached-model retrieval")
    def test_actual_backend_retrieval(self):
        copilot, retriever = rag_api._get_runtime()
        # Exercise unchanged backend code while keeping research logs untouched.
        with tempfile.TemporaryDirectory() as directory, patch.object(retriever, "log_path", Path(directory) / "retrieval.jsonl"), patch.object(copilot, "COPILOT_LOG_PATH", Path(directory) / "copilot.jsonl"):
            response = self.client.post("/chat", json={"question": "What are equivalent fractions?", "grade": 4, "use_llm": False})
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()["chunks"]), 0)
        self.assertIn("retrieval only", response.json()["answer"])

    @unittest.skipUnless(os.getenv("CALCMATE_TEST_LLM") == "1", "Set CALCMATE_TEST_LLM=1 with a running Ollama model")
    def test_actual_backend_generation(self):
        copilot, retriever = rag_api._get_runtime()
        with tempfile.TemporaryDirectory() as directory, patch.object(retriever, "log_path", Path(directory) / "retrieval.jsonl"), patch.object(copilot, "COPILOT_LOG_PATH", Path(directory) / "copilot.jsonl"):
            response = self.client.post("/chat", json={"question": "What are equivalent fractions?", "grade": 4})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["answer"])
        self.assertNotIn("retrieval only", response.json()["answer"])
        self.assertIn("[Grounded in:", response.json()["answer"])
        self.assertGreater(len(response.json()["chunks"]), 0)


if __name__ == "__main__":
    unittest.main()
