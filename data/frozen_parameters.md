
# CalcMate — Frozen Simulation Parameters

**Version:** 1.0
**Frozen on:** 2026-09-15
**Frozen by:** Anirudh
**Applies to:** RQ3 (allocation algorithm evaluation)
**Status:** LOCKED — see Change Policy below

---

## Change policy

Once this document is tagged `frozen-v1` in git, any change to a numeric
value requires:

1. A version bump (1.0 → 1.1 for additive changes, 2.0 for changes that
   invalidate prior experiments).
2. Re-running `src/sim/validate_bkt.py` and confirming the validation gate
   still passes.
3. A note in the changelog at the bottom of this file explaining *why* the
   value changed and *which experiments* are affected.

Editing `src/sim/config.py` without first updating this document is
forbidden. The config file is a mirror; this doc is the source of truth.

---

## 1. BKT parameters

Global parameters applied uniformly to all concepts. Per-concept
parameterization is deferred to future work (see §7).

| Symbol | Meaning | Value |
|---|---|---|
| `P(L0)` | Prior probability of mastery at t=0 | `0.30` |
| `P(T)`  | Probability of learning transition per timestep | `0.10` |
| `P(G)`  | Probability of guessing correctly if not mastered | `0.20` |
| `P(S)`  | Probability of slipping (incorrect) if mastered | `0.10` |
| `τ`     | Mastery threshold (binary classifier cutoff) | `0.70` |

**Rationale:**
- `P(L0)=0.30` reflects a classroom where most concepts start unmastered.
- `P(T)=0.10` assumes moderate learning rate per day; with 30-day timelines
  this yields non-trivial growth.
- `P(G)=0.20` and `P(S)=0.10` are standard BKT defaults from the literature
  (Corbett & Anderson, 1995) and represent a 4:1 ratio of correct-guess
  against incorrect-slip, appropriate for multiple-choice or short-answer
  primary-school assessments.
- `τ=0.70` matches the mastery cutoff common in tutoring systems
  (e.g. Cognitive Tutor).

**Timestep definition:** 1 timestep = 1 calendar day. Observations are
generated for each (learner, concept, day) triple independently.

---

## 2. Learner generation

### 2.1 Prerequisite constraint

Learner mastery values `K_true(u, c) ∈ [0, 1]` are generated as:

```
If concept c has no prerequisites:
    K_true(u, c) ~ Uniform(0, 1)

If concept c has prerequisites P(c) = {p1, p2, ..., pk}:
    K_true(u, c) ~ min( Uniform(0, 1), max(K_true(u, pi)) + 0.15 )
```

**Rationale:** A learner cannot genuinely master a concept whose prerequisite
they have not learned. The `+0.15` margin permits partial transfer (a
learner may be slightly ahead of their prerequisite), but prevents the
unrealistic case where a learner masters a downstream concept while
having near-zero mastery on all its prerequisites. This constraint uses
the knowledge graph's prerequisite edges directly — see
`src/knowledge_graph.py`.

### 2.2 Class size

Single classroom per simulation:
```
n_learners = 30
```

**Rationale:** Typical primary-school classroom size; large enough that
aggregation metrics are meaningful, small enough that runs stay fast.

### 2.3 Grades simulated

```
grades = [3, 4, 5]
```

One classroom per (grade, scenario) pair during an experiment.

---

## 3. Scenario types

Five scenario types, distinguished only by the initialization rule for
`K_true`. All use the prerequisite constraint from §2.1.

### 3.1 `balanced`

All learners sampled from the §2.1 distribution. No modifications.

**Use case:** baseline comparison; no injected pathology.

### 3.2 `heterogeneous`

```
60% of learners: K_true ~ min(Uniform(0.6, 1.0), prereq_bound)
40% of learners: K_true ~ min(Uniform(0.0, 0.4), prereq_bound)
```

**Use case:** simulates a mixed-ability classroom where the allocator must
balance attention between high and low performers.

### 3.3 `prerequisite-gap`

Baseline `balanced` generation, then:

```
For 30% of learners (selected uniformly at random):
    Select one concept c* that has prerequisites.
    Set K_true(u, c*) = 0.05  (near-zero, regardless of prereqs)
    Do NOT modify K_true on prerequisites.
```

**Use case:** simulates the specific failure mode where a learner has
mastered prerequisites but has not transferred to a downstream concept.
This is the hardest case for a BKT model and the most important one for
the allocator's prerequisite-repair logic.

### 3.4 `learning-gap-heavy`

```
For 30% of learners (selected uniformly at random):
    For ALL concepts c:
        K_true(u, c) = min( Uniform(0.0, 0.4), prereq_bound )
```

**Use case:** simulates systemic under-performance, where a subset of
learners lags across the entire grade.

### 3.5 `attendance-disrupted`

Baseline `balanced` generation. No modification to `K_true`.

Modification happens in `evidence.py` (see §4): 30% of learners
(selected uniformly at random) have their evidence dropped with
probability `0.60` per (concept, day) triple.

**Use case:** simulates intermittent attendance; the allocator must handle
learners whose estimates are genuinely uncertain.

---

## 4. Evidence generation

### 4.1 Density levels

The evidence generator emits observations for each (learner, concept, day)
triple independently with probability `p_obs`:

| Level | `p_obs` | Used in |
|---|---|---|
| `dense` | `0.85` | RQ3 (validation + main experiments) |
| `moderate` | `0.40` | RQ4 (sparsity sweep) |
| `sparse` | `0.15` | RQ4 |
| `very_sparse` | `0.05` | RQ4 |

**RQ3 uses `dense` only.** The other levels are frozen here for RQ4
reproducibility but not invoked.

