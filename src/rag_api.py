"""Small development HTTP bridge; the existing RAG pipeline remains unchanged."""
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
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    grade: Literal[1, 2, 3, 4]
    subject: Literal["Math"] = "Math"
    k: int = Field(default=3, ge=1, le=10)
    use_llm: bool = True


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
    mode: Literal["generated", "retrieval-only"] = "generated"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    rag_loaded: bool
    retrieval_dependencies_available: bool
    corpus_available: bool
    generation_available: bool = False
    configured_model: str = "llama3.2:3b"
    generation_message: str = ""


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
    # The embedding/model instances and original append-only logging are shared.
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
