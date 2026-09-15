"""
retrieve.py - production retrieval module for CalcMate.

Wraps the FAISS vector store + curriculum-aware filtering (grade/subject
metadata via FAISS IDSelectorArray) into a single reusable class, so
downstream code (the Copilot, the allocation engine, any UI layer) doesn't
need to know about FAISS internals.

Design notes:
  - The store is loaded ONCE per process (Retriever is a singleton via
    module-level caching in get_default_retriever()). Loading the model is
    the expensive part (~2s) - do not do it per-query.
  - Every retrieve() call is logged to data/retrieval_log.jsonl in
    append-only JSONL form. This is the passive dataset that will be used
    to TUNE the confidence threshold later. Do not remove the logging.
  - The curriculum filter is applied via FAISS IDSelectorArray, which
    restricts the ANN search itself - not a post-hoc filter. This is what
    RQ1 established as the winning design.

Usage as a library:
    from retrieve import get_default_retriever
    r = get_default_retriever()
    results = r.retrieve("What are equivalent fractions?", grade=4, subject="Math", k=3)
    for c in results:
        print(c.score, c.source_pdf, c.text[:80])

Usage as a self-test:
    python retrieve.py --test
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

# Resolve paths relative to THIS file so the module works regardless of cwd.
_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent
_DATA_DIR = _PROJECT_ROOT / "data"

INDEX_PATH = _DATA_DIR / "vector_store.index"
META_PATH = _DATA_DIR / "vector_store_meta.json"
LOG_PATH = _DATA_DIR / "retrieval_log.jsonl"
MODEL_NAME = "all-MiniLM-L6-v2"

# If a curriculum bucket has fewer chunks than this, we still apply the
# filter (small bucket is fine); but if it's EMPTY we fall back to global.
FALLBACK_ON_EMPTY_BUCKET = True

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("retrieve")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass
class RetrievedChunk:
    """A single retrieved chunk with its metadata and relevance score."""
    chunk_id: int
    text: str
    concept_ids: list[str]
    grade: int
    subject: str
    source_pdf: str
    chunk_index: int
    score: float          # cosine similarity in [-1, 1]; higher = more relevant
    used_fallback: bool = False   # True if curriculum filter was bypassed


# --------------------------------------------------------------------------- #
# Retriever
# --------------------------------------------------------------------------- #

class Retriever:
    """
    FAISS-backed retriever with optional curriculum (grade/subject) filtering.

    Instances are expensive to construct (loads FAISS index + embedding model),
    so construct ONE and reuse it. Use get_default_retriever() for a
    process-wide singleton.
    """

    def __init__(
        self,
        index_path: Path = INDEX_PATH,
        meta_path: Path = META_PATH,
        model_name: str = MODEL_NAME,
        log_path: Path = LOG_PATH,
    ):
        # --- Validate inputs early (fail loudly, not 200 lines later) ---
        if not Path(index_path).exists():
            raise FileNotFoundError(
                f"FAISS index not found at {index_path}. "
                f"Run: python build_vector_store.py"
            )
        if not Path(meta_path).exists():
            raise FileNotFoundError(
                f"Metadata not found at {meta_path}. "
                f"Run: python build_vector_store.py"
            )

        t0 = time.perf_counter()
        self.index = faiss.read_index(str(index_path))
        with open(meta_path, encoding="utf-8") as f:
            self.meta: list[dict] = json.load(f)
        self.meta_by_id: dict[int, dict] = {m["id"]: m for m in self.meta}

        # Validate index/meta alignment once at load - silent misalignment
        # would be a nightmare to debug downstream.
        if self.index.ntotal != len(self.meta):
            raise ValueError(
                f"Index/meta mismatch: index.ntotal={self.index.ntotal}, "
                f"len(meta)={len(self.meta)}. Rebuild with build_vector_store.py."
            )

        # Precompute (grade, subject) -> chunk-id list once. This is the
        # hot path in retrieval and a naive per-query scan is wasteful.
        self._buckets: dict[tuple[int, str], list[int]] = {}
        for m in self.meta:
            self._buckets.setdefault((m["grade"], m["subject"]), []).append(m["id"])

        # Load the embedding model last (slowest step).
        self.model = SentenceTransformer(model_name)
        self.model_name = model_name

        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

        log.info(
            f"[retrieve] loaded index ({self.index.ntotal} chunks, dim={self.index.d}), "
            f"{len(self._buckets)} buckets, model={model_name} "
            f"in {time.perf_counter() - t0:.2f}s"
        )

    # --------------------------------------------------------------------- #

    def _embed(self, text: str) -> np.ndarray:
        return self.model.encode(
            [text], convert_to_numpy=True, normalize_embeddings=True
        ).astype("float32")

    def retrieve(
        self,
        query: str,
        grade: Optional[int] = None,
        subject: Optional[str] = None,
        k: int = 3,
        log_call: bool = True,
    ) -> list[RetrievedChunk]:
        """
        Retrieve the top-k chunks for `query`.

        If grade AND subject are both provided, retrieval is restricted to
        chunks whose metadata matches that (grade, subject) bucket using
        FAISS IDSelectorArray. If the bucket is empty, falls back to global
        search (flagged via RetrievedChunk.used_fallback=True).

        Args:
            query: natural-language question.
            grade: student's grade, e.g. 4. Optional.
            subject: student's subject, e.g. "Math". Optional.
            k: number of chunks to return.
            log_call: if True, appends a JSONL line to retrieval_log.jsonl.

        Returns:
            List of RetrievedChunk, sorted by descending score.
        """
        if not query.strip():
            raise ValueError("query is empty")

        t0 = time.perf_counter()
        q_vec = self._embed(query)

        used_fallback = False
        filter_size: Optional[int] = None

        if grade is not None and subject is not None:
            matching_ids = self._buckets.get((grade, subject), [])
            filter_size = len(matching_ids)

            if matching_ids:
                selector = faiss.IDSelectorArray(np.array(matching_ids, dtype="int64"))
                params = faiss.SearchParameters(sel=selector)
                effective_k = min(k, len(matching_ids))
                scores, ids = self.index.search(q_vec, effective_k, params=params)
            elif FALLBACK_ON_EMPTY_BUCKET:
                used_fallback = True
                log.debug(
                    f"[retrieve] empty bucket for (grade={grade}, subject={subject!r}); "
                    f"falling back to global search"
                )
                scores, ids = self.index.search(q_vec, k)
            else:
                scores, ids = np.empty((1, 0), dtype="float32"), np.empty((1, 0), dtype="int64")
        else:
            scores, ids = self.index.search(q_vec, k)

        results: list[RetrievedChunk] = []
        for score, idx in zip(scores[0], ids[0]):
            if idx == -1:
                continue
            m = self.meta_by_id[int(idx)]
            results.append(RetrievedChunk(
                chunk_id=int(idx),
                text=m["text"],
                concept_ids=m["concept_ids"],
                grade=m["grade"],
                subject=m["subject"],
                source_pdf=m["source_pdf"],
                chunk_index=m.get("chunk_index", -1),
                score=float(score),
                used_fallback=used_fallback,
            ))

        elapsed_ms = (time.perf_counter() - t0) * 1000

        if log_call:
            self._log_query(
                query=query,
                grade=grade,
                subject=subject,
                k=k,
                results=results,
                filter_size=filter_size,
                used_fallback=used_fallback,
                elapsed_ms=elapsed_ms,
            )

        return results

    # --------------------------------------------------------------------- #

    def _log_query(
        self,
        query: str,
        grade: Optional[int],
        subject: Optional[str],
        k: int,
        results: list[RetrievedChunk],
        filter_size: Optional[int],
        used_fallback: bool,
        elapsed_ms: float,
    ) -> None:
        """
        Append one JSONL line per query. This is the passive dataset for
        threshold tuning - the whole point is to accumulate real queries
        WITHOUT manual collection.
        """
        record = {
            "ts": time.time(),
            "query": query,
            "grade": grade,
            "subject": subject,
            "k": k,
            "filter_size": filter_size,
            "used_fallback": used_fallback,
            "elapsed_ms": round(elapsed_ms, 2),
            "top_score": results[0].score if results else None,
            "scores": [round(r.score, 4) for r in results],
            "top_source": results[0].source_pdf if results else None,
            "top_concepts": results[0].concept_ids if results else None,
        }
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as e:
            # Logging is best-effort - never let it crash retrieval.
            log.warning(f"[retrieve] failed to write log line: {e}")


# --------------------------------------------------------------------------- #
# Process-wide singleton
# --------------------------------------------------------------------------- #

@lru_cache(maxsize=1)
def get_default_retriever() -> Retriever:
    """
    Return a process-wide singleton Retriever.

    Loading the model takes ~2s, so all callers within one process must
    share one instance. Use this instead of Retriever() directly unless
    you specifically need a fresh one (e.g. testing with a different index).
    """
    return Retriever()


# --------------------------------------------------------------------------- #
# CLI self-test
# --------------------------------------------------------------------------- #

def _self_test() -> None:
    """..."""
    print("=" * 72)
    print("SELF-TEST: retrieve.py")
    print("=" * 72)

    r = get_default_retriever()

    cases = [
        ("What are equivalent fractions?", 4, "Math", "M408"),
        ("How do you read a clock to the minute?", 3, "Math", "M315"),
        ("How do we find the perimeter of a rectangle?", 4, "Math", "M412"),
    ]

    all_ok = True
    for q, g, s, hint in cases:
        print(f"\nQuery: {q!r}  (grade={g}, subject={s})")
        chunks = r.retrieve(q, grade=g, subject=s, k=3, log_call=False)
        if not chunks:
            print("  !! no results")
            all_ok = False
            continue
        for i, c in enumerate(chunks, 1):
            marker = "  <-- contains expected concept" if hint in c.concept_ids else ""
            print(f"  [{i}] score={c.score:.3f} grade={c.grade} "
                  f"concepts={c.concept_ids} {c.source_pdf}{marker}")
            print(f"       {c.text[:100].strip()}...")

        # Correctness check: expected concept must appear in top-1
        if hint not in chunks[0].concept_ids:
            print(f"  !! top-1 chunk does not contain expected concept {hint}")
            all_ok = False
        # Sanity check: score should not be absurdly low
        if chunks[0].score < 0.20:
            print(f"  !! top score {chunks[0].score:.3f} is suspiciously low")
            all_ok = False

    print()
    if all_ok:
        print("[retrieve.py] SELF-TEST PASSED")
    else:
        print("[retrieve.py] SELF-TEST FAILED - see warnings above")
        raise SystemExit(1)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("query", nargs="?", default=None, help="Optional one-shot query")
    p.add_argument("--grade", type=int, default=None)
    p.add_argument("--subject", default=None)
    p.add_argument("--k", type=int, default=3)
    p.add_argument("--test", action="store_true", help="Run self-test and exit")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    if args.test or args.query is None:
        _self_test()
    else:
        r = get_default_retriever()
        for c in r.retrieve(args.query, grade=args.grade, subject=args.subject, k=args.k):
            print(f"\nscore={c.score:.3f} [{c.source_pdf}] (grade {c.grade})")
            print(f"concepts={c.concept_ids}")
            print(c.text)