"""Small development HTTP bridge; the existing RAG pipeline remains unchanged.

Stage 3 extension: When the request includes copilot context fields
(workspace_id, student_id, concept_id, screen_context), the /chat endpoint
routes through the Stage 3 intent-routing pipeline BEFORE the RAG pipeline.
Plain questions without copilot context fall through to the original RAG pipeline.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import json
import logging
import urllib.request
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from src.classroom_contracts import ClassroomEvidence, assert_workspace, evidence_database
from src.auth_api import require_teacher


# ─── Request / Response Models ────────────────────────────────────────────────

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    grade: Literal[1, 2, 3, 4, 5]
    subject: Literal["Math"] = "Math"
    k: int = Field(default=3, ge=1, le=10)
    use_llm: bool = True
    # Stage 3 copilot context fields (optional — backward compatible)
    workspace_id: Optional[str] = Field(default=None)
    student_id:   Optional[str] = Field(default=None)
    concept_id:   Optional[str] = Field(default=None)
    screen_context: Optional[str] = Field(default=None)
    classroom_evidence: ClassroomEvidence | None = None


class ChunkResponse(BaseModel):
    chunk_id: int
    text: str
    grade: int
    subject: str
    source_pdf: str
    source_url: str | None = None
    source_pages: str | None = None
    resource_kind: str = "textbook_passage"
    chunk_index: int
    score: float
    used_fallback: bool


class ChatResponse(BaseModel):
    answer: str
    chunks: list[ChunkResponse]
    mode: Literal["generated", "retrieval-only", "copilot"] = "generated"
    evidence_revision: str | None = None
    # Stage 3 structured fields (absent for plain RAG responses)
    intent: Optional[str] = None
    evidence_found: Optional[str] = None
    graph_finding: Optional[str] = None
    recommended_next_step: Optional[str] = None
    ncert_resource: Optional[dict] = None
    limitations: list[str] = Field(default_factory=list)
    # Structured operation payload, used by the on-device scheduler bridge.
    structured_data: Optional[dict] = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    rag_loaded: bool
    retrieval_dependencies_available: bool
    corpus_available: bool
    coverage: dict = Field(default_factory=dict)
    generation_available: bool = False
    configured_model: str = "llama3.2:3b"
    generation_message: str = ""


# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="Calcmate RAG development bridge", version="1.0.0")
origins = [value.strip() for value in os.getenv(
    "CALCMATE_CORS_ORIGINS", "http://localhost:8081,http://localhost:8082"
).split(",") if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_credentials=False, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type", "Authorization"])
_lock = Lock()
_rag_loaded = False


def _trace(event: str, **fields) -> None:
    """Emit compact request-routing diagnostics to the backend terminal."""
    details = " ".join(f"{key}={value!r}" for key, value in fields.items())
    # Use flushed stdout so traces remain visible even when Uvicorn is started
    # with log_level="error" (for example, by the integration test runner).
    print(f"[CALCMATE_TRACE] {event}{f' {details}' if details else ''}", flush=True)


def generation_status():
    model = os.getenv("CALCMATE_RAG_MODEL", "llama3.2:3b")
    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    if "://" not in host:
        host = "http://" + host
    try:
        with urllib.request.urlopen(host + "/api/tags", timeout=2) as response:
            models = {item["name"] for item in json.load(response).get("models", [])}
        if model in models or model + ":latest" in models:
            return True, model, "Local answer generation is ready."
        return False, model, f"Model {model} is missing. Run ollama pull {model} on the server computer."
    except Exception:
        return False, model, "Ollama is not reachable. Open Ollama or run ollama serve on the server computer."


def source_excerpt_answer(chunks):
    """An explicitly labelled source view, never a fabricated generated answer."""
    parts = ["### Textbook excerpts (retrieval only)",
             "The local AI model is unavailable. These are retrieved curriculum passages, rather than an AI explanation."]
    for chunk in chunks[:3]:
        text = chunk.text.strip()
        if len(text) > 900:
            text = text[:900].rsplit(" ", 1)[0] + "…"
        # Block quotes keep source text separate from application commentary.
        parts.append("\n".join("> " + line for line in text.splitlines()))
        parts.append(f"Source: {chunk.source_pdf} · Grade {chunk.grade}")
    return "\n\n".join(parts)


@lru_cache(maxsize=1)
def _get_runtime():
    global _rag_loaded
    copilot = importlib.import_module("src.copilot")
    retriever = copilot.get_default_retriever()
    _rag_loaded = True
    return copilot, retriever


# ─── Stage 3: Copilot Pipeline ────────────────────────────────────────────────

def _is_copilot_request(request: ChatRequest) -> bool:
    """
    A request uses the copilot pipeline when it carries at least one
    structured context field. Plain RAG questions (workspace_id=None) pass
    through the original pipeline unchanged.
    """
    selected = bool(request.workspace_id or request.student_id or request.concept_id)
    _trace(
        "route_check",
        copilot=selected,
        workspace=bool(request.workspace_id),
        student=bool(request.student_id),
        concept=bool(request.concept_id),
        screen=bool(request.screen_context),
        grade=request.grade,
        question_length=len(request.question),
    )
    return selected


def _run_copilot_pipeline(request: ChatRequest) -> ChatResponse:
    """
    Stage 3 pipeline:
      ChatRequest → CopilotRequest → extract_intent → dispatch (operations)
      → compose response (deterministic or LLM-assisted).

    RAG is called additionally for EXPLAIN_CONCEPT and GENERAL_QUESTION intents
    if the retriever is loaded.
    """
    from src.copilot_contract import CopilotRequest as Req, CopilotIntent
    from src.intent_extractor import extract_intent
    from src.copilot_operations import dispatch
    from src.response_composer import compose_deterministic, compose_with_llm

    if request.classroom_evidence and not request.student_id:
        import re
        candidates=[s.id for s in request.classroom_evidence.students if re.search(r'\b'+re.escape(s.name)+r'\b',request.question,re.I)]
        if len(candidates)==1:
            request.student_id=candidates[0]
    copilot_req = Req(
        message=request.question,
        grade=request.grade,
        subject=request.subject,
        k=request.k,
        use_llm=request.use_llm,
        workspace_id=request.workspace_id,
        student_id=request.student_id,
        concept_id=request.concept_id,
        screen_context=request.screen_context,
    )

    _trace(
        "copilot_request",
        workspace=bool(copilot_req.workspace_id),
        student=bool(copilot_req.student_id),
        concept=bool(copilot_req.concept_id),
        screen=copilot_req.screen_context or "none",
    )

    intent_result = extract_intent(copilot_req)
    _trace(
        "intent_extracted",
        intent=intent_result.intent.value,
        method=intent_result.extraction_method,
        confidence=round(intent_result.confidence, 3),
        missing=intent_result.missing_parameters,
        parameter_keys=sorted(intent_result.parameters.keys()),
    )
    op_result = dispatch(intent_result, copilot_req)
    _trace(
        "operation_complete",
        operation=op_result.operation,
        status=op_result.status.value,
        has_structured_data=bool(op_result.structured_data),
    )

    # For retrieval-heavy intents, also run RAG for enrichment
    rag_answer: Optional[str] = None
    rag_chunks: list = []
    rag_intents = {CopilotIntent.GENERAL_QUESTION, CopilotIntent.EXPLAIN_CONCEPT,
                   CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY, CopilotIntent.RETRIEVE_NCERT_RESOURCE,
                   CopilotIntent.EXPLAIN_PREREQUISITES, CopilotIntent.EXPLAIN_LEARNING_DIFFICULTY}

    if intent_result.intent in rag_intents:
        _trace("rag_enrichment_start", intent=intent_result.intent.value)
        try:
            copilot_mod, retriever = _get_runtime()
            model = os.getenv("CALCMATE_RAG_MODEL", copilot_mod.DEFAULT_MODEL)
            rag_answer, raw_chunks = copilot_mod.answer_question(
                retriever, request.question, request.grade,
                subject=request.subject, k=request.k, model=model,
                stream=False, use_llm=request.use_llm,
            )
            if rag_answer.startswith("[generation failed:"):
                if raw_chunks and os.getenv("CALCMATE_RAG_ALLOW_RETRIEVAL_FALLBACK", "true").lower() in {"true", "1", "yes", "on"}:
                    rag_answer = source_excerpt_answer(raw_chunks)
                else:
                    rag_answer = None
            elif rag_answer.startswith("[--no-llm mode:"):
                rag_answer = source_excerpt_answer(raw_chunks).replace("The local AI model is unavailable.", "Retrieval-only mode was requested.")
            rag_chunks = [
                {"chunk_id": c.chunk_id, "text": c.text, "grade": c.grade,
                 "subject": c.subject, "source_pdf": c.source_pdf,
                 "chunk_index": c.chunk_index, "score": c.score,
                 "used_fallback": c.used_fallback,"source_url":getattr(c,"source_url",None),"source_pages":getattr(c,"source_pages",None),"resource_kind":getattr(c,"resource_kind","textbook_passage")}
                for c in raw_chunks
            ]
            _trace(
                "rag_enrichment_complete",
                answer=bool(rag_answer),
                chunks=len(rag_chunks),
                fallback=bool(rag_answer and "retrieval only" in rag_answer.lower()),
            )
        except Exception as exc:
            _trace("rag_enrichment_error", error_type=type(exc).__name__)

    if not rag_chunks and op_result.structured_data and "chunks" in op_result.structured_data:
        rag_chunks = op_result.structured_data["chunks"]
    if not rag_answer and rag_chunks:
        from types import SimpleNamespace
        dummy_chunks = [SimpleNamespace(**c) for c in rag_chunks]
        rag_answer = source_excerpt_answer(dummy_chunks)

    if request.use_llm and intent_result.intent in {CopilotIntent.GENERAL_QUESTION,CopilotIntent.EXPLAIN_CONCEPT,CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY,CopilotIntent.RETRIEVE_NCERT_RESOURCE}:
        copilot_response = compose_with_llm(
            op_result, intent_result, copilot_req,
            rag_answer=rag_answer, rag_chunks=rag_chunks,
            model=os.getenv("CALCMATE_RAG_MODEL", "llama3.2:3b"),
        )
    else:
        copilot_response = compose_deterministic(
            op_result, intent_result, copilot_req,
            rag_answer=rag_answer, rag_chunks=rag_chunks,
        )

    _trace(
        "copilot_response",
        intent=copilot_response.intent,
        answer_length=len(copilot_response.answer),
        chunks=len(copilot_response.chunks),
        used_llm=copilot_response.used_llm,
        limitations=len(copilot_response.limitations),
    )

    # Build backward-compatible ChunkResponse list
    chunk_responses = []
    for c in copilot_response.chunks:
        try:
            chunk_responses.append(ChunkResponse(**{
                k: c[k] for k in ("chunk_id", "text", "grade", "subject",
                                   "source_pdf", "chunk_index", "score", "used_fallback","source_url","source_pages","resource_kind") if k in c
            }))
        except Exception:
            pass

    return ChatResponse(
        answer=copilot_response.answer,
        chunks=chunk_responses,
        mode="copilot",
        evidence_revision=request.classroom_evidence.revision if request.classroom_evidence else None,
        intent=copilot_response.intent,
        evidence_found=copilot_response.evidence_found,
        graph_finding=copilot_response.graph_finding,
        recommended_next_step=copilot_response.recommended_next_step,
        ncert_resource=copilot_response.ncert_resource,
        limitations=copilot_response.limitations,
        structured_data=op_result.structured_data,
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    data = Path(__file__).resolve().parent.parent / "data"
    available, model, message = generation_status()
    from src.resource_coverage import coverage
    return HealthResponse(
        status="ok", rag_loaded=_rag_loaded,coverage=coverage(),
        generation_available=available, configured_model=model, generation_message=message,
        retrieval_dependencies_available=all(importlib.util.find_spec(name) is not None
                                             for name in ("faiss", "numpy", "sentence_transformers")),
        corpus_available=all((data / name).is_file()
                             for name in ("vector_store.index", "vector_store_meta.json")),
    )


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, http_request: Request, authorization: str | None = Header(default=None)) -> ChatResponse:
    if request.workspace_id or request.student_id or request.classroom_evidence:
        teacher = require_teacher(http_request, authorization)
        assert_workspace(request.workspace_id, teacher)
        if request.classroom_evidence is None:
            raise HTTPException(422, "Refresh classroom evidence before asking about students.")
        assert_workspace(request.classroom_evidence.workspace_id, teacher)
        request.workspace_id = teacher["workspace_id"]
    _trace("chat_received", subject=request.subject, grade=request.grade, use_llm=request.use_llm)
    # Stage 3: Route structured copilot requests through the intent pipeline.
    if _is_copilot_request(request):
        with _lock:
            try:
                if request.classroom_evidence:
                    with evidence_database(request.classroom_evidence):
                        return _run_copilot_pipeline(request)
                return _run_copilot_pipeline(request)
            except Exception as exc:
                logging.getLogger("uvicorn.error").exception("CalcMate copilot pipeline failed")
                raise HTTPException(status_code=503,
                                    detail="Copilot pipeline unavailable. Check Python dependencies.") from exc

    # Original RAG path (unchanged for backward compatibility).
    _trace("plain_rag_path", reason="no structured copilot context")
    with _lock:
        try:
            copilot, retriever = _get_runtime()
            answer, chunks = copilot.answer_question(
                retriever, request.question, request.grade, subject=request.subject,
                k=request.k, model=os.getenv("CALCMATE_RAG_MODEL", copilot.DEFAULT_MODEL),
                stream=False, use_llm=request.use_llm,
            )
        except Exception as exc:
            logging.getLogger("uvicorn.error").exception("CalcMate retrieval/generation request failed")
            raise HTTPException(status_code=503, detail="RAG runtime unavailable. Check Python dependencies, corpus and cached embedding model.") from exc
    # copilot reports generation failures as text; do not pass internal error details to clients.
    if answer.startswith("[generation failed:"):
        logging.getLogger("uvicorn.error").warning("CalcMate local answer generation failed; inspect Ollama and CALCMATE_RAG_MODEL")
        if not chunks or os.getenv("CALCMATE_RAG_ALLOW_RETRIEVAL_FALLBACK", "true").lower() not in {"true", "1", "yes", "on"}:
            raise HTTPException(status_code=503, detail="Local answer generation unavailable. Check the Ollama service and configured model, or use retrieval-only mode.")
        answer = source_excerpt_answer(chunks)
        mode = "retrieval-only"
    elif answer.startswith("[--no-llm mode:"):
        answer = source_excerpt_answer(chunks).replace("The local AI model is unavailable.", "Retrieval-only mode was requested.")
        mode = "retrieval-only"
    else:
        mode = "generated"
    _trace("plain_rag_complete", mode=mode, chunks=len(chunks), answer_length=len(answer))
    return ChatResponse(answer=answer, mode=mode, chunks=[ChunkResponse(
        chunk_id=c.chunk_id, text=c.text, grade=c.grade, subject=c.subject,
        source_pdf=c.source_pdf, source_url=getattr(c,"source_url",None),source_pages=getattr(c,"source_pages",None),resource_kind=getattr(c,"resource_kind","textbook_passage"),chunk_index=c.chunk_index, score=c.score,
        used_fallback=c.used_fallback,
    ) for c in chunks])
