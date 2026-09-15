"""
Calcmate RAG Comparison: Generic vs Curriculum-Aware Retrieval
----------------------------------------------------------------
Fill in `load_ncert_chunks()` with your actual chunked NCERT text
(see chunk_ncert.py for the chunking step). This script then runs
BOTH retrieval pipelines over the same chunk set and reports
Precision@k / Recall@k / MRR on benchmark/questions.csv.

Usage:
    python rag_compare.py

Dependencies:
    pip install sentence-transformers numpy --break-system-packages
"""

import csv
import numpy as np
from sentence_transformers import SentenceTransformer


MODEL_NAME = "all-MiniLM-L6-v2"  # small, fast, good enough for this comparison
K = 3  # evaluate Precision@3 / Recall@3


class Chunk:
    def __init__(self, chunk_id, text, grade=None, subject=None, concept_id=None):
        self.chunk_id = chunk_id
        self.text = text
        self.grade = grade
        self.subject = subject
        self.concept_id = concept_id


def load_ncert_chunks(path="../data/chunks.csv"):
    """
    Loads chunks produced by build_corpus.py (data/chunks.csv).
    Run build_corpus.py on your extracted NCERT text files first -
    see README.md for the full workflow.
    """
    import csv as _csv
    from pathlib import Path as _Path

    if not _Path(path).exists():
        raise FileNotFoundError(
            f"{path} not found. Run build_corpus.py on your extracted NCERT "
            "text files first to generate tagged chunks."
        )

    with open(path, newline="", encoding="utf-8") as f:
        rows = list(_csv.DictReader(f))

    return [
        Chunk(r["chunk_id"], r["text"], grade=int(r["grade"]),
              subject=r["subject"], concept_id=r["concept_id"])
        for r in rows
    ]


def embed_chunks(model, chunks):
    texts = [c.text for c in chunks]
    return model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)


def cosine_topk(query_vec, chunk_vecs, k):
    scores = chunk_vecs @ query_vec
    top_idx = np.argsort(-scores)[:k]
    return top_idx, scores[top_idx]


def retrieve_generic(model, chunks, chunk_vecs, question, k=K):
    """Plain semantic search - no metadata used at all."""
    q_vec = model.encode([question], convert_to_numpy=True, normalize_embeddings=True)[0]
    top_idx, _ = cosine_topk(q_vec, chunk_vecs, k)
    return [chunks[i] for i in top_idx]


def retrieve_curriculum_aware(model, chunks, chunk_vecs, question, grade, subject, k=K):
    """Metadata-filtered semantic search: only consider chunks matching
    the question's grade/subject before ranking by similarity.

    If the metadata filter is too strict and returns nothing, this
    falls back to generic search over the full chunk set (avoids
    silently failing on sparse coverage).
    """
    mask = [i for i, c in enumerate(chunks) if c.grade == grade and c.subject == subject]
    if not mask:
        return retrieve_generic(model, chunks, chunk_vecs, question, k)

    sub_vecs = chunk_vecs[mask]
    q_vec = model.encode([question], convert_to_numpy=True, normalize_embeddings=True)[0]
    top_idx, _ = cosine_topk(q_vec, sub_vecs, min(k, len(mask)))
    return [chunks[mask[i]] for i in top_idx]


def load_benchmark(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def precision_recall_mrr(retrieved_ids, gold_id):
    """Single-gold-passage version. If you label multiple gold chunks
    per question, extend gold_id to a set and adjust accordingly."""
    hit_rank = None
    for rank, cid in enumerate(retrieved_ids, start=1):
        if cid == gold_id:
            hit_rank = rank
            break
    precision = (1 if hit_rank else 0) / len(retrieved_ids) if retrieved_ids else 0.0
    recall = 1.0 if hit_rank else 0.0  # single gold passage assumed
    mrr = 1.0 / hit_rank if hit_rank else 0.0
    return precision, recall, mrr


def run_comparison():
    model = SentenceTransformer(MODEL_NAME)
    chunks = load_ncert_chunks()
    chunk_vecs = embed_chunks(model, chunks)
    benchmark = load_benchmark("../benchmark/questions.csv")

    results = {"generic": [], "curriculum": []}

    for row in benchmark:
        gold = row["gold_chunk_id"].strip()
        if not gold:
            continue  # skip unlabeled questions - label these before running for real

        q = row["question"]
        grade = int(row["grade"])
        subject = row["subject"]

        generic_hits = retrieve_generic(model, chunks, chunk_vecs, q)
        curriculum_hits = retrieve_curriculum_aware(model, chunks, chunk_vecs, q, grade, subject)

        results["generic"].append(precision_recall_mrr([c.chunk_id for c in generic_hits], gold))
        results["curriculum"].append(precision_recall_mrr([c.chunk_id for c in curriculum_hits], gold))

    for pipeline, vals in results.items():
        if not vals:
            print(f"{pipeline}: no labeled questions found - fill in gold_chunk_id in questions.csv")
            continue
        p = np.mean([v[0] for v in vals])
        r = np.mean([v[1] for v in vals])
        m = np.mean([v[2] for v in vals])
        print(f"{pipeline:>12} | Precision@{K}: {p:.3f} | Recall@{K}: {r:.3f} | MRR: {m:.3f}")


if __name__ == "__main__":
    run_comparison()
