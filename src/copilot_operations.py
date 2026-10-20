"""
CALCMATE — Stage 3: Copilot Operations
src/copilot_operations.py

One function per structured intent. Each function:
- Receives an IntentResult and a CopilotRequest.
- Reads from the local SQLite db (when db_path is available) or uses payload data.
- Calls learner_intelligence or knowledge_graph for structured data.
- Calls retrieve.py for NCERT content.
- Returns an OperationResult with structured_data, evidence_summary, graph_finding, etc.
- NEVER fabricates student data, mastery values, citations, or schedules.

Resource coverage is read from shipped metadata. Selected foundational resources have explicit limitations and provenance.
"""
from __future__ import annotations

from typing import Optional

from src.copilot_contract import (
    CopilotIntent, CopilotRequest, IntentResult,
    OperationResult, OperationStatus,
)
from src.knowledge_graph import load_kg, prerequisite_readiness
from src import learner_intelligence as li

def _find_db() -> Optional[str]:
    from src.classroom_contracts import snapshot_connection
    return "request-snapshot" if snapshot_connection.get() is not None else None


def _rag_limitation(grade: int) -> Optional[str]:
    from src.resource_coverage import coverage
    current=coverage().get(str(grade),{})
    if not current.get('chunks'):
        return f'No textbook resources are indexed for Grade {grade}.'
    if current.get('source_summaries'):
        return f'Grade {grade} has selected source summaries; coverage is partial and these are labelled separately from textbook passages.'
    return None


def _retrieve_for_concept(concept_phrase: str, grade: int, k: int = 3) -> list[dict]:
    """Call the retriever; return list of chunk dicts (safe even if unavailable)."""
    try:
        from src.copilot import get_default_retriever, MIN_SCORE_THRESHOLD
        from src.classroom_queries import concept_ids
        ids = concept_ids(concept_phrase, grade)
        kg = load_kg()
        query = "; ".join(kg.nodes[cid]["concept"] for cid in ids) if ids else concept_phrase
        if len(ids) == 1:
            grade = int(kg.nodes[ids[0]]["grade"])
        retriever = get_default_retriever()
        chunks = retriever.retrieve(query, grade=min(grade, 5), subject="Math", k=k, concept_ids=ids or None)
        chunks = [chunk for chunk in chunks if chunk.score >= MIN_SCORE_THRESHOLD]
        print(
            "[CALCMATE_TRACE] operation_retrieval "
            f"phrase={concept_phrase[:80]!r} grade={grade!r} chunks={len(chunks)!r}",
            flush=True,
        )
        return [
            {
                "chunk_id": c.chunk_id, "text": c.text[:400], "grade": c.grade,
                "subject": c.subject, "source_pdf": c.source_pdf,
                "chunk_index": c.chunk_index, "score": round(c.score, 3), "concept_ids": getattr(c,"concept_ids",[]),
                "used_fallback": c.used_fallback,"source_url":getattr(c,"source_url",None),"source_pages":getattr(c,"source_pages",None),"resource_kind":getattr(c,"resource_kind","textbook_passage"),
            }
            for c in chunks
        ]
    except Exception as exc:
        print(f"[CALCMATE_TRACE] operation_retrieval_error error_type={type(exc).__name__!r}", flush=True)
        return []


# ─── Operations ───────────────────────────────────────────────────────────────

