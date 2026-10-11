import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch
from fastapi.testclient import TestClient
from src.api import app
from src.auth_api import administrator


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "accounts.db"
        self.env = patch.dict(os.environ, {"CALCMATE_AUTH_DB": str(self.path), "CALCMATE_ALLOW_INSECURE_AUTH": "1"})
        self.env.start()
        self.client = TestClient(app)
        self.credentials = {"email": "teacher@example.com", "password": "a-long-test-password-123"}
        self.signup = {**self.credentials, "name": "Teacher", "schoolName": "School", "experience": 3, "grades": [1, 3]}

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.directory.cleanup()

    def create(self):
        self.assertEqual(self.client.post("/auth/signup", json=self.signup).status_code, 202)

    def approved_session(self):
        self.create()
        administrator("approve", self.credentials["email"])
        response = self.client.post("/auth/login", json=self.credentials)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_signup_approval_login_logout_and_stable_identity(self):
        self.create()
        self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 403)
        self.assertEqual(self.client.post("/auth/signup", json=self.signup).status_code, 202)
        administrator("approve", self.credentials["email"])
        result = self.client.post("/auth/login", json=self.credentials).json()
        self.assertTrue(result["approved"])
        headers = {"Authorization": "Bearer " + result["token"]}
        current = self.client.get("/auth/me", headers=headers)
        self.assertEqual(current.status_code, 200)
        self.assertNotIn("token", current.json())
        self.assertEqual(self.client.post("/auth/logout", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
        second = self.client.post("/auth/login", json=self.credentials).json()
        self.assertEqual(second["workspaceId"], result["workspaceId"])
        self.assertNotEqual(second["token"], result["token"])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 1)
            account_hash = db.execute("SELECT password_hash FROM accounts").fetchone()[0]
            self.assertNotIn(self.credentials["password"], account_hash)
            self.assertNotIn(second["token"], json.dumps(db.execute("SELECT * FROM sessions").fetchall()))

    def test_wrong_password_disabled_and_expired_sessions(self):
        result = self.approved_session()
        self.assertEqual(self.client.post("/auth/login", json={**self.credentials, "password": "another-long-password"}).status_code, 401)
        headers = {"Authorization": "Bearer " + result["token"]}
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("UPDATE sessions SET expires=0")
            db.commit()
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
        administrator("disable", self.credentials["email"])
        self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 403)

    def test_transport_validation_and_no_password_echo(self):
        with patch.dict(os.environ, {"CALCMATE_ALLOW_INSECURE_AUTH": "0"}):
            self.assertFalse(self.client.get("/auth/config").json()["available"])
            self.assertEqual(self.client.post("/auth/signup", json=self.signup).status_code, 503)
        for body in ({**self.signup, "grades": []}, {**self.signup, "password": "short-secret"}, {**self.signup, "approved": True}):
            response = self.client.post("/auth/signup", json=body)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(body["password"], response.text)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)

    def test_true_opt_in_and_authenticated_cors_preflight(self):
        with patch.dict(os.environ, {"CALCMATE_ALLOW_INSECURE_AUTH": "true"}):
            self.assertTrue(self.client.get("/auth/config").json()["available"])
            self.create()
            pending = self.client.post("/auth/login", json=self.credentials)
            self.assertEqual(pending.status_code, 403)
            self.assertEqual(pending.json()["detail"]["code"], "pending-approval")
        response = self.client.options("/auth/me", headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:8081")
        self.assertIn("authorization", response.headers["access-control-allow-headers"].lower())

    def test_persistent_rate_limit(self):
        # Use validation-free known credentials, but avoid unnecessary hashes in this test.
        with patch("src.auth_api.password_hash", return_value="0" * 32 + ":fake"):
            for _ in range(10):
                self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 401)
            self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 429)


if __name__ == "__main__":
    unittest.main()
