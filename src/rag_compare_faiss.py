"""
Generic vs curriculum-aware retrieval over the FAISS vector store.
(docstring unchanged)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("rag_compare_faiss")

# Silence the httpx / HF chatter
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)

REQUIRED_QUESTION_COLUMNS = {"id", "question", "concept_id", "grade", "subject"}


def dbg(msg: str, *args) -> None:
    """Debug helper — only prints when root logger is at DEBUG."""
    log.debug("    [DBG] " + msg, *args)


def _banner(title: str) -> None:
    log.info("\n" + "=" * 72)
    log.info(title)
    log.info("=" * 72)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

@dataclass
class Config:
    index_path: Path = Path("../data/vector_store.index")
    meta_path: Path = Path("../data/vector_store_meta.json")
    questions_csv: Path = Path("../benchmark/questions.csv")
    model_name: str = "all-MiniLM-L6-v2"
    k: int = 3
    report_path: Path | None = None
    breakdown_by: list[str] = None

    def __post_init__(self):
        if self.breakdown_by is None:
            self.breakdown_by = []


def parse_args(argv: list[str] | None = None) -> Config:
    d = Config()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--index-path", type=Path, default=d.index_path)
    p.add_argument("--meta-path", type=Path, default=d.meta_path)
    p.add_argument("--questions", type=Path, default=d.questions_csv, dest="questions_csv")
    p.add_argument("--model", default=d.model_name, dest="model_name")
    p.add_argument("--k", type=int, default=d.k)
    p.add_argument("--report", type=Path, default=d.report_path, dest="report_path",
                    help="optional path to write a JSON results report")
    p.add_argument("--by", action="append", choices=["grade", "subject"], dest="breakdown_by",
                    default=[], help="also break results down by this field (repeatable)")
    p.add_argument("--debug", action="store_true", help="Enable DEBUG-level logs")
    args = p.parse_args(argv)

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        log.info("[debug] DEBUG logging enabled")

    cfg = Config(**{k: v for k, v in vars(args).items() if k != "debug"})
    return cfg


# --------------------------------------------------------------------------- #
# Store / questions loading
# --------------------------------------------------------------------------- #

def load_store(cfg: Config):
    import faiss

    dbg(f"index_path: {cfg.index_path.resolve()}  (exists={cfg.index_path.exists()})")
    dbg(f"meta_path : {cfg.meta_path.resolve()}  (exists={cfg.meta_path.exists()})")

    if not cfg.index_path.exists() or not cfg.meta_path.exists():
        raise FileNotFoundError(
            f"Vector store not found ({cfg.index_path}, {cfg.meta_path}). "
            "Run build_vector_store.py first."
        )

    t0 = time.perf_counter()
    index = faiss.read_index(str(cfg.index_path))
    dbg(f"faiss.read_index in {time.perf_counter() - t0:.3f}s -> ntotal={index.ntotal}, dim={index.d}")

    with open(cfg.meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    dbg(f"meta entries: {len(meta)}")
    dbg(f"meta id range: {min(m['id'] for m in meta)}..{max(m['id'] for m in meta)}")

    if index.ntotal != len(meta):
        log.warning(
            f"Index has {index.ntotal} vectors but metadata has {len(meta)} entries - "
            "they may be out of sync. Consider rebuilding."
        )
    else:
        dbg("index.ntotal == len(meta)  [OK]")

    return index, meta


@dataclass
class Question:
    id: str
    text: str
    concept_id: str
    grade: int
    subject: str


def load_questions(questions_csv: Path) -> list[Question]:
    dbg(f"opening questions: {questions_csv.resolve()}  (exists={questions_csv.exists()})")
    if not questions_csv.exists():
        raise FileNotFoundError(f"Questions file not found: {questions_csv}")

    with open(questions_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        dbg(f"questions.csv columns: {fieldnames}")

        missing = REQUIRED_QUESTION_COLUMNS - set(fieldnames)
        if missing:
            raise ValueError(f"questions.csv is missing required column(s): {', '.join(sorted(missing))}")

        questions = []
        total_rows = 0
        for i, raw in enumerate(reader, start=2):
            total_rows += 1
            try:
                grade = int(raw["grade"])
            except (ValueError, TypeError):
                log.warning(f"  [questions] row {i} ({raw.get('id', '?')}): invalid grade, skipping")
                continue
            if not raw["question"].strip():
                log.warning(f"  [questions] row {i} ({raw.get('id', '?')}): empty question text, skipping")
                continue
            q = Question(
                id=raw["id"],
                text=raw["question"],
                concept_id=raw["concept_id"].strip(),
                grade=grade,
                subject=raw["subject"].strip(),
            )
            questions.append(q)
            dbg(f"row {i}: id={q.id} concept={q.concept_id} grade={q.grade} subj={q.subject} q='{q.text[:60]}...'")

    dbg(f"loaded {len(questions)} usable questions out of {total_rows} data rows")
    return questions


# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #

def embed_query(model, text: str):
    vec = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)
    return vec.astype("float32")


def search_generic(index, model, question: str, k: int) -> list[int]:
    q_vec = embed_query(model, question)
    _, ids = index.search(q_vec, k)
    out = [int(i) for i in ids[0] if i != -1]
    dbg(f"generic: k={k} returned {len(out)} ids -> {out}")
    return out


def search_curriculum_aware(index, model, matching_ids_by_key: dict, question: str,
                             grade: int, subject: str, k: int) -> list[int]:
    import faiss
    import numpy as np

    matching_ids = matching_ids_by_key.get((grade, subject), [])
    dbg(f"curriculum filter (grade={grade}, subject={subject}): "
        f"{len(matching_ids)} candidate chunks in store")

    if not matching_ids:
        log.warning(f"    curriculum filter empty for (grade={grade}, subject={subject}) "
                    f"- falling back to unrestricted search")
        return search_generic(index, model, question, k)

    q_vec = embed_query(model, question)
    selector = faiss.IDSelectorArray(np.array(matching_ids, dtype="int64"))
    params = faiss.SearchParameters(sel=selector)

    effective_k = min(k, len(matching_ids))
    if effective_k < k:
        dbg(f"effective_k reduced from {k} to {effective_k} (fewer candidates than k)")

    _, ids = index.search(q_vec, effective_k, params=params)
    out = [int(i) for i in ids[0] if i != -1]
    dbg(f"curriculum: k={effective_k} returned {len(out)} ids -> {out}")
    return out


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def is_relevant(chunk_id: int, meta_by_id: dict, gold_concept_id: str) -> bool:
    if chunk_id not in meta_by_id:
        log.warning(f"    retrieved chunk_id {chunk_id} not present in meta - treating as irrelevant")
        return False
    return gold_concept_id in meta_by_id[chunk_id]["concept_ids"]


def score(retrieved_ids: list[int], meta_by_id: dict, gold_concept_id: str) -> dict:
    if not retrieved_ids:
        return {"precision": 0.0, "hit_rate": 0.0, "mrr": 0.0}

    relevant_flags = [is_relevant(cid, meta_by_id, gold_concept_id) for cid in retrieved_ids]
    precision = sum(relevant_flags) / len(retrieved_ids)
    hit_rate = 1.0 if any(relevant_flags) else 0.0
    mrr = next((1.0 / (rank + 1) for rank, hit in enumerate(relevant_flags) if hit), 0.0)

    # Sanity checks — cheap, catches silent math bugs
    assert 0.0 <= precision <= 1.0, f"precision out of range: {precision}"
    assert hit_rate in (0.0, 1.0), f"hit_rate not 0/1: {hit_rate}"
    assert 0.0 <= mrr <= 1.0, f"mrr out of range: {mrr}"

    return {"precision": precision, "hit_rate": hit_rate, "mrr": mrr}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate(per_question: list[dict]) -> dict:
    if not per_question:
        return {"precision": 0.0, "hit_rate": 0.0, "mrr": 0.0, "n": 0}
    return {
        "precision": _mean([r["precision"] for r in per_question]),
        "hit_rate": _mean([r["hit_rate"] for r in per_question]),
        "mrr": _mean([r["mrr"] for r in per_question]),
        "n": len(per_question),
    }


# --------------------------------------------------------------------------- #
# Run
# --------------------------------------------------------------------------- #

def run(cfg: Config) -> dict:
    t_start = time.perf_counter()

    _banner("STAGE 0: CONFIG RESOLUTION")
    log.info(f"  index_path   : {cfg.index_path.resolve()}")
    log.info(f"  meta_path    : {cfg.meta_path.resolve()}")
    log.info(f"  questions    : {cfg.questions_csv.resolve()}")
    log.info(f"  model_name   : {cfg.model_name}")
    log.info(f"  k            : {cfg.k}")
    log.info(f"  report_path  : {cfg.report_path.resolve() if cfg.report_path else '(none)'}")
    log.info(f"  breakdown_by : {cfg.breakdown_by or '(none)'}")
    log.info(f"  cwd          : {Path.cwd()}")

    _banner("STAGE 1: LOAD STORE")
    index, meta = load_store(cfg)
    meta_by_id = {m["id"]: m for m in meta}
    dbg(f"meta_by_id built with {len(meta_by_id)} entries")

    _banner("STAGE 2: LOAD QUESTIONS")
    questions = load_questions(cfg.questions_csv)
    if not questions:
        log.error("No usable questions found. Nothing to evaluate.")
        sys.exit(1)
    log.info(f"  {len(questions)} questions loaded")

    _banner("STAGE 3: LOAD MODEL")
    log.info(f"  loading model '{cfg.model_name}' ...")
    t_model = time.perf_counter()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(cfg.model_name)
    dbg(f"model loaded in {time.perf_counter() - t_model:.2f}s")

    _banner("STAGE 4: INDEX METADATA")
    matching_ids_by_key: dict[tuple[int, str], list[int]] = defaultdict(list)
    for m in meta:
        matching_ids_by_key[(m["grade"], m["subject"])].append(m["id"])
    log.info(f"  distinct (grade, subject) buckets in store: {len(matching_ids_by_key)}")
    for key, ids in sorted(matching_ids_by_key.items()):
        dbg(f"    {key}: {len(ids)} chunks")

    concepts_in_store = {cid for m in meta for cid in m["concept_ids"]}
    log.info(f"  distinct concepts in store: {len(concepts_in_store)}")

    q_concepts = {q.concept_id for q in questions}
    missing_concepts = q_concepts - concepts_in_store
    dbg(f"question concepts total={len(q_concepts)}, "
        f"covered={len(q_concepts) - len(missing_concepts)}, "
        f"missing={len(missing_concepts)}")
    if missing_concepts:
        dbg(f"missing concept_ids (sample): {sorted(missing_concepts)[:10]}")

    _banner("STAGE 5: RETRIEVE + SCORE")
    per_question: list[dict] = []
    skipped: list[tuple[str, str]] = []

    # track filter effectiveness
    n_filtered = 0
    n_fallback = 0
    reductions: list[float] = []

    for i, q in enumerate(questions, start=1):
        dbg(f"\n[{i}/{len(questions)}] id={q.id} concept={q.concept_id} "
            f"grade={q.grade} subj={q.subject}")
        dbg(f"    question: {q.text[:120]}{'...' if len(q.text) > 120 else ''}")

        if q.concept_id not in concepts_in_store:
            dbg(f"    SKIP - concept '{q.concept_id}' not present in store")
            skipped.append((q.id, q.concept_id))
            continue

        generic_ids = search_generic(index, model, q.text, cfg.k)
        total_chunks = index.ntotal
        candidates_before = total_chunks

        curriculum_ids = search_curriculum_aware(
            index, model, matching_ids_by_key, q.text, q.grade, q.subject, cfg.k
        )
        candidates_after = len(matching_ids_by_key.get((q.grade, q.subject), []))
        if candidates_after and candidates_after < candidates_before:
            n_filtered += 1
            reductions.append(1.0 - candidates_after / candidates_before)
        elif not candidates_after:
            n_fallback += 1

        generic_score = score(generic_ids, meta_by_id, q.concept_id)
        curriculum_score = score(curriculum_ids, meta_by_id, q.concept_id)

        dbg(f"    generic   : {generic_score}")
        dbg(f"    curriculum: {curriculum_score}")

        # Show which retrieved chunks were relevant (DEBUG only)
        if log.isEnabledFor(logging.DEBUG):
            for label, ids in (("gen", generic_ids), ("cur", curriculum_ids)):
                for rank, cid in enumerate(ids, start=1):
                    rel = is_relevant(cid, meta_by_id, q.concept_id)
                    m = meta_by_id.get(cid, {})
                    dbg(f"      {label} rank{rank} chunk={cid} "
                        f"relevant={rel} pdf={m.get('source_pdf','?')} "
                        f"concepts={m.get('concept_ids',[])}")

        per_question.append({
            "id": q.id,
            "concept_id": q.concept_id,
            "grade": q.grade,
            "subject": q.subject,
            "generic": generic_score,
            "curriculum": curriculum_score,
        })

    _banner("STAGE 6: AGGREGATE + REPORT")
    if n_filtered:
        avg_reduction = _mean(reductions) * 100
        log.info(f"  curriculum filter narrowed candidates on {n_filtered}/{len(per_question)} "
                 f"questions (avg reduction {avg_reduction:.1f}%)")
    if n_fallback:
        log.warning(f"  curriculum filter fell back to unrestricted on {n_fallback} questions "
                    f"(no matching grade/subject in store)")

    report = _build_report(per_question, skipped, len(questions), cfg)
    _print_report(report, cfg)

    if cfg.report_path:
        cfg.report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cfg.report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        size_kb = cfg.report_path.stat().st_size / 1024
        log.info(f"\nWrote full report to {cfg.report_path} ({size_kb:.1f} KB, "
                 f"{len(per_question)} per-question entries)")

    log.info(f"\n  total wall time: {time.perf_counter() - t_start:.2f}s")
    return report


def _build_report(per_question: list[dict], skipped: list[tuple[str, str]],
                   total_questions: int, cfg: Config) -> dict:
    overall = {
        "generic": aggregate([r["generic"] for r in per_question]),
        "curriculum": aggregate([r["curriculum"] for r in per_question]),
    }
    dbg(f"overall: {overall}")

    breakdown = {}
    for field in cfg.breakdown_by:
        groups: dict = defaultdict(list)
        for r in per_question:
            groups[r[field]].append(r)
        breakdown[field] = {
            str(key): {
                "generic": aggregate([r["generic"] for r in rows]),
                "curriculum": aggregate([r["curriculum"] for r in rows]),
            }
            for key, rows in sorted(groups.items(), key=lambda kv: str(kv[0]))
        }
        dbg(f"breakdown[{field}] groups: {list(breakdown[field].keys())}")

    return {
        "k": cfg.k,
        "model": cfg.model_name,
        "evaluated": len(per_question),
        "total_questions": total_questions,
        "skipped": [{"id": qid, "concept_id": cid} for qid, cid in skipped],
        "overall": overall,
        "breakdown": breakdown,
        "per_question": per_question,
    }


def _print_report(report: dict, cfg: Config) -> None:
    log.info(
        f"\nEvaluated {report['evaluated']}/{report['total_questions']} questions "
        f"({len(report['skipped'])} skipped - concept not yet in vector store)\n"
    )

    _print_table(report["overall"], cfg.k)

    for field, groups in report["breakdown"].items():
        log.info(f"\nBy {field}:")
        for key, vals in groups.items():
            n = vals["generic"]["n"]
            log.info(f"  {field} = {key} (n={n})")
            _print_table(vals, cfg.k, indent="    ")

    if report["skipped"]:
        log.info("\nStill need PDFs processed for these concepts:")
        for s in report["skipped"]:
            log.info(f"  {s['id']}: concept {s['concept_id']}")


def _print_table(overall: dict, k: int, indent: str = "") -> None:
    for pipeline in ("generic", "curriculum"):
        vals = overall[pipeline]
        if vals["n"] == 0:
            log.info(f"{indent}{pipeline:>12}: no evaluable questions")
            continue
        log.info(
            f"{indent}{pipeline:>12} | Precision@{k}: {vals['precision']:.3f} "
            f"| Hit-Rate@{k} (recall proxy): {vals['hit_rate']:.3f} "
            f"| MRR: {vals['mrr']:.3f}"
        )


def main(argv: list[str] | None = None) -> None:
    cfg = parse_args(argv)
    try:
        run(cfg)
    except (FileNotFoundError, ValueError) as e:
        log.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()