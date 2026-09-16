"""
validate_bkt.py - the estimator validation gate.

Frozen parameters §6 requires that any estimator feeding the allocator
must satisfy:

    MAE ≤ 0.08          (pass)   ≤ 0.12 (warn)
    RMSE ≤ 0.10         (pass)   ≤ 0.15 (warn)
    Pearson r ≥ 0.90    (pass)   ≥ 0.80 (warn)
    MAE non-increasing over the first 20 timesteps (80% of concepts)

This script runs the validation across the frozen setup (balanced,
grade 4, dense evidence, seeds 1-3), evaluates every registered
estimator, and reports pass/warn/fail per estimator.

Artifacts written to data/bkt_validation/:
    summary.json         - full numeric report per estimator
    ktrue_vs_khat.png    - scatter plot of K_hat vs K_true, per estimator
    convergence.png      - MAE vs day, per estimator per seed

Exit code:
    0 if at least one estimator PASSES
    1 if the best estimator only WARNS
    2 if all estimators FAIL

Usage:
    python -m sim.validate_bkt
    python -m sim.validate_bkt --out-dir ../data/bkt_validation
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_SRC_DIR = _THIS_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from sim.config import (  # noqa: E402
    Config,
    EvidenceDensity,
    ScenarioType,
    ValidationGate,
    VALIDATION_OUT_DIR,
)
from sim.estimators import (  # noqa: E402
    EstimateResult,
    MasteryEstimator,
    all_estimators,
)
from sim.evidence import simulate_evidence_stream  # noqa: E402
from sim.learners import generate_classroom  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("validate_bkt")


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def compute_metrics(k_hat: np.ndarray, k_true: np.ndarray) -> dict:
    """Compute MAE, RMSE, Pearson r, and mean bias between K_hat and K_true."""
    if k_hat.shape != k_true.shape:
        raise ValueError(
            f"shape mismatch: k_hat {k_hat.shape}, k_true {k_true.shape}"
        )
    diff = k_hat - k_true
    mae = float(np.mean(np.abs(diff)))
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    # Pearson correlation; guard against zero-variance inputs
    if k_hat.std() < 1e-12 or k_true.std() < 1e-12:
        r = 0.0
    else:
        r = float(np.corrcoef(k_hat.flatten(), k_true.flatten())[0, 1])
    bias = float(k_hat.mean() - k_true.mean())
    return {"mae": mae, "rmse": rmse, "pearson_r": r, "mean_bias": bias}


def compute_convergence(k_true: np.ndarray,
                        trajectory: np.ndarray) -> np.ndarray:
    """
    Return MAE vs timestep. trajectory has shape
    (n_learners, n_concepts, T+1). We compute MAE at each t in [0, T].
    """
    T = trajectory.shape[2]
    return np.array([
        float(np.mean(np.abs(trajectory[:, :, t] - k_true)))
        for t in range(T)
    ])


def check_convergence(convergence: np.ndarray,
                      window: int,
                      jitter: float,
                      min_fraction: float) -> tuple[bool, float]:
    """
    Frozen §6.2: MAE over first `window` timesteps must be non-increasing
    (allowing `jitter` tolerance). We return (ok, fraction_ok) where
    fraction_ok is the fraction of timesteps within the window where
    MAE did not increase by more than `jitter`.
    """
    window = min(window, len(convergence))
    if window < 2:
        return True, 1.0
    deltas = np.diff(convergence[:window])
    ok_steps = deltas <= jitter
    fraction = float(ok_steps.mean())
    return fraction >= min_fraction, fraction


# --------------------------------------------------------------------------- #
# Gate decision
# --------------------------------------------------------------------------- #

def classify(mae: float, rmse: float, r: float,
             conv_ok: bool) -> str:
    """
    Return 'PASS', 'WARN', or 'FAIL' per frozen_parameters.md §6.2.

    The gate requires:
      MAE ≤ 0.08 AND RMSE ≤ 0.10 AND r ≥ 0.90 AND conv_ok  -> PASS
      MAE ≤ 0.12 AND RMSE ≤ 0.15 AND r ≥ 0.80 AND conv_ok  -> WARN
      otherwise                                            -> FAIL
    """
    passes = (
        mae <= ValidationGate.MAE_PASS
        and rmse <= ValidationGate.RMSE_PASS
        and r >= ValidationGate.PEARSON_PASS
        and conv_ok
    )
    if passes:
        return "PASS"
    warns = (
        mae <= ValidationGate.MAE_WARN
        and rmse <= ValidationGate.RMSE_WARN
        and r >= ValidationGate.PEARSON_WARN
        and conv_ok
    )
    if warns:
        return "WARN"
    return "FAIL"


# --------------------------------------------------------------------------- #
# Single-seed run
# --------------------------------------------------------------------------- #

def run_one_seed(
    estimator: MasteryEstimator,
    seed: int,
    grade: int,
    scenario: ScenarioType,
    density: EvidenceDensity,
    n_days: int,
) -> dict:
    """
    Run a single (estimator, seed) validation trial and return a report
    with metrics + convergence data.
    """
    cfg = Config(
        seed=seed, grade=grade, scenario=scenario,
        evidence_density=density, n_days=n_days,
    )
    classroom = generate_classroom(cfg)
    stream = simulate_evidence_stream(classroom, cfg)

    result = estimator.estimate(
        stream, classroom.concept_ids, return_trajectory=True,
    )

    metrics = compute_metrics(result.k_hat, classroom.k_true)

    convergence = None
    conv_ok = True
    conv_fraction = 1.0
    if result.trajectory is not None:
        convergence = compute_convergence(
            classroom.k_true, result.trajectory,
        )
        conv_ok, conv_fraction = check_convergence(
            convergence,
            window=ValidationGate.CONVERGENCE_WINDOW,
            jitter=ValidationGate.CONVERGENCE_JITTER,
            min_fraction=ValidationGate.CONVERGENCE_MIN_FRACTION,
        )

    return {
        "seed": seed,
        "estimator": estimator.name,
        "config": {
            "grade": grade,
            "scenario": scenario.value,
            "density": density.value,
            "n_days": n_days,
            "n_learners": cfg.n_learners,
            "n_concepts": len(classroom.concept_ids),
        },
        "metrics": metrics,
        "convergence": convergence.tolist() if convergence is not None else None,
        "convergence_ok": conv_ok,
        "convergence_fraction_ok": conv_fraction,
        "elapsed_ms": result.elapsed_ms,
        "n_observations": result.n_observations_consumed,
    }


# --------------------------------------------------------------------------- #
# Multi-seed aggregation
# --------------------------------------------------------------------------- #

def aggregate_seeds(per_seed: list[dict]) -> dict:
    """Aggregate metrics across seeds (mean and std)."""
    maes = np.array([r["metrics"]["mae"] for r in per_seed])
    rmses = np.array([r["metrics"]["rmse"] for r in per_seed])
    rs = np.array([r["metrics"]["pearson_r"] for r in per_seed])
    biases = np.array([r["metrics"]["mean_bias"] for r in per_seed])

    conv_ok_all = all(r["convergence_ok"] for r in per_seed)

    # Worst-case (max) values for the gate — conservative
    return {
        "n_seeds": len(per_seed),
        "mae_mean": float(maes.mean()),
        "mae_std": float(maes.std(ddof=1)) if len(maes) > 1 else 0.0,
        "mae_worst": float(maes.max()),
        "rmse_mean": float(rmses.mean()),
        "rmse_std": float(rmses.std(ddof=1)) if len(rmses) > 1 else 0.0,
        "rmse_worst": float(rmses.max()),
        "pearson_mean": float(rs.mean()),
        "pearson_worst": float(rs.min()),
        "bias_mean": float(biases.mean()),
        "convergence_ok_all": conv_ok_all,
    }


# --------------------------------------------------------------------------- #
# Plots (optional - only if matplotlib available)
# --------------------------------------------------------------------------- #

def _try_import_matplotlib():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        return plt
    except ImportError:
        return None


def write_plots(
    out_dir: Path,
    ktrue_by_estimator: dict[str, np.ndarray],
    khat_by_estimator: dict[str, np.ndarray],
    convergence_by_estimator: dict[str, list[np.ndarray]],
) -> None:
    plt = _try_import_matplotlib()
    if plt is None:
        log.warning("[validate] matplotlib not available; skipping plots")
        return

    out_dir.mkdir(parents=True, exist_ok=True)

    # --- Scatter: K_true vs K_hat -------------------------------------- #
    n_est = len(khat_by_estimator)
    if n_est == 0:
        return
    fig, axes = plt.subplots(1, n_est, figsize=(5 * n_est, 5), squeeze=False)
    for ax, name in zip(axes[0], khat_by_estimator.keys()):
        k_true = ktrue_by_estimator[name]
        k_hat = khat_by_estimator[name]
        ax.scatter(k_true, k_hat, alpha=0.3, s=8)
        ax.plot([0, 1], [0, 1], "k--", linewidth=1)
        ax.set_xlabel("K_true")
        ax.set_ylabel("K_hat")
        ax.set_title(name)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(out_dir / "ktrue_vs_khat.png", dpi=120)
    plt.close(fig)
    log.info(f"[validate] wrote {out_dir / 'ktrue_vs_khat.png'}")

    # --- Convergence: MAE vs timestep ---------------------------------- #
    fig, ax = plt.subplots(figsize=(8, 5))
    for name, conv_list in convergence_by_estimator.items():
        for i, conv in enumerate(conv_list):
            ax.plot(conv, label=f"{name} (seed {i + 1})",
                    alpha=0.7, linewidth=1.5)
    ax.set_xlabel("Timestep (day)")
    ax.set_ylabel("MAE(K_hat, K_true)")
    ax.set_title("Convergence by estimator")
    ax.legend(loc="best", fontsize=8)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / "convergence.png", dpi=120)
    plt.close(fig)
    log.info(f"[validate] wrote {out_dir / 'convergence.png'}")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--out-dir", type=Path, default=VALIDATION_OUT_DIR,
        help=f"Output directory (default: {VALIDATION_OUT_DIR})",
    )
    p.add_argument(
        "--seeds", nargs="+", type=int,
        default=list(ValidationGate.SEEDS),
        help=f"Seeds to run (default: {list(ValidationGate.SEEDS)})",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    t_start = time.perf_counter()

    print("=" * 72)
    print("VALIDATION GATE: sim/validate_bkt.py")
    print("=" * 72)
    print(f"Setup: scenario={ValidationGate.SCENARIO.value}, "
          f"grade={ValidationGate.GRADE}, density={ValidationGate.DENSITY.value}, "
          f"days={ValidationGate.DAYS}, seeds={args.seeds}")
    print(f"Gate:  MAE ≤ {ValidationGate.MAE_PASS} (warn ≤ {ValidationGate.MAE_WARN})")
    print(f"       RMSE ≤ {ValidationGate.RMSE_PASS} (warn ≤ {ValidationGate.RMSE_WARN})")
    print(f"       Pearson r ≥ {ValidationGate.PEARSON_PASS} "
          f"(warn ≥ {ValidationGate.PEARSON_WARN})")
    print(f"       convergence: ≥{ValidationGate.CONVERGENCE_MIN_FRACTION:.0%} "
          f"of steps within ±{ValidationGate.CONVERGENCE_JITTER} over first "
          f"{ValidationGate.CONVERGENCE_WINDOW} days")
    print("=" * 72)

    estimators = all_estimators()
    log.info(f"[validate] {len(estimators)} estimator(s) registered: "
             f"{[e.name for e in estimators]}")

    # Store per-estimator artifacts for plots and reports
    per_estimator_results: dict[str, list[dict]] = {e.name: [] for e in estimators}
    khat_final_by_estimator: dict[str, np.ndarray] = {}
    ktrue_final_by_estimator: dict[str, np.ndarray] = {}
    convergence_by_estimator: dict[str, list[np.ndarray]] = {e.name: [] for e in estimators}

    for est in estimators:
        print(f"\n--- estimator: {est.name} ---")
        for seed in args.seeds:
            log.info(f"[validate] running seed={seed}, estimator={est.name}")
            report = run_one_seed(
                estimator=est,
                seed=seed,
                grade=ValidationGate.GRADE,
                scenario=ValidationGate.SCENARIO,
                density=ValidationGate.DENSITY,
                n_days=ValidationGate.DAYS,
            )
            per_estimator_results[est.name].append(report)
            print(f"  seed={seed}: "
                  f"MAE={report['metrics']['mae']:.4f}, "
                  f"RMSE={report['metrics']['rmse']:.4f}, "
                  f"r={report['metrics']['pearson_r']:.4f}, "
                  f"conv_ok={report['convergence_ok']}")

            # Re-run to grab full arrays for plotting (cheap: same RNG)
            # Actually we saved k_hat in the report? No — we didn't. Let's
            # re-run. Or we could add k_hat to the report; for now re-run.
            cfg = Config(
                seed=seed, grade=ValidationGate.GRADE,
                scenario=ValidationGate.SCENARIO,
                evidence_density=ValidationGate.DENSITY,
                n_days=ValidationGate.DAYS,
            )
            classroom = generate_classroom(cfg)
            stream = simulate_evidence_stream(classroom, cfg)
            result = est.estimate(stream, classroom.concept_ids,
                                  return_trajectory=True)
            if seed == args.seeds[-1]:
                khat_final_by_estimator[est.name] = result.k_hat
                ktrue_final_by_estimator[est.name] = classroom.k_true
            if result.trajectory is not None:
                from sim.validate_bkt import compute_convergence as _cc
                convergence_by_estimator[est.name].append(
                    _cc(classroom.k_true, result.trajectory)
                )

    # --- Aggregate and classify --------------------------------------- #
    print("\n" + "=" * 72)
    print("RESULTS")
    print("=" * 72)

    verdicts: dict[str, str] = {}
    per_estimator_summary: dict[str, dict] = {}

    for est in estimators:
        agg = aggregate_seeds(per_estimator_results[est.name])
        verdict = classify(
            mae=agg["mae_worst"],
            rmse=agg["rmse_worst"],
            r=agg["pearson_worst"],
            conv_ok=agg["convergence_ok_all"],
        )
        verdicts[est.name] = verdict

        per_estimator_summary[est.name] = {
            **agg,
            "verdict": verdict,
            "per_seed": per_estimator_results[est.name],
        }

        print(f"\n{est.name}:")
        print(f"  MAE    mean={agg['mae_mean']:.4f}  std={agg['mae_std']:.4f}  "
              f"worst={agg['mae_worst']:.4f}")
        print(f"  RMSE   mean={agg['rmse_mean']:.4f}  std={agg['rmse_std']:.4f}  "
              f"worst={agg['rmse_worst']:.4f}")
        print(f"  r      mean={agg['pearson_mean']:.4f}  "
              f"worst={agg['pearson_worst']:.4f}")
        print(f"  bias   mean={agg['bias_mean']:+.4f}")
        print(f"  convergence_ok_all={agg['convergence_ok_all']}")
        print(f"  -> VERDICT: {verdict}")

    # --- Write artifacts ---------------------------------------------- #
    summary = {
        "gate": {
            "scenario": ValidationGate.SCENARIO.value,
            "grade": ValidationGate.GRADE,
            "density": ValidationGate.DENSITY.value,
            "days": ValidationGate.DAYS,
            "seeds": list(args.seeds),
            "thresholds": {
                "mae_pass": ValidationGate.MAE_PASS,
                "mae_warn": ValidationGate.MAE_WARN,
                "rmse_pass": ValidationGate.RMSE_PASS,
                "rmse_warn": ValidationGate.RMSE_WARN,
                "pearson_pass": ValidationGate.PEARSON_PASS,
                "pearson_warn": ValidationGate.PEARSON_WARN,
                "convergence_window": ValidationGate.CONVERGENCE_WINDOW,
                "convergence_jitter": ValidationGate.CONVERGENCE_JITTER,
                "convergence_min_fraction": ValidationGate.CONVERGENCE_MIN_FRACTION,
            },
        },
        "estimators": per_estimator_summary,
        "verdicts": verdicts,
        "best_estimator": _best_estimator(verdicts, per_estimator_summary),
    }

    with open(out_dir / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    log.info(f"[validate] wrote {out_dir / 'summary.json'}")

    write_plots(out_dir, ktrue_final_by_estimator,
                khat_final_by_estimator, convergence_by_estimator)

    # --- Exit code --------------------------------------------------- #
    elapsed = time.perf_counter() - t_start
    print(f"\nTotal wall time: {elapsed:.2f}s")

    any_pass = any(v == "PASS" for v in verdicts.values())
    any_warn = any(v == "WARN" for v in verdicts.values())

    if any_pass:
        print("\n[validate_bkt] GATE PASSED for at least one estimator.")
        sys.exit(0)
    elif any_warn:
        print("\n[validate_bkt] GATE WARNED (no estimator passed cleanly).")
        sys.exit(1)
    else:
        print("\n[validate_bkt] GATE FAILED for all estimators.")
        sys.exit(2)


def _best_estimator(verdicts: dict[str, str],
                    summaries: dict[str, dict]) -> str | None:
    """Pick the estimator with the best verdict, tiebroken by MAE worst."""
    rank = {"PASS": 0, "WARN": 1, "FAIL": 2}
    candidates = sorted(
        summaries.items(),
        key=lambda kv: (rank.get(verdicts[kv[0]], 3),
                        kv[1]["mae_worst"]),
    )
    if not candidates:
        return None
    best_name, best_summary = candidates[0]
    if verdicts[best_name] == "FAIL":
        return None
    return best_name


if __name__ == "__main__":
    main()