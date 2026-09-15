# Calcmate — KG + RAG Starter (Week 1)

## What's here

```
calcmate/
├── data/
│   └── concepts.csv          43 Math concepts, Grades 3-5, with prerequisite edges
├── src/
│   ├── knowledge_graph.py    KG loader + PR(g,c), DI(c), feasibility - TESTED, WORKS
│   └── rag_compare.py        Generic vs curriculum-aware retrieval comparison
└── benchmark/
    └── questions.csv         15 teacher-style questions - NEEDS gold_chunk_id filled in
```

## Setup

```bash
pip install networkx sentence-transformers numpy
```

## What's done

- KG loads and passes 5 sanity checks (run `python src/knowledge_graph.py`).
- RAG comparison pipeline is fully wired (generic vs metadata-filtered retrieval),
  just needs real data plugged in.

## Simplified workflow (Steps 3-6)

Only pull NCERT chapters for the ~15 concepts referenced in
benchmark/questions.csv, plus a few extra for realistic distractors -
not all 43. That's the biggest time saver.

### 1. Download + extract (src/extract_pdf_text.py)
   ```bash
   python extract_pdf_text.py ../pdfs/grade4_fractions.pdf
   ```
   Repeat per chapter. Produces a .txt file next to each PDF.

### 2. Tag chunks interactively (src/build_corpus.py)
   ```bash
   python build_corpus.py ../pdfs/grade4_fractions.txt
   ```
   Shows you each paragraph; you type a concept_id (e.g. M408) to tag it,
   's' to skip, 'q' to stop and save. Appends to data/chunks.csv.
   Repeat for each extracted .txt file. No manual copy-pasting into Python.

### 3. Auto-fill gold labels (src/autofill_gold.py)
   ```bash
   python autofill_gold.py
   ```
   Matches each question's concept_id to a tagged chunk automatically.
   Prints any unresolved questions (concept not yet tagged, or ambiguous)
   for you to fix by hand in benchmark/questions.csv.

### 4. Run the comparison
   ```bash
   python rag_compare.py
   ```
   Now reads data/chunks.csv automatically. Prints Precision@3 / Recall@3 /
   MRR for both pipelines. THIS is your headline number for Friday.

## Extending the KG (optional, if time allows)

- Add Science/EVS concepts to data/concepts.csv as a SEPARATE small set
  (~20 concepts) using looser edges (e.g. "related_to" rather than strict
  "prerequisite_of" where Science doesn't have clean prerequisite chains).
  Mention this as a "generalizability" demo, not a full second experiment.

## For the review itself

Lead with:
1. The KG diagram (a handful of nodes from concepts.csv, drawn as a chain)
2. The retrieval comparison table (generic vs curriculum-aware numbers)
3. One live example: ask a question, show what each pipeline retrieves,
   point out why curriculum-aware wins (or doesn't - report honestly)

Don't present the allocation algorithm yet if it's not ready - RAG + KG is
a complete, defensible slice on its own for this checkpoint.
