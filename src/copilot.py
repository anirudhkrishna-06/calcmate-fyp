"""
copilot.py - grounded teacher Q&A, end to end.

Pipeline: teacher question -> curriculum-aware retrieval (retrieve.py)
          -> confidence check -> grounded prompt -> local SLM (Ollama)
          -> answer with citations.

SCOPE OF THIS PROTOTYPE (read this before citing any numbers from it):
    This file validates that the RAG-to-generation loop works END-TO-END
    on a laptop using a small local model via Ollama. It is a FEASIBILITY
    CHECK, not an on-device performance benchmark.

    RQ5 (on-device latency/RAM) requires a real quantized runtime
    (llama.cpp / MLC) on the actual target hardware (Android ARM64).
    Numbers from this prototype should NOT be cited as RQ5 evidence -
    laptop RAM, x86 CPU, no thermal constraints, different runtime.

    What this prototype DOES establish:
      - The retrieval layer feeds cleanly into a generation layer.
      - A small (1B) local model can produce grounded, cited answers.
      - The confidence threshold correctly rejects off-corpus questions
        BEFORE calling the LLM (no hallucination path).

SETUP (one-time):
    1. Install Ollama:      https://ollama.com/download
    2. Pull a small model:  ollama pull llama3.2:1b
    3. Install Python pkg:  pip install ollama

Usage:
    python copilot.py "What are equivalent fractions?" --grade 4
    python copilot.py "How do you read a clock?" --grade 3 --no-llm
    python copilot.py "..." --grade 4 --model llama3.2:3b
    python copilot.py "..." --grade 4 --stream
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

# Resolve paths relative to this file
_THIS_DIR = Path(__file__).resolve().parent
_DATA_DIR = _THIS_DIR.parent / "data"
COPILOT_LOG_PATH = _DATA_DIR / "copilot_log.jsonl"

# Import the retriever module
import sys
sys.path.insert(0, str(_THIS_DIR))
from retrieve import RetrievedChunk, get_default_retriever, Retriever  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("copilot")

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

DEFAULT_MODEL = "llama3.2:1b"

# If the best retrieval score is below this, the Copilot refuses to call
# the LLM at all and returns a "not in corpus" message. This is the primary
# hallucination-prevention mechanism.
#
# NOTE: 0.30 is an INITIAL GUESS. Every retrieve() call appends to
# data/retrieval_log.jsonl; once you have 30+ real queries with hand-labeled
# "should have answered" vs "should have refused", run src/eval_threshold.py
# to pick this value from data rather than from a guess. Do NOT cite 0.30 as
# a final value in the report until it's been tuned.
MIN_SCORE_THRESHOLD = 0.45

# Ollama generation parameters
TEMPERATURE = 0.2          # low = grounded, less creative drift
MAX_TOKENS = 300           # plenty for a 2-4 sentence answer

# Context-window safety: if joined chunk text exceeds this, we drop the
# lowest-scoring chunks first, then truncate the tail of remaining chunks.
MAX_CONTEXT_CHARS = 6000

PROMPT_TEMPLATE = """You are a teaching assistant helping a primary school teacher. \
Answer the teacher's question using ONLY the textbook content provided below. \
Do not use any outside knowledge. If the provided content does not contain \
enough information to answer, say so explicitly rather than guessing.

Textbook content:
{context}

Teacher's question: {question}

