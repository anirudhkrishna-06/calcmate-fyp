"""Generate publication-ready Calcmate research figures from project artefacts.

The script intentionally reads the checked-in curriculum, simulation, BKT, and
policy-evaluation outputs. It does not invent classroom observations or alter
application data.

Outputs are written to ``outputs/`` by default:
  01_curriculum_knowledge_graph.png/.svg
  02_learner_state_estimation.png/.svg
  03_scheduler_policy_metrics.png/.svg
  figure_manifest.json
  run_report.txt          (console diagnostics, ready to paste into the report)

Run from the repository root:
  python scripts/generate_report_figures.py
  python scripts/generate_report_figures.py --quiet      # no console diagnostics
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import textwrap
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "outputs"
GRADE_COLORS = {1: "#2F80ED", 2: "#27AE60", 3: "#F2994A", 4: "#9B51E0", 5: "#EB5757"}
INK = "#172033"
MUTED = "#64748B"
GRID = "#E5EAF1"
PAPER = "#F8FAFC"

WIDTH = 100  # console width; keeps screenshots tidy


# --------------------------------------------------------------------------- #
# Console / report diagnostics (ASCII-only so screenshots look the same on
# Windows, macOS and Linux terminals)
# --------------------------------------------------------------------------- #
class Report:
    """Prints diagnostics and keeps a copy so they can be saved to a text file."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.quiet = False

    def emit(self, text: str = "") -> None:
        self.lines.append(text)
        if not self.quiet:
            print(text)

    def banner(self, title: str) -> None:
        self.emit("=" * WIDTH)
        self.emit(title.center(WIDTH))
        self.emit("=" * WIDTH)

    def section(self, title: str) -> None:
        self.emit()
        self.emit(f"[ {title} ]".ljust(WIDTH, "-"))

    def kv(self, key: str, value: Any, indent: int = 2) -> None:
        self.emit(f"{' ' * indent}{key:<34}: {value}")

    def ok(self, message: str) -> None:
        self.emit(f"  [OK]   {message}")

    def warn(self, message: str) -> None:
        self.emit(f"  [WARN] {message}")

    def info(self, message: str) -> None:
        self.emit(f"  [INFO] {message}")

    def table(self, headers: list[str], rows: list[list[Any]], indent: int = 2) -> None:
        cells = [[str(c) for c in row] for row in rows]
        widths = [max(len(h), *(len(r[i]) for r in cells)) if cells else len(h) for i, h in enumerate(headers)]
        pad = " " * indent
        rule = pad + "+" + "+".join("-" * (w + 2) for w in widths) + "+"
        self.emit(rule)
        self.emit(pad + "|" + "|".join(f" {h:<{w}} " for h, w in zip(headers, widths)) + "|")
        self.emit(rule)
        for row in cells:
            self.emit(pad + "|" + "|".join(f" {c:<{w}} " for c, w in zip(row, widths)) + "|")
        self.emit(rule)

    def save(self, path: Path) -> None:
        path.write_text("\n".join(self.lines) + "\n", encoding="utf-8")


REPORT = Report()


def fmt(value: Any, digits: int = 4) -> str:
    """Format numbers compactly; leave everything else as text."""
    if isinstance(value, (int, np.integer)):
        return str(value)
    if isinstance(value, (float, np.floating)):
        return f"{value:.{digits}f}"
    return str(value)


def describe_file(path: Path) -> str:
    return f"{path.name} ({path.stat().st_size / 1024:,.1f} KB)"


# --------------------------------------------------------------------------- #
# I/O helpers
# --------------------------------------------------------------------------- #
def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    columns = list(rows[0].keys()) if rows else []
    REPORT.ok(f"Loaded {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}  "
              f"rows={len(rows)}  columns={columns}")
    return rows


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    REPORT.ok(f"Loaded {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}  "
              f"top-level keys={list(data)[:8]}{' ...' if len(data) > 8 else ''}")
    return data


