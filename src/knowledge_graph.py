"""
Calcmate Curriculum Knowledge Graph
------------------------------------
Loads concepts.csv into a directed graph (edge c_i -> c_j means
"c_i is a prerequisite for c_j"), and implements the two KG-derived
signals used by the allocation priority score:

    PR(g, c)  - prerequisite readiness of group g for concept c
    DI(c)     - downstream dependency importance of concept c

Run this file directly to execute a small set of sanity checks.
"""

import csv
import networkx as nx


def load_kg(csv_path: str) -> nx.DiGraph:
    """Load concepts.csv into a directed prerequisite graph.

    Each node stores grade/subject/unit/concept name as attributes.
    An edge (p -> c) means p is a direct prerequisite of c.
    """
    g = nx.DiGraph()

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    # first pass: add nodes
    for row in rows:
        g.add_node(
            row["id"],
            grade=int(row["grade"]),
            subject=row["subject"],
            unit=row["unit"],
            concept=row["concept"],
        )

    # second pass: add prerequisite edges (semicolon-separated)
    for row in rows:
        prereqs = row["prerequisites"].strip()
        if not prereqs:
            continue
        for p in prereqs.split(";"):
            p = p.strip()
            if p:
                g.add_edge(p, row["id"])

    return g


def prerequisite_readiness(g: nx.DiGraph, knowledge_state: dict, concept_id: str) -> float:
    """PR(g, c): mean mastery over concept_id's DIRECT prerequisites.

    knowledge_state: dict mapping concept_id -> K_{g,c} in [0, 1]
    Returns 1.0 if the concept has no prerequisites (always ready).
    """
    preds = list(g.predecessors(concept_id))
    if not preds:
        return 1.0
    values = [knowledge_state.get(p, 0.0) for p in preds]
    return sum(values) / len(values)


def prerequisite_deficit(g: nx.DiGraph, knowledge_state: dict, concept_id: str) -> float:
    """PD(g, c) = 1 - PR(g, c)"""
    return 1.0 - prerequisite_readiness(g, knowledge_state, concept_id)


def downstream_dependency_importance(g: nx.DiGraph) -> dict:
    """DI(c) for every concept: normalized count of downstream descendants.

    A concept that (directly or indirectly) unlocks many future concepts
    gets a higher score. Normalized to [0, 1] by the max descendant count
    in the graph.
    """
    raw = {c: len(nx.descendants(g, c)) for c in g.nodes}
    max_d = max(raw.values()) if raw else 1
    max_d = max(max_d, 1)  # avoid divide-by-zero if graph is trivial
    return {c: v / max_d for c, v in raw.items()}


def is_feasible(g: nx.DiGraph, knowledge_state: dict, concept_id: str, tau_p: float = 0.70) -> bool:
    """A concept is feasible for direct instruction only if ALL its direct
    prerequisites meet the mastery threshold tau_p."""
    preds = list(g.predecessors(concept_id))
    return all(knowledge_state.get(p, 0.0) >= tau_p for p in preds)


# ---------------------------------------------------------------------
# Sanity checks - run with: python knowledge_graph.py
# ---------------------------------------------------------------------
if __name__ == "__main__":
    g = load_kg("../data/concepts.csv")

    print(f"Loaded graph: {g.number_of_nodes()} concepts, {g.number_of_edges()} prerequisite edges")
    assert g.number_of_nodes() > 0, "No concepts loaded - check CSV path"

    # --- Test 1: chain readiness reflects a weak middle link ---
    # Addition(M304) -> Multiplication(M307) -> Multiplication tables(M308)
    knowledge_state = {"M304": 0.90, "M307": 0.50}
    pr_308 = prerequisite_readiness(g, knowledge_state, "M308")
    print(f"\n[Test 1] PR(M308) with weak M307 (0.50): {pr_308:.2f}")
    assert pr_308 == 0.50, "Direct single-prerequisite readiness should equal that prerequisite's mastery"

    # --- Test 2: a root concept (no prerequisites) is always ready ---
    pr_root = prerequisite_readiness(g, {}, "M301")
    print(f"[Test 2] PR(M301) [no prerequisites]: {pr_root:.2f}")
    assert pr_root == 1.0, "Root concepts should have readiness 1.0"

    # --- Test 3: a concept with two prerequisites averages them ---
    # M506 (unlike-denominator fraction addition) depends on M505 and M504
    knowledge_state_2 = {"M505": 0.80, "M504": 0.40}
    pr_506 = prerequisite_readiness(g, knowledge_state_2, "M506")
    print(f"[Test 3] PR(M506) with M505=0.80, M504=0.40: {pr_506:.2f}")
    assert abs(pr_506 - 0.60) < 1e-9, "Multi-prerequisite readiness should average all direct prerequisites"

    # --- Test 4: downstream importance - an early foundational concept
    # should score higher than a leaf/terminal concept ---
    di = downstream_dependency_importance(g)
    print(f"[Test 4] DI(M302 'place value'): {di['M302']:.2f}  (should be relatively high)")
    print(f"         DI(M513 'volume basics'): {di['M513']:.2f}  (should be low/terminal)")
    assert di["M302"] > di["M513"], "A foundational concept should have higher downstream importance than a terminal leaf"

    # --- Test 5: feasibility gating ---
    ks_low = {"M307": 0.40}
    ks_high = {"M307": 0.85}
    print(f"[Test 5] Feasible(M308) with M307=0.40: {is_feasible(g, ks_low, 'M308')} (expect False)")
    print(f"         Feasible(M308) with M307=0.85: {is_feasible(g, ks_high, 'M308')} (expect True)")
    assert not is_feasible(g, ks_low, "M308")
    assert is_feasible(g, ks_high, "M308")

    print("\nAll sanity checks passed.")
