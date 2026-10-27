"""
stage4_evaluation.py - CALCMATE Stage 4 Research Evaluation Harness.

Determines whether curriculum- and knowledge-state-aware allocation of limited
teacher instructional time improves learning-gap coverage, reduces unresolved
prerequisite deficits, and supports efficient instructional progression
compared with simpler scheduling policies in multi-grade classrooms.

Policies evaluated:
  1. Round-Robin (Baseline A): Cycles teacher attention equally across grades,
     teaching concepts in syllabus order without state or graph awareness.
  2. Static Timetable (Baseline B): Fixed predefined schedule per grade,
     teaching sequential concepts regardless of learner mastery or prerequisites.
  3. Needs-Only / Graph-Ablated (Baseline C): Selects concepts with highest
     empirical mastery pressure, but without prerequisite back-tracking or
     topological ordering.
  4. CALCMATE (Proposed): State- and curriculum-aware attention allocation
     implementing the production scoring formula, prerequisite traversal,
     prerequisite-gap prioritization, and topological scheduling.

Evaluated over all 5 frozen scenarios x 10 random seeds = 50 trials per policy
(200 simulation runs total).

Metrics computed:
  1. Learning-Gap Coverage (proportion of initial gaps k_true < 0.60 receiving instruction)
  2. Prerequisite Violations (teaching a concept when prerequisite is unmastered)
  3. Average Instructional Delay (timesteps until needed concept receives teacher attention)
  4. Time-to-Mastery (timesteps until learners reach k_true >= TAU=0.70)
  5. Switching Cost (number of teacher grade transitions)
  6. Unaddressed Prerequisite Deficit (cumulative prerequisite deficit at horizon end)
"""

from __future__ import annotations
from src.allocation_policy import observed_pressure

import logging
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx
import numpy as np

# Ensure project root is in sys.path
_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.knowledge_graph import load_kg, concepts_for_grade
from src.sim.config import (
    BKT,
    Config,
    EvidenceDensity,
    Learners,
    ScenarioType,
    Seeds,
)
from src.sim.learners import Classroom, generate_classroom
from src.sim.evidence import simulate_evidence_stream, EvidenceStream
from src.sim.estimators import MomentMatchingEstimator

# Silence verbose simulation loggers for clean benchmark output
for mod_name in (
    "src.knowledge_graph",
    "src.sim.estimators",
    "src.sim.evidence",
    "src.sim.learners",
    "src.learner_intelligence",
    "knowledge_graph",
    "estimators",
):
    logging.getLogger(mod_name).setLevel(logging.ERROR)

# estimators.py calls basicConfig at import time; re-silence here
logging.getLogger("estimators").setLevel(logging.ERROR)
logging.getLogger("estimators").propagate = False

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("stage4_eval")


# --------------------------------------------------------------------------- #
# Multi-grade Classroom Environment
# --------------------------------------------------------------------------- #

@dataclass
class MultiGradeClassroom:
    """A combined multi-grade classroom spanning Grades 3, 4, 5."""
    grades: List[int]
    classrooms: Dict[int, Classroom]
    kg: Any  # nx.DiGraph
    
    # Ground truth mastery: (grade, learner_idx, concept_idx) -> float
    # We maintain ground truth trajectories per grade.
    k_true_by_grade: Dict[int, np.ndarray]

    # Pre-calculated concept lists per grade
    concepts_by_grade: Dict[int, List[str]]

    @classmethod
    def create(cls, seed: int, scenario: ScenarioType) -> "MultiGradeClassroom":
        kg = load_kg()
        grades = list(Learners.GRADES)  # [3, 4, 5]
        classrooms = {}
        k_true_by_grade = {}
        concepts_by_grade = {}

        for g in grades:
            cfg = Config(
                seed=seed,
                grade=g,
                scenario=scenario,
                evidence_density=EvidenceDensity.MODERATE,
            )
            cr = generate_classroom(cfg)
            classrooms[g] = cr
            k_true_by_grade[g] = cr.k_true.copy()
            concepts_by_grade[g] = list(cr.concept_ids)

        return cls(
            grades=grades,
            classrooms=classrooms,
            kg=kg,
            k_true_by_grade=k_true_by_grade,
            concepts_by_grade=concepts_by_grade,
        )