def configure(ax: plt.Axes, title: str, subtitle: str) -> None:
    ax.set_facecolor(PAPER)
    ax.set_title(title, loc="left", fontsize=20, fontweight="bold", color=INK, pad=20)
    ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=10, color=MUTED, va="bottom")


def save_figure(fig: plt.Figure, output: Path, stem: str) -> list[str]:
    png, svg = output / f"{stem}.png", output / f"{stem}.svg"
    fig.savefig(png, dpi=240, bbox_inches="tight", facecolor=PAPER)
    fig.savefig(svg, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)
    REPORT.ok(f"Saved {describe_file(png)}")
    REPORT.ok(f"Saved {describe_file(svg)}")
    return [png.name, svg.name]


def wrapped(value: str, width: int = 24) -> str:
    return "\n".join(textwrap.wrap(value, width=width))


# --------------------------------------------------------------------------- #
# Figure 1: curriculum knowledge graph
# --------------------------------------------------------------------------- #
def diagnose_graph(graph: nx.DiGraph, skipped_edges: list[tuple[str, str]], duplicate_edges: int) -> dict[str, Any]:
    """Print structural diagnostics of the prerequisite graph."""
    is_dag = nx.is_directed_acyclic_graph(graph)
    grades = sorted({d["grade"] for _, d in graph.nodes(data=True)})

    REPORT.section("Knowledge graph: structure")
    REPORT.kv("Concepts (nodes)", graph.number_of_nodes())
    REPORT.kv("Prerequisite relations (edges)", graph.number_of_edges())
    REPORT.kv("Is a DAG (no cycles)", is_dag)
    REPORT.kv("Weakly connected components", nx.number_weakly_connected_components(graph))
    REPORT.kv("Isolated concepts", sum(1 for n in graph if graph.degree(n) == 0))
    REPORT.kv("Edge density", f"{nx.density(graph):.5f}")
    REPORT.kv("Mean out-degree", f"{np.mean([d for _, d in graph.out_degree()]):.2f}")

    if is_dag:
        REPORT.ok("Graph is acyclic: prerequisite ordering is well defined")
        path = nx.dag_longest_path(graph)
        REPORT.kv("Longest prerequisite chain (nodes)", len(path))
        REPORT.kv("Chain", " -> ".join(path[:12]) + (" -> ..." if len(path) > 12 else ""))
    else:
        REPORT.warn("Cycle detected; layout will fail. Example cycle: "
                    f"{[e[0] for e in nx.find_cycle(graph)]}")

    REPORT.section("Knowledge graph: per-grade breakdown")
    rows = []
    for grade in grades:
        members = [n for n, d in graph.nodes(data=True) if d["grade"] == grade]
        incoming = sum(graph.in_degree(n) for n in members)
        outgoing = sum(graph.out_degree(n) for n in members)
        rows.append([f"Grade {grade}", len(members), incoming, outgoing,
                     sum(1 for n in members if graph.in_degree(n) == 0)])
    REPORT.table(["Grade", "Concepts", "In-edges", "Out-edges", "Entry points"], rows)

    cross = sum(1 for u, v in graph.edges if graph.nodes[u]["grade"] != graph.nodes[v]["grade"])
    backwards = [(u, v) for u, v in graph.edges if graph.nodes[u]["grade"] > graph.nodes[v]["grade"]]
    REPORT.kv("Within-grade edges", graph.number_of_edges() - cross)
    REPORT.kv("Cross-grade edges", cross)
    if backwards:
        REPORT.warn(f"{len(backwards)} edge(s) point from a higher grade to a lower grade, e.g. {backwards[:3]}")
    else:
        REPORT.ok("No edge points backwards in grade level")

    REPORT.section("Knowledge graph: most influential concepts")
    top_out = sorted(graph.nodes, key=lambda n: graph.out_degree(n), reverse=True)[:5]
    REPORT.emit("  Top 5 foundations (most dependants):")
    REPORT.table(["Concept ID", "Grade", "Dependants", "Title"],
                 [[n, graph.nodes[n]["grade"], graph.out_degree(n), graph.nodes[n]["title"][:48]] for n in top_out])
    top_in = sorted(graph.nodes, key=lambda n: graph.in_degree(n), reverse=True)[:5]
    REPORT.emit("  Top 5 most demanding (most prerequisites):")
    REPORT.table(["Concept ID", "Grade", "Prerequisites", "Title"],
                 [[n, graph.nodes[n]["grade"], graph.in_degree(n), graph.nodes[n]["title"][:48]] for n in top_in])

    REPORT.section("Knowledge graph: data-quality checks")
    if skipped_edges:
        REPORT.warn(f"{len(skipped_edges)} edge(s) skipped (unknown concept ID), e.g. {skipped_edges[:3]}")
    else:
        REPORT.ok("Every prerequisite edge references known concepts")
    if duplicate_edges:
        REPORT.warn(f"{duplicate_edges} duplicate edge row(s) collapsed")
    else:
        REPORT.ok("No duplicate edges")
    self_loops = list(nx.selfloop_edges(graph))
    REPORT.ok("No self-loops") if not self_loops else REPORT.warn(f"Self-loops: {self_loops[:3]}")

    return {
        "acyclic": is_dag,
        "components": nx.number_weakly_connected_components(graph),
        "longest_chain": len(nx.dag_longest_path(graph)) if is_dag else None,
        "cross_grade_edges": cross,
        "skipped_edges": len(skipped_edges),
        "duplicate_edges": duplicate_edges,
    }