### 4.2 Observation model

For a learner `u` with true mastery `K_true(u, c)` on concept `c`, an
observation (correct / incorrect) is sampled:

```
P(observed_correct = 1) = K_true * (1 - P(S)) + (1 - K_true) * P(G)
```

with `P(S)=0.10` and `P(G)=0.20` from §1.

**Rationale:** this is the standard BKT observation model. A learner who
has mastered the concept answers correctly with high probability `1-P(S)`,
but may occasionally slip. A learner who has not mastered the concept
answers correctly with low probability `P(G)`, but may occasionally guess.

### 4.3 Timeline

```
n_days = 30
Timestep granularity: 1 day
```

### 4.4 Observation scope

Each observation is on a **single concept**. Batched observations (e.g. a
quiz covering multiple concepts with correlated skill requirements) are
deferred to future work (see §7).

---

## 5. Random seed policy

- All experiments run with `seeds = [1, 2, 3, ..., 10]`.
- Reported metrics are **mean ± std** across seeds.
- The simulator accepts `--seed <int>` on the command line; scripts that
  iterate seeds use `--seed-sweep 1:10`.
- Learner generation, evidence generation, and any stochastic choice inside
  the simulator must use **this same seed** for reproducibility of the
  entire pipeline (learner state, evidence, and downstream BKT estimates
  should be deterministic given `(seed, config)`).

**Rationale:** 10 seeds gives an adequate sample for mean ± std without
blowing up experiment runtime. Each (grade, scenario, seed) run should
complete in under 60 seconds.

---

## 6. Validation criteria (`validate_bkt.py` gate)

Before **any** allocator development begins, `validate_bkt.py` must
demonstrate that BKT can recover ground-truth mastery from simulated
evidence. The gate is defined as follows.

### 6.1 Setup

- Scenario: `balanced` (§3.1)
- Grade: `4` (middle grade, most concepts)
- Evidence density: `dense` (§4.1)
- Days: 30 (§4.3)
- Seeds: 1, 2, 3 (three seeds; report mean and worst-case)

### 6.2 Pass criteria

The gate **passes** if, averaged across seeds, at the final timestep:

| Metric | Pass | Warn | Fail |
|---|---|---|---|
| Mean Absolute Error (MAE) | ≤ 0.08 | 0.08 < MAE ≤ 0.12 | > 0.12 |
| Root Mean Squared Error (RMSE) | ≤ 0.10 | 0.10 < RMSE ≤ 0.15 | > 0.15 |
| Pearson correlation `r(K_true, K_hat)` | ≥ 0.90 | 0.80 ≤ r < 0.90 | < 0.80 |

Additionally, for the majority of concepts (≥ 80% of concepts in the
grade):

- MAE over the first 20 timesteps must be non-increasing (allowing ± 0.02
  jitter to absorb stochastic noise).

### 6.3 Interpretation

- **PASS:** Proceed to allocator development.
- **WARN:** Diagnose before proceeding. Likely causes: `P(G)`/`P(S)` too
  high relative to `P(T)`; insufficient timesteps; prerequisite constraint
  in §2.1 interacting badly with BKT's independence assumption.
- **FAIL:** Do not proceed. Check BKT update equations for sign errors,
  missing transition step, or off-by-one in evidence alignment.

### 6.4 Artifacts

`validate_bkt.py` must write:
- `data/bkt_validation/summary.json` — pass/warn/fail + all metrics
- `data/bkt_validation/ktrue_vs_khat.png` — scatter plot at final timestep
- `data/bkt_validation/convergence.png` — MAE vs. timestep, one line per seed

These artifacts are part of the frozen record; they are cited in the RQ3
report section as evidence the estimator is trustworthy.

---

## 7. Deferred decisions (DO NOT IMPLEMENT for RQ3)

The following are explicitly out of scope for RQ3. They may appear in RQ4
or RQ5, or in the paper's future-work section. If someone proposes adding
any of these during RQ3 development, the answer is no — open a separate
issue and defer.

1. **Per-concept BKT parameters.** RQ3 uses global parameters (§1). Fitting
   per-concept parameters requires empirical student data that we do not
   have.
2. **Item Response Theory alternative to BKT.** Related-work material only;
   no IRT model is built or compared against.
3. **Concept-to-item mapping.** Currently 1 assessment per concept per
   observation. Realistic quizzes have items that load on multiple concepts
   with different weights.
4. **Time-varying difficulty.** `P(T)` is assumed stationary across days.
   Real learning slows or accelerates with fatigue/motivation.
5. **Learner forgetting.** BKT does not model decay between sessions.
   A learner who has mastered a concept retains that mastery indefinitely.
6. **Non-binary evidence.** Observations are correct/incorrect. Partial
   credit, latency, and hint usage are not modeled.

Each of the six has a corresponding future-work paragraph in the paper.

---

## 8. Changelog

| Version | Date | Change | Author |
|---|---|---|---|
| 1.0 | 2026-09-15 | Initial freeze for RQ3 | Anirudh |

---

## 9. References

- Corbett, A. T., & Anderson, J. R. (1995). *Knowledge tracing: Modeling
  the effect of individual knowledge on problem-solving performance.*
  User Modeling and User-Adapted Interaction, 4(4), 253–278.
  (Source for the standard BKT observation model, `P(G)=0.20`, `P(S)=0.10`
  defaults.)
- Yudelson, M. V., Koedinger, K. R., & Gordon, G. J. (2013). *Individualized
  Bayesian Knowledge Tracing.* (Source for the two-step update equations
  referenced in `src/sim/bkt.py`.)