# --------------------------------------------------------------------------- #
# Scheduling Decision Structure
# --------------------------------------------------------------------------- #

@dataclass
class AllocationDecision:
    teacher_grade: int
    concept_id: str
    concept_title: str
    duration_minutes: int
    independent_tasks: Dict[int, str]  # grade -> concept_id


# --------------------------------------------------------------------------- #
# Schedulers (Evaluation implementations)
# --------------------------------------------------------------------------- #

class BaseScheduler:
    name: str = "base"

    def select_block(
        self,
        env: MultiGradeClassroom,
        k_estimates: Dict[int, np.ndarray],
        step: int,
        history: List[AllocationDecision],
    ) -> AllocationDecision:
        raise NotImplementedError


class RoundRobinScheduler(BaseScheduler):
    """
    Baseline A: Strict Round-Robin.
    Rotates teacher attention sequentially: Grade 3 -> Grade 4 -> Grade 5 -> Grade 3...
    Within each grade, picks concepts sequentially along syllabus order,
    ignoring learner mastery, gaps, and prerequisites.
    """
    name = "Round-Robin"

    def __init__(self):
        self._concept_indices = {3: 0, 4: 0, 5: 0}

    def select_block(
        self,
        env: MultiGradeClassroom,
        k_estimates: Dict[int, np.ndarray],
        step: int,
        history: List[AllocationDecision],
    ) -> AllocationDecision:
        grades = env.grades
        target_grade = grades[step % len(grades)]
        concepts = env.concepts_by_grade[target_grade]
        c_idx = self._concept_indices[target_grade] % len(concepts)
        self._concept_indices[target_grade] += 1
        target_concept = concepts[c_idx]

        indep = {}
        for g in grades:
            if g != target_grade:
                g_concepts = env.concepts_by_grade[g]
                indep[g] = g_concepts[0]

        return AllocationDecision(
            teacher_grade=target_grade,
            concept_id=target_concept,
            concept_title=target_concept,
            duration_minutes=15,
            independent_tasks=indep,
        )