def op_find_students_by_concept(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Find students who need support on a given concept."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    concept_phrase: str = params.get("concept_phrase", concept_id or "the concept")
    grade: int = int(params.get("grade", request.grade))
    limitations = []

    if not concept_id:
        return OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.PARTIAL,
            evidence_summary="No specific concept was identified in the question.",
            limitations=["Please specify which concept you are asking about (e.g., fractions, multiplication)."],
        )

    db_path = _find_db()
    if not db_path:
        return OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.UNAVAILABLE,
            evidence_summary="The classroom database is not accessible from the server.",
            limitations=["Connect the server to the local classroom device to access student data."],
        )

    workspace_id = request.workspace_id
    if not workspace_id:
        return OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.UNAVAILABLE,
            evidence_summary="No workspace ID was provided.",
            limitations=["workspace_id is required to query student data."],
        )

    try:
        summary = li.get_group_concept_summary(workspace_id, grade, concept_id, db_path)
        counts = summary.get("counts", {})
        total = summary.get("total_students", 0)
        needs_support = counts.get("needs_support", 0)
        unknown = counts.get("unknown", 0)
        likely_ready = counts.get("likely_ready", 0)

        evidence = (
            f"Grade {grade}, concept '{concept_phrase}': "
            f"{total} students total — "
            f"{needs_support} need support, {likely_ready} likely ready, "
            f"{unknown} unassessed."
        )
        identified = [s["name"] for s in summary.get("students", []) if s["state_status"] == "needs_support"]
        unassessed = [s["name"] for s in summary.get("students", []) if s["state_status"] == "unknown"]
        if identified:
            evidence += " Students needing support: " + ", ".join(identified) + "."
        if unassessed:
            evidence += " No assessment evidence: " + ", ".join(unassessed) + "."
        graph_finding = None
        if summary.get("mean_mastery") is not None:
            graph_finding = f"Group mean mastery: {summary['mean_mastery']:.0%}."

        rec = None
        if needs_support > 0 or unknown > 0:
            rec = (f"Review {needs_support + unknown} student(s) who need support or have "
                   f"not yet been assessed on '{concept_phrase}'.")

        return OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.OK,
            structured_data=summary,
            evidence_summary=evidence,
            graph_finding=graph_finding,
            limitations=limitations,
            recommended_next_step=rec,
        )
    except Exception as exc:
        return OperationResult(
            operation="find_students_by_concept",
            status=OperationStatus.ERROR,
            error_detail=str(exc),
        )