def draw_knowledge_graph(output: Path) -> dict[str, Any]:
    REPORT.section("Figure 1: curriculum knowledge graph - loading data")
    concepts = read_csv(ROOT / "data" / "concepts.csv")
    edges = read_csv(ROOT / "data" / "prerequisite_edges.csv")
    graph = nx.DiGraph()
    for row in concepts:
        graph.add_node(row["id"], grade=int(row["grade"]), title=row["concept"], unit=row.get("unit", ""))

    skipped: list[tuple[str, str]] = []
    duplicates = 0
    for row in edges:
        source, target = row["source_concept_id"], row["target_concept_id"]
        if source in graph and target in graph:
            if graph.has_edge(source, target):
                duplicates += 1
            graph.add_edge(source, target)
        else:
            skipped.append((source, target))

    diagnostics = diagnose_graph(graph, skipped, duplicates)

    # A deterministic layered layout makes prerequisite direction visible while
    # keeping all curated nodes in one figure.
    levels: dict[str, int] = {}
    for node in nx.topological_sort(graph):
        levels[node] = max((levels.get(parent, 0) + 1 for parent in graph.predecessors(node)), default=0)
    REPORT.section("Knowledge graph: layout")
    REPORT.kv("Layer count (depth levels)", max(levels.values()) + 1 if levels else 0)
    REPORT.kv("Nodes per layer", dict(sorted(Counter(levels.values()).items())))

    positions: dict[str, tuple[float, float]] = {}
    for grade in sorted({data["grade"] for _, data in graph.nodes(data=True)}):
        nodes = sorted((n for n, data in graph.nodes(data=True) if data["grade"] == grade), key=lambda n: (levels[n], n))
        buckets: dict[int, list[str]] = {}
        for node in nodes:
            buckets.setdefault(levels[node], []).append(node)
        for level, bucket in buckets.items():
            for index, node in enumerate(bucket):
                positions[node] = (grade + (index - (len(bucket) - 1) / 2) * 0.07, -level - index * 0.015)

    fig, ax = plt.subplots(figsize=(24, 16), constrained_layout=True)
    configure(ax, "Mathematics curriculum knowledge graph", "Authoritative concept nodes and verified prerequisite edges; arrows point from prerequisite to dependent concept")
    for grade in sorted({data["grade"] for _, data in graph.nodes(data=True)}):
        ax.axvline(grade, color=GRADE_COLORS.get(grade, MUTED), alpha=0.10, lw=18, zorder=0)
        ax.text(grade, 0.99, f"Grade {grade}", transform=ax.get_xaxis_transform(), ha="center", color=GRADE_COLORS.get(grade, MUTED), fontsize=12, fontweight="bold")
    nx.draw_networkx_edges(graph, positions, ax=ax, edge_color="#9AA7B8", width=0.8, alpha=0.48, arrows=True, arrowsize=8, node_size=220)
    nx.draw_networkx_nodes(graph, positions, ax=ax, node_color=[GRADE_COLORS.get(graph.nodes[n]["grade"], MUTED) for n in graph], node_size=270, edgecolors="white", linewidths=0.7)
    labels = {n: f"{n}\n{wrapped(graph.nodes[n]['title'], 22)}" for n in graph}
    nx.draw_networkx_labels(graph, positions, labels=labels, ax=ax, font_size=5.8, font_color=INK, verticalalignment="top", clip_on=False)
    ax.text(0.01, 0.01, f"{graph.number_of_nodes()} concepts  |  {graph.number_of_edges()} prerequisite relations  |  DAG: {nx.is_directed_acyclic_graph(graph)}", transform=ax.transAxes, color=MUTED, fontsize=10)
    ax.set_axis_off()
    REPORT.section("Figure 1: rendering")
    files = save_figure(fig, output, "01_curriculum_knowledge_graph")
    return {"nodes": graph.number_of_nodes(), "edges": graph.number_of_edges(), "acyclic": nx.is_directed_acyclic_graph(graph),
            "diagnostics": diagnostics, "files": files}


