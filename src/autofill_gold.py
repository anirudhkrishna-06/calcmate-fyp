"""
Step 6 replacement: auto-fill gold_chunk_id in questions.csv.

For each question, finds chunks in data/chunks.csv whose concept_id
matches the question's concept_id.
    - Exactly one match  -> auto-filled automatically.
    - Zero matches       -> flagged; you haven't tagged that concept's
                             chunk yet (go back to build_corpus.py).
    - Multiple matches   -> shown to you interactively with text previews
                             so you can pick the best one in one keystroke,
                             instead of hunting through chunks.csv by hand.

Usage:
    python autofill_gold.py

Overwrites benchmark/questions.csv in place (only the gold_chunk_id column).
"""

import csv

CHUNKS_CSV = "../data/chunks.csv"
QUESTIONS_CSV = "../benchmark/questions.csv"
PREVIEW_LEN = 160


def resolve_ambiguous(question_text, matches_with_text):
    """Show numbered previews of each candidate chunk and let the user
    pick one interactively. Returns the chosen chunk_id, or None if skipped."""
    print(f"\nQuestion: {question_text}")
    print(f"{len(matches_with_text)} chunks match this concept - which one best answers it?\n")

    for i, (cid, text) in enumerate(matches_with_text, start=1):
        preview = text[:PREVIEW_LEN].replace("\n", " ")
        print(f"  [{i}] {cid}: {preview}{'...' if len(text) > PREVIEW_LEN else ''}")

    while True:
        answer = input(f"\nPick 1-{len(matches_with_text)}, or 's' to skip for now > ").strip().lower()
        if answer == "s":
            return None
        if answer.isdigit() and 1 <= int(answer) <= len(matches_with_text):
            return matches_with_text[int(answer) - 1][0]
        print("Invalid choice, try again.")


def main():
    with open(CHUNKS_CSV, newline="", encoding="utf-8") as f:
        chunks = list(csv.DictReader(f))

    with open(QUESTIONS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        questions = list(reader)

    no_chunk_yet = []

    for q in questions:
        if q.get("gold_chunk_id", "").strip():
            continue  # already resolved in a previous run - don't re-ask

        matches = [(c["chunk_id"], c["text"]) for c in chunks if c["concept_id"] == q["concept_id"]]

        if len(matches) == 1:
            q["gold_chunk_id"] = matches[0][0]
        elif len(matches) == 0:
            no_chunk_yet.append((q["id"], q["concept_id"]))
        else:
            chosen = resolve_ambiguous(q["question"], matches)
            if chosen:
                q["gold_chunk_id"] = chosen

    with open(QUESTIONS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(questions)

    filled = sum(1 for q in questions if q["gold_chunk_id"])
    print(f"\n{filled}/{len(questions)} gold labels now filled.")

    if no_chunk_yet:
        print("\nStill need chapters tagged for these concepts:")
        for qid, cid in no_chunk_yet:
            print(f"  {qid}: concept {cid}")


if __name__ == "__main__":
    main()



if __name__ == "__main__":
    main()