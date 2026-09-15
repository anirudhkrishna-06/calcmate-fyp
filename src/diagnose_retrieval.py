"""
Diagnostic: print retrieved chunks vs gold concept for each question.

Runs BOTH retrieval pipelines by default:
  - generic   : unrestricted top-k across the whole store
  - curriculum: top-k restricted to the question's (grade, subject) bucket
                via FAISS IDSelectorArray

Reports separate hit-rate summaries per pipeline so the two are never
confused again.

Usage:
    python diagnose_retrieval.py                      # both pipelines, all questions
    python diagnose_retrieval.py --grade 5            # only Grade 5
    python diagnose_retrieval.py --k 5                # top-5
    python diagnose_retrieval.py --debug              # extra verbose
    python diagnose_retrieval.py --only curriculum    # single pipeline
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from collections import Counter, defaultdict

import faiss
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("diagnose")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)

INDEX_PATH = "../data/vector_store.index"
META_PATH = "../data/vector_store_meta.json"
QUESTIONS_CSV = "../benchmark/questions.csv"
MODEL_NAME = "all-MiniLM-L6-v2"
DEFAULT_K = 3
PREVIEW_LEN = 150

SUSPICIOUS_SHORT = 50
SUSPICIOUS_LONG = 2500
LOW_SCORE_THRESHOLD = 0.35


# --------------------------------------------------------------------------- #
# Logging helpers
# --------------------------------------------------------------------------- #

def dbg(msg: str, *args) -> None:
    log.debug("    [DBG] " + msg, *args)


def banner(title: str) -> None:
    log.info("\n" + "=" * 72)
    log.info(title)
    log.info("=" * 72)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--grade", type=int, default=None, help="Only show questions for this grade")
    p.add_argument("--k", type=int, default=DEFAULT_K, help="Number of retrieved chunks to show")
    p.add_argument("--debug", action="store_true", help="Enable DEBUG-level logs")
    p.add_argument("--only", choices=["generic", "curriculum", "both"], default="both",
                   help="which pipeline(s) to run (default: both)")
    return p.parse_args()


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #

def load_store():
    banner("STAGE 1: LOAD STORE")
    t0 = time.perf_counter()
    index = faiss.read_index(INDEX_PATH)
    dbg(f"index: ntotal={index.ntotal}, dim={index.d}, "
        f"loaded in {time.perf_counter() - t0:.3f}s")

    with open(META_PATH, encoding="utf-8") as f:
        meta = json.load(f)
    dbg(f"meta: {len(meta)} entries, "
        f"id range {min(m['id'] for m in meta)}..{max(m['id'] for m in meta)}")

    if index.ntotal != len(meta):
        log.warning(f"  !! index.ntotal ({index.ntotal}) != len(meta) ({len(meta)}) - out of sync")
    else:
        dbg("index.ntotal == len(meta)  [OK]")

    return index, meta


def load_questions(grade_filter=None):
    banner("STAGE 2: LOAD QUESTIONS")
    with open(QUESTIONS_CSV, newline="", encoding="utf-8") as f:
        questions = list(csv.DictReader(f))
    dbg(f"loaded {len(questions)} questions total")

    if grade_filter is not None:
        questions = [q for q in questions if int(q["grade"]) == grade_filter]
        log.info(f"  filtered to grade {grade_filter}: {len(questions)} questions")
    else:
        log.info(f"  {len(questions)} questions (no grade filter)")

    by_grade = Counter(int(q["grade"]) for q in questions)
    for g in sorted(by_grade):
        dbg(f"    grade {g}: {by_grade[g]} questions")

    return questions


# --------------------------------------------------------------------------- #
# Audit
# --------------------------------------------------------------------------- #

def audit_coverage(meta, questions):
    banner("STAGE 3: CONCEPT COVERAGE AUDIT")

    concepts_per_grade = defaultdict(set)
    concept_to_grades = defaultdict(set)
    concept_to_chunk_count = Counter()

    for m in meta:
        for c in m["concept_ids"]:
            concepts_per_grade[m["grade"]].add(c)
            concept_to_grades[c].add(m["grade"])
            concept_to_chunk_count[c] += 1

    log.info("Store concepts per grade:")
    for g in sorted(concepts_per_grade):
        n_chunks = sum(1 for m in meta if m["grade"] == g)
        log.info(f"  grade {g}: {len(concepts_per_grade[g])} concepts, {n_chunks} chunks")
        dbg(f"    {sorted(concepts_per_grade[g])}")

    log.info("\nQuestion concepts per grade and coverage:")
    missing_total = 0
    for g in sorted({int(q["grade"]) for q in questions}):
        q_concepts = [q["concept_id"] for q in questions if int(q["grade"]) == g]
        store_set = concepts_per_grade.get(g, set())
        missing = [c for c in q_concepts if c not in store_set]
        log.info(f"  grade {g}: {len(q_concepts)} questions, "
                 f"{len(set(q_concepts))} unique concepts, "
                 f"{len(missing)} NOT at this grade in store")
        if missing:
            missing_total += len(missing)
            for c in sorted(set(missing)):
                where = concept_to_grades.get(c, set())
                n = concept_to_chunk_count.get(c, 0)
                if where:
                    log.info(f"    missing at grade {g}: {c}  "
                             f"(exists at grade(s) {sorted(where)}, {n} chunks)")
                else:
                    log.info(f"    missing at grade {g}: {c}  (NOT in store at all)")

    if missing_total == 0:
        log.info("  All question concepts are present at their expected grade. [OK]")
    else:
        log.info(f"  !! {missing_total} question-concept(s) not at their expected grade.")

    return concepts_per_grade, concept_to_grades, concept_to_chunk_count


def audit_chunks(meta):
    banner("STAGE 4: CHUNK-SIZE AUDIT")
    lens = sorted(len(m["text"]) for m in meta)
    n = len(lens)
    log.info(f"  n={n}  min={lens[0]}  p50={lens[n // 2]}  "
             f"p90={lens[int(n * 0.9)]}  max={lens[-1]}")

    short = [m for m in meta if len(m["text"]) < SUSPICIOUS_SHORT]
    long_ = [m for m in meta if len(m["text"]) > SUSPICIOUS_LONG]
    log.info(f"  chunks < {SUSPICIOUS_SHORT} chars: {len(short)}")
    log.info(f"  chunks > {SUSPICIOUS_LONG} chars: {len(long_)}")

    if short:
        log.info("  Sample of very short chunks (possible noise):")
        for m in short[:3]:
            log.info(f"    [{m['id']}] {len(m['text'])} chars: {m['text'][:80]!r}")
    if long_:
        log.info("  Sample of very long chunks (possible merged paragraphs):")
        for m in long_[:3]:
            log.info(f"    [{m['id']}] {len(m['text'])} chars: {m['text'][:80]!r}...")


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #

def build_buckets(meta):
    buckets = defaultdict(list)
    for m in meta:
        buckets[(m["grade"], m["subject"])].append(m["id"])
    return buckets


def search_generic(index, model, text, k):
    q_vec = model.encode([text], convert_to_numpy=True, normalize_embeddings=True).astype("float32")
    scores, ids = index.search(q_vec, k)
    return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1]


def search_curriculum(index, model, buckets, text, grade, subject, k):
    allowed = buckets.get((grade, subject), [])
    if not allowed:
        return []
    q_vec = model.encode([text], convert_to_numpy=True, normalize_embeddings=True).astype("float32")
    sel = faiss.IDSelectorArray(np.array(allowed, dtype="int64"))
    params = faiss.SearchParameters(sel=sel)
    scores, ids = index.search(q_vec, min(k, len(allowed)), params=params)
    return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1]


# --------------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------------- #

def categorize(gold, retrieved, meta_by_id):
    hits = [(rank, rid) for rank, (rid, _) in enumerate(retrieved, start=1)
            if gold in meta_by_id[rid]["concept_ids"]]
    if not hits:
        return "not-retrieved"
    return f"hit-at-rank-{hits[0][0]}"


def print_pipeline(label, retrieved, meta_by_id, gold):
    log.info(f"\n  {label}:")
    if not retrieved:
        log.info("    (empty)")
        return
    if retrieved[0][1] < LOW_SCORE_THRESHOLD:
        log.info(f"    !! top-1 cosine = {retrieved[0][1]:.3f} < {LOW_SCORE_THRESHOLD}")
    for rank, (rid, score) in enumerate(retrieved, start=1):
        m = meta_by_id[rid]
        mark = "  <-- MATCHES GOLD" if gold in m["concept_ids"] else ""
        preview = m["text"][:PREVIEW_LEN].replace("\n", " ")
        log.info(f"    [{rid}] score={score:.3f} grade={m['grade']} "
                 f"concepts={m['concept_ids']} ({m['source_pdf']}): {preview}...{mark}")


# --------------------------------------------------------------------------- #
# Per-question
# --------------------------------------------------------------------------- #

def diagnose_one(q, index, meta_by_id, meta, model, concepts_in_store,
                 concept_to_grades, buckets, k, only):
    """Returns dict: {'generic': category, 'curriculum': category}."""
    gold = q["concept_id"]
    grade = int(q["grade"])
    subject = q["subject"]

    log.info(f"\n{'-' * 72}")
    log.info(f"{q['id']} (Grade {grade}, concept {gold}): {q['question']}")
    dbg(f"concept in store: {gold in concepts_in_store}")
    dbg(f"concept appears at grade(s): {sorted(concept_to_grades.get(gold, []))}")
    dbg(f"bucket size at (grade={grade}, subj={subject}): "
        f"{len(buckets.get((grade, subject), []))}")

    if gold not in concepts_in_store:
        log.info(f"  !! concept '{gold}' not in store - skipping")
        return {"generic": "concept-absent", "curriculum": "concept-absent"}

    matching = [m for m in meta if gold in m["concept_ids"]]
    same_grade = [m for m in matching if m["grade"] == grade]
    log.info(f"  {len(matching)} chunk(s) tagged '{gold}' "
             f"({len(same_grade)} at grade {grade})")
    for m in matching[:3]:
        flag = "" if m["grade"] == grade else f"  !! WRONG GRADE (grade {m['grade']})"
        preview = m["text"][:PREVIEW_LEN].replace("\n", " ")
        log.info(f"    [{m['id']}] ({m['source_pdf']}, grade {m['grade']}, "
                 f"{len(m['text'])} chars): {preview}...{flag}")
    if len(matching) > 3:
        log.info(f"    ... and {len(matching) - 3} more")

    result = {}

    if only in ("generic", "both"):
        generic = search_generic(index, model, q["question"], k)
        print_pipeline(f"Top-{k} (generic)", generic, meta_by_id, gold)
        result["generic"] = categorize(gold, generic, meta_by_id)

    if only in ("curriculum", "both"):
        bucket_size = len(buckets.get((grade, subject), []))
        curriculum = search_curriculum(index, model, buckets,
                                       q["question"], grade, subject, k)
        print_pipeline(f"Top-{k} (curriculum: grade={grade}, subj={subject}, "
                       f"bucket={bucket_size})", curriculum, meta_by_id, gold)
        result["curriculum"] = categorize(gold, curriculum, meta_by_id)

    dbg(f"categories: {result}")
    return result


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    args = parse_args()
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        log.info("[debug] DEBUG logging enabled")

    t_start = time.perf_counter()

    index, meta = load_store()
    meta_by_id = {m["id"]: m for m in meta}
    buckets = build_buckets(meta)

    concepts_in_store = {c for m in meta for c in m["concept_ids"]}
    concept_to_grades = defaultdict(set)
    for m in meta:
        for c in m["concept_ids"]:
            concept_to_grades[c].add(m["grade"])

    questions = load_questions(args.grade)
    if not questions:
        log.error("No questions match the filter. Nothing to diagnose.")
        sys.exit(1)

    audit_coverage(meta, questions)
    audit_chunks(meta)

    banner("STAGE 5: LOAD MODEL")
    from sentence_transformers import SentenceTransformer
    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL_NAME)
    dbg(f"model loaded in {time.perf_counter() - t0:.2f}s")

    banner("STAGE 6: PER-QUESTION DIAGNOSIS")
    generic_cats = Counter()
    curriculum_cats = Counter()

    for i, q in enumerate(questions, start=1):
        dbg(f"\n[{i}/{len(questions)}] {q['id']}")
        res = diagnose_one(q, index, meta_by_id, meta, model, concepts_in_store,
                           concept_to_grades, buckets, args.k, args.only)
        if "generic" in res:
            generic_cats[res["generic"]] += 1
        if "curriculum" in res:
            curriculum_cats[res["curriculum"]] += 1

    banner("SUMMARY")
    log.info(f"  Diagnosed {len(questions)} questions")

    def _print_pipeline_summary(label, cats):
        log.info(f"\n  {label}:")
        if not cats:
            log.info("    (not run)")
            return
        total = sum(cats.values())
        for cat, n in cats.most_common():
            log.info(f"    {cat}: {n}")
        hits = sum(n for c, n in cats.items() if c.startswith("hit-at-rank"))
        log.info(f"    --> hit-rate@k = {hits / total:.3f} ({hits}/{total})")

    if args.only in ("generic", "both"):
        _print_pipeline_summary("GENERIC pipeline", generic_cats)
    if args.only in ("curriculum", "both"):
        _print_pipeline_summary("CURRICULUM pipeline", curriculum_cats)

    log.info(f"\n  total wall time: {time.perf_counter() - t_start:.2f}s")

    log.info("\n  Interpretation cheat-sheet:")
    log.info("    hit-at-rank-1      -> retrieval is fine")
    log.info("    hit-at-rank-2/3    -> relevant chunk exists but outranked (reranker helps)")
    log.info("    not-retrieved      -> concept exists but no gold chunk in top-k")
    log.info("                          (chunking split text, or question phrasing too far)")
    log.info("    concept-absent     -> fix chapter_manifest.csv / add missing PDF")

    # Sanity check: hit-rates should roughly match rag_compare_faiss.py output
    if args.only == "both" and generic_cats and curriculum_cats:
        gt = sum(generic_cats.values())
        ct = sum(curriculum_cats.values())
        gh = sum(n for c, n in generic_cats.items() if c.startswith("hit-at-rank"))
        ch = sum(n for c, n in curriculum_cats.items() if c.startswith("hit-at-rank"))
        log.info(f"\n  Cross-check vs rag_compare_faiss.py:")
        log.info(f"    generic    hit-rate@k should be ~{gh / gt:.3f}" if gt else "")
        log.info(f"    curriculum hit-rate@k should be ~{ch / ct:.3f}" if ct else "")


if __name__ == "__main__":
    main()