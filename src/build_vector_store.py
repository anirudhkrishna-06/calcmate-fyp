"""
Build the FAISS vector store directly from NCERT chapter PDFs.
... (docstring unchanged)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# --------------------------------------------------------------------------- #
# Logging setup — DEBUG level available via --debug
# --------------------------------------------------------------------------- #
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("build_vector_store")

REQUIRED_MANIFEST_COLUMNS = {"pdf_filename", "concept_ids", "grade", "subject"}


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
    manifest_csv: Path = Path("../data/chapter_manifest.csv")
    pdf_dir: Path = Path("../pdfs")
    index_path: Path = Path("../data/vector_store.index")
    meta_path: Path = Path("../data/vector_store_meta.json")
    model_name: str = "all-MiniLM-L6-v2"

    min_paragraph_len: int = 80
    window_words: int = 180
    window_overlap: int = 40
    min_paragraphs_for_split: int = 3

    def parser_defaults(self) -> dict:
        return self.__dict__


def parse_args(argv: list[str] | None = None) -> Config:
    defaults = Config()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--manifest", type=Path, default=defaults.manifest_csv, dest="manifest_csv")
    p.add_argument("--pdf-dir", type=Path, default=defaults.pdf_dir, dest="pdf_dir")
    p.add_argument("--index-path", type=Path, default=defaults.index_path)
    p.add_argument("--meta-path", type=Path, default=defaults.meta_path)
    p.add_argument("--model", default=defaults.model_name, dest="model_name")
    p.add_argument("--min-paragraph-len", type=int, default=defaults.min_paragraph_len)
    p.add_argument("--window-words", type=int, default=defaults.window_words)
    p.add_argument("--window-overlap", type=int, default=defaults.window_overlap)
    p.add_argument("--debug", action="store_true", help="Enable DEBUG-level logs")
    args = p.parse_args(argv)

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        log.info("[debug] DEBUG logging enabled")

    cfg = Config(**{k: v for k, v in vars(args).items() if k != "debug"})
    return cfg


# --------------------------------------------------------------------------- #
# PDF extraction
# --------------------------------------------------------------------------- #

def extract_text(pdf_path: Path) -> str:
    import pdfplumber

    dbg(f"opening PDF: {pdf_path}")
    parts = []
    empty_pages = 0
    with pdfplumber.open(pdf_path) as pdf:
        dbg(f"page count: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            parts.append(text)
            n = len(text)
            dbg(f"page {i + 1}/{len(pdf.pages)}: {n} chars")
            if not text.strip():
                empty_pages += 1
                log.warning(f"    page {i + 1}: no extractable text (scanned image? needs OCR)")
    joined = "\n".join(parts)
    dbg(f"extracted {len(joined)} total chars ({empty_pages} empty pages)")
    return joined


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #

def _dehyphenate(text: str) -> str:
    return re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)


def _clean(text: str) -> str:
    text = re.sub(r"--- Page \d+ ---", "\n", text)
    text = _dehyphenate(text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def chunk_text(text: str, cfg: Config) -> list[str]:
    text = _clean(text)
    dbg(f"after clean: {len(text)} chars")

    raw_paragraphs = re.split(r"\n\s*\n", text)
    dbg(f"raw paragraph splits: {len(raw_paragraphs)}")

    paragraphs = [p.strip().replace("\n", " ") for p in raw_paragraphs]
    kept = [p for p in paragraphs if len(p) >= cfg.min_paragraph_len]
    dbg(f"paragraphs kept (>= {cfg.min_paragraph_len} chars): {len(kept)} / {len(paragraphs)}")

    if kept:
        lens = sorted(len(p) for p in kept)
        dbg(f"paragraph length min/median/max: {lens[0]}/{lens[len(lens)//2]}/{lens[-1]}")

    if len(kept) >= cfg.min_paragraphs_for_split:
        dbg(f"STRATEGY: paragraph split ({len(kept)} paragraphs)")
        return _dedupe(kept)

    dbg(f"STRATEGY: sliding window (only {len(kept)} paragraphs, need {cfg.min_paragraphs_for_split})")
    words = text.split()
    dbg(f"total words: {len(words)}")
    chunks = []
    step = max(cfg.window_words - cfg.window_overlap, 1)
    for start in range(0, len(words), step):
        window = " ".join(words[start:start + cfg.window_words])
        if len(window) >= cfg.min_paragraph_len:
            chunks.append(window)
    dbg(f"window chunks produced: {len(chunks)} (step={step})")
    return _dedupe(chunks)


def _dedupe(chunks: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    dropped = 0
    for c in chunks:
        if c not in seen:
            seen.add(c)
            out.append(c)
        else:
            dropped += 1
    dbg(f"dedupe: kept {len(out)}, dropped {dropped} duplicates")
    return out


# --------------------------------------------------------------------------- #
# Manifest handling
# --------------------------------------------------------------------------- #

@dataclass
class ChapterRow:
    pdf_filename: str
    concept_ids: list[str]
    grade: int
    subject: str


def load_manifest(manifest_csv: Path) -> list[ChapterRow]:
    if not manifest_csv.exists():
        raise FileNotFoundError(
            f"Manifest not found at {manifest_csv}. Create it with columns: "
            f"{', '.join(sorted(REQUIRED_MANIFEST_COLUMNS))}"
        )

    dbg(f"opening manifest: {manifest_csv}")

    with open(manifest_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        dbg(f"manifest columns: {fieldnames}")

        missing = REQUIRED_MANIFEST_COLUMNS - set(fieldnames)
        if missing:
            raise ValueError(f"Manifest is missing required column(s): {', '.join(sorted(missing))}")

        rows = []
        seen_filenames: set[str] = set()
        total_rows = 0
        for i, raw in enumerate(reader, start=2):
            total_rows += 1
            filename = raw["pdf_filename"].strip()
            dbg(f"row {i}: pdf_filename='{filename}' grade='{raw['grade']}' subject='{raw['subject']}' concept_ids='{raw['concept_ids']}'")

            if not filename:
                log.warning(f"  [manifest] row {i}: empty pdf_filename, skipping")
                continue
            if filename in seen_filenames:
                log.warning(f"  [manifest] row {i}: duplicate pdf_filename '{filename}'")
            seen_filenames.add(filename)

            try:
                grade = int(raw["grade"])
            except (ValueError, TypeError):
                log.warning(f"  [manifest] row {i}: invalid grade '{raw['grade']}', skipping row")
                continue

            concept_ids = [c.strip() for c in raw["concept_ids"].split(";") if c.strip()]
            if not concept_ids:
                log.warning(f"  [manifest] row {i}: no concept_ids for '{filename}', skipping row")
                continue

            rows.append(ChapterRow(
                pdf_filename=filename,
                concept_ids=concept_ids,
                grade=grade,
                subject=raw["subject"].strip(),
            ))

    dbg(f"manifest: {len(rows)} usable rows out of {total_rows} data rows")
    return rows


# --------------------------------------------------------------------------- #
# Build pipeline
# --------------------------------------------------------------------------- #

def process_chapter(row: ChapterRow, cfg: Config) -> tuple[list[str], list[dict]]:
    pdf_path = cfg.pdf_dir / row.pdf_filename
    dbg(f"resolving PDF: {pdf_path} (exists={pdf_path.exists()})")
    if not pdf_path.exists():
        log.warning(f"  [skip] {pdf_path} not found - download it first")
        return [], []

    log.info(f"  Processing {row.pdf_filename} ...")
    t0 = time.perf_counter()
    try:
        raw_text = extract_text(pdf_path)
    except Exception as e:
        log.error(f"    [error] could not read {row.pdf_filename}: {e}")
        return [], []

    if not raw_text.strip():
        log.warning(f"    [skip] {row.pdf_filename} produced no text at all (likely scanned; needs OCR)")
        return [], []

    chunks = chunk_text(raw_text, cfg)
    dt = time.perf_counter() - t0

    if chunks:
        lens = [len(c) for c in chunks]
        dbg(f"chunk length min/avg/max: {min(lens)}/{sum(lens)//len(lens)}/{max(lens)}")

    meta = [
        {
            "concept_ids": row.concept_ids,
            "grade": row.grade,
            "subject": row.subject,
            "source_pdf": row.pdf_filename,
            "chunk_index": idx,
            "char_count": len(chunk),
        }
        for idx, chunk in enumerate(chunks)
    ]
    log.info(f"    -> {len(chunks)} chunks in {dt:.2f}s")
    return chunks, meta


def build(cfg: Config) -> None:
    t_start = time.perf_counter()

    _banner("STAGE 0: CONFIG RESOLUTION")
    log.info(f"  manifest_csv : {cfg.manifest_csv.resolve()}")
    log.info(f"  pdf_dir      : {cfg.pdf_dir.resolve()}")
    log.info(f"  index_path   : {cfg.index_path.resolve()}")
    log.info(f"  meta_path    : {cfg.meta_path.resolve()}")
    log.info(f"  model_name   : {cfg.model_name}")
    log.info(f"  cwd          : {Path.cwd()}")

    _banner("STAGE 1: LOAD MANIFEST")
    manifest = load_manifest(cfg.manifest_csv)
    if not manifest:
        log.error("Manifest has no usable rows. Nothing to build.")
        sys.exit(1)
    log.info(f"  {len(manifest)} chapters queued")

    _banner("STAGE 2: EXTRACT + CHUNK PDFs")
    all_texts: list[str] = []
    all_meta: list[dict] = []
    skipped: list[str] = []

    for row in manifest:
        chunks, meta = process_chapter(row, cfg)
        if not chunks:
            skipped.append(row.pdf_filename)
        all_texts.extend(chunks)
        all_meta.extend(meta)

    log.info(f"\n  total chunks: {len(all_texts)}")
    if skipped:
        log.warning(f"  skipped/missing PDFs ({len(skipped)}): {', '.join(skipped)}")

    if not all_texts:
        log.error(
            f"\nNo chunks produced. Check that PDFs exist in "
            f"{cfg.pdf_dir.resolve()}/ matching {cfg.manifest_csv.resolve()}."
        )
        sys.exit(1)

    _banner("STAGE 3: EMBED")
    log.info(f"  loading model: {cfg.model_name}")
    t_model = time.perf_counter()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(cfg.model_name)
    dbg(f"model loaded in {time.perf_counter() - t_model:.2f}s")

    log.info(f"  embedding {len(all_texts)} chunks ...")
    t_embed = time.perf_counter()
    embeddings = model.encode(
        all_texts, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=True
    ).astype("float32")
    dbg(f"embeddings shape: {embeddings.shape}, dtype: {embeddings.dtype}")
    dbg(f"embedding time: {time.perf_counter() - t_embed:.2f}s")
    log.info(f"  embedded in {time.perf_counter() - t_embed:.2f}s  shape={embeddings.shape}")

    _banner("STAGE 4: WRITE FAISS INDEX")
    _write_index(embeddings, cfg.index_path)
    size_kb = cfg.index_path.stat().st_size / 1024
    log.info(f"  wrote {cfg.index_path}  ({size_kb:.1f} KB, dim={embeddings.shape[1]})")

    _banner("STAGE 5: WRITE METADATA")
    _write_meta(all_texts, all_meta, cfg.meta_path)
    meta_kb = cfg.meta_path.stat().st_size / 1024
    log.info(f"  wrote {cfg.meta_path}  ({meta_kb:.1f} KB, {len(all_meta)} entries)")

    if log.isEnabledFor(logging.DEBUG) and all_meta:
        dbg("sample meta entry (first):")
        sample = dict(all_meta[0])
        sample["text"] = sample["text"][:120] + "..."
        for k, v in sample.items():
            dbg(f"  {k}: {v}")

    _banner("SUMMARY")
    _print_summary(all_meta, embeddings.shape[1], cfg)
    log.info(f"\n  total wall time: {time.perf_counter() - t_start:.2f}s")


def _write_index(embeddings, index_path: Path) -> None:
    import faiss
    import numpy as np

    index_path.parent.mkdir(parents=True, exist_ok=True)
    dim = embeddings.shape[1]
    dbg(f"creating IndexIDMap(IndexFlatIP) with dim={dim}")
    index = faiss.IndexIDMap(faiss.IndexFlatIP(dim))
    ids = np.arange(len(embeddings))
    dbg(f"adding {len(ids)} vectors with ids 0..{ids[-1] if len(ids) else -1}")
    index.add_with_ids(embeddings, ids)
    dbg(f"index ntotal after add: {index.ntotal}")
    faiss.write_index(index, str(index_path))
    dbg(f"faiss.write_index complete -> {index_path}")


def _write_meta(texts: list[str], meta: list[dict], meta_path: Path) -> None:
    dbg(f"attaching {len(texts)} texts to {len(meta)} meta dicts")
    for i, m in enumerate(meta):
        m["id"] = i
        m["text"] = texts[i]

    meta_path.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    dbg(f"json.dump complete -> {meta_path}")


def _print_summary(meta: list[dict], dim: int, cfg: Config) -> None:
    by_subject: dict[str, int] = {}
    for m in meta:
        by_subject[m["subject"]] = by_subject.get(m["subject"], 0) + 1
    avg_len = sum(m["char_count"] for m in meta) / len(meta)

    log.info(f"  index path  : {cfg.index_path}")
    log.info(f"  meta path   : {cfg.meta_path}")
    log.info(f"  vectors     : {len(meta)}")
    log.info(f"  dimension   : {dim}")
    log.info(f"  avg chunk   : {avg_len:.0f} chars")
    log.info("  by subject  :")
    for subject, count in sorted(by_subject.items()):
        log.info(f"    {subject}: {count}")


def main(argv: list[str] | None = None) -> None:
    cfg = parse_args(argv)
    try:
        build(cfg)
    except (FileNotFoundError, ValueError) as e:
        log.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()