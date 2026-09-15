"""
evidence.py - simulated assessment observations over a synthetic classroom.

Takes a Classroom (from learners.py) and produces a chronological stream of
binary (correct / incorrect) observations, according to the frozen model in
frozen_parameters.md §4.

Key design notes:
  - Evidence is a FLAT LIST of events, sorted by (learner, concept, day).
    This mirrors how real LMS event logs arrive, is trivially serializable
    to JSON, and gives BKT a natural iteration order.
  - Observation existence is Bernoulli(p_obs) per (learner, concept, day)
    triple, independent across triples. This is §4.1 of the frozen doc.
  - Observation value is drawn from the standard BKT observation model:
        P(correct | K_true, G, S) = K_true·(1−S) + (1−K_true)·G
    This is §4.2.
  - The attendance_disrupted scenario applies an ADDITIONAL drop probability
    on top of p_obs, for a fraction of learners. This is §3.5 and §4.
  - K_true is NEVER exposed in the returned evidence. Only observations.
    This is the entire point of the validation gate.

Usage:
    from sim.config import Config, ScenarioType, EvidenceDensity
    from sim.learners import generate_classroom
    from sim.evidence import simulate_evidence_stream, EvidenceStream

    cfg = Config(seed=1, grade=4, scenario=ScenarioType.BALANCED,
                 evidence_density=EvidenceDensity.DENSE)
    classroom = generate_classroom(cfg)
    stream = simulate_evidence_stream(classroom, cfg)

    for event in stream.events[:5]:
        print(event.learner_id, event.concept_id, event.day, event.correct)

Self-test:
    python -m sim.evidence
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_SRC_DIR = _THIS_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from sim.config import (  # noqa: E402
    BKT,
    Config,
    EVIDENCE_P_OBS,
    Evidence,
    EvidenceDensity,
    ScenarioParams,
    ScenarioType,
)
from sim.learners import Classroom  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("evidence")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Observation:
    """
    A single assessment observation.

    Days are 0-indexed internally. Day 0 = first school day after baseline.
    """
    learner_idx: int      # index into Classroom.learner_ids
    concept_id: str       # concept being assessed
    day: int              # 0-indexed day
    correct: bool         # True if the learner answered correctly

    # convenience denormalized fields (also present in the stream)
    learner_id: int = -1  # external learner ID (usually == learner_idx)


@dataclass
class EvidenceStream:
    """
    The full observation sequence for one classroom.

    Events are sorted by (learner_idx, concept_id, day). This is the
    order BKT will iterate over for a single learner, but BKT for a single
    concept is what matters — so we also provide a helper to group.

    Attributes:
        config: the Config this stream was generated under.
        observations: flat list of Observation, sorted chronologically.
        n_learners: number of learners in the classroom.
        n_concepts: number of concepts in the grade.
        n_days: number of days simulated.
        metadata: summary stats for logging / reports.
    """
    config: Config
    observations: list[Observation]
    n_learners: int
    n_concepts: int
    n_days: int
    metadata: dict

    @property
    def n_events(self) -> int:
        return len(self.observations)

    def observations_for(self, learner_idx: int, concept_id: str) -> list[Observation]:
        """
        Return all observations for a specific (learner, concept) pair,
        sorted by day ascending. This is the canonical input for BKT.
        """
        return [
            o for o in self.observations
            if o.learner_idx == learner_idx and o.concept_id == concept_id
        ]

    def group_by_learner_concept(self) -> dict[tuple[int, str], list[Observation]]:
        """
        Precompute a dict for fast BKT iteration:
            (learner_idx, concept_id) -> sorted list of observations.
        """
        groups: dict[tuple[int, str], list[Observation]] = defaultdict(list)
        for o in self.observations:
            groups[(o.learner_idx, o.concept_id)].append(o)
        # Each group is already in day order because we sort globally
        return dict(groups)

    def to_json(self, path: Path) -> None:
        """Serialize to JSON for debugging / archival."""
        payload = {
            "config": {
                "seed": self.config.seed,
                "grade": self.config.grade,
                "scenario": self.config.scenario.value,
                "evidence_density": self.config.evidence_density.value,
                "n_learners": self.config.n_learners,
                "n_days": self.config.n_days,
            },
            "n_events": self.n_events,
            "metadata": self.metadata,
            "observations": [asdict(o) for o in self.observations],
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)


# --------------------------------------------------------------------------- #
# Observation value model
# --------------------------------------------------------------------------- #

def p_correct_given_ktrue(k_true: float, p_guess: float, p_slip: float) -> float:
    """
    §4.2 - Standard BKT observation model.

        P(correct | K_true) = K_true·(1−P_S) + (1−K_true)·P_G

    Sanity: if K_true = 1.0 and P_S = 0.10, P(correct) = 0.90.
            if K_true = 0.0 and P_G = 0.20, P(correct) = 0.20.
    """
    return k_true * (1.0 - p_slip) + (1.0 - k_true) * p_guess


# --------------------------------------------------------------------------- #
# Main simulation
# --------------------------------------------------------------------------- #

def simulate_evidence_stream(classroom: Classroom, config: Config) -> EvidenceStream:
    """
    Generate a chronological evidence stream for a classroom.

    Deterministic given (config.seed). Uses a fresh RNG seeded from
    config.seed so evidence is reproducible independently of learners.py
    (which uses its own RNG from the same seed).
    """
    t0 = time.perf_counter()

    rng = np.random.default_rng(config.seed + 10_000)  # offset to avoid RNG collisions with learners.py

    p_obs = EVIDENCE_P_OBS[config.evidence_density]
    p_guess = BKT.P_G
    p_slip = BKT.P_S
    n_days = config.n_days
    n_learners = classroom.n_learners
    concept_ids = classroom.concept_ids

    log.info(
        f"[evidence] simulating: scenario={config.scenario.value}, "
        f"density={config.evidence_density.value} (p_obs={p_obs}), "
        f"n_learners={n_learners}, n_concepts={len(concept_ids)}, "
        f"n_days={n_days}"
    )

    # --- Attendance disruption mask (§3.5) ---
    # For attendance_disrupted, we designate 30% of learners as "disrupted".
    # For all other scenarios, the mask is all False.
    attendance_mask = np.zeros(n_learners, dtype=bool)
    if config.scenario == ScenarioType.ATTENDANCE_DISRUPTED:
        n_disrupted = int(round(n_learners
                                * ScenarioParams.ATTENDANCE_DISRUPTED_FRACTION))
        disrupted_learners = rng.choice(n_learners, size=n_disrupted, replace=False)
        attendance_mask[disrupted_learners] = True
        log.info(f"[evidence] attendance-disrupted: {n_disrupted}/{n_learners} "
                 f"learners with p_drop={ScenarioParams.ATTENDANCE_DROP_PROB}")

    # --- Main loop: (learner, concept, day) triples ---
    observations: list[Observation] = []

    # We iterate concept-major then learner-major so the final sort is cheap.
    # numpy vectorization over learners within a (concept, day) is the
    # efficiency play: each (concept, day) gets n_learners-vectorized draws.
    for concept_i, concept_id in enumerate(concept_ids):
        k_true_col = classroom.k_true[:, concept_i]  # shape (n_learners,)

        # Precompute P(correct | K_true) for all learners once per concept
        p_correct = (
            k_true_col * (1.0 - p_slip)
            + (1.0 - k_true_col) * p_guess
        )

        for day in range(n_days):
            # Draw whether each learner has an observation this day
            obs_mask = rng.random(n_learners) < p_obs

            # Apply attendance disruption: extra drop for disrupted learners
            if config.scenario == ScenarioType.ATTENDANCE_DISRUPTED:
                drop_mask = rng.random(n_learners) < ScenarioParams.ATTENDANCE_DROP_PROB
                # A disrupted learner loses the observation if BOTH conditions
                # apply: they're disrupted AND the drop-coin fires
                extra_drop = attendance_mask & drop_mask
                obs_mask = obs_mask & ~extra_drop

            # For learners with an observation, draw correct/incorrect
            # We only draw for observed learners to avoid wasting RNG.
            observed_indices = np.where(obs_mask)[0]
            if observed_indices.size == 0:
                continue

            # Draw correct/incorrect for observed learners
            draws = rng.random(observed_indices.size)
            correct_flags = draws < p_correct[observed_indices]

            for u, correct in zip(observed_indices, correct_flags):
                observations.append(Observation(
                    learner_idx=int(u),
                    concept_id=concept_id,
                    day=day,
                    correct=bool(correct),
                    learner_id=classroom.learner_ids[int(u)],
                ))

    # Sort by (learner_idx, concept_id, day) for deterministic output
    observations.sort(key=lambda o: (o.learner_idx, o.concept_id, o.day))

    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Metadata for logs
    n_events = len(observations)
    expected_events = n_learners * len(concept_ids) * n_days * p_obs
    if config.scenario == ScenarioType.ATTENDANCE_DISRUPTED:
        # Effective p_obs for disrupted learners is lower
        frac_disrupted = ScenarioParams.ATTENDANCE_DISRUPTED_FRACTION
        extra_drop_prob = frac_disrupted * ScenarioParams.ATTENDANCE_DROP_PROB
        expected_events *= (1.0 - extra_drop_prob)

    metadata = {
        "n_events": n_events,
        "expected_events_unrounded": expected_events,
        "n_learners": n_learners,
        "n_concepts": len(concept_ids),
        "n_days": n_days,
        "p_obs": p_obs,
        "scenario": config.scenario.value,
        "density": config.evidence_density.value,
        "elapsed_ms": round(elapsed_ms, 2),
    }

    log.info(f"[evidence] {n_events} observations generated "
             f"(expected ~{expected_events:.0f}) in {elapsed_ms:.1f} ms")

    return EvidenceStream(
        config=config,
        observations=observations,
        n_learners=n_learners,
        n_concepts=len(concept_ids),
        n_days=n_days,
        metadata=metadata,
    )


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #

def _summarize(stream: EvidenceStream) -> dict:
    """Compute summary statistics of an evidence stream."""
    per_learner = defaultdict(int)
    per_concept = defaultdict(int)
    per_day = defaultdict(int)
    correct_total = 0

    for o in stream.observations:
        per_learner[o.learner_idx] += 1
        per_concept[o.concept_id] += 1
        per_day[o.day] += 1
        if o.correct:
            correct_total += 1

    return {
        "n_events": stream.n_events,
        "events_per_learner_min": min(per_learner.values()) if per_learner else 0,
        "events_per_learner_max": max(per_learner.values()) if per_learner else 0,
        "events_per_concept_min": min(per_concept.values()) if per_concept else 0,
        "events_per_concept_max": max(per_concept.values()) if per_concept else 0,
        "days_covered": len(per_day),
        "overall_correct_rate": correct_total / stream.n_events if stream.n_events else 0.0,
    }


def _self_test() -> None:
    print("=" * 72)
    print("SELF-TEST: sim/evidence.py")
    print("=" * 72)

    from sim.learners import generate_classroom

    all_ok = True
    grade = 4
    seed = 1

    for scenario in ScenarioType.all():
        print(f"\n--- scenario: {scenario.value} ---")
        cfg = Config(
            seed=seed, grade=grade, scenario=scenario,
            evidence_density=EvidenceDensity.DENSE,
        )
        classroom = generate_classroom(cfg)
        stream = simulate_evidence_stream(classroom, cfg)
        summary = _summarize(stream)

        print(f"  n_events = {summary['n_events']}")
        print(f"  events/learner: min={summary['events_per_learner_min']} "
              f"max={summary['events_per_learner_max']}")
        print(f"  events/concept: min={summary['events_per_concept_min']} "
              f"max={summary['events_per_concept_max']}")
        print(f"  days covered: {summary['days_covered']}")
        print(f"  overall correct rate: {summary['overall_correct_rate']:.3f}")

        # --- Sanity checks ---
        if summary["n_events"] == 0:
            print(f"  !! no events generated")
            all_ok = False

        # Rough sanity: expected ~30·19·30·0.85 ≈ 14,500
        expected_n = stream.metadata["expected_events_unrounded"]
        tolerance = max(0.10 * expected_n, 200)  # 10% or 200 events, whichever larger
        if abs(summary["n_events"] - expected_n) > tolerance:
            print(f"  !! event count {summary['n_events']} far from "
                f"expected {expected_n:.0f} (tolerance ±{tolerance:.0f})")
            all_ok = False
        else:
            delta_pct = (summary["n_events"] - expected_n) / expected_n * 100
            print(f"  event count within tolerance of expected "
                f"({expected_n:.0f}, deviation {delta_pct:+.2f}%) [OK]")

        # Correct-rate should be between P_G and 1-P_S for a balanced-ish K_true
        mean_k = classroom.k_true.mean()
        expected_correct = mean_k * (1 - BKT.P_S) + (1 - mean_k) * BKT.P_G
        observed_correct = summary["overall_correct_rate"]
        if abs(observed_correct - expected_correct) > 0.05:
            print(f"  !! correct rate {observed_correct:.3f} differs from "
                  f"expected {expected_correct:.3f} by >0.05")
            all_ok = False
        else:
            print(f"  correct rate matches expectation ({expected_correct:.3f}) [OK]")

        # --- Attendance-specific check ---
        if scenario == ScenarioType.ATTENDANCE_DISRUPTED:
            # Roughly 30% of learners should have fewer events
            per_learner = defaultdict(int)
            for o in stream.observations:
                per_learner[o.learner_idx] += 1
            counts = np.array([per_learner[u] for u in range(classroom.n_learners)])
            low_count = int((counts < counts.mean() * 0.9).sum())
            print(f"  learners with <90% median events: {low_count} "
                  f"(expected ~{int(0.3 * classroom.n_learners)})")
            if low_count < int(0.2 * classroom.n_learners):
                print(f"  !! too few attendance-disrupted learners visible")
                all_ok = False

        # --- Determinism check on one scenario ---
        if scenario == ScenarioType.BALANCED:
            stream2 = simulate_evidence_stream(classroom, cfg)
            if stream2.n_events == stream.n_events and all(
                a.correct == b.correct and a.day == b.day
                for a, b in zip(stream.observations, stream2.observations)
            ):
                print(f"  determinism: same seed -> identical stream [OK]")
            else:
                print(f"  !! determinism check failed")
                all_ok = False

    # --- Different seeds give different streams ---
    print("\n--- cross-seed check ---")
    cfg_a = Config(seed=1, grade=4, scenario=ScenarioType.BALANCED,
                   evidence_density=EvidenceDensity.DENSE)
    cfg_b = Config(seed=2, grade=4, scenario=ScenarioType.BALANCED,
                   evidence_density=EvidenceDensity.DENSE)
    ca = generate_classroom(cfg_a)
    cb = generate_classroom(cfg_b)
    sa = simulate_evidence_stream(ca, cfg_a)
    sb = simulate_evidence_stream(cb, cfg_b)
    if sa.n_events != sb.n_events or any(
        a.correct != b.correct
        for a, b in zip(sa.observations, sb.observations)
    ):
        print("  different seed -> different stream [OK]")
    else:
        print("  !! different seeds produced identical streams")
        all_ok = False

    # --- Attendance scenario should produce FEWER events than balanced ---
    print("\n--- attendance disruption check ---")
    cfg_bal = Config(seed=1, grade=4, scenario=ScenarioType.BALANCED,
                     evidence_density=EvidenceDensity.DENSE)
    cfg_att = Config(seed=1, grade=4, scenario=ScenarioType.ATTENDANCE_DISRUPTED,
                     evidence_density=EvidenceDensity.DENSE)
    classroom_bal = generate_classroom(cfg_bal)
    classroom_att = generate_classroom(cfg_att)
    s_bal = simulate_evidence_stream(classroom_bal, cfg_bal)
    s_att = simulate_evidence_stream(classroom_att, cfg_att)
    reduction = 1.0 - s_att.n_events / s_bal.n_events
    print(f"  balanced: {s_bal.n_events} events")
    print(f"  disrupted: {s_att.n_events} events  "
          f"(reduction {reduction * 100:.1f}%)")
    # Expect ~18% reduction: 30% of learners × 60% drop = 18%
    if not (0.10 <= reduction <= 0.25):
        print(f"  !! reduction outside expected range [10%, 25%]")
        all_ok = False
    else:
        print("  attendance disruption producing expected reduction [OK]")

    print()
    if all_ok:
        print("[sim/evidence.py] SELF-TEST PASSED")
    else:
        print("[sim/evidence.py] SELF-TEST FAILED - see warnings above")
        raise SystemExit(1)


if __name__ == "__main__":
    _self_test()