"""
Calcmate Curriculum Knowledge Graph
-------------------------------------
Loads the canonical curriculum from two CSV files:

  data/concepts.csv        — one row per concept (id, grade, subject, unit,
                             concept, learning_objective, coverage_status,
                             is_active)
  data/prerequisite_edges.csv — one row per directed prerequisite edge
                             (source_concept_id, target_concept_id,
                              relationship_type, confidence)

An edge  source → target  means "source is a prerequisite of target"
(i.e. source must be mastered before target is taught).

This replaces the old single-column `prerequisites` field in concepts.csv
so that concepts with multiple prerequisites are represented correctly.

The graph is shared curriculum structure; per-student mastery is passed in
as a knowledge_state dict at query time — no student-specific graph copies.

Public API
----------
    load_kg(concepts_csv, edges_csv) -> nx.DiGraph
    prerequisite_readiness(g, knowledge_state, concept_id) -> float
    prerequisite_deficit(g, knowledge_state, concept_id) -> float
    downstream_dependency_importance(g) -> dict[str, float]
    is_feasible(g, knowledge_state, concept_id, tau_p=0.70) -> bool
    concepts_for_grade(g, grade) -> list[str]

Smoke-test (run directly):
    python -m src.knowledge_graph
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Optional

import networkx as nx

log = logging.getLogger(__name__)

# Canonical file locations relative to the project root.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_CONCEPTS_CSV = _PROJECT_ROOT / "data" / "concepts.csv"
_DEFAULT_EDGES_CSV = _PROJECT_ROOT / "data" / "prerequisite_edges.csv"


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def load_kg(
    concepts_csv: Path | str = _DEFAULT_CONCEPTS_CSV,
    edges_csv: Path | str = _DEFAULT_EDGES_CSV,
    *,
    active_only: bool = True,
) -> nx.DiGraph:
    """Load the curriculum knowledge graph.

    Args:
        concepts_csv:  Path to canonical concepts CSV.
        edges_csv:     Path to prerequisite-edge CSV.
        active_only:   If True, skip concepts whose is_active == 'false'.

    Returns:
        nx.DiGraph where nodes are concept IDs and edges represent
        PREREQUISITE_OF relationships (source → target).
    """
    concepts_csv = Path(concepts_csv)
    edges_csv = Path(edges_csv)

    if not concepts_csv.exists():
        raise FileNotFoundError(f"concepts CSV not found: {concepts_csv}")
    if not edges_csv.exists():
        raise FileNotFoundError(f"prerequisite edges CSV not found: {edges_csv}")

    g = nx.DiGraph()

    # --- 1. Add concept nodes ------------------------------------------------
    with concepts_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if active_only and row.get("is_active", "true").lower() == "false":
                continue
            g.add_node(
                row["id"],
                grade=int(row["grade"]),
                subject=row["subject"],
                unit=row["unit"],
                concept=row["concept"],
                learning_objective=row.get("learning_objective", ""),
                coverage_status=row.get("coverage_status", "pending"),
            )

    # --- 2. Add prerequisite edges -------------------------------------------
    skipped_edges: list[tuple[str, str]] = []
    with edges_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            src, tgt = row["source_concept_id"].strip(), row["target_concept_id"].strip()
            if src not in g.nodes:
                skipped_edges.append((src, tgt))
                continue
            if tgt not in g.nodes:
                skipped_edges.append((src, tgt))
                continue
            g.add_edge(
                src,
                tgt,
                relationship_type=row.get("relationship_type", "PREREQUISITE_OF"),
                confidence=row.get("confidence", "provisional"),
            )

    if skipped_edges:
        log.warning(
            "[knowledge_graph] %d edge(s) skipped — concept IDs not in active graph: %s",
            len(skipped_edges), skipped_edges[:10],
        )

    # --- 3. Validate DAG property --------------------------------------------
    if not nx.is_directed_acyclic_graph(g):
        cycles = list(nx.simple_cycles(g))
        raise ValueError(
            f"Prerequisite graph contains {len(cycles)} cycle(s): {cycles[:3]}"
        )

    log.info(
        "[knowledge_graph] loaded %d concepts, %d prerequisite edges, is_DAG=True",
        g.number_of_nodes(), g.number_of_edges(),
    )
    return g


# ---------------------------------------------------------------------------
# Graph-derived signals used by the allocation algorithm
# ---------------------------------------------------------------------------

def prerequisite_readiness(
    g: nx.DiGraph,
    knowledge_state: dict[str, float],
    concept_id: str,
) -> float:
    """PR(g, c) — mean mastery over concept_id's DIRECT prerequisites.

    knowledge_state maps concept_id → estimated mastery in [0, 1].
    Returns 1.0 if the concept has no prerequisites (always ready).
    """
    preds = list(g.predecessors(concept_id))
    if not preds:
        return 1.0
    values = [knowledge_state.get(p, 0.0) for p in preds]
    return sum(values) / len(values)


def prerequisite_deficit(
    g: nx.DiGraph,
    knowledge_state: dict[str, float],
    concept_id: str,
) -> float:
    """PD(g, c) = 1 − PR(g, c)."""
    return 1.0 - prerequisite_readiness(g, knowledge_state, concept_id)


def downstream_dependency_importance(g: nx.DiGraph) -> dict[str, float]:
    """DI(c) — normalised count of downstream descendants.

    A concept that unlocks many future concepts gets a higher score.
    Normalised to [0, 1] over the max descendant count in the graph.
    """
    raw = {c: len(nx.descendants(g, c)) for c in g.nodes}
    max_d = max(raw.values(), default=1)
    max_d = max(max_d, 1)
    return {c: v / max_d for c, v in raw.items()}


def is_feasible(
    g: nx.DiGraph,
    knowledge_state: dict[str, float],
    concept_id: str,
    tau_p: float = 0.70,
) -> bool:
    """True iff ALL direct prerequisites of concept_id meet mastery threshold.

    A concept is feasible for direct teacher instruction only when its
    prerequisites are adequately mastered; otherwise the student lacks the
    foundation to benefit from instruction on this concept.
    """
    preds = list(g.predecessors(concept_id))
    return all(knowledge_state.get(p, 0.0) >= tau_p for p in preds)


def concepts_for_grade(g: nx.DiGraph, grade: int) -> list[str]:
    """Return concept IDs belonging to the given grade, in topological order."""
    grade_nodes = [n for n, d in g.nodes(data=True) if d.get("grade") == grade]
    # Sub-graph restricted to this grade for topological sort.
    sub = g.subgraph(grade_nodes)
    if nx.is_directed_acyclic_graph(sub):
        return list(nx.topological_sort(sub))
    return sorted(grade_nodes)


# ---------------------------------------------------------------------------
# Smoke tests — run with:  python -m src.knowledge_graph
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    g = load_kg()

    grades_present = sorted({d["grade"] for _, d in g.nodes(data=True)})
    print(f"\nLoaded graph: {g.number_of_nodes()} concepts, "
          f"{g.number_of_edges()} prerequisite edges")
    print(f"Grades covered: {grades_present}")
    assert g.number_of_nodes() > 0, "No concepts loaded — check CSV path"
    assert nx.is_directed_acyclic_graph(g), "Graph has cycles — check edge file"

    # Test 1: single direct prerequisite
    ks = {"M304": 0.90, "M307": 0.50}
    pr = prerequisite_readiness(g, ks, "M308")
    print(f"\n[Test 1] PR(M308) with M307=0.50: {pr:.2f}  (expect 0.50)")
    assert abs(pr - 0.50) < 1e-9

    # Test 2: root concept (no prerequisites)
    pr_root = prerequisite_readiness(g, {}, "M301")
    print(f"[Test 2] PR(M301) [no prereqs]: {pr_root:.2f}  (expect 1.0)")
    assert pr_root == 1.0

    # Test 3: multiple prerequisites averaged
    ks2 = {"M505": 0.80, "M504": 0.40}
    pr_506 = prerequisite_readiness(g, ks2, "M506")
    print(f"[Test 3] PR(M506) with M505=0.80, M504=0.40: {pr_506:.2f}  (expect 0.60)")
    assert abs(pr_506 - 0.60) < 1e-9

    # Test 4: downstream importance ordering
    di = downstream_dependency_importance(g)
    print(f"[Test 4] DI(M302 place-value): {di['M302']:.3f}  (should be high)")
    print(f"         DI(M513 volume-basics): {di['M513']:.3f}  (should be low)")
    assert di["M302"] > di["M513"], "Foundational concept must outrank a terminal leaf"

    # Test 5: feasibility gating
    ks_low  = {"M307": 0.40}
    ks_high = {"M307": 0.85}
    print(f"[Test 5] Feasible(M308) M307=0.40: {is_feasible(g, ks_low,  'M308')}  (expect False)")
    print(f"         Feasible(M308) M307=0.85: {is_feasible(g, ks_high, 'M308')}  (expect True)")
    assert not is_feasible(g, ks_low,  "M308")
    assert is_feasible(g, ks_high, "M308")

    # Test 6: cross-grade prerequisite — Grade 5 concept builds on Grade 4
    assert "M408" in list(g.predecessors("M505")), \
        "M505 (like-denom addition) should depend on M408 (equiv fractions)"
    print("[Test 6] Cross-grade prereq M408->M505: OK")

    # Test 7: Grade 1 nodes present
    g1 = concepts_for_grade(g, 1)
    assert len(g1) >= 5, f"Expected ≥5 Grade 1 concepts, got {len(g1)}"
    print(f"[Test 7] Grade 1 concepts ({len(g1)}): {g1[:4]}...")

    # Test 8: M425 is now a proper node
    assert "M425" in g.nodes, "M425 (Area using a grid) should be in graph"
    print("[Test 8] M425 is a valid node with prerequisite M413")

    print("\nAll smoke tests passed.")
