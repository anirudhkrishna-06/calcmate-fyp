"""
eval_threshold.py - pick MIN_SCORE_THRESHOLD from real data.

Reads data/retrieval_log.jsonl (populated automatically by retrieve.py)
and, IF you've hand-labeled each logged query as "should have answered"
or "should have refused", computes the precision/recall tradeoff at
each candidate threshold and prints the best one.

Usage:
    # 1. Have retrieved at least 30 real queries (log accumulates passively)
    # 2. Create data/threshold_labels.csv with columns: ts,label
    #    label = "answer" | "refuse"
    # 3. Run:
    python eval_threshold.py

This is intentionally a skeleton - it becomes useful once you have data.
Until then, MIN_SCORE_THRESHOLD = 0.30 (see copilot.py) remains a guess
and MUST be described as such in the report.
"""

import csv
import json
from pathlib import Path

LOG_PATH = Path("../data/retrieval_log.jsonl")
LABELS_PATH = Path("../data/threshold_labels.csv")


def load_log():
    if not LOG_PATH.exists():
        raise SystemExit(f"No log at {LOG_PATH}. Run some queries first.")
    entries = []
    with open(LOG_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def load_labels():
    if not LABELS_PATH.exists():
        raise SystemExit(
            f"No labels at {LABELS_PATH}. Create it with columns: ts,label "
            f"(label = 'answer' | 'refuse'). See docstring."
        )
    with open(LABELS_PATH, encoding="utf-8") as f:
        return {float(r["ts"]): r["label"] for r in csv.DictReader(f)}


def main():
    log = load_log()
    labels = load_labels()

    labeled = [(e["top_score"], labels[e["ts"]]) for e in log if e["ts"] in labels]
    if len(labeled) < 10:
        raise SystemExit(
            f"Only {len(labeled)} labeled entries - need at least 10 "
            f"(ideally 30+) to pick a threshold sensibly."
        )

    print(f"Tuning threshold on {len(labeled)} labeled queries")
    print(f"  should-answer: {sum(1 for _, l in labeled if l == 'answer')}")
    print(f"  should-refuse: {sum(1 for _, l in labeled if l == 'refuse')}\n")

    best = None
    for t in [x / 100 for x in range(10, 91, 5)]:
        tp = sum(1 for s, l in labeled if s >= t and l == "answer")
        fp = sum(1 for s, l in labeled if s >= t and l == "refuse")
        fn = sum(1 for s, l in labeled if s < t and l == "answer")
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        print(f"  threshold={t:.2f}  precision={prec:.3f}  recall={rec:.3f}  f1={f1:.3f}")
        if best is None or f1 > best[1]:
            best = (t, f1)

    print(f"\nBest threshold by F1: {best[0]:.2f} (F1={best[1]:.3f})")
    print(f"Update MIN_SCORE_THRESHOLD in copilot.py accordingly.")


if __name__ == "__main__":
    main()