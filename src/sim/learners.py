"""
learners.py - synthetic learner generation with hidden ground-truth mastery.

Generates a Classroom object: a set of synthetic learners, each with a
per-concept ground-truth mastery value K_true(u, c) ∈ [0, 1]. Five scenario
types govern how K_true is initialized (see frozen_parameters.md §3).

The generated K_true is NEVER visible to the allocator or to BKT. It is the
ground truth that BKT will attempt to recover from simulated evidence, and
that validate_bkt.py will use to score the estimator.

Design notes:
  - K_true is sampled in TOPOLOGICAL ORDER over the knowledge graph so that
    the prerequisite constraint (§2.1) can be applied without a second pass.
  - The prerequisite constraint is a HARD constraint: K_true(c) never
    exceeds max(K_true(prereq)) + PREREQ_MARGIN. This is enforced by
    clipping after sampling.
  - All randomness flows through a numpy Generator seeded from Config.seed.
    Two runs with the same (seed, grade, scenario) produce identical K_true.

Usage:
    from sim.config import Config, ScenarioType, EvidenceDensity
    from sim.learners import generate_classroom

    cfg = Config(seed=1, grade=4, scenario=ScenarioType.BALANCED,
                 evidence_density=EvidenceDensity.DENSE)
    classroom = generate_classroom(cfg)
    # classroom.k_true.shape == (30, n_concepts_for_grade_4)

Self-test:
    python -m sim.learners
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

# Make `knowledge_graph` importable when running from src/
_THIS_DIR = Path(__file__).resolve().parent
_SRC_DIR = _THIS_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from sim.config import (  # noqa: E402
    Config,
    Learners,
    ScenarioParams,
    ScenarioType,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("learners")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass
class Classroom:
    """
    A synthetic classroom for one (grade, scenario) pair.

    Attributes:
        config: the Config this classroom was generated from.
        learner_ids: list of int IDs, length n_learners.
        concept_ids: list of concept IDs for this grade, sorted topologically.
        k_true: np.ndarray of shape (n_learners, n_concepts), values in [0, 1].
                Ground truth. NEVER exposed to BKT or the allocator.
        prereq_graph: concept_id -> list[prerequisite concept_id].
                      Only includes edges to prerequisites that are themselves
                      in this grade's concept set.
    """
    config: Config
    learner_ids: list[int]
    concept_ids: list[str]
    k_true: np.ndarray
    prereq_graph: dict[str, list[str]]

    @property
    def n_learners(self) -> int:
        return len(self.learner_ids)

    @property
    def n_concepts(self) -> int:
        return len(self.concept_ids)

    def concept_index(self, concept_id: str) -> int:
        """Column index of a concept in k_true."""
        return self.concept_ids.index(concept_id)

    def k_true_of(self, learner_idx: int, concept_id: str) -> float:
        return float(self.k_true[learner_idx, self.concept_index(concept_id)])

# --------------------------------------------------------------------------- #
# Knowledge graph loading
# --------------------------------------------------------------------------- #

# Path to concepts.csv, resolved relative to this file.
_CONCEPTS_CSV = _SRC_DIR.parent / "data" / "concepts.csv"


def _load_kg_for_grade(grade: int) -> tuple[list[str], dict[str, list[str]]]:
    """
    Return (concept_ids, prereq_graph) for a grade.

    concept_ids is sorted in topological order (prerequisites before
    dependents) so that k_true can be sampled in a single forward pass.

    Loads the KG via knowledge_graph.load_kg() (module-level function),
    then filters to the requested grade.
    """
    try:
        from knowledge_graph import load_kg  # type: ignore
    except ImportError:
        raise ImportError(
            "knowledge_graph.py not found in src/ or doesn't export load_kg(). "
            "learners.py requires it to know which concepts exist per grade "
            "and what their prerequisites are."
        )

    if not _CONCEPTS_CSV.exists():
        raise FileNotFoundError(
            f"concepts.csv not found at {_CONCEPTS_CSV}. "
            f"learners.py needs it to build the prerequisite graph."
        )

    # Load the full graph (all grades), then filter
    full_graph = load_kg(str(_CONCEPTS_CSV))

    # Concepts for this grade
    concept_ids = [
        node for node, data in full_graph.nodes(data=True)
        if data.get("grade") == grade
    ]

    if not concept_ids:
        raise ValueError(
            f"No concepts found for grade {grade} in {_CONCEPTS_CSV}. "
            f"Available grades: {sorted({d.get('grade') for _, d in full_graph.nodes(data=True)})}"
        )

    # Prerequisite edges restricted to this grade's concepts
    allowed = set(concept_ids)
    prereq_graph: dict[str, list[str]] = {}
    for c in concept_ids:
        preds = [p for p in full_graph.predecessors(c) if p in allowed]
        prereq_graph[c] = preds

    ordered = _topological_order(concept_ids, prereq_graph)
    return ordered, prereq_graph




def _topological_order(
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> list[str]:
    """
    Return concept_ids in topological order (prerequisites first).

    Uses Kahn's algorithm. Falls back to sorted order if the graph has a
    cycle (which should never happen for a well-formed KG, but we don't
    want to crash on it).
    """
    # Build in-degree map
    indeg: dict[str, int] = {c: 0 for c in concept_ids}
    for c in concept_ids:
        for p in prereq_graph.get(c, []):
            if p in indeg:
                indeg[c] += 1

    # Kahn's algorithm
    queue = sorted([c for c in concept_ids if indeg[c] == 0])
    ordered: list[str] = []
    while queue:
        c = queue.pop(0)
        ordered.append(c)
        # Decrement indegree of dependents
        for other in concept_ids:
            if c in prereq_graph.get(other, []):
                indeg[other] -= 1
                if indeg[other] == 0:
                    queue.append(other)
        queue.sort()  # deterministic tie-breaking

    if len(ordered) != len(concept_ids):
        log.warning(
            f"Knowledge graph has a cycle among {len(concept_ids) - len(ordered)} "
            f"concepts; falling back to sorted order for those."
        )
        remaining = sorted(set(concept_ids) - set(ordered))
        ordered.extend(remaining)

    return ordered


# --------------------------------------------------------------------------- #
# Prerequisite-constrained sampling
# --------------------------------------------------------------------------- #

def _sample_k_true_constrained(
    rng: np.random.Generator,
    n_learners: int,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
    margin: float,
    sampling_fn,
) -> np.ndarray:
    """
    Sample K_true for all learners and concepts in topological order,
    applying the prerequisite constraint from frozen_parameters.md §2.1:

        K_true(c) <= max(K_true(prereq)) + margin

    Args:
        sampling_fn: callable (rng, n_learners) -> np.ndarray of shape
                     (n_learners,), returning the unconstrained samples for
                     one concept. Different scenarios pass different fns.

    Returns:
        np.ndarray of shape (n_learners, n_concepts), values in [0, 1].
    """
    n_concepts = len(concept_ids)
    k_true = np.zeros((n_learners, n_concepts), dtype=np.float64)
    idx = {c: i for i, c in enumerate(concept_ids)}

    for c in concept_ids:
        raw = sampling_fn(rng, n_learners)          # unconstrained samples
        raw = np.clip(raw, 0.0, 1.0)

        prereqs = prereq_graph.get(c, [])
        if prereqs:
            prereq_cols = [idx[p] for p in prereqs if p in idx]
            if prereq_cols:
                max_prereq = k_true[:, prereq_cols].max(axis=1)
                upper_bound = np.minimum(1.0, max_prereq + margin)
                raw = np.minimum(raw, upper_bound)

        k_true[:, idx[c]] = raw

    return k_true


def _uniform_sampler(low: float, high: float):
    """Return a sampling_fn that draws Uniform(low, high)."""
    def _fn(rng: np.random.Generator, n: int) -> np.ndarray:
        return rng.uniform(low, high, size=n)
    return _fn


# --------------------------------------------------------------------------- #
# Scenario generators
# --------------------------------------------------------------------------- #

def _generate_balanced(
    rng: np.random.Generator,
    n_learners: int,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> np.ndarray:
    """§3.1 - balanced: no pathology, just prereq-constrained uniform sampling."""
    return _sample_k_true_constrained(
        rng=rng,
        n_learners=n_learners,
        concept_ids=concept_ids,
        prereq_graph=prereq_graph,
        margin=Learners.PREREQ_MARGIN,
        sampling_fn=_uniform_sampler(0.0, 1.0),
    )


def _generate_heterogeneous(
    rng: np.random.Generator,
    n_learners: int,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> np.ndarray:
    """
    §3.2 - heterogeneous: 60% high-performing, 40% struggling.

    Implemented as a per-learner "ability tier" that shifts the sampling range.
    The tier is chosen once per learner, then all concepts for that learner
    are sampled within the tier's range, subject to the prereq constraint.
    """
    n_high = int(round(n_learners * ScenarioParams.HETERO_HIGH_FRACTION))
    # Assign tier per learner in random order
    tier = np.zeros(n_learners, dtype=int)  # 0 = low, 1 = high
    high_indices = rng.choice(n_learners, size=n_high, replace=False)
    tier[high_indices] = 1

    k_true = np.zeros((n_learners, len(concept_ids)), dtype=np.float64)
    idx = {c: i for i, c in enumerate(concept_ids)}

    low_lo, low_hi = ScenarioParams.HETERO_LOW_RANGE
    high_lo, high_hi = ScenarioParams.HETERO_HIGH_RANGE

    for c in concept_ids:
        # Sample per learner conditioned on their tier
        raw = np.where(
            tier == 1,
            rng.uniform(high_lo, high_hi, size=n_learners),
            rng.uniform(low_lo, low_hi, size=n_learners),
        )
        raw = np.clip(raw, 0.0, 1.0)

        prereqs = prereq_graph.get(c, [])
        if prereqs:
            prereq_cols = [idx[p] for p in prereqs if p in idx]
            if prereq_cols:
                max_prereq = k_true[:, prereq_cols].max(axis=1)
                upper_bound = np.minimum(1.0, max_prereq + Learners.PREREQ_MARGIN)
                raw = np.minimum(raw, upper_bound)

        k_true[:, idx[c]] = raw

    return k_true


def _apply_prerequisite_gap(
    rng: np.random.Generator,
    k_true: np.ndarray,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> np.ndarray:
    """
    §3.3 - prerequisite-gap: for 30% of learners, zero out one concept c*
    that has prerequisites, then cascade the constraint down to all
    dependents of c*.

    The cascade is necessary: if c* is unmastered, its direct and
    transitive dependents cannot be mastered either (per §2.1's hard
    constraint). Modelling a learner who is high on a dependent while
    low on its prerequisite would violate the KG constraint and make
    the scenario internally inconsistent.

    Note: we do NOT modify c*'s prerequisites. Those stay wherever they
    were. The gap is entirely downstream of the prerequisites.
    """
    n_learners = k_true.shape[0]
    n_gapped = int(round(n_learners * ScenarioParams.PREREQ_GAP_FRACTION))

    # Concepts that HAVE prerequisites are the only eligible targets.
    # This ensures there's a meaningful "upstream mastered, downstream not"
    # pattern for the allocator to detect.
    eligible = [c for c in concept_ids if prereq_graph.get(c, [])]
    if not eligible:
        log.warning("prerequisite_gap scenario: no concept has prerequisites; "
                    "no-op")
        return k_true

    idx = {c: i for i, c in enumerate(concept_ids)}
    gapped_learners = rng.choice(n_learners, size=n_gapped, replace=False)

    # Build descendant map once: c -> all transitive dependents of c.
    # Descendants are used to cascade the constraint after zeroing.
    descendants = _build_descendants(concept_ids, prereq_graph)

    for u in gapped_learners:
        c_star = eligible[rng.integers(0, len(eligible))]
        # Zero c* itself
        k_true[u, idx[c_star]] = ScenarioParams.PREREQ_GAP_TARGET_VALUE

        # Cascade: any descendant of c* must satisfy
        #   K_true(d) <= max(K_true(prereqs of d)) + margin
        # We process the descendants in topological order so that when we
        # update d, its own prereqs (which may include c* or other
        # descendants already processed) have their new values.
        for d in descendants[c_star]:
            prereqs = prereq_graph.get(d, [])
            if not prereqs:
                continue
            prereq_cols = [idx[p] for p in prereqs if p in idx]
            if not prereq_cols:
                continue
            max_prereq = float(k_true[u, prereq_cols].max())
            upper_bound = min(1.0, max_prereq + Learners.PREREQ_MARGIN)
            if k_true[u, idx[d]] > upper_bound:
                k_true[u, idx[d]] = upper_bound

    return k_true


def _build_descendants(
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> dict[str, list[str]]:
    """
    Return {c: [all transitive descendants of c]}, in topological order.

    A descendant of c is any concept d such that c is on some prerequisite
    chain leading to d. Includes direct children and everything below.
    """
    # Build adjacency: prereq -> [dependents]
    children: dict[str, list[str]] = {c: [] for c in concept_ids}
    for c in concept_ids:
        for p in prereq_graph.get(c, []):
            if p in children:
                children[p].append(c)

    # Topological order ensures descendants appear after their ancestors
    topo_order = _topological_order(concept_ids, prereq_graph)
    topo_index = {c: i for i, c in enumerate(topo_order)}

    descendants: dict[str, list[str]] = {}
    for c in concept_ids:
        # BFS/DFS over `children` to collect all transitive dependents
        seen: set[str] = set()
        stack = list(children.get(c, []))
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(children.get(node, []))
        # Sort by topological index so caller can update in order
        descendants[c] = sorted(seen, key=lambda x: topo_index.get(x, 1e9))

    return descendants


def _apply_learning_gap_heavy(
    rng: np.random.Generator,
    k_true: np.ndarray,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> np.ndarray:
    """
    §3.4 - learning-gap-heavy: for 30% of learners, force K_true to be low
    across all concepts (systemic struggle).
    """
    n_learners = k_true.shape[0]
    n_gapped = int(round(n_learners * ScenarioParams.LEARNING_GAP_FRACTION))
    low_lo, low_hi = ScenarioParams.LEARNING_GAP_RANGE

    idx = {c: i for i, c in enumerate(concept_ids)}
    gapped_learners = rng.choice(n_learners, size=n_gapped, replace=False)

    # Re-sample in topological order so the prereq constraint still holds
    # within the low range.
    for c in concept_ids:
        prereqs = prereq_graph.get(c, [])
        raw = rng.uniform(low_lo, low_hi, size=n_gapped)
        if prereqs:
            prereq_cols = [idx[p] for p in prereqs if p in idx]
            if prereq_cols:
                max_prereq = k_true[gapped_learners][:, prereq_cols].max(axis=1)
                upper_bound = np.minimum(1.0, max_prereq + Learners.PREREQ_MARGIN)
                raw = np.minimum(raw, upper_bound)
        k_true[gapped_learners, idx[c]] = raw

    return k_true


def _generate_attendance_disrupted(
    rng: np.random.Generator,
    n_learners: int,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
) -> np.ndarray:
    """
    §3.5 - attendance-disrupted: K_true generation is IDENTICAL to balanced.
    The disruption is applied in evidence.py (see frozen_parameters.md §4).

    We still draw from the RNG here so that this scenario consumes the same
    number of random numbers as the others up to this point - keeps seeds
    comparable across scenarios.
    """
    k_true = _generate_balanced(rng, n_learners, concept_ids, prereq_graph)
    # Note: no K_true modification. evidence.py handles the attendance model.
    return k_true


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def generate_classroom(config: Config) -> Classroom:
    """
    Generate a classroom for the given config.

    Deterministic given (config.seed, config.grade, config.scenario).
    """
    log.info(f"[learners] generating classroom: grade={config.grade}, "
             f"scenario={config.scenario.value}, seed={config.seed}, "
             f"n_learners={config.n_learners}")

    # Load KG for this grade
    concept_ids, prereq_graph = _load_kg_for_grade(config.grade)
    log.info(f"[learners] grade {config.grade}: {len(concept_ids)} concepts, "
             f"{sum(len(v) for v in prereq_graph.values())} prerequisite edges")

    # Seed RNG from config
    rng = np.random.default_rng(config.seed)

    # Dispatch by scenario
    if config.scenario == ScenarioType.BALANCED:
        k_true = _generate_balanced(rng, config.n_learners, concept_ids, prereq_graph)

    elif config.scenario == ScenarioType.HETEROGENEOUS:
        k_true = _generate_heterogeneous(rng, config.n_learners, concept_ids, prereq_graph)

    elif config.scenario == ScenarioType.PREREQUISITE_GAP:
        k_true = _generate_balanced(rng, config.n_learners, concept_ids, prereq_graph)
        k_true = _apply_prerequisite_gap(rng, k_true, concept_ids, prereq_graph)

    elif config.scenario == ScenarioType.LEARNING_GAP_HEAVY:
        k_true = _generate_balanced(rng, config.n_learners, concept_ids, prereq_graph)
        k_true = _apply_learning_gap_heavy(rng, k_true, concept_ids, prereq_graph)

    elif config.scenario == ScenarioType.ATTENDANCE_DISRUPTED:
        k_true = _generate_attendance_disrupted(rng, config.n_learners, concept_ids, prereq_graph)

    else:
        raise ValueError(f"unknown scenario: {config.scenario}")

    learner_ids = list(range(config.n_learners))
    return Classroom(
        config=config,
        learner_ids=learner_ids,
        concept_ids=concept_ids,
        k_true=k_true,
        prereq_graph=prereq_graph,
    )


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #

def _check_prereq_constraint(
    k_true: np.ndarray,
    concept_ids: list[str],
    prereq_graph: dict[str, list[str]],
    margin: float,
) -> tuple[bool, float]:
    """
    Return (ok, worst_violation). A violation is any (u, c) where
    K_true(u, c) > max_prereq(K_true(u, prereq)) + margin + epsilon.
    """
    idx = {c: i for i, c in enumerate(concept_ids)}
    worst = 0.0
    for c in concept_ids:
        prereqs = prereq_graph.get(c, [])
        if not prereqs:
            continue
        prereq_cols = [idx[p] for p in prereqs if p in idx]
        if not prereq_cols:
            continue
        max_prereq = k_true[:, prereq_cols].max(axis=1)
        upper = np.minimum(1.0, max_prereq + margin)
        violation = k_true[:, idx[c]] - upper
        worst = max(worst, float(violation.max()))
    return (worst <= 1e-9, worst)


def _self_test() -> None:
    import time
    from sim.config import EvidenceDensity

    print("=" * 72)
    print("SELF-TEST: sim/learners.py")
    print("=" * 72)

    grade = 4
    seed = 1
    all_ok = True

    for scenario in ScenarioType.all():
        print(f"\n--- scenario: {scenario.value} ---")
        cfg = Config(seed=seed, grade=grade, scenario=scenario,
                     evidence_density=EvidenceDensity.DENSE)

        t0 = time.perf_counter()
        try:
            classroom = generate_classroom(cfg)
        except Exception as e:
            print(f"  !! FAILED: {type(e).__name__}: {e}")
            all_ok = False
            continue
        dt = (time.perf_counter() - t0) * 1000

        print(f"  generated in {dt:.1f} ms  "
              f"shape={classroom.k_true.shape}  "
              f"({classroom.n_learners} learners × {classroom.n_concepts} concepts)")

        # --- Basic sanity ---
        if classroom.k_true.shape != (classroom.n_learners, classroom.n_concepts):
            print(f"  !! shape mismatch")
            all_ok = False

        if not np.all((classroom.k_true >= 0) & (classroom.k_true <= 1)):
            print(f"  !! values outside [0, 1]")
            all_ok = False

        # --- Prerequisite constraint ---
        ok, worst = _check_prereq_constraint(
            classroom.k_true, classroom.concept_ids,
            classroom.prereq_graph, Learners.PREREQ_MARGIN,
        )
        if ok:
            print(f"  prereq constraint: OK (worst violation = {worst:.2e})")
        else:
            print(f"  !! prereq constraint VIOLATED (worst = {worst:.4f})")
            all_ok = False

        # --- Per-scenario behaviour checks ---
        if scenario == ScenarioType.BALANCED:
            row_means = classroom.k_true.mean(axis=1)
            print(f"  learner mean K_true: "
                  f"min={row_means.min():.3f}  mean={row_means.mean():.3f}  "
                  f"max={row_means.max():.3f}")

        elif scenario == ScenarioType.HETEROGENEOUS:
            # Should see a bimodal distribution
            row_means = classroom.k_true.mean(axis=1)
            n_high = int((row_means > 0.5).sum())
            n_low = int((row_means <= 0.5).sum())
            print(f"  high-mean learners: {n_high}, low-mean learners: {n_low} "
                  f"(expected ~{int(0.6 * classroom.n_learners)}/"
                  f"~{int(0.4 * classroom.n_learners)})")
            if not (10 <= n_high <= 25):
                print(f"  !! unusual split for heterogeneous scenario")
                all_ok = False

        elif scenario == ScenarioType.PREREQUISITE_GAP:
            n_gapped = int(round(classroom.n_learners
                                * ScenarioParams.PREREQ_GAP_FRACTION))
            target = ScenarioParams.PREREQ_GAP_TARGET_VALUE
            # Count learners with at least one concept exactly at the target value
            has_target = (np.abs(classroom.k_true - target) < 1e-9).any(axis=1)
            n_target = int(has_target.sum())
            print(f"  learners with ≥1 concept == {target}: "
                f"{n_target} (expected {n_gapped})")
            if n_target < n_gapped:
                print(f"  !! fewer gapped learners than expected")
                all_ok = False

        elif scenario == ScenarioType.LEARNING_GAP_HEAVY:
            # Expect ~30% of learners with ALL concepts <= LEARNING_GAP_RANGE high
            gap_hi = ScenarioParams.LEARNING_GAP_RANGE[1]
            all_low = (classroom.k_true <= gap_hi + 1e-6).all(axis=1)
            n_gapped = int(all_low.sum())
            expected = int(round(classroom.n_learners
                                 * ScenarioParams.LEARNING_GAP_FRACTION))
            print(f"  learners with ALL concepts ≤ {gap_hi}: "
                  f"{n_gapped} (expected ~{expected})")
            if n_gapped < expected - 2:  # allow small tolerance
                print(f"  !! fewer systemically-low learners than expected")
                all_ok = False

        elif scenario == ScenarioType.ATTENDANCE_DISRUPTED:
            # K_true distribution should match balanced (the disruption is
            # in evidence.py, not here)
            row_means = classroom.k_true.mean(axis=1)
            print(f"  learner mean K_true: "
                  f"min={row_means.min():.3f}  mean={row_means.mean():.3f}  "
                  f"max={row_means.max():.3f}  (same shape as balanced)")

    # --- Determinism check ---
    print("\n--- determinism check ---")
    cfg_a = Config(seed=42, grade=4, scenario=ScenarioType.BALANCED,
                   evidence_density=EvidenceDensity.DENSE)
    cfg_b = Config(seed=42, grade=4, scenario=ScenarioType.BALANCED,
                   evidence_density=EvidenceDensity.DENSE)
    try:
        ca = generate_classroom(cfg_a)
        cb = generate_classroom(cfg_b)
        if np.array_equal(ca.k_true, cb.k_true):
            print("  same seed -> identical k_true  [OK]")
        else:
            print("  !! same seed produced different k_true")
            all_ok = False
    except Exception as e:
        print(f"  !! determinism check failed to run: {e}")
        all_ok = False

    # --- Different seed produces different output ---
    cfg_c = Config(seed=43, grade=4, scenario=ScenarioType.BALANCED,
                   evidence_density=EvidenceDensity.DENSE)
    try:
        cc = generate_classroom(cfg_c)
        if not np.array_equal(ca.k_true, cc.k_true):
            print("  different seed -> different k_true  [OK]")
        else:
            print("  !! different seeds produced identical k_true")
            all_ok = False
    except Exception:
        pass

    print()
    if all_ok:
        print("[sim/learners.py] SELF-TEST PASSED")
    else:
        print("[sim/learners.py] SELF-TEST FAILED - see warnings above")
        raise SystemExit(1)


if __name__ == "__main__":
    _self_test()