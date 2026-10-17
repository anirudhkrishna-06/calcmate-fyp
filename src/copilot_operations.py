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

RAG corpus limitation: Only Grades 3–5 are indexed. Grades 1–2 have no retrieval.
This must be disclosed in the limitations field.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from src.copilot_contract import (
    CopilotIntent, CopilotRequest, IntentResult,
    OperationResult, OperationStatus,
)
from src.knowledge_graph import load_kg, prerequisite_readiness
from src import learner_intelligence as li

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_DB_SEARCH_PATHS = [
    Path(os.getenv("CALCMATE_DB_PATH", "")) if os.getenv("CALCMATE_DB_PATH") else None,
    Path.home() / "Documents" / "ExponentAsync" / "SQLite" / "calcmate.db",
    Path.home() / "Documents" / "calcmate.db",
    _DATA_DIR.parent / "calcmate.db",
]

RAG_GRADES_INDEXED = {3, 4, 5}


def _find_db() -> Optional[str]:
    for p in _DB_SEARCH_PATHS:
        if p and p.is_file():
            return str(p)
    return None


def _rag_limitation(grade: int) -> Optional[str]:
    if grade not in RAG_GRADES_INDEXED:
        return (f"The NCERT retrieval corpus covers Grades 3–5. "
                f"No textbook content is indexed for Grade {grade}.")
    return None


def _retrieve_for_concept(concept_phrase: str, grade: int, k: int = 3) -> list[dict]:
    """Call the retriever; return list of chunk dicts (safe even if unavailable)."""
    try:
        from src.copilot import get_default_retriever
        retriever = get_default_retriever()
        chunks = retriever.retrieve(concept_phrase, grade=min(grade, 5), subject="Math", k=k)
        return [
            {
                "chunk_id": c.chunk_id, "text": c.text[:400], "grade": c.grade,
                "subject": c.subject, "source_pdf": c.source_pdf,
                "chunk_index": c.chunk_index, "score": round(c.score, 3),
                "used_fallback": c.used_fallback,
            }
            for c in chunks
        ]
    except Exception:
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
            k_state = {pid: 0.0 for pid in prereq_ids}
            readiness = prerequisite_readiness(kg, k_state, concept_id)
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
        )

    try:
        import sqlite3
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
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

        total_students = summaries[0]["total_students"] if summaries else 0
        needs_support_concepts = [
            s["concept_title"] for s in summaries
            if s.get("counts", {}).get("needs_support", 0) > 0
        ]

        evidence = (
            f"Grade {grade} classroom summary: {total_students} student(s), "
            f"{len(concepts)} concept(s) assessed. "
            f"{len(needs_support_concepts)} concept(s) have students needing support."
        )
        rec = (f"Focus on: {', '.join(needs_support_concepts[:3])}."
               if needs_support_concepts else "All assessed concepts show adequate group progress.")

        return OperationResult(
            operation="classroom_learning_summary",
            status=OperationStatus.OK,
            structured_data={"grade": grade, "concept_summaries": summaries},
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
            low = [p for p in prereqs if p["readiness_fraction"] < 0.5]
            evidence = (
                f"Group prerequisite readiness for '{concept_phrase}' (Grade {grade}): "
                f"{len(prereqs)} prerequisite(s) checked. "
                f"{'Group is ready.' if group_ready else f'{len(low)} prerequisite(s) below 50% readiness.'}"
            )
            graph_finding = (
                "All prerequisites show ≥50% group readiness. Proceed with instruction."
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


def op_recommend_curriculum_activity(intent: IntentResult, request: CopilotRequest) -> OperationResult:
    """Retrieve NCERT content and suggest a teaching activity for a concept."""
    params = intent.parameters
    concept_id: Optional[str] = params.get("concept_id")
    concept_phrase: str = params.get("concept_phrase", concept_id or request.message[:60])
    grade: int = int(params.get("grade", request.grade))
    limitations: list[str] = []
    lim = _rag_limitation(grade)
    if lim:
        limitations.append(lim)

    chunks = _retrieve_for_concept(concept_phrase, grade)
    ncert = None
    if chunks:
        top = chunks[0]
        ncert = {"source_pdf": top["source_pdf"], "grade": top["grade"],
                 "text_snippet": top["text"][:300]}
        evidence = f"Retrieved {len(chunks)} NCERT passage(s) for '{concept_phrase}' (Grade {grade})."
    else:
        evidence = (
            f"No NCERT passages retrieved for '{concept_phrase}' (Grade {grade}). "
            "This topic may not be covered in the current corpus, or the grade is outside the indexed range."
        )
        limitations.append("No curriculum content found for this concept at this grade.")

    return OperationResult(
        operation="recommend_curriculum_activity",
        status=OperationStatus.OK if chunks else OperationStatus.PARTIAL,
        structured_data={"concept_id": concept_id, "concept_phrase": concept_phrase,
                         "grade": grade, "chunks": chunks[:3]},
        evidence_summary=evidence,
        ncert_resource=ncert,
        limitations=limitations,
        recommended_next_step=(
            f"Use the retrieved passages to design a hands-on activity for '{concept_phrase}'."
            if chunks else None
        ),
    )


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
            "The schedule is being generated on your device using your current classroom data. "
            "It will appear as a schedule card below this message."
        ),
        limitations=[
            "The instructional scheduler runs on-device using your recorded attendance "
            "and assessment data. If you have not recorded data for today, the schedule "
            "will use the most recent available evidence.",
            "The NCERT retrieval corpus covers Grades 3–5. "
            "Grades 1–2 concepts are handled by the curriculum graph only.",
        ],
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
    fn = _DISPATCH.get(intent_result.intent)
    if fn is None:
        return op_unsupported(intent_result, request)
    return fn(intent_result, request)

