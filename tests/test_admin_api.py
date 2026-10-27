import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from src.api import app


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "CALCMATE_AUTH_DB": str(Path(self.directory.name) / "accounts.db"),
            "CALCMATE_ALLOW_INSECURE_AUTH": "true", "CALCMATE_ADMIN_PASSWORD": "test-admin-access",
        })
        self.env.start()
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-admin-access"}
        self.credentials = {"email": "new-teacher@example.com", "password": "teacher-password-12345"}
        self.receipt = self.client.post("/auth/signup", json={**self.credentials, "name": "Ananya Rao",
                                              "schoolName": "Vidya School", "grades": [1, 4], "experience": 4}).json()['approvalToken']

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.directory.cleanup()

    def test_inbox_approval_unlocks_login(self):
        self.assertEqual(self.client.get("/admin").status_code, 200)
        self.assertEqual(self.client.get("/admin/requests").status_code, 401)
        inbox = self.client.get("/admin/requests", headers=self.headers).json()["requests"]
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["profile"]["name"], "Ananya Rao")
        self.assertNotIn("password", str(inbox))
        account_id = inbox[0]["id"]
        self.assertEqual(self.client.post(f"/admin/requests/{account_id}/approve").status_code, 401)
        self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 403)
        self.assertEqual(self.client.post(f"/admin/requests/{account_id}/approve", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get("/admin/requests", headers=self.headers).json()["requests"], [])
        session = self.client.post("/auth/login", json=self.credentials)
        self.assertEqual(session.status_code, 200)
        self.assertTrue(session.json()["presentationRoster"])
        self.assertEqual(self.client.post(f"/admin/requests/{account_id}/reject", headers=self.headers).status_code, 409)

    def test_rejection_and_wrong_admin_code(self):
        self.assertEqual(self.client.get("/admin/requests", headers={"Authorization": "Bearer wrong"}).status_code, 401)
        account_id = self.client.get("/admin/requests", headers=self.headers).json()["requests"][0]["id"]
        self.assertEqual(self.client.post(f"/admin/requests/{account_id}/reject", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post("/auth/login", json=self.credentials).status_code, 403)
        self.assertEqual(self.client.get("/admin/requests", headers=self.headers).json()["requests"], [])

    def test_presentation_roster_can_be_disabled(self):
        account_id = self.client.get("/admin/requests", headers=self.headers).json()["requests"][0]["id"]
        self.client.post(f"/admin/requests/{account_id}/approve", headers=self.headers)
        with patch.dict(os.environ, {"CALCMATE_PRESENTATION_ROSTER": "false"}):
            self.assertFalse(self.client.post("/auth/login", json=self.credentials).json()["presentationRoster"])

    def test_tracking_receipt_cannot_unlock_classroom(self):
        headers={'Authorization':'Bearer '+self.receipt}
        self.assertEqual(self.client.get('/auth/approval',headers=headers).json()['status'],'pending')
        self.assertEqual(self.client.get('/auth/me',headers=headers).status_code,401)
        self.assertEqual(self.client.get('/auth/approval').status_code,401)
        self.assertEqual(self.client.get('/auth/approval',headers={'Authorization':'Bearer wrong'}).status_code,401)
        account_id=self.client.get('/admin/requests',headers=self.headers).json()['requests'][0]['id']
        self.client.post(f'/admin/requests/{account_id}/approve',headers=self.headers)
        self.assertEqual(self.client.get('/auth/approval',headers=headers).json()['status'],'approved')

    def test_bulk_approval_atomic_and_protected(self):
        account_id=self.client.get('/admin/requests',headers=self.headers).json()['requests'][0]['id']
        self.assertEqual(self.client.post('/admin/approve-selected',json={'accountIds':[account_id]}).status_code,401)
        self.assertEqual(self.client.post('/admin/approve-selected',headers=self.headers,json={'accountIds':[account_id,'missing']}).status_code,409)
        self.assertEqual(len(self.client.get('/admin/requests',headers=self.headers).json()['requests']),1)
        result=self.client.post('/admin/approve-selected',headers=self.headers,json={'accountIds':[account_id,account_id]})
        self.assertEqual(result.json()['count'],1)
        self.assertEqual(self.client.get('/admin/requests',headers=self.headers).json()['requests'],[])

    def test_duplicate_signup_does_not_expose_approval(self):
        response=self.client.post('/auth/signup',json={**self.credentials,'password':'different-password-123','name':'Other','schoolName':'Other','grades':[1],'experience':0})
        self.assertEqual(response.status_code,202)
        self.assertEqual(self.client.get('/auth/approval',headers={'Authorization':'Bearer '+response.json()['approvalToken']}).status_code,401)

    def test_default_password_and_persistent_history(self):
        with patch.dict(os.environ, {'CALCMATE_ADMIN_PASSWORD':''}):
            headers={'Authorization':'Bearer admin123'}
            row=self.client.get('/admin/requests',headers=headers).json()['requests'][0]
            self.client.post(f"/admin/requests/{row['id']}/approve",headers=headers)
            self.assertEqual(self.client.get('/admin/requests',headers=headers).json()['requests'],[])
            approved=self.client.get('/admin/requests?status=approved',headers=headers).json()['requests']
            self.assertEqual(approved[0]['status'],'approved')
            self.assertIsNotNone(approved[0]['reviewedAt'])
            with TestClient(app) as reopened:
                self.assertEqual(reopened.get('/admin/requests?status=approved',headers=headers).json()['requests'][0]['id'],row['id'])

    def test_rejected_history_and_eight_character_password(self):
        payload={**self.credentials,'email':'eight@example.com','password':'Teach123','name':'Teacher','schoolName':'School','grades':[1],'experience':1}
        self.assertEqual(self.client.post('/auth/signup',json=payload).status_code,202)
        for password in ['abc1234','abcdefgh','12345678']:
            self.assertEqual(self.client.post('/auth/signup',json={**payload,'password':password}).status_code,422)
        row=next(r for r in self.client.get('/admin/requests',headers=self.headers).json()['requests'] if r['email']=='eight@example.com')
        self.client.post(f"/admin/requests/{row['id']}/reject",headers=self.headers)
        history=self.client.get('/admin/requests?status=rejected',headers=self.headers).json()['requests']
        self.assertEqual(history[0]['id'],row['id']);self.assertIsNotNone(history[0]['reviewedAt'])