Answer (grounded strictly in the content above, 2-4 sentences, plain language suitable for explaining to a Grade {grade} student):"""


# --------------------------------------------------------------------------- #
# Prompt construction
# --------------------------------------------------------------------------- #

def build_context(chunks: list[RetrievedChunk], max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """
    Build the context block from retrieved chunks, respecting a character
    budget. Chunks are given in descending score order by retrieve();
    if we exceed the budget, we drop the lowest-scoring chunks first,
    then truncate the tail of the last remaining chunk.
    """
    # Keep highest-scoring chunks that fit
    kept: list[str] = []
    total = 0
    for c in chunks:
        piece = f"[{c.source_pdf}]\n{c.text}"
        if total + len(piece) <= max_chars:
            kept.append(piece)
            total += len(piece)
        else:
            # Try a truncated version of this chunk
            remaining = max_chars - total
            if remaining > 200:
                kept.append(piece[:remaining].rstrip() + " ...")
            break
    return "\n\n---\n\n".join(kept)


def build_prompt(question: str, grade: int, chunks: list[RetrievedChunk]) -> str:
    context = build_context(chunks)
    return PROMPT_TEMPLATE.format(context=context, question=question, grade=grade)


# --------------------------------------------------------------------------- #
# Ollama invocation
# --------------------------------------------------------------------------- #

def call_llm(
    model: str,
    prompt: str,
    stream: bool = False,
) -> str:
    """
    Invoke Ollama. If stream=True, print tokens as they arrive and return
    the concatenated result.

    Raises RuntimeError with a helpful message if Ollama isn't running or
    the model isn't pulled.
    """
    try:
        import ollama
    except ImportError:
        raise RuntimeError(
            "The 'ollama' Python package is not installed. "
            "Run: pip install ollama"
        )

    options = {"temperature": TEMPERATURE, "num_predict": MAX_TOKENS}

    try:
        if stream:
            pieces: list[str] = []
            for chunk in ollama.generate(
                model=model, prompt=prompt, stream=True, options=options
            ):
                token = chunk.get("response", "")
                pieces.append(token)
                print(token, end="", flush=True)
            print()  # newline after stream
            return "".join(pieces).strip()

        resp = ollama.generate(model=model, prompt=prompt, options=options)
        return resp["response"].strip()

    except Exception as e:
        # Ollama-specific errors are opaque; give the user actionable advice.
        msg = str(e).lower()
        if "connection" in msg or "refused" in msg or "not running" in msg:
            raise RuntimeError(
                "Cannot reach Ollama. Is it running? Start with: `ollama serve`"
            ) from e
        if "model" in msg and "not found" in msg:
            raise RuntimeError(
                f"Model '{model}' not pulled. Run: ollama pull {model}"
            ) from e
        raise


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

def _log_interaction(
    question: str, grade: int, subject: str, k: int,
    top_score: float | None,
    refused: bool,
    model: str | None,
    answer: str | None,
    sources: list[str],
    elapsed_ms: float,
) -> None:
    """Append one JSONL line per Q&A. Used for demo analysis, not evaluation."""
    record = {
        "ts": time.time(),
        "question": question,
        "grade": grade,
        "subject": subject,
        "k": k,
        "top_score": top_score,
        "refused": refused,
        "model": model,
        "answer_chars": len(answer) if answer else 0,
        "sources": sources,
        "elapsed_ms": round(elapsed_ms, 2),
    }
    try:
        COPILOT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(COPILOT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        log.warning(f"[copilot] failed to write log: {e}")


# --------------------------------------------------------------------------- #
# Main pipeline
# --------------------------------------------------------------------------- #

def answer_question(
    retriever: Retriever,
    question: str,
    grade: int,
    subject: str = "Math",
    k: int = 3,
    model: str = DEFAULT_MODEL,
    stream: bool = False,
    use_llm: bool = True,
) -> tuple[str, list[RetrievedChunk]]:
    """
    Full pipeline: retrieve -> threshold check -> grounded prompt -> LLM.

    Returns (answer_text, retrieved_chunks). The chunks are returned so
    callers (e.g. a UI) can display citations or let the teacher inspect
    the raw source material.

    The refusal path is FIRST-CLASS: if top_score < MIN_SCORE_THRESHOLD,
    we return a refusal WITHOUT calling the LLM. This is deliberate - it
    guarantees no hallucination on off-corpus questions and saves the
    LLM call latency.
    """
    t0 = time.perf_counter()
    chunks = retriever.retrieve(question, grade=grade, subject=subject, k=k)

    # --- Refusal path 1: no retrieval results at all ---
    if not chunks:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _log_interaction(question, grade, subject, k,
                         top_score=None, refused=True, model=None,
                         answer=None, sources=[], elapsed_ms=elapsed_ms)
        return ("I couldn't find any curriculum content for this question "
                "in the current corpus.", [])

    top_score = chunks[0].score

    # --- Refusal path 2: retrieval too weak ---
    if top_score < MIN_SCORE_THRESHOLD:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _log_interaction(question, grade, subject, k,
                         top_score=top_score, refused=True, model=None,
                         answer=None, sources=[], elapsed_ms=elapsed_ms)
        return (f"I don't have confident curriculum content for this question "
                f"(best match score: {top_score:.2f}, threshold: {MIN_SCORE_THRESHOLD}). "
                f"This topic may not be covered in the current corpus, or the "
                f"question may need rephrasing.", chunks)

    # --- Optional: retrieval-only mode (no LLM) ---
    if not use_llm:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _log_interaction(question, grade, subject, k,
                         top_score=top_score, refused=False, model=None,
                         answer=None, sources=sorted({c.source_pdf for c in chunks}),
                         elapsed_ms=elapsed_ms)
        return ("[--no-llm mode: retrieval only; see chunks below]", chunks)

    # --- Generation ---
    prompt = build_prompt(question, grade, chunks)
    log.debug(f"[copilot] prompt length: {len(prompt)} chars")

    try:
        answer = call_llm(model, prompt, stream=stream)
    except RuntimeError as e:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _log_interaction(question, grade, subject, k,
                         top_score=top_score, refused=False, model=model,
                         answer=None, sources=[], elapsed_ms=elapsed_ms)
        return (f"[generation failed: {e}]", chunks)

    # --- Citation footer ---
    sources = sorted({c.source_pdf for c in chunks if not c.used_fallback})
    if chunks[0].used_fallback:
        sources = sorted({c.source_pdf for c in chunks})
        footer = (f"\n\n[Grounded in: {', '.join(sources)} | "
                  f"top match score: {top_score:.2f} | "
                  f"NO curriculum filter for grade {grade} {subject} - used global search]")
    else:
        footer = (f"\n\n[Grounded in: {', '.join(sources)} | "
                  f"top match score: {top_score:.2f}]")

    elapsed_ms = (time.perf_counter() - t0) * 1000
    _log_interaction(question, grade, subject, k,
                     top_score=top_score, refused=False, model=model,
                     answer=answer, sources=sources, elapsed_ms=elapsed_ms)

    return (answer + footer, chunks)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("question", help="The teacher's question")
    p.add_argument("--grade", type=int, required=True, help="Student grade (e.g. 4)")
    p.add_argument("--subject", default="Math", help="Subject (default: Math)")
    p.add_argument("--k", type=int, default=3, help="Number of chunks to retrieve")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"Ollama model (default: {DEFAULT_MODEL})")
    p.add_argument("--stream", action="store_true", help="Stream tokens as they arrive")
    p.add_argument("--no-llm", action="store_true",
                   help="Skip LLM generation; show retrieved chunks only")
    p.add_argument("--show-chunks", action="store_true",
                   help="Print retrieved chunks after the answer (for debugging)")
    return p.parse_args()


def main() -> None:
    args = _parse_args()

    print("=" * 72)
    print(f"Q: {args.question}")
    print(f"   (grade={args.grade}, subject={args.subject}, k={args.k})")
    print("=" * 72)

    retriever = get_default_retriever()

    answer, chunks = answer_question(
        retriever,
        question=args.question,
        grade=args.grade,
        subject=args.subject,
        k=args.k,
        model=args.model,
        stream=args.stream,
        use_llm=not args.no_llm,
    )

    if not args.stream:
        print(f"\nA: {answer}")

    if args.show_chunks:
        print("\n" + "-" * 72)
        print("Retrieved chunks (for inspection):")
        print("-" * 72)
        for i, c in enumerate(chunks, 1):
            print(f"\n[{i}] score={c.score:.3f}  {c.source_pdf}  "
                  f"grade={c.grade}  concepts={c.concept_ids}")
            print(f"    {c.text[:300].strip()}...")


if __name__ == "__main__":
    main()