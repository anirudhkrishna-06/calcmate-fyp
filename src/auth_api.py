"""Local-development authentication with explicit operator approval; no RAG changes."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

router = APIRouter(prefix="/auth", tags=["accounts"])
_hash_lock = Lock()


@contextmanager
def connection():
    path = Path(os.getenv("CALCMATE_AUTH_DB", str(Path(__file__).resolve().parent.parent / "data" / "auth.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS accounts(
          id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
          profile TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
          expires REAL NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(ip TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(ip,created);
        CREATE TABLE IF NOT EXISTS approval_receipts(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS account_signup_times(account_id TEXT PRIMARY KEY REFERENCES accounts(id),created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS account_decisions(account_id TEXT PRIMARY KEY REFERENCES accounts(id),reviewed REAL NOT NULL);
        """)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def password_hash(password: str, salt: bytes | None = None):
    salt = salt or secrets.token_bytes(16)
    # OWASP's scrypt minimum: N=2^17, r=8, p=1. Serialize memory-intensive hashes.
    with _hash_lock:
        digest = hashlib.scrypt(password.encode(), salt=salt, n=131072, r=8, p=1, maxmem=256 * 1024 * 1024)
    return salt.hex() + ":" + digest.hex()


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=254)
    password: SecretStr

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Invalid email")
        return value

    @field_validator("password")
    @classmethod
    def password_valid(cls, value):
        if not 8 <= len(value.get_secret_value()) <= 128:
            raise ValueError("Use 8 to 128 password characters")
        return value


class Signup(Credentials):
    @field_validator("password")
    @classmethod
    def password_complexity(cls,value):
        password=value.get_secret_value()
        if not re.search(r"[A-Za-z]",password) or not re.search(r"[0-9]",password):
            raise ValueError("Include letters and numbers")
        return value

    name: str = Field(min_length=1, max_length=100)
    schoolName: str = Field(min_length=1, max_length=150)
    experience: int = Field(ge=0, le=60)
    grades: list[Literal[1, 2, 3, 4, 5]] = Field(min_length=1, max_length=5)

    @field_validator("name", "schoolName")
    @classmethod
    def text_valid(cls, value):
        if not value.strip():
            raise ValueError("Required field")
        return value.strip()


class SessionResponse(BaseModel):
    workspaceId: str
    teacherId: str
    mode: Literal["real"] = "real"
    approved: Literal[True] = True
    createdAt: str
    validUntil: str
    token: str | None = None
    profile: dict
    presentationRoster: bool = True


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def insecure_auth_allowed():
    return os.getenv("CALCMATE_ALLOW_INSECURE_AUTH", "").strip().lower() in {"1", "true", "yes", "on"}


def transport(request: Request):
    if request.url.scheme != "https" and not insecure_auth_allowed():
        raise HTTPException(503, "Account service requires HTTPS. Trusted local development needs explicit insecure-auth opt-in.")


def limit(request: Request):
    transport(request)
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    # BEGIN IMMEDIATE ensures concurrent requests cannot race the rate-limit counter.
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM attempts WHERE created<?", (now - 900,))
        if db.execute("SELECT COUNT(*) FROM attempts WHERE ip=?", (ip,)).fetchone()[0] >= 10:
            raise HTTPException(429, "Too many account attempts. Try again in 15 minutes.")
        db.execute("INSERT INTO attempts VALUES(?,?)", (ip, now))


@router.get("/config")
def config(request: Request):
    available = request.url.scheme == "https" or insecure_auth_allowed()
    return {"available": available, "approvalRequired": True, "offlineSessionHours": 24}


@router.post("/signup", status_code=202)
def signup(body: Signup, request: Request):
    limit(request)
    hashed = password_hash(body.password.get_secret_value())
    account_id = str(uuid.uuid4())
    profile = {"id": account_id, "name": body.name, "schoolName": body.schoolName,
               "experience": body.experience, "grades": sorted(set(body.grades)), "preferredSubject": "Math"}
    with connection() as db:
        # Generic response avoids disclosing whether an email already has an account.
        inserted = db.execute("INSERT OR IGNORE INTO accounts(id,email,password_hash,profile) VALUES(?,?,?,?)",
                   (account_id, body.email, hashed, json.dumps(profile)))
        receipt = secrets.token_urlsafe(32)
        if inserted.rowcount:
            db.execute("INSERT INTO account_signup_times VALUES(?,?)", (account_id, time.time()))
            db.execute("DELETE FROM approval_receipts WHERE expires<=?", (time.time(),))
            db.execute("INSERT INTO approval_receipts VALUES(?,?,?)", (hashlib.sha256(receipt.encode()).hexdigest(), account_id, time.time()+604800))
    return {"status": "pending-approval", "approvalToken": receipt}