# --------------------------------------------------------------------------- #
# Figure 2: learner-state estimation
# --------------------------------------------------------------------------- #
def draw_learner_state(output: Path) -> dict[str, Any]:
    REPORT.section("Figure 2: learner-state estimation - loading data")
    summary = load_json(ROOT / "data" / "bkt_validation" / "summary.json")
    estimators = summary["estimators"]
    convergence = {name: values["per_seed"][0]["convergence"] for name, values in estimators.items()}
    days = np.arange(1, len(next(iter(convergence.values()))) + 1)

    REPORT.section("Learner-state estimation: validation metrics")
    REPORT.kv("Estimators compared", list(estimators))
    REPORT.kv("Seeds per estimator", {n: len(v["per_seed"]) for n, v in estimators.items()})
    REPORT.kv("Observation days", len(days))
    REPORT.kv("Best gated estimator", summary.get("best_estimator", "n/a"))
    rows = []
    for name, values in estimators.items():
        rows.append([name, fmt(values["mae_mean"]), fmt(values["rmse_mean"]), fmt(values["pearson_mean"]),
                     values.get("verdict", "n/a")])
    REPORT.table(["Estimator", "MAE (mean)", "RMSE (mean)", "Pearson r", "Verdict"], rows)
    for name, values in estimators.items():
        if "mae_std" in values:
            REPORT.kv(f"{name} MAE std across seeds", fmt(values["mae_std"]))

    REPORT.section("Learner-state estimation: convergence (seed 0)")
    rows = []
    for name, series in convergence.items():
        first, last = float(series[0]), float(series[-1])
        change = (first - last) / first * 100 if first else float("nan")
        rows.append([name, fmt(first), fmt(last), fmt(min(series)), int(np.argmin(series)) + 1, f"{change:+.1f}%"])
        if last > first:
            REPORT.warn(f"{name}: error is higher on the final day than on day 1")
    REPORT.table(["Estimator", "Day-1 error", "Final error", "Min error", "Min on day", "Error reduction"], rows)

    # Head-to-head, when BKT is one of the estimators.
    if "BKT" in estimators and len(estimators) > 1:
        others = [n for n in estimators if n != "BKT"]
        for other in others:
            delta = estimators["BKT"]["mae_mean"] - estimators[other]["mae_mean"]
            REPORT.info(f"MAE: BKT - {other} = {delta:+.4f} ({'BKT worse' if delta > 0 else 'BKT better'})")

    fig, (left, right) = plt.subplots(1, 2, figsize=(18, 8), gridspec_kw={"width_ratios": [1.45, 1]}, constrained_layout=True)
    fig.patch.set_facecolor(PAPER)
    for ax in (left, right):
        ax.set_facecolor(PAPER)
    left.set_title("Learner-state estimation over repeated evidence", loc="left", fontsize=18, fontweight="bold", color=INK, pad=18)
    left.text(0, 1.02, "Mean absolute estimation error by observation day; lower is better", transform=left.transAxes, fontsize=10, color=MUTED)
    for name, values in convergence.items():
        color = "#EB5757" if name == "BKT" else "#2F80ED"
        left.plot(days, values, lw=2.6, color=color, label=name)
        left.scatter(days[-1], values[-1], color=color, s=35, zorder=3)
    left.set_xlabel("Observation day")
    left.set_ylabel("MAE / convergence error")
    left.grid(axis="y", color=GRID)
    left.legend(frameon=False)
    right.set_title("Validation profile", loc="left", fontsize=18, fontweight="bold", color=INK, pad=18)
    names = list(estimators)
    x = np.arange(len(names))
    width = 0.25
    for offset, metric, label, color in [(-width, "mae_mean", "MAE", "#2F80ED"), (0, "rmse_mean", "RMSE", "#F2994A"), (width, "pearson_mean", "Pearson r", "#27AE60")]:
        values = [estimators[name][metric] for name in names]
        right.bar(x + offset, values, width, label=label, color=color)
    right.set_xticks(x, [wrapped(name, 13) for name in names])
    right.set_ylim(0, 1.0)
    right.set_ylabel("Metric value")
    right.grid(axis="y", color=GRID)
    right.legend(frameon=False, ncol=3, fontsize=9)
    best = summary.get("best_estimator", "")
    right.text(0.02, 0.94, f"Best gated estimator: {best}\nBKT is shown transparently as a baseline", transform=right.transAxes, fontsize=10, color=INK, bbox={"boxstyle": "round,pad=0.5", "facecolor": "white", "edgecolor": GRID})
    REPORT.section("Figure 2: rendering")
    files = save_figure(fig, output, "02_learner_state_estimation")
    return {"best_estimator": best, "estimators": {name: {key: values[key] for key in ("mae_mean", "rmse_mean", "pearson_mean", "verdict")} for name, values in estimators.items()},
            "files": files}


