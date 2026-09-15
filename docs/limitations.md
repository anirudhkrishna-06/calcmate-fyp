## Benchmark construction and evaluation integrity

The development evaluation set (`benchmark/questions.csv`, 15 questions) was
constructed and revised during iterative development. Two classes of change
were made:

**1. Content-based corrections (independent of model output).** An audit of the
vector store revealed that several chapter PDFs had been mapped to incorrect
concept IDs during initial authoring — the original manifest used filename
pattern-matching rather than chapter-content matching. These mappings were
corrected based on the actual text of each chapter, and remain correct
regardless of any retrieval system. This correction is not benchmark-tuning;
it fixes an error in the ground-truth store.

**2. Post-hoc question revisions (potentially tuning-dependent).** Three
development questions were revised after observing the retrieval system's
output on them:

  - **Q9** — concept_id changed from M504 (HCF/LCM) to M405 (factors and
    multiples). The question text ("What are factors and multiples of a
    number?") genuinely refers to M405, so this is defensible as a labelling
    correction; however, it was only identified after the retriever returned
    M405-tagged chunks and failed to return M504-tagged chunks.
  - **Q13** — grade changed from 4 to 5. Angles are not taught at Grade 4 in
    the Maths Mela syllabus, so the original label was objectively wrong;
    however, the correction was identified only after the retriever's
    Grade-5 chunks outranked any Grade-4 chunks for the query.
  - **Q11** — concept_id changed from M413 to M412. M413 (area by unit squares)
    has no source PDF in the corpus, so the original question was not
    evaluable; M412 is the closest covered concept. This is a corpus-coverage
    correction rather than a metric-shaping one.

The aggregate effect of these post-hoc revisions is that the development-set
numbers are upward-biased by an unknown amount.

## Held-out validation

To quantify the extent of this bias, we constructed a held-out evaluation set
(`benchmark/questions_heldout.csv`, 10 questions) written *after* the retrieval
pipeline was frozen. The questions were written from chapter content alone,
with no reference to model output. The file was committed to version control
at git tag `heldout-v1` before any evaluation was run on it, and has not been
edited since.

### Results

| Split | Pipeline | Precision@3 | Hit-Rate@3 | MRR |
|---|---|---|---|---|
| Dev (13/15 evaluable)        | Generic    | 0.308 | 0.462 | 0.385 |
| Dev (13/15 evaluable)        | Curriculum | 0.872 | 1.000 | 0.962 |
| Held-out (10/10 evaluable)   | Generic    | 0.333 | 0.500 | 0.500 |
| Held-out (10/10 evaluable)   | Curriculum | **0.767** | **0.900** | **0.900** |
| Δ (dev − held-out)           | Curriculum | +0.105 | +0.100 | +0.062 |

**We report the held-out curriculum-aware numbers (Precision@3 = 0.767,
Hit-Rate@3 = 0.900, MRR = 0.900) as the primary result.** The dev-set numbers
represent an upper bound and are included only to characterize the magnitude
of benchmark over-fitting (approximately 0.10 Precision@3 under the current
development procedure).

The direction and magnitude of the metadata-filter benefit are preserved on
the held-out set: curriculum-aware retrieval improves Precision@3 by 2.3×
(0.767 vs. 0.333) and Hit-Rate@3 by 1.8× (0.900 vs. 0.500) over generic
retrieval on questions the system was never tuned against. We therefore
conclude that grade- and subject-based metadata filtering is a genuine and
substantial improvement over unfiltered semantic retrieval for
curriculum-aligned K-12 content, and that the dev-set inflation is a
property of the development benchmark rather than of the underlying effect.

## Additional limitations

**Phrasing register.** Both dev and held-out questions are written in
textbook-register language ("What are equivalent fractions?") rather than the
pedagogical meta-language of the original question set ("How can equivalent
fractions be explained to a Grade 4 student?"). Earlier iterations showed that
meta-language queries under-perform on content-embedding retrieval. Our
results therefore characterize retrieval quality on *content-directed*
queries, which is a narrower claim than retrieval quality on arbitrary teacher
questions. Extending to raw pedagogical phrasing is left for future work.

**Corpus coverage.** Eight concepts in `concepts.csv` (M413, M419, M422–424,
M508–510, M519–520, M527–528) have no source PDF in the current corpus.
Questions referencing these concepts are excluded from both dev and held-out
evaluations (2 of 15 in dev; 0 of 10 in held-out). The corpus covers
approximately 68 of 76 concepts in the Grade 3–5 Maths Mela syllabus.

**Held-out set size.** The held-out evaluation comprises 10 questions, which
allows per-grade breakdowns only at n = 3–4. Confidence intervals on
per-grade numbers would be wide. The overall held-out numbers (n = 10) are
robust for the aggregate claim but not for fine-grained grade-level
comparisons.