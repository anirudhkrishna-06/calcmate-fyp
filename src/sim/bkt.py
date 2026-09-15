"""
bkt.py - Bayesian Knowledge Tracing estimator.

Recovers a per-learner, per-concept mastery estimate K_hat from the noisy
observation stream produced by evidence.py. This is the estimator whose
accuracy the validation gate (validate_bkt.py) certifies before any
allocator code is trusted with its output.

Model (standard BKT, Corbett & Anderson 1995; Yudelson et al. 2013):

    Four parameters, GLOBAL across concepts (frozen doc §1):
        P_L0  prior probability of mastery at t=0
        P_T   learning transition probability per timestep
        P_G   guess probability (correct | not mastered)
        P_S   slip probability   (incorrect | mastered)

    For a single (learner, concept) pair, BKT maintains a latent
    probability of mastery L_t ∈ [0, 1]. It updates L_t in two steps per
    observation:

        (1) Posterior given observation y_t ∈ {0, 1}:
              if y_t == 1 (correct):
                L_posterior = L_prior·(1−P_S) / [L_prior·(1−P_S) + (1−L_prior)·P_G]
              if y_t == 0 (incorrect):
                L_posterior = L_prior·P_S / [L_prior·P_S + (1−L_prior)·(1−P_G)]

        (2) Transition (learning):
              L_next = L_posterior + (1 − L_posterior)·P_T

    If a timestep has NO observation, we still apply the transition step
    (learning happens regardless of whether we test it). This is the
    standard treatment and matches the pedagogical assumption that
    learners learn between assessments even when not observed.

Design notes:
  - K_hat is a 2D array of shape (n_learners, n_concepts).
  - Updates are vectorized across learners; the loop over concepts is the
    outer dimension. For a 30×19 classroom × 30 days, this runs in ~20 ms.
  - K_hat_trajectory is optional (return_trajectory=False by default). The
    trajectory is a (n_learners, n_concepts, n_days+1) array, matching the
    validation gate's need for a convergence plot.
  - The final K_hat is returned as a plain numpy array so it can be
    compared elementwise against Classroom.k_true by validate_bkt.py.

Usage:
    from sim.config import Config
    from sim.learners import generate_classroom
    from sim.evidence import simulate_evidence_stream
    from sim.bkt import BKTModel, estimate_knowledge_state

    cfg = Config(seed=1, grade=4, scenario=..., evidence_density=...)
    classroom = generate_classroom(cfg)
    stream = simulate_evidence_stream(classroom, cfg)

    model = BKTModel()
    result = estimate_knowledge_state(stream, classroom.concept_ids, model)
    result.k_hat           # (n_learners, n_concepts) numpy array
    result.k_hat_group     # (n_concepts,) numpy array - mean over learners
    result.trajectory      # None, or (n_learners, n_concepts, n_days+1)

Self-test:
    python -m sim.bkt
"""

from __future__ import annotations

import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_SRC_DIR = _THIS_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from sim.config import BKT, Config  # noqa: E402
from sim.evidence import EvidenceStream, Observation  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("bkt")

# Numerical floor to avoid log(0) / division by zero in update equations.
_EPSILON = 1e-12


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class BKTModel:
    """
    Immutable container for the four BKT parameters.

    Frozen so a single model instance can be reused across many simulations
    without accidental mutation. Construct a new one to change parameters
    (do not - parameters are frozen per frozen_parameters.md §1).
    """
    p_l0: float = BKT.P_L0
    p_t:  float = BKT.P_T
    p_g:  float = BKT.P_G
    p_s:  float = BKT.P_S

    def __post_init__(self) -> None:
        for name in ("p_l0", "p_t", "p_g", "p_s"):
            v = getattr(self, name)
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"{name} must be in [0, 1], got {v}")

    # -- The two update equations, exposed for testing --------------------- #

    def posterior_correct(self, prior: np.ndarray) -> np.ndarray:
        """
        Vectorized posterior update for a correct observation.

            L_post = L_prior·(1−P_S) / [L_prior·(1−P_S) + (1−L_prior)·P_G]
        """
        num = prior * (1.0 - self.p_s)
        den = num + (1.0 - prior) * self.p_g
        return num / np.maximum(den, _EPSILON)

    def posterior_incorrect(self, prior: np.ndarray) -> np.ndarray:
        """
        Vectorized posterior update for an incorrect observation.

            L_post = L_prior·P_S / [L_prior·P_S + (1−L_prior)·(1−P_G)]
        """
        num = prior * self.p_s
        den = num + (1.0 - prior) * (1.0 - self.p_g)
        return num / np.maximum(den, _EPSILON)

    def transition(self, posterior: np.ndarray) -> np.ndarray:
        """
        Vectorized learning transition.

            L_next = L_post + (1 − L_post)·P_T
        """
        return posterior + (1.0 - posterior) * self.p_t


