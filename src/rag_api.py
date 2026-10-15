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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field


# ─── Request / Response Models ────────────────────────────────────────────────

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    grade: Literal[1, 2, 3, 4]
    subject: Literal["Math"] = "Math"
    k: int = Field(default=3, ge=1, le=10)
    use_llm: bool = True
    # Stage 3 copilot context fields (optional — backward compatible)
    workspace_id: Optional[str] = Field(default=None)
    student_id:   Optional[str] = Field(default=None)
    concept_id:   Optional[str] = Field(default=None)
    screen_context: Optional[str] = Field(default=None)


class ChunkResponse(BaseModel):
    chunk_id: int
    text: str
    grade: int
    subject: str
    source_pdf: str
    chunk_index: int
    score: float
    used_fallback: bool


class ChatResponse(BaseModel):
    answer: str
    chunks: list[ChunkResponse]
    mode: Literal["generated", "retrieval-only", "copilot"] = "generated"
    # Stage 3 structured fields (absent for plain RAG responses)
    intent: Optional[str] = None
    evidence_found: Optional[str] = None
    graph_finding: Optional[str] = None
    recommended_next_step: Optional[str] = None
    ncert_resource: Optional[dict] = None
    limitations: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    rag_loaded: bool
    retrieval_dependencies_available: bool
    corpus_available: bool
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
    return bool(request.workspace_id or request.student_id or request.concept_id)


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

    intent_result = extract_intent(copilot_req)
    op_result = dispatch(intent_result, copilot_req)

    # For retrieval-heavy intents, also run RAG for enrichment
    rag_answer: Optional[str] = None
    rag_chunks: list = []
    rag_intents = {CopilotIntent.GENERAL_QUESTION, CopilotIntent.EXPLAIN_CONCEPT,
                   CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY, CopilotIntent.RETRIEVE_NCERT_RESOURCE,
                   CopilotIntent.EXPLAIN_PREREQUISITES, CopilotIntent.EXPLAIN_LEARNING_DIFFICULTY}

    if intent_result.intent in rag_intents:
        try:
            copilot_mod, retriever = _get_runtime()
            model = os.getenv("CALCMATE_RAG_MODEL", copilot_mod.DEFAULT_MODEL)
            rag_answer, raw_chunks = copilot_mod.answer_question(
                retriever, request.question, request.grade,
                subject=request.subject, k=request.k, model=model,
                stream=False, use_llm=request.use_llm,
            )
            if rag_answer.startswith("[generation failed:") or rag_answer.startswith("[--no-llm mode:"):
                rag_answer = None
            rag_chunks = [
                {"chunk_id": c.chunk_id, "text": c.text, "grade": c.grade,
                 "subject": c.subject, "source_pdf": c.source_pdf,
                 "chunk_index": c.chunk_index, "score": c.score,
                 "used_fallback": c.used_fallback}
                for c in raw_chunks
            ]
        except Exception:
            pass

    if request.use_llm:
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

    # Build backward-compatible ChunkResponse list
    chunk_responses = []
    for c in copilot_response.chunks:
        try:
            chunk_responses.append(ChunkResponse(**{
                k: c[k] for k in ("chunk_id", "text", "grade", "subject",
                                   "source_pdf", "chunk_index", "score", "used_fallback")
            }))
        except Exception:
            pass

    return ChatResponse(
        answer=copilot_response.answer,
        chunks=chunk_responses,
        mode="copilot",
        intent=copilot_response.intent,
        evidence_found=copilot_response.evidence_found,
        graph_finding=copilot_response.graph_finding,
        recommended_next_step=copilot_response.recommended_next_step,
        ncert_resource=copilot_response.ncert_resource,
        limitations=copilot_response.limitations,
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    data = Path(__file__).resolve().parent.parent / "data"
    available, model, message = generation_status()
    return HealthResponse(
        status="ok", rag_loaded=_rag_loaded,
        generation_available=available, configured_model=model, generation_message=message,
        retrieval_dependencies_available=all(importlib.util.find_spec(name) is not None
                                             for name in ("faiss", "numpy", "sentence_transformers")),
        corpus_available=all((data / name).is_file()
                             for name in ("vector_store.index", "vector_store_meta.json")),
    )


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    # Stage 3: Route structured copilot requests through the intent pipeline.
    if _is_copilot_request(request):
        with _lock:
            try:
                return _run_copilot_pipeline(request)
            except Exception as exc:
                logging.getLogger("uvicorn.error").exception("CalcMate copilot pipeline failed")
                raise HTTPException(status_code=503,
                                    detail="Copilot pipeline unavailable. Check Python dependencies.") from exc

    # Original RAG path (unchanged for backward compatibility).
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
    return ChatResponse(answer=answer, mode=mode, chunks=[ChunkResponse(
        chunk_id=c.chunk_id, text=c.text, grade=c.grade, subject=c.subject,
        source_pdf=c.source_pdf, chunk_index=c.chunk_index, score=c.score,
        used_fallback=c.used_fallback,
    ) for c in chunks])