def op_get_student_concept_state(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Return a single student's state on a specific concept."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    student_id: Optional[str] = params.get("student_id") or request.student_id
    concept_phrase: str = params.get("concept_phrase", concept_id or "the concept")
    workspace_id = request.workspace_id
    limitations = []

    if not concept_id or not student_id or not workspace_id:
        missing = []
        if not concept_id: missing.append("concept")
        if not student_id: missing.append("student")
        return OperationResult(
            operation="get_student_concept_state",
            status=OperationStatus.PARTIAL,
            evidence_summary=f"Missing: {', '.join(missing)}.",
            limitations=[f"Please specify {' and '.join(missing)} to check the state."],
        )

    db_path = _find_db()
    if not db_path:
        return OperationResult(
            operation="get_student_concept_state",
            status=OperationStatus.UNAVAILABLE,
            limitations=["Classroom database not accessible from the server."],
        )

    try:
        state = li.get_student_concept_state(workspace_id, student_id, concept_id, db_path)
        if not state:
            return OperationResult(
                operation="get_student_concept_state",
                status=OperationStatus.PARTIAL,
                evidence_summary=f"No assessment evidence recorded for student {student_id} on '{concept_phrase}'.",
                limitations=["Record at least one assessment to estimate mastery."],
            )

        mastery = state.get("mastery_estimate")
        status_str = state.get("state_status", "unknown")
        evidence_count = state.get("evidence_count", 0)
        evidence = (
            f"Student {student_id} — '{concept_phrase}': "
            f"state={status_str}, "
            f"mastery={f'{mastery:.0%}' if mastery is not None else 'N/A'}, "
            f"evidence={evidence_count} assessment(s)."
        )

        # KG prerequisite check
        kg = load_kg()
        prereq_ids = list(kg.predecessors(concept_id)) if concept_id in kg.nodes else []
        graph_finding = None
        if prereq_ids:
            analysis = li.get_student_prerequisite_analysis(workspace_id, student_id, concept_id, db_path)
            readiness = analysis["kg_prerequisite_readiness"]
            graph_finding = (
                f"Prerequisite readiness score: {readiness:.2f} "
                f"(prerequisites: {', '.join(prereq_ids)})."
            )

        return OperationResult(
            operation="get_student_concept_state",
            status=OperationStatus.OK,
            structured_data=state,
            evidence_summary=evidence,
            graph_finding=graph_finding,
            limitations=limitations,
        )
    except Exception as exc:
        return OperationResult(
            operation="get_student_concept_state",
            status=OperationStatus.ERROR,
            error_detail=str(exc),
        )


def op_get_student_progress(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Return a student's full knowledge view across all grade concepts."""
    params = intent.parameters
    student_id: Optional[str] = params.get("student_id") or request.student_id
    grade: int = int(params.get("grade", request.grade))
    workspace_id = request.workspace_id

    if not student_id or not workspace_id:
        return OperationResult(
            operation="get_student_progress",
            status=OperationStatus.PARTIAL,
            limitations=["student_id and workspace_id are required."],
        )

    db_path = _find_db()
    if not db_path:
        return OperationResult(
            operation="get_student_progress",
            status=OperationStatus.UNAVAILABLE,
            limitations=["Classroom database not accessible."],
        )

    try:
        view = li.get_student_knowledge_view(workspace_id, student_id, db_path)
        assessed = view.get("assessed_count", 0)
        total = assessed + view.get("unassessed_count", 0)
        needs_support = view.get("needs_support_count", 0)
        likely_ready = view.get("likely_ready_count", 0)

        evidence = (
            f"{view.get('student_name', student_id)} (Grade {view.get('grade', grade)}): "
            f"{assessed}/{total} concepts assessed — "
            f"{likely_ready} likely ready, {needs_support} need support."
        )
        gaps_with_prereq = [c for c in view.get("concepts", []) if c.get("prerequisite_gap")]
        graph_finding = None
        if gaps_with_prereq:
            names = [c.get("concept_title", c["concept_id"]) for c in gaps_with_prereq[:3]]
            graph_finding = f"Prerequisite gaps detected on: {', '.join(names)}."

        return OperationResult(
            operation="get_student_progress",
            status=OperationStatus.OK,
            structured_data=view,
            evidence_summary=evidence,
            graph_finding=graph_finding,
        )
    except Exception as exc:
        return OperationResult(
            operation="get_student_progress",
            status=OperationStatus.ERROR,
            error_detail=str(exc),
        )


def op_explain_prerequisites(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Explain what a student must know before learning a given concept."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    concept_phrase: str = params.get("concept_phrase", concept_id or "the concept")
    grade: int = int(params.get("grade", request.grade))
    student_id: Optional[str] = params.get("student_id") or request.student_id
    workspace_id = request.workspace_id
    limitations: list[str] = []
    lim = _rag_limitation(grade)
    if lim:
        limitations.append(lim)

    if not concept_id:
        return OperationResult(
            operation="explain_prerequisites",
            status=OperationStatus.PARTIAL,
            evidence_summary="No specific concept identified.",
            limitations=["Specify the concept to see its prerequisites."],
        )

    kg = load_kg()
    prereq_ids = list(kg.predecessors(concept_id)) if concept_id in kg.nodes else []

    if not prereq_ids:
        evidence = f"'{concept_phrase}' has no prerequisites recorded in the curriculum graph."
        return OperationResult(
            operation="explain_prerequisites",
            status=OperationStatus.OK,
            evidence_summary=evidence,
            graph_finding="This concept is foundational (no prerequisites).",
            limitations=limitations,
        )

    prereq_names = [kg.nodes[pid].get("concept", pid) for pid in prereq_ids]
    graph_finding = f"Prerequisites for '{concept_phrase}': {', '.join(prereq_names)}."

    # If student available, check their states
    db_path = _find_db()
    evidence = graph_finding
    rec = None
    if student_id and workspace_id and db_path:
        try:
            analysis = li.get_student_prerequisite_analysis(
                workspace_id, student_id, concept_id, db_path
            )
            evidence = analysis.get("recommendation", graph_finding)
            readiness = analysis.get("kg_prerequisite_readiness")
            if readiness is not None:
                graph_finding += f" KG readiness score: {readiness:.2f}."
            if analysis.get("has_blocking_gaps"):
                rec = f"Address prerequisite gaps before teaching '{concept_phrase}'."
        except Exception:
            pass

    chunks = _retrieve_for_concept(concept_phrase, grade)
    ncert = None
    if chunks:
        top = chunks[0]
        ncert = {"source_pdf": top["source_pdf"], "grade": top["grade"],
                 "text_snippet": top["text"][:200]}

    return OperationResult(
        operation="explain_prerequisites",
        status=OperationStatus.OK,
        structured_data={"concept_id": concept_id, "prerequisite_ids": prereq_ids,
                         "prerequisite_names": prereq_names},
        evidence_summary=evidence,
        graph_finding=graph_finding,
        ncert_resource=ncert,
        limitations=limitations,
        recommended_next_step=rec,
    )


def op_explain_learning_difficulty(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Explain why students might find a concept difficult using KG + RAG."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    concept_phrase: str = params.get("concept_phrase", concept_id or "the concept")
    grade: int = int(params.get("grade", request.grade))
    limitations: list[str] = []
    lim = _rag_limitation(grade)
    if lim:
        limitations.append(lim)

    kg = load_kg()
    prereq_ids = list(kg.predecessors(concept_id)) if concept_id and concept_id in kg.nodes else []
    graph_finding = None
    if prereq_ids:
        prereq_names = [kg.nodes.get(pid, {}).get("concept", pid) for pid in prereq_ids]
        graph_finding = (
            f"Curriculum graph: '{concept_phrase}' depends on "
            f"{', '.join(prereq_names)}. Gaps in these prerequisites "
            f"are a common source of difficulty."
        )

    chunks = _retrieve_for_concept(concept_phrase, grade)
    ncert = None
    if chunks:
        top = chunks[0]
        ncert = {"source_pdf": top["source_pdf"], "grade": top["grade"],
                 "text_snippet": top["text"][:200]}

    evidence = (
        f"Difficulty analysis for '{concept_phrase}' (Grade {grade}): "
        f"{len(prereq_ids)} direct prerequisite(s) identified in the curriculum graph."
    )

    return OperationResult(
        operation="explain_learning_difficulty",
        status=OperationStatus.OK,
        structured_data={"concept_id": concept_id, "prerequisite_ids": prereq_ids},
        evidence_summary=evidence,
        graph_finding=graph_finding,
        ncert_resource=ncert,
        limitations=limitations,
    )


def op_classroom_learning_summary(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Return a classroom-level learning summary for all grade concepts."""
    params = intent.parameters
    grade: int = int(params.get("grade", request.grade))
    workspace_id = request.workspace_id

    if not workspace_id:
        return OperationResult(
            operation="classroom_learning_summary",
            status=OperationStatus.UNAVAILABLE,
            limitations=["workspace_id required."],
        )

    db_path = _find_db()
    if not db_path:
        return OperationResult(
            operation="classroom_learning_summary",
            status=OperationStatus.UNAVAILABLE,
            limitations=["Classroom database not accessible."],
            recommended_next_step="Reconnect the classroom workspace or record learner evidence on the classroom device before asking for attention priorities.",
        )

    try:
        import sqlite3
        import datetime
        with li._connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            students = conn.execute(
                "SELECT id, name FROM students WHERE workspace_id=? AND grade=? ORDER BY name",
                (workspace_id, grade),
            ).fetchall()
            concepts = conn.execute(
                "SELECT id, title FROM concepts WHERE workspace_id=? AND grade=? ORDER BY id",
                (workspace_id, grade),
            ).fetchall()

        if not concepts:
            return OperationResult(
                operation="classroom_learning_summary",
                status=OperationStatus.PARTIAL,
                evidence_summary=f"No concepts found for Grade {grade} in this workspace.",
            )

        summaries = []
        for c in concepts[:10]:  # cap at 10 to keep response manageable
            s = li.get_group_concept_summary(workspace_id, grade, c["id"], db_path)
            summaries.append({**s, "concept_title": c["title"]})

        # Rank attention deterministically from stored learner-state evidence.
        # Unknown evidence is reported separately and never treated as failure.
        attention_candidates = []
        for student in students:
            view = li.get_student_knowledge_view(workspace_id, student["id"], db_path)
            support = [
                c["concept_title"] for c in view["concepts"]
                if (c.get("state") or {}).get("state_status") == "needs_support"
            ]
            concept_by_id = {c["concept_id"]: c for c in view["concepts"]}
            prerequisite_support = []
            prerequisite_unknown = []
            for concept in view["concepts"]:
                if not concept.get("prerequisite_gap"):
                    continue
                prerequisite_states = [
                    (concept_by_id.get(pid) or {}).get("state") or {}
                    for pid in concept.get("prerequisite_ids", [])
                ]
                if any(state.get("state_status") == "needs_support" for state in prerequisite_states):
                    prerequisite_support.append(concept["concept_title"])
                else:
                    prerequisite_unknown.append(concept["concept_title"])
            insufficient_count = sum(
                1 for c in view["concepts"]
                if (c.get("state") or {}).get("state_status") == "unknown"
            ) + len(prerequisite_unknown)
            priority = len(support) * 3 + len(prerequisite_support) * 2
            if not support and not prerequisite_support and insufficient_count:
                priority = 1
            if priority:
                reasons = []
                if support:
                    reasons.append(f"needs support on {', '.join(support[:2])}")
                if prerequisite_support:
                    reasons.append(f"prerequisite gap for {', '.join(prerequisite_support[:2])}")
                if prerequisite_unknown:
                    reasons.append(f"prerequisite evidence missing for {', '.join(prerequisite_unknown[:2])}")
                if insufficient_count and not support and not prerequisite_support:
                    reasons.append(f"{insufficient_count} concept(s) have insufficient evidence")
                attention_candidates.append({
                    "student_id": student["id"],
                    "student_name": student["name"],
                    "priority": priority,
                    "reason": "; ".join(reasons),
                    "evidence_status": "supported" if support or prerequisite_support else "unknown",
                })
        attention_candidates.sort(key=lambda item: (-item["priority"], item["student_name"]))

        attendance = []
        try:
            today = datetime.date.today().isoformat()
            with li._connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                from src.classroom_contracts import snapshot_connection
                if snapshot_connection.get() is not None:
                    today = conn.execute("SELECT value FROM classroom_meta WHERE key='as_of'").fetchone()[0]
                attendance = [dict(row) for row in conn.execute(
                    """SELECT s.name AS student_name, a.status FROM attendance a
                       JOIN students s ON s.id=a.student_id AND s.workspace_id=a.workspace_id
                       WHERE a.workspace_id=? AND s.grade=? AND a.date=? ORDER BY s.name""",
                    (workspace_id, grade, today),
                ).fetchall()]
        except sqlite3.OperationalError:
            # Older classroom databases may not yet contain attendance.
            attendance = []

        total_students = summaries[0]["total_students"] if summaries else 0
        needs_support_concepts = [
            s["concept_title"] for s in summaries
            if s.get("counts", {}).get("needs_support", 0) > 0
        ]

        evidence = (
            f"Grade {grade} classroom summary: {total_students} student(s), "
            f"{len(concepts)} concept(s) in scope. "
            f"{len(needs_support_concepts)} concept(s) have students needing support."
        )
        if attention_candidates:
            supported = [item for item in attention_candidates if item["evidence_status"] == "supported"]
            unknown = [item for item in attention_candidates if item["evidence_status"] == "unknown"]
            if supported:
                listed = ", ".join(
                    f"{item['student_name']} ({item['reason']})"
                    for item in supported[:5]
                )
                evidence += f" Confirmed learning needs: {listed}."
            if unknown:
                listed_unknown = ", ".join(
                    f"{item['student_name']} ({item['reason']})"
                    for item in unknown[:5]
                )
                evidence += f" Insufficient evidence requiring a check: {listed_unknown}."
        elif students:
            evidence += " No demonstrated learning difficulty was found in the recorded learner states."
        elif not students:
            evidence += " No students are enrolled; there is insufficient evidence to rank attention needs."
        if attendance:
            attendance_counts = {
                status: sum(1 for row in attendance if row["status"] == status)
                for status in ("present", "late", "absent")
            }
            evidence += (
                f" Attendance recorded today: {attendance_counts['present']} present, "
                f"{attendance_counts['late']} late, {attendance_counts['absent']} absent."
            )
        elif students:
            evidence += " Today's attendance is not recorded for this group."

        rec = (f"Focus on: {', '.join(needs_support_concepts[:3])}."
               if needs_support_concepts else "Begin with a short readiness check for concepts with missing evidence.")

        return OperationResult(
            operation="classroom_learning_summary",
            status=OperationStatus.OK,
            structured_data={
                "grade": grade,
                "concept_summaries": summaries,
                "attention_candidates": attention_candidates,
                "attendance": attendance,
            },
            evidence_summary=evidence,
            recommended_next_step=rec,
        )
    except Exception as exc:
        return OperationResult(
            operation="classroom_learning_summary",
            status=OperationStatus.ERROR,
            error_detail=str(exc),
        )


def op_group_prerequisite_readiness(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Check if the grade group is ready to learn a given concept."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    concept_phrase: str = params.get("concept_phrase", concept_id or "the concept")
    grade: int = int(params.get("grade", request.grade))
    workspace_id = request.workspace_id

    if not concept_id or not workspace_id:
        return OperationResult(
            operation="group_prerequisite_readiness",
            status=OperationStatus.PARTIAL,
            limitations=["concept_id and workspace_id required."],
        )

    db_path = _find_db()
    if not db_path:
        return OperationResult(
            operation="group_prerequisite_readiness",
            status=OperationStatus.UNAVAILABLE,
            limitations=["Classroom database not accessible."],
        )

    try:
        result = li.get_group_prerequisite_readiness(workspace_id, grade, concept_id, db_path)
        group_ready = result.get("group_ready", False)
        prereqs = result.get("prerequisites", [])

        if not prereqs:
            evidence = f"No prerequisites for '{concept_phrase}' in the curriculum graph."
            graph_finding = "This is a foundational concept; no prerequisite readiness check needed."
        else:
            low = [p for p in prereqs if p["readiness_fraction"] < 1]
            evidence = (
                f"Group prerequisite readiness for '{concept_phrase}' (Grade {grade}): "
                f"{len(prereqs)} prerequisite(s) checked. "
                f"{'Group is ready.' if group_ready else f'{len(low)} prerequisite(s) have support or missing-evidence gaps.'}"
            )
            graph_finding = (
                "Every student has prerequisite evidence at or above the practice threshold. Proceed with instruction."
                if group_ready
                else f"Not ready: {', '.join(p['concept_title'] for p in low)} need more support first."
            )

        rec = (None if group_ready
               else f"Spend more time on prerequisites before teaching '{concept_phrase}'.")

        return OperationResult(
            operation="group_prerequisite_readiness",
            status=OperationStatus.OK,
            structured_data=result,
            evidence_summary=evidence,
            graph_finding=graph_finding,
            recommended_next_step=rec,
        )
    except Exception as exc:
        return OperationResult(
            operation="group_prerequisite_readiness",
            status=OperationStatus.ERROR,
            error_detail=str(exc),
        )


def _practice_steps(title):
    """Inspectable teacher-practice templates; retrieved sources stay explicit."""
    lower = title.lower()
    if "equivalent" in lower and "fraction" in lower:
        return ["Take two equal-length paper strips. Fold the first into two equal parts and shade one part (1/2).",
                "Fold the second into four equal parts and shade two parts (2/4). Align their ends and compare the shaded lengths.",
                "Explain why 1/2 = 2/4, then repeat with 1/3 and 2/6. Ask each learner to draw and explain one equivalent pair."]
    if "numerator" in lower or "denominator" in lower or "fraction representation" in lower:
        return ["Divide a rectangle into four equal parts and shade three.",
                "Write 3/4: explain that 4 counts all equal parts and 3 counts shaded parts.",
                "Change the number of shaded parts and ask learners to draw, name and explain the new fraction."]
    if "division" in lower:
        return (["Share 14 counters equally among three groups: place four in each group and identify the two counters left over.",
                 "Record 14 = 3 x 4 + 2. Explain why the remainder must be smaller than three.",
                 "Try 17 counters in four groups and explain the quotient and remainder."] if "remainder" in lower else
                ["Share 12 counters equally into three groups and count four in each group.",
                 "Record 12 / 3 = 4 and check it with 3 x 4 = 12.",
                 "Ask learners to share 20 counters among five groups and explain their grouping."] if "long" not in lower else
                ["Work through 144 / 12 using place value and the divide, multiply, subtract and bring-down steps.",
                 "Check that 12 x 12 = 144; have partners explain each step.",
                 "Try 168 / 12 independently and check the quotient by multiplication."])
    if "shape" in lower:
        return ["Trace familiar objects to draw a triangle, square and rectangle.",
                "Count and mark their straight sides and corners. Compare them with a circle, which has no corners.",
                "Ask a partner to identify a shape from its sides and corners and explain the choice."]
    if "length" in lower:
        return ["Place two classroom objects side by side with one end aligned.",
                "Identify which extends farther; describe it as longer and the other as shorter.",
                "Order three pencils by length and ask a partner to check the aligned ends and explain the order."]
    if "count" in lower:
        return ["Arrange a small set of counters and count each object exactly once.",
                "Match the set to a written numeral, then rearrange it and count again.",
                "Ask learners to explain why rearranging the same objects does not change their number."]
    return [f"Model one worked example for {title.lower()} using objects or a diagram.",
            "Have pairs explain each step and check a similar example against the model.",
            "Collect one individual exit answer and explanation; record its score before updating learner state."]


def op_recommend_curriculum_activity(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Select the actual concept, use recorded readiness, and cite matching sources."""
    from src.classroom_queries import concept_ids, roster
    params = intent.parameters
    grade = int(params.get("grade", request.grade))
    kg = load_kg()
    target = params.get("concept_id")
    if target not in kg:
        ids = concept_ids(params.get("concept_phrase", ""), grade)
        target = ids[0] if len(ids) == 1 else None
    if not target:
        return OperationResult(operation="recommend_curriculum_activity", status=OperationStatus.PARTIAL,
                               evidence_summary="Please specify the activity's concept or topic and grade.")
    title = kg.nodes[target]["concept"]
    focus = target
    analysis = None
    graph = None
    student_id = params.get("student_id") or request.student_id
    student = next((s for s in roster(request.workspace_id) if s["id"] == student_id), None)
    prefix = ""
    if student_id and student and _find_db():
        analysis = li.get_student_prerequisite_analysis(request.workspace_id, student_id, target, _find_db())
        blocked = [p for p in analysis["prerequisites"] if p["is_blocking"]]
        if blocked:
            focus = blocked[0]["concept_id"]
            reason = "prerequisite evidence is missing; start with a diagnostic check" if blocked[0]["state_status"] == "unknown" else "recorded prerequisite evidence indicates support is needed"
            prefix = f"For {student['name']}, before {title} ({target}), practise {kg.nodes[focus]['concept']} ({focus}): {reason}. "
        else:
            prefix = f"For {student['name']}, recorded prerequisite evidence supports practising {title} ({target}). "
        graph = f"Observed prerequisite readiness: {analysis['kg_prerequisite_readiness']:.2f}. " + analysis["recommendation"]
    grade = int(kg.nodes[focus]["grade"])
    chunks = _retrieve_for_concept(focus, grade)
    steps = _practice_steps(kg.nodes[focus]["concept"])
    limitations = [value for value in [_rag_limitation(grade)] if value]
    if not chunks:
        limitations.append("No concept-specific NCERT passage is indexed for this activity. These are teacher-practice template instructions, not a quoted NCERT activity.")
    evidence = prefix + f"Activity: {kg.nodes[focus]['concept']} ({focus}). " + " ".join(f"{i+1}. {step}" for i, step in enumerate(steps))
    if focus != target:
        evidence += f" Then revisit {title} ({target}) after a scored prerequisite check."
    source = ({"source_pdf": chunks[0]["source_pdf"], "grade": chunks[0]["grade"],
               "text_snippet": chunks[0]["text"][:300]} if chunks else None)
    return OperationResult(operation="recommend_curriculum_activity", status=OperationStatus.OK if chunks else OperationStatus.PARTIAL,
                           evidence_summary=evidence, graph_finding=graph, ncert_resource=source,
                           limitations=limitations, recommended_next_step="Record an individual exit assessment; completing an activity alone does not establish mastery.",
                           structured_data={"concept_id": target, "activity_concept_id": focus,
                                            "concept_phrase": title, "grade": grade, "chunks": chunks,
                                            "prerequisite_analysis": analysis, "deterministic_activity": True,
                                            "activity": {"concept_id": focus, "instructions": steps, "source_references": [c["source_pdf"] for c in chunks]}})


def op_retrieve_ncert_resource(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Retrieve NCERT textbook passages for a concept."""
    return op_recommend_curriculum_activity(intent, request)


def op_explain_concept(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Retrieve NCERT content and prepare a concept explanation."""
    params = intent.parameters
    concept_phrase: str = params.get("concept_phrase", request.message[:80])
    grade: int = int(params.get("grade", request.grade))
    limitations: list[str] = []
    lim = _rag_limitation(grade)
    if lim:
        limitations.append(lim)

    chunks = _retrieve_for_concept(concept_phrase, grade, k=4)
    ncert = None
    if chunks:
        top = chunks[0]
        ncert = {"source_pdf": top["source_pdf"], "grade": top["grade"],
                 "text_snippet": top["text"][:350]}
        evidence = f"Found {len(chunks)} NCERT passage(s) for '{concept_phrase}' (Grade {grade})."
    else:
        evidence = f"No NCERT passages found for '{concept_phrase}' at Grade {grade}."

    return OperationResult(
        operation="explain_concept",
        status=OperationStatus.OK if chunks else OperationStatus.PARTIAL,
        structured_data={"concept_phrase": concept_phrase, "grade": grade, "chunks": chunks},
        evidence_summary=evidence,
        ncert_resource=ncert,
        limitations=limitations,
    )


def op_generate_instructional_schedule(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """
    Stage 4: Emit a structured action signal so the frontend can invoke
    buildGeneralSchedule() directly in TypeScript (the single production engine).

    The backend DOES NOT generate the schedule — it extracts parameters from
    the teacher's request and tells the frontend what to do.  The frontend
    detects action='invoke_local_scheduler' and calls createGeneralSchedule()
    using live classroom data on-device.
    """
    params = intent.parameters

    # --- Extract suggested grades ------------------------------------------
    # Grades explicitly mentioned in the intent; fall back to active grade.
    raw_grades = params.get("grades")  # may be a list set by intent extractor
    if isinstance(raw_grades, list) and raw_grades:
        suggested_grades = [int(g) for g in raw_grades if 1 <= int(g) <= 5]
    else:
        # Fall back: include the request grade plus a prompt to add more.
        suggested_grades = [int(params.get("grade", request.grade))]

    # --- Extract available minutes ------------------------------------------
    available_minutes: int = int(params.get("available_minutes", 45))
    available_minutes = max(20, min(240, available_minutes))

    # --- Extract priority ----------------------------------------------------
    priority_raw = params.get("priority", "balanced")
    priority = "learning-needs" if "need" in str(priority_raw).lower() else "balanced"

    # --- Date ----------------------------------------------------------------
    import datetime
    suggested_date = params.get("date", datetime.date.today().isoformat())

    evidence = (
        f"Schedule request for Grade(s) {', '.join(str(g) for g in suggested_grades)}, "
        f"{available_minutes} minutes, priority={priority}. "
        "The on-device scheduler will compute the rotation using live learner states."
    )

    return OperationResult(
        operation="generate_instructional_schedule",
        status=OperationStatus.OK,
        evidence_summary=evidence,
        recommended_next_step=(
            "The schedule uses your current classroom evidence and the shared planning service. "
            "It will appear as a schedule card below this message."
        ),
        limitations=["Online planning uses observed classroom evidence. Offline schedules are labelled local heuristics; resource coverage varies by concept."],
        structured_data={
            # --- Stage 4 action signal ---
            "action": "invoke_local_scheduler",
            "suggested_grades": suggested_grades,
            "available_minutes": available_minutes,
            "priority": priority,
            "date": suggested_date,
        },
    )


def op_general_question(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Retrieve NCERT textbook passages for a general question."""
    params = intent.parameters
    concept_phrase: str = params.get("concept_phrase", request.message[:80])
    grade: int = int(params.get("grade", request.grade))
    limitations: list[str] = []
    lim = _rag_limitation(grade)
    if lim:
        limitations.append(lim)

    chunks = _retrieve_for_concept(concept_phrase, grade, k=request.k or 3)
    ncert = None
    if chunks:
        top = chunks[0]
        ncert = {"source_pdf": top["source_pdf"], "grade": top["grade"],
                 "text_snippet": top["text"][:350]}
        evidence = f"Retrieved {len(chunks)} NCERT passage(s) for Grade {grade}."
    else:
        evidence = f"No direct NCERT passages found for Grade {grade}."

    return OperationResult(
        operation="general_question",
        status=OperationStatus.OK if chunks else OperationStatus.PARTIAL,
        structured_data={"concept_phrase": concept_phrase, "grade": grade, "chunks": chunks},
        evidence_summary=evidence,
        ncert_resource=ncert,
        limitations=limitations,
    )


def op_unsupported(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    return OperationResult(
        operation="unsupported",
        status=OperationStatus.UNAVAILABLE,
        evidence_summary="This type of question is not yet supported by the structured copilot.",
        limitations=["The question will be routed to the general NCERT Q&A pipeline instead."],
    )


# ─── Dispatch table ───────────────────────────────────────────────────────────

_DISPATCH = {
    CopilotIntent.FIND_STUDENTS_BY_CONCEPT:       op_find_students_by_concept,
    CopilotIntent.GET_STUDENT_CONCEPT_STATE:      op_get_student_concept_state,
    CopilotIntent.GET_STUDENT_PROGRESS:           op_get_student_progress,
    CopilotIntent.EXPLAIN_LEARNING_DIFFICULTY:    op_explain_learning_difficulty,
    CopilotIntent.EXPLAIN_PREREQUISITES:          op_explain_prerequisites,
    CopilotIntent.CLASSROOM_LEARNING_SUMMARY:     op_classroom_learning_summary,
    CopilotIntent.GROUP_PREREQUISITE_READINESS:   op_group_prerequisite_readiness,
    CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY:  op_recommend_curriculum_activity,
    CopilotIntent.RETRIEVE_NCERT_RESOURCE:        op_retrieve_ncert_resource,
    CopilotIntent.EXPLAIN_CONCEPT:                op_explain_concept,
    CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE: op_generate_instructional_schedule,
    CopilotIntent.GENERAL_QUESTION:               op_general_question,
    CopilotIntent.UNSUPPORTED:                    op_unsupported,
    CopilotIntent.AMBIGUOUS:                      op_unsupported,
}


def dispatch(intent_result: IntentResult, request: CopilotRequest) -> OperationResult:
    """Route an IntentResult to the correct operation function."""
    if intent_result.parameters.get("record_query"):
        from src.classroom_queries import execute_record_query
        return execute_record_query(intent_result, request)
    fn = _DISPATCH.get(intent_result.intent)
    if fn is None:
        print(f"[CALCMATE_TRACE] dispatch_missing intent={intent_result.intent.value!r}", flush=True)
        return op_unsupported(intent_result, request)
    print(f"[CALCMATE_TRACE] dispatch operation={fn.__name__!r}", flush=True)
    return fn(intent_result, request)