# --------------------------------------------------------------------------- #
# Figure 3: scheduler policy comparison
# --------------------------------------------------------------------------- #
def draw_scheduler_metrics(output: Path) -> dict[str, Any]:
    REPORT.section("Figure 3: scheduler policy metrics - loading data")
    results = load_json(ROOT / "data" / "stage4_evaluation_results.json")
    policies = list(results)
    metrics = ["learning_gap_coverage", "mastery_resolution_rate", "prerequisite_violations", "average_instructional_delay", "time_to_mastery", "switching_cost"]
    labels = ["Gap coverage", "Mastery resolution", "Prerequisite safety", "Instruction delay", "Time to mastery", "Switching cost"]
    # Normalize each metric against the observed policy range. For cost metrics
    # higher is worse, so the displayed score always means "better".
    higher_is_better = {"learning_gap_coverage": True, "mastery_resolution_rate": True}

    REPORT.kv("Policies compared", policies)
    REPORT.kv("Metrics", metrics)
    missing = [(p, m) for p in policies for m in metrics if m not in results[p]]
    if missing:
        REPORT.warn(f"Missing metric values: {missing[:5]}")
    else:
        REPORT.ok("All policies report all metrics")

    REPORT.section("Scheduler: raw metric values (^ higher is better, v lower is better)")
    headers = ["Policy"] + [f"{m}{' ^' if higher_is_better.get(m) else ' v'}" for m in metrics]
    REPORT.table(headers, [[p] + [fmt(float(results[p][m]), 3) for m in metrics] for p in policies])

    scores: dict[str, list[float]] = {}
    for metric in metrics:
        values = np.array([float(results[p][metric]) for p in policies])
        low, high = values.min(), values.max()
        if math.isclose(low, high):
            REPORT.warn(f"'{metric}' is identical across policies; scored 1.0 for all")
        scaled = np.full(len(values), 1.0) if math.isclose(low, high) else (values - low) / (high - low)
        scores[metric] = list(scaled if higher_is_better.get(metric, False) else 1 - scaled)

    REPORT.section("Scheduler: normalised scores (0 = worst policy, 1 = best policy)")
    overall = {p: float(np.mean([scores[m][i] for m in metrics])) for i, p in enumerate(policies)}
    ranking = sorted(policies, key=lambda p: overall[p], reverse=True)
    REPORT.table(["Policy"] + labels + ["Mean", "Rank"],
                 [[p] + [fmt(scores[m][i], 2) for m in metrics] + [fmt(overall[p], 3), ranking.index(p) + 1]
                  for i, p in enumerate(policies)])

    REPORT.section("Scheduler: per-metric winners")
    winners = []
    for m, label in zip(metrics, labels):
        raw = {p: float(results[p][m]) for p in policies}
        best_policy = max(raw, key=raw.get) if higher_is_better.get(m) else min(raw, key=raw.get)
        winners.append([label, best_policy, fmt(raw[best_policy], 3)])
    REPORT.table(["Metric", "Best policy", "Value"], winners)

    if "CALCMATE" in results:
        baselines = [p for p in policies if p != "CALCMATE"]
        REPORT.section("Scheduler: CALCMATE vs best baseline")
        rows = []
        for m, label in zip(metrics, labels):
            cm = float(results["CALCMATE"][m])
            vals = {p: float(results[p][m]) for p in baselines}
            if not vals:
                continue
            best_base = max(vals, key=vals.get) if higher_is_better.get(m) else min(vals, key=vals.get)
            diff = cm - vals[best_base]
            better = diff > 0 if higher_is_better.get(m) else diff < 0
            pct = f"{diff / vals[best_base] * 100:+.1f}%" if vals[best_base] else "n/a"
            rows.append([label, fmt(cm, 3), best_base, fmt(vals[best_base], 3), pct,
                         "better" if better else ("tie" if diff == 0 else "worse")])
        REPORT.table(["Metric", "CALCMATE", "Best baseline", "Baseline value", "Diff", "Outcome"], rows)
        wins = sum(1 for r in rows if r[-1] == "better")
        REPORT.kv("Metrics where CALCMATE leads", f"{wins}/{len(rows)}")
        REPORT.kv("CALCMATE overall rank", f"{ranking.index('CALCMATE') + 1} of {len(policies)}")
    else:
        REPORT.warn("Policy 'CALCMATE' not found in results; highlight and summary skipped")

    angles = np.linspace(0, 2 * np.pi, len(metrics), endpoint=False).tolist()
    angles += angles[:1]
    fig = plt.figure(figsize=(17, 9), facecolor=PAPER)
    grid = fig.add_gridspec(1, 2, width_ratios=[1.25, 1], wspace=0.2)
    ax = fig.add_subplot(grid[0, 0], polar=True, facecolor=PAPER)
    ax.set_title("Scheduler policy profile", loc="left", x=-0.05, y=1.15, fontsize=20, fontweight="bold", color=INK)
    ax.text(-0.05, 1.08, "Relative performance across controlled simulated classrooms; larger area means better", transform=ax.transAxes, fontsize=10, color=MUTED)
    for policy in policies:
        values = [scores[m][policies.index(policy)] for m in metrics] + [scores[metrics[0]][policies.index(policy)]]
        color = "#2F80ED" if policy == "CALCMATE" else "#AAB5C3"
        ax.plot(angles, values, lw=3 if policy == "CALCMATE" else 1.2, color=color, label=policy)
        ax.fill(angles, values, color=color, alpha=0.14 if policy == "CALCMATE" else 0.025)
    ax.set_xticks(angles[:-1], labels, fontsize=9)
    ax.set_yticks([0.25, 0.5, 0.75, 1.0], ["25%", "50%", "75%", "100%"], fontsize=8, color=MUTED)
    ax.set_ylim(0, 1)
    ax.grid(color=GRID)
    ax.legend(loc="lower left", bbox_to_anchor=(-0.12, -0.20), frameon=False, ncol=2)

    ax2 = fig.add_subplot(grid[0, 1], facecolor=PAPER)
    violations = [results[p]["prerequisite_violations"] for p in policies]
    bars = ax2.barh([wrapped(p, 16) for p in policies], violations, color=["#2F80ED" if p == "CALCMATE" else "#AAB5C3" for p in policies])
    ax2.set_title("Prerequisite-safe allocation", loc="left", fontsize=18, fontweight="bold", color=INK, pad=18)
    ax2.text(0, 1.02, "A key differentiator of graph-aware scheduling", transform=ax2.transAxes, fontsize=10, color=MUTED)
    ax2.set_xlabel("Mean prerequisite violations")
    ax2.grid(axis="x", color=GRID)
    for bar, value in zip(bars, violations):
        ax2.text(bar.get_width() + max(violations) * 0.025, bar.get_y() + bar.get_height() / 2, f"{value:.1f}", va="center", color=INK, fontsize=10, fontweight="bold")
    ax2.spines[["top", "right", "left"]].set_visible(False)
    REPORT.section("Figure 3: rendering")
    files = save_figure(fig, output, "03_scheduler_policy_metrics")
    return {"policies": policies, "metric_names": labels, "overall_scores": overall,
            "calcmate_prerequisite_violations": results["CALCMATE"]["prerequisite_violations"], "files": files}


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def timed(name: str, func, output: Path, timings: dict[str, float]) -> dict[str, Any]:
    start = time.perf_counter()
    try:
        result = func(output)
    except Exception as exc:  # keep the failure visible in the saved report
        REPORT.section(f"ERROR in {name}")
        REPORT.emit(f"  {type(exc).__name__}: {exc}")
        raise
    timings[name] = round(time.perf_counter() - start, 2)
    REPORT.ok(f"{name} finished in {timings[name]:.2f}s")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Directory for generated figures")
    parser.add_argument("--quiet", action="store_true", help="Suppress console diagnostics (run_report.txt is still written)")
    args = parser.parse_args()
    REPORT.quiet = args.quiet
    args.output.mkdir(parents=True, exist_ok=True)

    overall_start = time.perf_counter()
    REPORT.banner("CALCMATE REPORT FIGURE GENERATOR")
    REPORT.section("Run environment")
    REPORT.kv("Timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    REPORT.kv("Python", platform.python_version())
    REPORT.kv("Platform", platform.platform())
    REPORT.kv("matplotlib", matplotlib.__version__)
    REPORT.kv("networkx", nx.__version__)
    REPORT.kv("numpy", np.__version__)
    REPORT.kv("Repository root", ROOT)
    REPORT.kv("Output directory", args.output.resolve())

    timings: dict[str, float] = {}
    figures = {
        "knowledge_graph": timed("knowledge_graph", draw_knowledge_graph, args.output, timings),
        "learner_state": timed("learner_state", draw_learner_state, args.output, timings),
        "scheduler": timed("scheduler", draw_scheduler_metrics, args.output, timings),
    }

    manifest = {"source": "repository artefacts", "generated_at": datetime.now().isoformat(timespec="seconds"),
                "timings_seconds": timings, "figures": figures}
    manifest_path = args.output / "figure_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")

    REPORT.section("Run summary")
    rows = []
    for key, info in figures.items():
        rows.append([key, ", ".join(info["files"]), f"{timings[key]:.2f}s"])
    REPORT.table(["Figure", "Files", "Time"], rows)
    REPORT.kv("Manifest", manifest_path.name)
    REPORT.kv("Total runtime", f"{time.perf_counter() - overall_start:.2f}s")
    REPORT.ok(f"Generated report figures in {args.output.resolve()}")

    report_path = args.output / "run_report.txt"
    REPORT.save(report_path)
    if not args.quiet:
        print(f"  [OK]   Console report saved to {report_path}")


if __name__ == "__main__":
    main()