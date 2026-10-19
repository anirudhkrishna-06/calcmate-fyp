"""Browser approval inbox for the local school administrator."""
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, ConfigDict

from src.auth_api import connection, limit, transport, password_hash

router = APIRouter(prefix="/admin", tags=["administrator"])


def admin_code():
    return os.getenv("CALCMATE_ADMIN_PASSWORD") or "admin123"


@asynccontextmanager
async def admin_lifespan(app):
    logger = logging.getLogger("uvicorn.error")
    logger.info("Teacher approval inbox: /admin (open on this API server)")
    if not os.getenv("CALCMATE_ADMIN_PASSWORD"):
        logger.info("Local administrator password: admin123")
    yield


def authorize(request: Request, authorization: str | None):
    transport(request)
    supplied = (authorization or "").removeprefix("Bearer ")
    if not authorization or not authorization.startswith("Bearer ") or not hmac.compare_digest(supplied.encode(), admin_code().encode()):
        # Failed admin authentication shares the persistent IP attempt limiter.
        limit(request)
        raise HTTPException(401, "Administrator password is incorrect.")


@router.get("", response_class=HTMLResponse, include_in_schema=False)
def dashboard():
    return HTMLResponse((Path(__file__).with_name("admin.html")).read_text(encoding="utf-8"),
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"})


@router.get("/requests")
def requests(request: Request, authorization: str | None = Header(default=None), status: str = "pending"):
    import json
    authorize(request, authorization)
    filters={"pending":"a.approved=0 AND a.disabled=0", "approved":"a.approved=1 AND a.disabled=0", "rejected":"a.disabled=1", "all":"1=1"}
    if status not in filters:
        raise HTTPException(400,"Choose pending, approved, rejected or all.")
    with connection() as db:
        rows = db.execute(f"SELECT a.id,a.email,a.profile,a.approved,a.disabled,t.created,d.reviewed FROM accounts a LEFT JOIN account_signup_times t ON t.account_id=a.id LEFT JOIN account_decisions d ON d.account_id=a.id WHERE {filters[status]} ORDER BY COALESCE(d.reviewed,t.created) DESC,a.rowid DESC").fetchall()
    return {"requests": [{"id": row["id"], "email": row["email"], "profile": json.loads(row["profile"]), "createdAt": row["created"], "reviewedAt":row["reviewed"], "status":"rejected" if row["disabled"] else "approved" if row["approved"] else "pending"} for row in rows]}


class BulkApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accountIds: list[str] = Field(min_length=1, max_length=100)


@router.post("/approve-selected")
def approve_selected(body: BulkApproval, request: Request, authorization: str | None = Header(default=None)):
    authorize(request, authorization)
    ids = sorted(set(body.accountIds))
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        for account_id in ids:
            row = db.execute("SELECT approved,disabled FROM accounts WHERE id=?", (account_id,)).fetchone()
            if not row or row["approved"] or row["disabled"]:
                raise HTTPException(409, "A selected request was already reviewed. Refresh the inbox.")
        for account_id in ids:
            db.execute("UPDATE accounts SET approved=1 WHERE id=?", (account_id,))
            db.execute("INSERT INTO account_decisions VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET reviewed=excluded.reviewed",(account_id,time.time()))
    return {"status": "approved", "count": len(ids)}


@router.get("/demo-status")
def demo_status(request: Request, authorization: str | None = Header(default=None)):
    """Return whether the demo workspace has been seeded and basic counts."""
    import json, os, sqlite3
    authorize(request, authorization)
    db_path = os.getenv("CALCMATE_AUTH_DB", str(Path(__file__).resolve().parent.parent / "data" / "auth.sqlite3"))
    # Demo data lives in the SQLite file produced by the frontend (device-side).
    # The admin endpoint just tells the UI whether a demo account exists so the
    # presenter can approve it without a real sign-up flow.
    with connection() as db:
        demo = db.execute(
            "SELECT id, approved, disabled FROM accounts WHERE email=?", ("demo@vidyaprimary.school",)
        ).fetchone()
    return {
        "demo_account_exists": bool(demo),
        "demo_approved": bool(demo and demo["approved"] and not demo["disabled"]),
        "demo_email": "demo@vidyaprimary.school",
        "demo_password": "DemoCalc2026",
        "instructions": (
            "Sign in to the CalcMate app using the credentials above. "
            "The app seeds mid-year student data automatically on first launch in demo mode. "
            "Use 'Approve demo account' below to grant classroom access without a review queue."
        )
    }


@router.post("/seed-demo")
def seed_demo(request: Request, authorization: str | None = Header(default=None)):
    """Create (or re-approve) the demo teacher account so the app can log in immediately."""
    import json, hashlib, secrets, time
    from src.auth_api import password_hash as make_hash
    authorize(request, authorization)

    demo_email = "demo@vidyaprimary.school"
    demo_password = "DemoCalc2026"
    demo_name = "Ananya Rao"
    demo_school = "Vidya Primary School"

    hashed = make_hash(demo_password)
    import uuid
    account_id = "demo-teacher-v1"
    profile = json.dumps({
        "id": account_id,
        "name": demo_name,
        "schoolName": demo_school,
        "experience": 6,
        "grades": [1, 2, 3, 4, 5],
        "preferredSubject": "Math"
    })

    now = time.time()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT id, approved FROM accounts WHERE email=?", (demo_email,)).fetchone()
        if existing:
            # Re-enable and approve if it was disabled/rejected
            db.execute(
                "UPDATE accounts SET approved=1, disabled=0, password_hash=? WHERE email=?",
                (hashed, demo_email)
            )
            acct_id = existing["id"]
        else:
            db.execute(
                "INSERT INTO accounts(id,email,password_hash,profile,approved,disabled) VALUES(?,?,?,?,1,0)",
                (account_id, demo_email, hashed, profile)
            )
            db.execute("INSERT OR IGNORE INTO account_signup_times VALUES(?,?)", (account_id, now))
            acct_id = account_id
        db.execute(
            "INSERT INTO account_decisions VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET reviewed=excluded.reviewed",
            (acct_id, now)
        )

    return {
        "status": "ready",
        "email": demo_email,
        "password": demo_password,
        "message": (
            "Demo account approved. Open the CalcMate app, log in with the credentials above, "
            "and the mid-year classroom (Grades 1-5, July onwards) will seed automatically."
        )
    }


@router.post("/requests/{account_id}/{action}")
def decide(account_id: str, action: str, request: Request, authorization: str | None = Header(default=None)):
    authorize(request, authorization)
    if action not in {"approve", "reject"}:
        raise HTTPException(400, "Choose approve or reject.")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT approved,disabled FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Request no longer exists.")
        if row["approved"] or row["disabled"]:
            raise HTTPException(409, "This request has already been reviewed.")
        if action == "approve":
            db.execute("UPDATE accounts SET approved=1 WHERE id=?", (account_id,))
        else:
            db.execute("UPDATE accounts SET disabled=1 WHERE id=?", (account_id,))
        db.execute("INSERT INTO account_decisions VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET reviewed=excluded.reviewed",(account_id,time.time()))
    return {"status": "approved" if action == "approve" else "rejected"}