@router.get("/approval")
def approval(request: Request, authorization: str | None = Header(default=None)):
    transport(request)
    if not authorization or not authorization.startswith("Bearer ") or len(authorization)>512:
        raise HTTPException(401, "Log in to check this request.")
    with connection() as db:
        row = db.execute("SELECT a.approved,a.disabled FROM approval_receipts r JOIN accounts a ON a.id=r.account_id WHERE r.token_hash=? AND r.expires>?", (hashlib.sha256(authorization[7:].encode()).hexdigest(),time.time())).fetchone()
    if not row:
        raise HTTPException(401, "Approval tracking expired. Log in to check your request.")
    return {"status": "rejected" if row["disabled"] else "approved" if row["approved"] else "pending"}


@router.post("/login", response_model=SessionResponse)
def login(body: Credentials, request: Request):
    limit(request)
    with connection() as db:
        account = db.execute("SELECT * FROM accounts WHERE email=?", (body.email,)).fetchone()
        salt = bytes.fromhex(account["password_hash"].split(":")[0]) if account else bytes(16)
        candidate = password_hash(body.password.get_secret_value(), salt)
        if not account or not hmac.compare_digest(candidate, account["password_hash"]):
            raise HTTPException(401, "Email or password is incorrect.")
        if account["disabled"]:
            raise HTTPException(403, "Account access is disabled. Contact your administrator.")
        if not account["approved"]:
            raise HTTPException(403, {"code": "pending-approval", "message": "Awaiting administrator approval. Your classroom is not unlocked yet."})
        now = time.time()
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
        db.execute("INSERT INTO sessions VALUES(?,?,?,?)",
                   (hashlib.sha256(token.encode()).hexdigest(), account["id"], now + 86400, now))
        return SessionResponse(workspaceId="teacher-" + account["id"], teacherId=account["id"],
                               createdAt=iso(now), validUntil=iso(now + 86400), token=token,
                               profile=json.loads(account["profile"]),
                               presentationRoster=os.getenv("CALCMATE_PRESENTATION_ROSTER", "true").lower() in {"true", "1", "yes", "on"})


def authorized(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 512:
        raise HTTPException(401, "Log in again.")
    hashed = hashlib.sha256(authorization[7:].encode()).hexdigest()
    with connection() as db:
        row = db.execute("SELECT s.*,a.approved,a.disabled,a.profile FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE token_hash=?", (hashed,)).fetchone()
        if not row or row["expires"] <= time.time() or not row["approved"] or row["disabled"]:
            raise HTTPException(401, "Your session is no longer valid. Log in again.")
        return dict(row)


def require_teacher(request: Request, authorization: str | None = Header(default=None)):
    """The server session, never a request body, owns classroom access."""
    transport(request)
    row = authorized(authorization)
    return {"teacher_id": row["account_id"], "workspace_id": "teacher-" + row["account_id"]}


@router.get("/me", response_model=SessionResponse, response_model_exclude_none=True)
def me(request: Request, authorization: str | None = Header(default=None)):
    transport(request)
    row = authorized(authorization)
    return SessionResponse(workspaceId="teacher-" + row["account_id"], teacherId=row["account_id"],
                           createdAt=iso(row["created"]), validUntil=iso(row["expires"]), profile=json.loads(row["profile"]),
                           presentationRoster=os.getenv("CALCMATE_PRESENTATION_ROSTER", "true").lower() in {"true", "1", "yes", "on"})


@router.post("/logout")
def logout(request: Request, authorization: str | None = Header(default=None)):
    transport(request)
    if authorization and authorization.startswith("Bearer ") and len(authorization) <= 512:
        with connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(authorization[7:].encode()).hexdigest(),))
    return {"status": "signed-out"}


def administrator(action: str, email: str):
    with connection() as db:
        account = db.execute("SELECT id FROM accounts WHERE email=?", (email.strip().lower(),)).fetchone()
        if not account:
            raise SystemExit("Account not found.")
        if action == "approve":
            db.execute("UPDATE accounts SET approved=1,disabled=0 WHERE id=?", (account["id"],))
        elif action == "disable":
            db.execute("UPDATE accounts SET disabled=1 WHERE id=?", (account["id"],))
            db.execute("DELETE FROM sessions WHERE account_id=?", (account["id"],))
        else:
            raise SystemExit("Use approve or disable.")
        db.execute("INSERT INTO account_decisions VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET reviewed=excluded.reviewed",(account["id"],time.time()))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python -m src.auth_api approve|disable teacher@example.com")
    administrator(sys.argv[1], sys.argv[2])
    print("Account status updated.")