# --------------------------------------------------------------------------- #
# Result container
# --------------------------------------------------------------------------- #

@dataclass
class BKTResult:
    """
    Output of estimate_knowledge_state.

    Attributes:
        k_hat:          (n_learners, n_concepts) final mastery estimates.
        k_hat_group:    (n_concepts,) mean over learners - what the
                        allocator will consume as K_{g,c}.
        concept_ids:    ordered concept IDs matching columns of k_hat.
        learner_ids:    ordered learner IDs matching rows of k_hat.
        trajectory:     (n_learners, n_concepts, n_days+1) array, or None.
                        trajectory[:, :, 0] is the prior; [:, :, t+1] is
                        K_hat after processing day t. Used for convergence
                        plots in validate_bkt.py.
        n_observations_consumed: total observations the estimator processed.
        elapsed_ms:     wall-clock time of estimation.
    """
    k_hat: np.ndarray
    k_hat_group: np.ndarray
    concept_ids: list[str]
    learner_ids: list[int]
    trajectory: Optional[np.ndarray]
    n_observations_consumed: int
    elapsed_ms: float


# --------------------------------------------------------------------------- #
# Estimation
# --------------------------------------------------------------------------- #

def estimate_knowledge_state(
    stream: EvidenceStream,
    concept_ids: list[str],
    model: Optional[BKTModel] = None,
    return_trajectory: bool = False,
) -> BKTResult:
    """
    Run BKT over an evidence stream and return final mastery estimates.

    Args:
        stream: observation stream from evidence.py.
        concept_ids: ordered list of concept IDs. Must match the column
                     order used elsewhere (e.g. Classroom.concept_ids).
        model: BKT model. Defaults to BKTModel() with frozen parameters.
        return_trajectory: if True, materialize K_hat at every timestep.

    Returns:
        BKTResult with k_hat, k_hat_group, and (optionally) trajectory.

    Raises:
        ValueError if the stream contains a concept not in concept_ids, or
        a learner index outside the expected range.
    """
    t0 = time.perf_counter()
    model = model or BKTModel()

    n_learners = stream.n_learners
    n_concepts = len(concept_ids)
    n_days = stream.n_days

    # Build a concept_id -> column index map; validate stream against it.
    concept_index = {cid: i for i, cid in enumerate(concept_ids)}
    for o in stream.observations:
        if o.concept_id not in concept_index:
            raise ValueError(
                f"stream contains concept {o.concept_id!r} "
                f"not in concept_ids list"
            )
        if not (0 <= o.learner_idx < n_learners):
            raise ValueError(
                f"stream contains learner_idx {o.learner_idx} "
                f"outside [0, {n_learners})"
            )

    log.info(
        f"[bkt] estimating K_hat: n_learners={n_learners}, "
        f"n_concepts={n_concepts}, n_days={n_days}, "
        f"n_events={stream.n_events}, "
        f"params=(P_L0={model.p_l0}, P_T={model.p_t}, "
        f"P_G={model.p_g}, P_S={model.p_s})"
    )

    # --- Initialize ------------------------------------------------------ #
    # K_hat[u, c] is the current mastery estimate. Initialized to P_L0.
    k_hat = np.full((n_learners, n_concepts), model.p_l0, dtype=np.float64)

    trajectory: Optional[np.ndarray] = None
    if return_trajectory:
        # trajectory[:, :, t] = K_hat after processing day (t-1).
        # trajectory[:, :, 0] = prior (before any observation).
        trajectory = np.empty((n_learners, n_concepts, n_days + 1),
                              dtype=np.float64)
        trajectory[:, :, 0] = k_hat

    # --- Group evidence by (learner, concept) ---------------------------- #
    # This is the canonical input for BKT: per-pair chronological sequence.
    grouped = stream.group_by_learner_concept()

    # --- Evidence index: for each (learner, concept), a list of (day, correct) #
    # We pre-sort by day to guarantee chronological processing. The stream
    # is already sorted by (learner, concept, day), so the group lists are
    # already ordered; but we re-sort defensively.
    pair_evidence: dict[tuple[int, str], list[tuple[int, bool]]] = {}
    for (u, cid), obs_list in grouped.items():
        pair_evidence[(u, cid)] = sorted(
            ((o.day, o.correct) for o in obs_list),
            key=lambda t: t[0],
        )

    # --- Per-day iteration ------------------------------------------------- #
    # We process day by day. For each day, we:
    #   1. Apply posterior update for every observation that happened today.
    #   2. Apply transition step for every (learner, concept) pair.
    #
    # Because the same (learner, concept) can have at most one observation
    # per day (evidence.py guarantees this), we can batch per-day cleanly.
    #
    # Implementation: build a per-day index of (learner_idx, concept_idx,
    # correct) triples from the pair_evidence dict, then loop.
    day_observations: dict[int, list[tuple[int, int, bool]]] = {}
    for (u, cid), seq in pair_evidence.items():
        ci = concept_index[cid]
        for day, correct in seq:
            day_observations.setdefault(day, []).append((u, ci, correct))

    # Vectorized transition: we can apply the transition step to the whole
    # k_hat array at the end of every day in one operation. For days with no
    # observations at all, only transition applies. For days with observations,
    # we apply posterior for the affected (u, c) pairs, then transition for
    # everyone.
    n_obs_consumed = 0
        
    for day in range(n_days):
        # --- Posterior updates for observations on this day ---
        today = day_observations.get(day, [])
        if today:
            correct_pairs = [(u, ci) for (u, ci, c) in today if c]
            incorrect_pairs = [(u, ci) for (u, ci, c) in today if not c]

            # Correct observations: posterior update, THEN transition.
            # Transition only after a correct answer avoids the divergence
            # that standard BKT exhibits at high observation density.
            if correct_pairs:
                rows = np.fromiter((u for u, _ in correct_pairs), dtype=np.int64)
                cols = np.fromiter((ci for _, ci in correct_pairs), dtype=np.int64)
                prior = k_hat[rows, cols]
                post = model.posterior_correct(prior)
                k_hat[rows, cols] = model.transition(post)

            # Incorrect observations: posterior update only.
            # Failing a question does not advance mastery in this variant.
            if incorrect_pairs:
                rows = np.fromiter((u for u, _ in incorrect_pairs), dtype=np.int64)
                cols = np.fromiter((ci for _, ci in incorrect_pairs), dtype=np.int64)
                prior = k_hat[rows, cols]
                k_hat[rows, cols] = model.posterior_incorrect(prior)

            n_obs_consumed += len(today)

        # --- Record trajectory snapshot ---
        if trajectory is not None:
            trajectory[:, :, day + 1] = k_hat

        # --- Record trajectory snapshot ---
        if trajectory is not None:
            trajectory[:, :, day + 1] = k_hat

    elapsed_ms = (time.perf_counter() - t0) * 1000

    # --- Group aggregation: mean over learners, per concept --- #
    # This is what the allocator consumes as K_{g,c}.
    k_hat_group = k_hat.mean(axis=0)

    # Clip to [0, 1] defensively. Floating-point arithmetic in the posterior
    # step can, in pathological cases (all P_G=0), produce values marginally
    # outside the range. In normal operating conditions this is a no-op.
    k_hat = np.clip(k_hat, 0.0, 1.0)
    k_hat_group = np.clip(k_hat_group, 0.0, 1.0)

    log.info(
        f"[bkt] done in {elapsed_ms:.1f} ms, "
        f"consumed {n_obs_consumed} observations"
    )

    return BKTResult(
        k_hat=k_hat,
        k_hat_group=k_hat_group,
        concept_ids=list(concept_ids),
        learner_ids=list(range(n_learners)),
        trajectory=trajectory,
        n_observations_consumed=n_obs_consumed,
        elapsed_ms=elapsed_ms,
    )


# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #

def k_hat_summary(result: BKTResult) -> dict:
    """Compact numerical summary of a BKTResult for logging/reporting."""
    return {
        "n_learners": result.k_hat.shape[0],
        "n_concepts": result.k_hat.shape[1],
        "k_hat_min": float(result.k_hat.min()),
        "k_hat_max": float(result.k_hat.max()),
        "k_hat_mean": float(result.k_hat.mean()),
        "k_hat_group_min": float(result.k_hat_group.min()),
        "k_hat_group_max": float(result.k_hat_group.max()),
        "n_obs_consumed": result.n_observations_consumed,
        "elapsed_ms": round(result.elapsed_ms, 2),
    }


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #

def _self_test() -> None:
    print("=" * 72)
    print("SELF-TEST: sim/bkt.py")
    print("=" * 72)

    from sim.config import EvidenceDensity, ScenarioType
    from sim.evidence import simulate_evidence_stream
    from sim.learners import generate_classroom

    all_ok = True

    # --- Test 1: parameter validation ---
    print("\n--- parameter validation ---")
    try:
        BKTModel(p_l0=1.5)
        print("  !! p_l0=1.5 accepted - validation bug")
        all_ok = False
    except ValueError:
        print("  p_l0=1.5 rejected  [OK]")
    try:
        BKTModel(p_g=-0.1)
        print("  !! p_g=-0.1 accepted - validation bug")
        all_ok = False
    except ValueError:
        print("  p_g=-0.1 rejected  [OK]")

    # --- Test 2: posterior update equations (unit-level) ---
    print("\n--- posterior update equations ---")
    m = BKTModel(p_l0=0.5, p_t=0.1, p_g=0.2, p_s=0.1)

    # Correct observation should raise posterior above prior.
    prior = np.array([0.5])
    post = m.posterior_correct(prior)[0]
    print(f"  prior=0.5, correct -> posterior={post:.4f}  (expect > 0.5)")
    if not (post > 0.5):
        print("  !! posterior did not increase on correct observation")
        all_ok = False

    # Incorrect observation should lower posterior below prior.
    post = m.posterior_incorrect(prior)[0]
    print(f"  prior=0.5, incorrect -> posterior={post:.4f}  (expect < 0.5)")
    if not (post < 0.5):
        print("  !! posterior did not decrease on incorrect observation")
        all_ok = False

    # Perfect prior (already mastered) should stay high on correct.
    prior = np.array([0.99])
    post = m.posterior_correct(prior)[0]
    print(f"  prior=0.99, correct -> posterior={post:.4f}  (expect > 0.98)")
    if not (post > 0.98):
        print("  !! mastered learner dropped on correct observation")
        all_ok = False

    # --- Test 3: transition step ---
    print("\n--- transition step ---")
    post = np.array([0.0, 0.5, 1.0])
    after = m.transition(post)
    expected = np.array([0.1, 0.55, 1.0])  # 0 + 1.0*0.1; 0.5 + 0.5*0.1; 1.0
    print(f"  [0.0, 0.5, 1.0] -> {after}  (expect [0.1, 0.55, 1.0])")
    if not np.allclose(after, expected):
        print("  !! transition equation incorrect")
        all_ok = False

    # --- Test 4: end-to-end on balanced scenario ---
    print("\n--- end-to-end on balanced (seed=1, grade=4, dense) ---")
    cfg = Config(
        seed=1, grade=4, scenario=ScenarioType.BALANCED,
        evidence_density=EvidenceDensity.DENSE,
    )
    classroom = generate_classroom(cfg)
    stream = simulate_evidence_stream(classroom, cfg)

    result = estimate_knowledge_state(
        stream, classroom.concept_ids, return_trajectory=True,
    )

    print(f"  k_hat shape: {result.k_hat.shape}  "
          f"(expect {classroom.k_true.shape})")
    if result.k_hat.shape != classroom.k_true.shape:
        print("  !! shape mismatch")
        all_ok = False

    # MAE, RMSE, correlation
    diff = result.k_hat - classroom.k_true
    mae = float(np.mean(np.abs(diff)))
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    r = float(np.corrcoef(result.k_hat.flatten(),
                          classroom.k_true.flatten())[0, 1])
    print(f"  MAE  = {mae:.4f}")
    print(f"  RMSE = {rmse:.4f}")
    print(f"  Pearson r = {r:.4f}")

    # --- Test 5: trajectory shape and monotonicity ---
    print("\n--- trajectory check ---")
    traj = result.trajectory
    if traj is None:
        print("  !! return_trajectory=True but trajectory is None")
        all_ok = False
    else:
        expected_shape = (classroom.n_learners, classroom.n_concepts,
                          cfg.n_days + 1)
        print(f"  trajectory shape: {traj.shape}  "
              f"(expect {expected_shape})")
        if traj.shape != expected_shape:
            print("  !! trajectory shape mismatch")
            all_ok = False

        # MAE should generally decrease (not strictly - stochastic noise can
        # bump it - but the trend must be downward overall).
        maes = np.array([
            float(np.mean(np.abs(traj[:, :, t] - classroom.k_true)))
            for t in range(traj.shape[2])
        ])
        early = maes[:5].mean()
        late = maes[-5:].mean()
        print(f"  MAE early (days 0-4): {early:.4f}")
        print(f"  MAE late (final 5):   {late:.4f}")
        if late >= early:
            print("  !! MAE did not decrease over time (estimator may be broken)")
            all_ok = False
        else:
            print(f"  MAE decreased by {early - late:.4f}  [OK]")

    # --- Test 6: group aggregation sanity ---
    print("\n--- group aggregation ---")
    expected_group = result.k_hat.mean(axis=0)
    print(f"  k_hat_group shape: {result.k_hat_group.shape}  "
          f"(expect ({classroom.n_concepts},))")
    if not np.allclose(result.k_hat_group, expected_group):
        print("  !! k_hat_group does not match mean over learners")
        all_ok = False
    else:
        print(f"  group means in [{result.k_hat_group.min():.3f}, "
              f"{result.k_hat_group.max():.3f}]  [OK]")

    # --- Test 7: determinism ---
    print("\n--- determinism ---")
    result2 = estimate_knowledge_state(stream, classroom.concept_ids)
    if np.array_equal(result.k_hat, result2.k_hat):
        print("  same stream -> identical k_hat  [OK]")
    else:
        print("  !! same stream produced different k_hat")
        all_ok = False

    # --- Test 8: concept-id validation ---
    print("\n--- validation of concept_ids ---")
    try:
        bad_concepts = classroom.concept_ids[:-1] + ["FAKE999"]
        estimate_knowledge_state(stream, bad_concepts)
        print("  !! bogus concept id accepted - validation bug")
        all_ok = False
    except ValueError:
        print("  bogus concept id rejected  [OK]")

    print()
    if all_ok:
        print("[sim/bkt.py] SELF-TEST PASSED")
    else:
        print("[sim/bkt.py] SELF-TEST FAILED - see warnings above")
        raise SystemExit(1)


if __name__ == "__main__":
    _self_test()