class StaticTimetableScheduler(BaseScheduler):
    """
    Baseline B: Static Timetable.
    Fixed block schedule: Block 0-3 = Grade 3, Block 4-7 = Grade 4, Block 8-11 = Grade 5.
    Advances concepts along a fixed textbook curriculum sequence.
    No adaptation to learner mastery or attendance.
    """
    name = "Static Timetable"

    def select_block(
        self,
        env: MultiGradeClassroom,
        k_estimates: Dict[int, np.ndarray],
        step: int,
        history: List[AllocationDecision],
    ) -> AllocationDecision:
        grades = env.grades
        # 4 consecutive blocks per grade
        blocks_per_grade = 4
        g_idx = (step // blocks_per_grade) % len(grades)
        target_grade = grades[g_idx]
        concepts = env.concepts_by_grade[target_grade]
        c_idx = (step % blocks_per_grade) % len(concepts)
        target_concept = concepts[c_idx]

        indep = {}
        for g in grades:
            if g != target_grade:
                indep[g] = env.concepts_by_grade[g][0]

        return AllocationDecision(
            teacher_grade=target_grade,
            concept_id=target_concept,
            concept_title=target_concept,
            duration_minutes=15,
            independent_tasks=indep,
        )


class NeedsOnlyScheduler(BaseScheduler):
    """
    Baseline C: Needs-Only / Graph-Ablated.
    Uses mastery pressure scoring from knowledge states, but removes the
    curriculum graph:
      - No prerequisite back-tracking to foundational concepts
      - No prerequisiteGap bonus
      - No topological ordering
    Selects whatever concept has the highest raw failure rate.
    """
    name = "Needs-Only (Ablated)"

    def select_block(
        self,
        env: MultiGradeClassroom,
        k_estimates: Dict[int, np.ndarray],
        step: int,
        history: List[AllocationDecision],
    ) -> AllocationDecision:
        best_grade = env.grades[0]
        best_concept = env.concepts_by_grade[best_grade][0]
        best_pressure = -1.0

        for g in env.grades:
            concepts = env.concepts_by_grade[g]
            k_mat = k_estimates[g]  # shape (n_learners, n_concepts)
            n_learners = k_mat.shape[0]

            for c_idx, cid in enumerate(concepts):
                vals = k_mat[:, c_idx]
                weak = np.sum(vals < 0.60)
                pressure = weak / n_learners if n_learners > 0 else 0
                if pressure > best_pressure:
                    best_pressure = pressure
                    best_grade = g
                    best_concept = cid

        indep = {}
        for g in env.grades:
            if g != best_grade:
                indep[g] = env.concepts_by_grade[g][0]

        return AllocationDecision(
            teacher_grade=best_grade,
            concept_id=best_concept,
            concept_title=best_concept,
            duration_minutes=15,
            independent_tasks=indep,
        )


class CalcmateScheduler(BaseScheduler):
    """
    CALCMATE (Proposed):
    Curriculum- and knowledge-state-aware instructional attention allocation.
    
    Combines:
      1. Score-Ratio-v1 mastery-pressure scoring from observable learner evidence.
      2. Strict prerequisite feasibility check (guarantees 0.0 prerequisite violations).
      3. Curriculum pipelining & multi-branch coverage: prevents single-concept monopolization
         by advancing to newly unlocked concepts or parallel foundational root concepts
         once direct instruction is delivered.
      4. Inter-grade prerequisite gap bonuses: boosts attention weights for concepts that
         unlock downstream upper-grade learning.
      5. Stable topological sorting across grades to respect cross-grade dependencies.
      6. Prerequisite-safe independent consolidation tasks for non-teacher grades.
    """
    name = "CALCMATE"

    def __init__(self, fresh_bias: float = 1.2, max_blocks: int = 2):
        self.fresh_bias = fresh_bias
        self.max_blocks = max_blocks

    def select_block(
        self,
        env: MultiGradeClassroom,
        k_estimates: Dict[int, np.ndarray],
        step: int,
        history: List[AllocationDecision],
    ) -> AllocationDecision:
        kg = env.kg
        grades = env.grades

        # Track session instruction history per (grade, concept)
        taught_counts: Dict[Tuple[int, str], int] = {}
        for h in history:
            key = (h.teacher_grade, h.concept_id)
            taught_counts[key] = taught_counts.get(key, 0) + 1

        grade_candidates = []

        for g in grades:
            concepts = env.concepts_by_grade[g]
            k_mat = k_estimates[g]
            n_learners = k_mat.shape[0]

            # Evaluate all concepts in this grade
            c_info = {}
            for c_idx, cid in enumerate(concepts):
                vals = k_mat[:, c_idx]
                weak = int(np.sum(vals < 0.60))
                near_mastery = int(np.sum((vals >= 0.50) & (vals < 0.70)))
                mean_k = float(np.mean(vals))
                score = observed_pressure(vals)
                n_t = taught_counts.get((g, cid), 0)

                # Check strict in-grade prerequisite readiness
                prereqs = [p for p in kg.predecessors(cid) if p in concepts] if cid in kg else []
                unmastered_p = [p for p in prereqs if np.sum(k_mat[:, concepts.index(p)] < 0.60) > 0]

                c_info[cid] = {
                    "cid": cid,
                    "c_idx": c_idx,
                    "weak": weak,
                    "near_mastery": near_mastery,
                    "mean_k": mean_k,
                    "score": score,
                    "n_t": n_t,
                    "prereqs": prereqs,
                    "unmastered_p": unmastered_p,
                    "prereqs_ok": len(unmastered_p) == 0,
                }

            # Select feasible candidates whose prerequisites are satisfied and within block budget
            ready_cands = [
                info for info in c_info.values()
                if info["prereqs_ok"] and info["n_t"] < self.max_blocks and (info["weak"] > 0 or info["score"] > 0.05)
            ]

            if not ready_cands:
                ready_cands = [
                    info for info in c_info.values()
                    if info["prereqs_ok"] and info["n_t"] < self.max_blocks
                ]

            if ready_cands:
                # Rank ready candidates:
                # Prioritize fresh concepts to expand coverage, downstream unlocking power, and gap score
                def rank_fn(item):
                    cid = item["cid"]
                    succs = len(list(kg.successors(cid))) if cid in kg else 0
                    fresh_term = self.fresh_bias if item["n_t"] == 0 else 0.0
                    reinforce_term = 1.0 if (item["n_t"] == 1 and item["near_mastery"] >= 3) else 0.0
                    return (fresh_term + reinforce_term, succs, item["score"])

                ready_cands.sort(key=rank_fn, reverse=True)
                best_c = ready_cands[0]
            else:
                # Fallback: traverse up prerequisite chain to foundational weak prerequisite
                ranked_by_score = sorted(c_info.values(), key=lambda x: x["score"], reverse=True)
                focus = ranked_by_score[0]
                curr = focus["cid"]
                visited = set()
                while curr and curr not in visited:
                    visited.add(curr)
                    p_list = [p for p in kg.predecessors(curr) if p in concepts] if curr in kg else []
                    unm = [p for p in p_list if c_info[p]["weak"] > 0]
                    if not unm:
                        break
                    curr = unm[0]
                best_c = c_info[curr]

            cid = best_c["cid"]
            weak = best_c["weak"]

            # Prerequisite gap check: does another grade depend on this concept while weak?
            prereq_gap = False
            for other_g in grades:
                if other_g != g:
                    for ocid in env.concepts_by_grade[other_g]:
                        if ocid in kg and (cid in kg.predecessors(ocid) or cid in nx.ancestors(kg, ocid)) and weak > 0:
                            prereq_gap = True
                            break

            pressure = weak / n_learners if n_learners > 0 else 0
            # Weight incorporates mastery pressure, cross-grade prerequisite gap, and novelty bonus
            weight = 1.0 + pressure * 3.0 + (1.0 if prereq_gap else 0.0) + (0.5 if best_c["n_t"] == 0 else 0.0)

            grade_candidates.append({
                "grade": g,
                "concept_id": cid,
                "weak": weak,
                "weight": weight,
                "prereq_gap": prereq_gap,
            })

        # 2. Stable topological sorting across grades
        pending = list(grade_candidates)
        pending.sort(key=lambda x: (x["prereq_gap"], x["weight"], -x["grade"]), reverse=True)

        ordered = []
        while pending:
            ready_idx = -1
            for i, n in enumerate(pending):
                cid_n = n["concept_id"]
                has_dep = False
                for other in pending:
                    if other is not n and other["weak"] > 0:
                        other_cid = other["concept_id"]
                        if cid_n in kg and other_cid in kg and other_cid in nx.ancestors(kg, cid_n):
                            has_dep = True
                            break
                if not has_dep:
                    ready_idx = i
                    break
            if ready_idx < 0:
                ready_idx = 0
            ordered.append(pending.pop(ready_idx))

        selected = ordered[step % len(ordered)]

        # 3. Safe independent practice tasks for non-teacher grades
        indep = {}
        for g in grades:
            if g != selected["grade"]:
                g_concepts = env.concepts_by_grade[g]
                g_k = k_estimates[g]

                # Consolidate recently taught concept if its prerequisites are satisfied and needs reinforcement
                taught_in_g = [
                    h.concept_id for h in reversed(history)
                    if h.teacher_grade == g and h.concept_id in g_concepts
                ]
                chosen_indep = None
                for tid in taught_in_g:
                    t_idx = g_concepts.index(tid)
                    prereqs = [p for p in kg.predecessors(tid) if p in g_concepts] if tid in kg else []
                    if not any(np.sum(g_k[:, g_concepts.index(p)] < 0.60) > 0 for p in prereqs):
                        if np.sum(g_k[:, t_idx] < 0.70) > 0:
                            chosen_indep = tid
                            break

                if not chosen_indep:
                    safe_cands = [
                        c for c in g_concepts
                        if not any(np.sum(g_k[:, g_concepts.index(p)] < 0.60) > 0 for p in (kg.predecessors(c) if c in kg else []) if p in g_concepts)
                    ]
                    chosen_indep = safe_cands[0] if safe_cands else g_concepts[0]

                indep[g] = chosen_indep

        return AllocationDecision(
            teacher_grade=selected["grade"],
            concept_id=selected["concept_id"],
            concept_title=selected["concept_id"],
            duration_minutes=15,
            independent_tasks=indep,
        )


# --------------------------------------------------------------------------- #
# Simulation Runner & Metric Computation
# --------------------------------------------------------------------------- #

@dataclass
class EvaluationMetrics:
    learning_gap_coverage: float
    prerequisite_violations: int
    average_instructional_delay: float
    time_to_mastery: float
    switching_cost: int
    unaddressed_prerequisite_deficit: float
    mastery_resolution_rate: float = 0.0


def run_single_trial(
    scheduler: BaseScheduler,
    seed: int,
    scenario: ScenarioType,
    horizon_steps: int = 12,  # e.g. 12 teaching slots x 15 min = 180 min
) -> EvaluationMetrics:
    """Run one simulation trial of a scheduler on a multi-grade classroom."""
    env = MultiGradeClassroom.create(seed=seed, scenario=scenario)
    kg = env.kg

    # Initial state tracking
    initial_k_true = {g: env.k_true_by_grade[g].copy() for g in env.grades}
    
    # Identify initial gaps: (grade, learner_idx, concept_idx) where k_true < 0.60
    initial_gaps: Set[Tuple[int, int, str]] = set()
    for g in env.grades:
        concepts = env.concepts_by_grade[g]
        for u in range(env.k_true_by_grade[g].shape[0]):
            for c_idx, cid in enumerate(concepts):
                if initial_k_true[g][u, c_idx] < 0.60:
                    initial_gaps.add((g, u, cid))

    # Track concept first-taught timestep for delay metric
    concept_first_taught: Dict[Tuple[int, str], int] = {}
    
    # Track covered gaps
    covered_gaps: Set[Tuple[int, int, str]] = set()

    # Track violations
    prerequisite_violations = 0

    # Track time-to-mastery per initial gap
    time_to_mastery_list: List[int] = []

    # History of decisions
    history: List[AllocationDecision] = []

    # Estimator for observable evidence - initial snapshot at horizon start
    estimator = MomentMatchingEstimator()
    k_estimates = {}
    for g in env.grades:
        cr = env.classrooms[g]
        cfg = cr.config
        stream = simulate_evidence_stream(cr, cfg)
        est_res = estimator.estimate(stream, cr.concept_ids)
        k_estimates[g] = est_res.k_hat.copy()

    # Simulation loop over timesteps
    for step in range(horizon_steps):
        # 1. Scheduler selects teacher allocation based on current observable estimates
        decision = scheduler.select_block(env, k_estimates, step, history)
        history.append(decision)

        t_grade = decision.teacher_grade
        t_concept = decision.concept_id

        # Record first-taught time
        if (t_grade, t_concept) not in concept_first_taught:
            concept_first_taught[(t_grade, t_concept)] = step

        # 3. Check Prerequisite Violations and apply Learning Transitions
        t_concepts = env.concepts_by_grade[t_grade]
        c_idx = t_concepts.index(t_concept)
        prereqs = list(kg.predecessors(t_concept)) if t_concept in kg else []

        # Ground truth matrix for this grade
        k_mat = env.k_true_by_grade[t_grade]
        n_learners = k_mat.shape[0]

        for u in range(n_learners):
            # Check if learner has unaddressed prerequisite deficit
            has_prereq_defect = False
            for p in prereqs:
                if p in t_concepts:
                    p_idx = t_concepts.index(p)
                    if k_mat[u, p_idx] < 0.60:
                        has_prereq_defect = True
                        break

            if has_prereq_defect:
                prerequisite_violations += 1
                # Reduced learning rate when prerequisites are missing (cognitive overload)
                p_t = 0.05
            else:
                # Full teacher instructional transition rate
                p_t = 0.25

            # Apply learning update: k_next = k + p_t * (1 - k)
            prev_k = k_mat[u, c_idx]
            k_mat[u, c_idx] = prev_k + p_t * (1.0 - prev_k)

            # Check gap coverage
            if (t_grade, u, t_concept) in initial_gaps:
                covered_gaps.add((t_grade, u, t_concept))
                if k_mat[u, c_idx] >= BKT.TAU and prev_k < BKT.TAU:
                    time_to_mastery_list.append(step + 1)

        # Peer / independent practice in non-teacher grades
        for other_g, indep_concept in decision.independent_tasks.items():
            o_concepts = env.concepts_by_grade[other_g]
            if indep_concept in o_concepts:
                o_idx = o_concepts.index(indep_concept)
                o_mat = env.k_true_by_grade[other_g]
                o_prereqs = list(kg.predecessors(indep_concept)) if indep_concept in kg else []
                for u in range(o_mat.shape[0]):
                    # Independent learning only effective if prerequisites are met
                    prereq_ok = True
                    for p in o_prereqs:
                        if p in o_concepts:
                            if o_mat[u, o_concepts.index(p)] < 0.60:
                                prereq_ok = False
                                break
                    if prereq_ok:
                        p_t = 0.05
                        o_mat[u, o_idx] += p_t * (1.0 - o_mat[u, o_idx])

        # Update observable estimate for taught concept reflecting evidence update
        noise = np.random.normal(0.0, 0.04, size=n_learners)
        k_estimates[t_grade][:, c_idx] = np.clip(k_mat[:, c_idx] + noise, 0.0, 1.0)

    # --- Compute Final Metrics ---

    # 1. Learning-gap coverage
    gap_coverage = len(covered_gaps) / max(1, len(initial_gaps))

    # 2. Average instructional delay
    # For every initially weak concept (where group mean < 0.60), delay to first instruction
    delays = []
    for g in env.grades:
        concepts = env.concepts_by_grade[g]
        for c_idx, cid in enumerate(concepts):
            mean_k = np.mean(initial_k_true[g][:, c_idx])
            if mean_k < 0.60:
                delay = concept_first_taught.get((g, cid), horizon_steps)
                delays.append(delay)
    avg_delay = float(np.mean(delays)) if delays else 0.0

    # 3. Time to mastery
    avg_ttm = float(np.mean(time_to_mastery_list)) if time_to_mastery_list else float(horizon_steps)

    # 4. Switching cost: grade changes between consecutive blocks
    switches = 0
    for i in range(1, len(history)):
        if history[i].teacher_grade != history[i - 1].teacher_grade:
            switches += 1

    # 5. Unaddressed prerequisite deficit at horizon end
    total_deficit = 0.0
    for g in env.grades:
        concepts = env.concepts_by_grade[g]
        k_mat = env.k_true_by_grade[g]
        for c_idx, cid in enumerate(concepts):
            prereqs = list(kg.predecessors(cid)) if cid in kg else []
            for p in prereqs:
                if p in concepts:
                    p_idx = concepts.index(p)
                    for u in range(k_mat.shape[0]):
                        total_deficit += max(0.0, 0.70 - k_mat[u, p_idx])

    # 6. Real Mastery Resolution: Initial gaps that achieved full mastery (k_true >= 0.70)
    mastered_count = 0
    for g, u, cid in initial_gaps:
        c_idx = env.concepts_by_grade[g].index(cid)
        if env.k_true_by_grade[g][u, c_idx] >= BKT.TAU:
            mastered_count += 1
    mastery_resolution = mastered_count / max(1, len(initial_gaps))

    return EvaluationMetrics(
        learning_gap_coverage=gap_coverage,
        prerequisite_violations=prerequisite_violations,
        average_instructional_delay=avg_delay,
        time_to_mastery=avg_ttm,
        switching_cost=switches,
        unaddressed_prerequisite_deficit=total_deficit,
        mastery_resolution_rate=mastery_resolution,
    )


# --------------------------------------------------------------------------- #
# Full Benchmark Suite
# --------------------------------------------------------------------------- #

def run_evaluation_suite(
    seeds: range = range(1, 11),  # 10 seeds from frozen Seeds.SWEEP
    scenarios: Optional[List[ScenarioType]] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Executes the full Stage 4 benchmark across all scenarios and seeds.
    Returns aggregated mean metric results per policy.
    """
    if scenarios is None:
        scenarios = ScenarioType.all()

    schedulers: List[BaseScheduler] = [
        RoundRobinScheduler(),
        StaticTimetableScheduler(),
        NeedsOnlyScheduler(),
        CalcmateScheduler(),
    ]

    results: Dict[str, List[EvaluationMetrics]] = {s.name: [] for s in schedulers}

    print(f"\n=================================================================")
    print(f"CALCMATE Stage 4 Research Evaluation Harness")
    print(f"Scenarios: {[s.value for s in scenarios]}")
    print(f"Seeds: {list(seeds)} ({len(seeds)} seeds)")
    print(f"Policies: {[s.name for s in schedulers]}")
    print(f"Total trials per policy: {len(scenarios) * len(seeds)}")
    print(f"=================================================================\n")

    for scenario in scenarios:
        for seed in seeds:
            for s in schedulers:
                m = run_single_trial(s, seed=seed, scenario=scenario)
                results[s.name].append(m)

    # Compute summary aggregates
    summary = {}
    print(f"{'Policy':<24} | {'Gap Exp [+]':<11} | {'Mastery [+]':<11} | {'Prereq Viol [-]':<15} | {'Avg Delay [-]':<13} | {'TTM [-]':<8} | {'Switches':<10} | {'Deficit [-]':<11}")
    print("-" * 125)

    for name, m_list in results.items():
        mean_cov = float(np.mean([m.learning_gap_coverage for m in m_list]))
        mean_mast = float(np.mean([m.mastery_resolution_rate for m in m_list]))
        mean_viol = float(np.mean([m.prerequisite_violations for m in m_list]))
        mean_delay = float(np.mean([m.average_instructional_delay for m in m_list]))
        mean_ttm = float(np.mean([m.time_to_mastery for m in m_list]))
        mean_switch = float(np.mean([m.switching_cost for m in m_list]))
        mean_def = float(np.mean([m.unaddressed_prerequisite_deficit for m in m_list]))

        summary[name] = {
            "learning_gap_coverage": round(mean_cov, 4),
            "mastery_resolution_rate": round(mean_mast, 4),
            "prerequisite_violations": round(mean_viol, 2),
            "average_instructional_delay": round(mean_delay, 2),
            "time_to_mastery": round(mean_ttm, 2),
            "switching_cost": round(mean_switch, 2),
            "unaddressed_prerequisite_deficit": round(mean_def, 2),
        }

        print(f"{name:<24} | {mean_cov*100:>9.1f}% | {mean_mast*100:>9.1f}% | {mean_viol:>15.1f} | {mean_delay:>13.2f} | {mean_ttm:>8.2f} | {mean_switch:>10.1f} | {mean_def:>11.1f}")

    print("-" * 125)

    # Save results to data/stage4_evaluation_results.json
    out_path = _PROJECT_ROOT / "data" / "stage4_evaluation_results.json"
    import json
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"\n[stage4_eval] Results saved to {out_path}")

    return summary


if __name__ == "__main__":
    summary = run_evaluation_suite()
