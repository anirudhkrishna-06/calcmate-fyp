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

from src.auth_api import connection, limit, transport

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
