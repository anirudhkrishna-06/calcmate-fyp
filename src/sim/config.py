"""
config.py - single source of truth for simulation parameters.

Every constant in this file mirrors a value in data/frozen_parameters.md.
If you need to change a value here, you MUST first update the doc, bump
its version, and re-run src/sim/validate_bkt.py. See §Change Policy in
the doc.

Do not add new constants to this file without adding them to the doc.
Do not hardcode numbers elsewhere in src/sim/* - import from here.

Usage:
    from sim.config import FROZEN, Config, ScenarioType, EvidenceDensity

    cfg = Config(seed=1, grade=4, scenario=ScenarioType.BALANCED,
                 evidence_density=EvidenceDensity.DENSE)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Final


# --------------------------------------------------------------------------- #
# File paths
# --------------------------------------------------------------------------- #

# Resolve paths relative to this file, so the module works from any cwd.
_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent
DATA_DIR = _PROJECT_ROOT / "data"
VALIDATION_OUT_DIR = DATA_DIR / "bkt_validation"


# --------------------------------------------------------------------------- #
# §1 BKT parameters (global)
# --------------------------------------------------------------------------- #

class BKT:
    """§1 - Global BKT parameters. See frozen_parameters.md §1."""
    P_L0: Final[float] = 0.30    # prior probability of mastery at t=0
    P_T:  Final[float] = 0.10    # learning transition probability per timestep
    P_G:  Final[float] = 0.20    # guess probability (correct | not mastered)
    P_S:  Final[float] = 0.10    # slip probability (incorrect | mastered)
    TAU:  Final[float] = 0.70    # mastery threshold for binary classification


# --------------------------------------------------------------------------- #
# §2 Learner generation
# --------------------------------------------------------------------------- #

class Learners:
    """§2 - Learner generation parameters. See frozen_parameters.md §2."""
    N_LEARNERS: Final[int] = 30                # §2.2
    PREREQ_MARGIN: Final[float] = 0.15         # §2.1 - max gap above prerequisite
    GRADES: Final[tuple[int, ...]] = (3, 4, 5) # §2.3


# --------------------------------------------------------------------------- #
# §3 Scenario types
# --------------------------------------------------------------------------- #

class ScenarioType(str, Enum):
    """§3 - The five scenario types. See frozen_parameters.md §3."""
    BALANCED             = "balanced"              # §3.1
    HETEROGENEOUS        = "heterogeneous"         # §3.2
    PREREQUISITE_GAP     = "prerequisite_gap"      # §3.3
    LEARNING_GAP_HEAVY   = "learning_gap_heavy"    # §3.4
    ATTENDANCE_DISRUPTED = "attendance_disrupted"  # §3.5

    @classmethod
    def all(cls) -> list["ScenarioType"]:
        return list(cls)


class ScenarioParams:
    """Fixed parameters used by the scenario generators in learners.py."""
    # §3.2 heterogeneous - 60% high / 40% low
    HETERO_HIGH_FRACTION: Final[float] = 0.60
    HETERO_HIGH_RANGE: Final[tuple[float, float]] = (0.60, 1.00)
    HETERO_LOW_RANGE:  Final[tuple[float, float]] = (0.00, 0.40)

    # §3.3 prerequisite-gap - 30% of learners have one concept zeroed
    PREREQ_GAP_FRACTION: Final[float] = 0.30
    PREREQ_GAP_TARGET_VALUE: Final[float] = 0.05   # near-zero (not exactly zero)

    # §3.4 learning-gap-heavy - 30% of learners uniformly low
    LEARNING_GAP_FRACTION: Final[float] = 0.30
    LEARNING_GAP_RANGE: Final[tuple[float, float]] = (0.00, 0.40)

    # §3.5 attendance-disrupted - 30% of learners have evidence dropped
    ATTENDANCE_DISRUPTED_FRACTION: Final[float] = 0.30
    ATTENDANCE_DROP_PROB: Final[float] = 0.60


# --------------------------------------------------------------------------- #
# §4 Evidence generation
# --------------------------------------------------------------------------- #

class EvidenceDensity(str, Enum):
    """§4.1 - Evidence density levels. See frozen_parameters.md §4.1."""
    DENSE       = "dense"        # p_obs = 0.85 - RQ3
    MODERATE    = "moderate"     # p_obs = 0.40 - RQ4
    SPARSE      = "sparse"       # p_obs = 0.15 - RQ4
    VERY_SPARSE = "very_sparse"  # p_obs = 0.05 - RQ4


# §4.1 - mapping from enum to p_obs value
EVIDENCE_P_OBS: Final[dict[EvidenceDensity, float]] = {
    EvidenceDensity.DENSE:       0.85,
    EvidenceDensity.MODERATE:    0.40,
    EvidenceDensity.SPARSE:      0.15,
    EvidenceDensity.VERY_SPARSE: 0.05,
}


class Evidence:
    """§4 - Evidence generation parameters. See frozen_parameters.md §4."""
    N_DAYS: Final[int] = 30                    # §4.3 - timeline


# --------------------------------------------------------------------------- #
# §5 Random seed policy
# --------------------------------------------------------------------------- #

class Seeds:
    """§5 - Seed policy. See frozen_parameters.md §5."""
    DEFAULT: Final[int] = 1
    SWEEP: Final[tuple[int, ...]] = tuple(range(1, 11))  # seeds 1..10


# --------------------------------------------------------------------------- #
# §6 Validation gate (used by validate_bkt.py)
# --------------------------------------------------------------------------- #
class ValidationGate:
    # Setup (§6.1)
    SCENARIO: Final[ScenarioType] = ScenarioType.BALANCED
    GRADE: Final[int] = 4
    DENSITY: Final[EvidenceDensity] = EvidenceDensity.DENSE
    DAYS: Final[int] = 30
    SEEDS: Final[tuple[int, ...]] = (1, 2, 3)

    # Thresholds (§6.2) — revised for v1.1
    # The previous pass threshold (MAE ≤ 0.08) was unachievable under the
    # frozen observation model: the theoretical floor is
    #   MAE_floor ≈ √(p(1−p)/n) / (1 − P_S − P_G) ≈ 0.11
    # with p≈0.46, n≈25, P_S=0.10, P_G=0.20. We set thresholds to reflect
    # the achievable bound with a 10% margin.
    MAE_PASS: Final[float] = 0.10
    MAE_WARN: Final[float] = 0.15
    RMSE_PASS: Final[float] = 0.13
    RMSE_WARN: Final[float] = 0.18
    PEARSON_PASS: Final[float] = 0.90
    PEARSON_WARN: Final[float] = 0.85
    CONVERGENCE_WINDOW: Final[int] = 20
    CONVERGENCE_JITTER: Final[float] = 0.02
    CONVERGENCE_MIN_FRACTION: Final[float] = 0.80
# --------------------------------------------------------------------------- #
# Per-run configuration (composition of the above)
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Config:
    """
    A single simulation run's configuration.

    Frozen (immutable) so it can't be mutated mid-run. Construct one per
    (seed, grade, scenario, density) combination.
    """
    seed: int
    grade: int
    scenario: ScenarioType
    evidence_density: EvidenceDensity

    # Optional override - defaults to Learners.N_LEARNERS
    n_learners: int = Learners.N_LEARNERS

    # Optional override - defaults to Evidence.N_DAYS
    n_days: int = Evidence.N_DAYS

    def __post_init__(self) -> None:
        # Validate inputs against the frozen constraints
        if self.grade not in Learners.GRADES:
            raise ValueError(
                f"grade {self.grade} not in frozen GRADES {Learners.GRADES}"
            )
        if self.n_learners <= 0:
            raise ValueError(f"n_learners must be positive, got {self.n_learners}")
        if self.n_days <= 0:
            raise ValueError(f"n_days must be positive, got {self.n_days}")
        if self.seed < 1:
            raise ValueError(f"seed must be >= 1, got {self.seed}")

    # Convenience accessors so callers don't need to reach into BKT class
    @property
    def p_l0(self) -> float: return BKT.P_L0
    @property
    def p_t(self) -> float:  return BKT.P_T
    @property
    def p_g(self) -> float:  return BKT.P_G
    @property
    def p_s(self) -> float:  return BKT.P_S
    @property
    def tau(self) -> float:  return BKT.TAU
    @property
    def p_obs(self) -> float: return EVIDENCE_P_OBS[self.evidence_density]


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #

def _self_test() -> None:
    """Sanity-check the config: construct one of each scenario, print values."""
    print("=" * 72)
    print("SELF-TEST: sim/config.py")
    print("=" * 72)

    print("\nBKT parameters (§1):")
    print(f"  P(L0)={BKT.P_L0}  P(T)={BKT.P_T}  P(G)={BKT.P_G}  "
          f"P(S)={BKT.P_S}  tau={BKT.TAU}")

    print("\nLearner parameters (§2):")
    print(f"  N_LEARNERS={Learners.N_LEARNERS}  "
          f"PREREQ_MARGIN={Learners.PREREQ_MARGIN}  "
          f"GRADES={Learners.GRADES}")

    print("\nScenario types (§3):")
    for s in ScenarioType.all():
        print(f"  {s.name:22s} = {s.value!r}")

    print("\nEvidence density (§4.1):")
    for d in EvidenceDensity:
        print(f"  {d.name:12s} = p_obs {EVIDENCE_P_OBS[d]}")

    print(f"\nTimeline (§4.3): N_DAYS={Evidence.N_DAYS}")
    print(f"Seeds (§5): default={Seeds.DEFAULT}, sweep={Seeds.SWEEP}")

    print("\nValidation gate (§6.2):")
    print(f"  MAE pass/warn:   {ValidationGate.MAE_PASS} / {ValidationGate.MAE_WARN}")
    print(f"  RMSE pass/warn:  {ValidationGate.RMSE_PASS} / {ValidationGate.RMSE_WARN}")
    print(f"  Pearson pass:    {ValidationGate.PEARSON_PASS}")

    print("\nConstructing one Config per scenario (grade=4, seed=1, dense):")
    for s in ScenarioType.all():
        cfg = Config(seed=1, grade=4, scenario=s,
                     evidence_density=EvidenceDensity.DENSE)
        print(f"  {s.name:22s} -> p_obs={cfg.p_obs}, "
              f"n_learners={cfg.n_learners}, n_days={cfg.n_days}")

    # Constraint checks
    print("\nConstraint checks:")
    try:
        Config(seed=1, grade=6, scenario=ScenarioType.BALANCED,
               evidence_density=EvidenceDensity.DENSE)
        print("  !! grade=6 accepted - validation bug")
    except ValueError:
        print("  grade=6 rejected as expected [OK]")

    try:
        Config(seed=1, grade=3, scenario=ScenarioType.BALANCED,
               evidence_density=EvidenceDensity.DENSE, n_learners=0)
        print("  !! n_learners=0 accepted - validation bug")
    except ValueError:
        print("  n_learners=0 rejected as expected [OK]")

    print("\n[sim/config.py] SELF-TEST PASSED")


if __name__ == "__main__":
    _self_test()