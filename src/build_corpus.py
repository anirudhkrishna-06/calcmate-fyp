"""
Step 5 replacement: interactive chunk tagging.

Splits extracted .txt files (from extract_pdf_text.py) into candidate
paragraph-level chunks, shows you each one, and lets you tag it with a
concept_id in one keystroke - instead of manually copy-pasting text into
a Python list.

Usage:
    python build_corpus.py ../pdfs/grade4_fractions.txt

Appends accepted chunks to data/chunks.csv (creates it if missing).
Run this once per extracted .txt file.

Controls at each prompt:
    <concept_id>   e.g. "M408"  -> tag and save this chunk
    s              -> skip this chunk (not useful content)
    q              -> stop tagging this file (save progress so far)
"""

import csv
import re
import sys
from pathlib import Path

CONCEPTS_CSV = "../data/concepts.csv"
CHUNKS_CSV = "../data/chunks.csv"
MIN_CHUNK_LEN = 80   # skip very short fragments (headers, page numbers)
MAX_PREVIEW = 400    # characters shown per chunk while tagging


def load_valid_concept_ids():
    with open(CONCEPTS_CSV, newline="", encoding="utf-8") as f:
        return {row["id"]: row["concept"] for row in csv.DictReader(f)}


def split_into_candidates(text: str):
    """Split on blank lines / page markers into paragraph-level candidates."""
    text = re.sub(r"--- Page \d+ ---", "\n", text)
    raw_parts = re.split(r"\n\s*\n", text)
    candidates = [p.strip().replace("\n", " ") for p in raw_parts]
    return [c for c in candidates if len(c) >= MIN_CHUNK_LEN]


def next_chunk_id(existing_rows):
    nums = [int(r["chunk_id"][1:]) for r in existing_rows if r["chunk_id"].startswith("C")]
    return f"C{(max(nums) + 1) if nums else 1}"


def load_existing_chunks():
    path = Path(CHUNKS_CSV)
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_chunks(rows):
    with open(CHUNKS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["chunk_id", "text", "grade", "subject", "concept_id"])
        writer.writeheader()
        writer.writerows(rows)


def tag_file(txt_path: str):
    valid_ids = load_valid_concept_ids()
    existing = load_existing_chunks()
    candidates = split_into_candidates(Path(txt_path).read_text(encoding="utf-8"))

    print(f"\nFound {len(candidates)} candidate chunks in {txt_path}\n")
    print("Reference: type a concept_id (e.g. M408) to tag, 's' to skip, 'q' to quit+save\n")

    for i, chunk_text in enumerate(candidates, start=1):
        preview = chunk_text[:MAX_PREVIEW]
        print(f"\n--- Candidate {i}/{len(candidates)} ---")
        print(preview + ("..." if len(chunk_text) > MAX_PREVIEW else ""))

        while True:
            answer = input("\nconcept_id / s / q > ").strip()
            if answer.lower() == "q":
                save_chunks(existing)
                print(f"\nSaved {len(existing)} chunks total to {CHUNKS_CSV}. Stopping early.")
                return
            if answer.lower() == "s":
                break
            if answer in valid_ids:
                cid = next_chunk_id(existing)
                # infer grade/subject from concepts.csv via the concept's row
                with open(CONCEPTS_CSV, newline="", encoding="utf-8") as f:
                    concept_row = next(r for r in csv.DictReader(f) if r["id"] == answer)
                existing.append({
                    "chunk_id": cid,
                    "text": chunk_text,
                    "grade": concept_row["grade"],
                    "subject": concept_row["subject"],
                    "concept_id": answer,
                })
                print(f"Tagged as {cid} -> {answer} ({valid_ids[answer]})")
                break
            print(f"'{answer}' is not a known concept_id. Check data/concepts.csv, or use 's'/'q'.")

    save_chunks(existing)
    print(f"\nDone. Saved {len(existing)} chunks total to {CHUNKS_CSV}.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python build_corpus.py <path_to_extracted_txt_file>")
        sys.exit(1)
    tag_file(sys.argv[1])
