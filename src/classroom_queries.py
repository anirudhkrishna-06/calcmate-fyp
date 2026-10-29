"""Deterministic questions over the authenticated classroom snapshot.

Assessment scores, estimated states and missing evidence are kept distinct.
Every SQL read is scoped to the authorized workspace; chat never mutates records.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
import re

from src.classroom_contracts import snapshot_connection
from src.copilot_contract import CopilotIntent as I, IntentResult, OperationResult, OperationStatus
from src import learner_intelligence as li
from src.knowledge_graph import load_kg


def normalize(text):
    return re.sub(r"\s+", " ", text.translate(str.maketrans({"\u2019": "'", "\u2018": "'", "`": "'"}))).strip()


def roster(workspace_id):
    conn = snapshot_connection.get()
    return [dict(s) for s in conn.execute("SELECT id,name,grade FROM students WHERE workspace_id=? ORDER BY name,id", (workspace_id,))] if conn else []


def mentioned_students(text, students):
    text = normalize(text)
    found = [s for s in students if re.search(r"(?<!\w)"+re.escape(s["name"])+r"(?!\w)", text, re.I)]
    first_names = {}
    for student in students:
        first_names.setdefault(student["name"].split()[0].casefold(), []).append(student)
    ambiguous = []
    for first, choices in first_names.items():
        if any(s in found for s in choices):
            continue
        if re.search(r"(?<!\w)"+re.escape(first)+r"(?!\w)", text, re.I):
            if len(choices) == 1:
                found.extend(choices)
            else:
                ambiguous.extend(s["name"] for s in choices)
    return found, ambiguous


def bind_student_context(request):
    found, ambiguous = mentioned_students(request.message, roster(request.workspace_id))
    if len(found) == 1 and not ambiguous:
        request.student_id = found[0]["id"]
    elif len(found) > 1 or ambiguous:
        request.student_id = None
    elif re.search(r"\b(?:students|learners|children|classroom|whole class|all grades)\b", request.message, re.I):
        # Explicit class questions override the profile's default learner.
        request.student_id = None
    elif re.search(r"'s\s+(?:mastery|state|progress|knowledge|understanding|scores?)\b", normalize(request.message), re.I) and not re.search(r"\bthis student's\b", normalize(request.message), re.I):
        # An explicit unknown name must not inherit another learner's screen ID.
        request.student_id = None
    elif getattr(request, "screen_context", None) == "student_copilot" and request.student_id and not re.search(r"\b(?:students|learners|children|classroom|whole class|all grades)\b", request.message, re.I):
        # Keep implicit pronoun and follow-up questions bound to the selected profile.
        return
    elif getattr(request, "screen_context", None) == "student_copilot" and request.student_id and not re.search(r"\b(?:students|learners|children|classroom|whole class|all grades)\b", request.message, re.I):
        # Keep implicit pronoun/follow-up questions bound to the selected learner.
        return


def concept_ids(phrase, grade):
    if not phrase:
        return []
    kg = load_kg()
    if re.fullmatch(r"M\d{3}", phrase, re.I):
        return [phrase.upper()] if phrase.upper() in kg else []
    words = normalize(phrase).casefold()
    aliases = {"dividing": "division", "divide": "division", "fractions": "fraction",
               "multiplications": "multiplication", "times tables": "multiplication",
               "count": "counting", "shapes": "shape", "equal sharing": "division"}
    words = aliases.get(words, words)
    candidates = [(cid, n["concept"].casefold()) for cid, n in kg.nodes(data=True) if int(n["grade"]) == grade]
    exact = [cid for cid, title in candidates if title == words]
    matches = exact or [cid for cid, title in candidates if words in title]
    if matches:
        return sorted(matches)
    from src.intent_extractor import resolve_concept_id
    resolved = resolve_concept_id(phrase, grade)
    return [resolved] if resolved else []


def classify_record_query(text, request, params):
    """Recognize record questions before permissive curriculum/LLM routing."""
    text = normalize(text)
    lower = text.casefold()
    params = dict(params)
    student_thread = bool(request.student_id and request.screen_context == "student_copilot")
    params["all_grades"] = bool(re.search(r"\b(all grades|across (?:all )?grades|entire classroom|whole school)\b", lower))
    kind = None
    intent = I.CLASSROOM_RECORD_QUERY
    latest = bool(re.search(r"\b(last|latest|most recent|recent)\s+(?:recorded\s+)?(assessment|test|exam|marks?|scores?|results?)\b", lower))
    if not student_thread and re.search(r"\b(?:is|are)\s+(?:the\s+)?(?:grade|group|class|students)\b.*\bready\b", lower):
        return None
    if re.search(r"\b(?:why|explain)\b.*\b(?:struggl\w*|difficulty|difficulties)\b", lower):
        return None
    is_support = bool(re.search(r"\b(?:need(?:s)?\s+(?:more\s+)?(?:support|help|revision)|struggl\w*|doing well|ready|mastered|unassessed|not (?:been )?assessed|below|less than|under\s+\d+|weak)\b", lower))
    if re.search(r"\b(?:mark|update|delete|remove|change|save|set)\b.*\b(?:attendance|present|absent|marks|scores|students)\b", lower):
        kind = "read_only"
    elif re.search(r"\b(?:phone number|mobile number|address|parent'?s? (?:name|number)|medical)\b", lower):
        kind = "unavailable_field"
    elif re.search(r"\b(?:why|reason)\b.*\b(?:absent|absence|late)\b", lower):
        kind = "absence_reason"
    elif (re.search(r"\b(?:attendance|absent|late)\b", lower) or re.search(r"\b(?:who|which|was|were|is|are)\b.*\bpresent\b", lower)) and not re.search(r"\b(?:summary|overview)\b", lower):
        kind = "attendance"
    elif re.search(r"\b(?:compare|comparison|better than|worse than)\b", lower) and not re.search(r"\b(?:suggest|activity|explain)\b", lower) and (request.student_id or mentioned_students(text, roster(request.workspace_id))[0] or re.search(r"\b(?:students|learners|children)\b", lower)):
        kind = "comparison"
    elif not is_support and re.search(r"\b(?:how many|number of|count|total)\s+(?:the\s+)?(?:students|learners|children)\b", lower):
        kind = "count"
    elif student_thread and not re.search(r"\b(?:students|learners|children|classroom|whole class|all grades|other students)\b", lower) and re.search(r"\b(?:what should .*teach|what .*teach .*next|teach .*next|what next|next step|recommend|suggest|which concepts?|what concepts?|support|struggl|progress|doing|assessments?|marks?|scores?)\b", lower):
        return None
    elif re.search(r"\b(?:last\s+(?:two|three|five|\d+)|assessment history|score history|scores? and dates?|marks? and dates?|when.*assess|latest assessment date)\b", lower) or (latest and not is_support):
        kind, intent = "history", I.GET_ASSESSMENT_HISTORY
    elif re.search(r"\b(?:performance|performing|how (?:is|are).*(?:doing|progressing)|class progress)\b", lower) and re.search(r"\b(?:students|learners|children|class|classroom|grade|group)\b", lower):
        kind, intent = "performance", I.CLASSROOM_LEARNING_SUMMARY
    elif is_support and (latest or params.get("concept_phrase") or params.get("concept_id")):
        kind, intent = "group", I.FIND_STUDENTS_BY_CONCEPT
    elif re.search(r"\b(?:mastery|knowledge state|understanding|state)\b", lower) and not re.search(r"\b(?:prerequisite|group|classroom)\b", lower):
        kind, intent = "state", I.GET_STUDENT_CONCEPT_STATE
    elif re.search(r"\b(?:which|list|show|who are)\b.*\b(?:students|learners)\b", lower) and not is_support and not re.search(r"\battention\b", lower):
        kind = "roster"
    if kind is None:
        return None
    if student_thread and kind in {"history", "attendance", "state"}:
        params["student_id"] = request.student_id
        params["student_name"] = next((s["name"] for s in roster(request.workspace_id) if s["id"] == request.student_id), None)
        params["grade"] = request.grade
    params.update(record_query=kind, latest_assessment=latest)
    if params.get("concept_phrase"):
        params["concept_ids"] = concept_ids(params["concept_phrase"], params["grade"])
        if len(params["concept_ids"]) == 1:
            params["concept_id"] = params["concept_ids"][0]
    elif params.get("concept_id"):
        params["concept_ids"] = [params["concept_id"]]
    threshold = re.search(r"\b(?:below|less than|under)\s+(\d+(?:\.\d+)?)\s*(%|percent|(?:out of|/)\s*\d+(?:\.\d+)?)?", lower)
    if threshold:
        value = float(threshold[1])
        unit = threshold[2] or "%"
        maximum = re.search(r"(?:out of|/)\s*(\d+(?:\.\d+)?)", unit)
        params["score_threshold"] = value / float(maximum[1]) if maximum and float(maximum[1]) else value / 100
    params["selection"] = "unknown" if re.search(r"\b(?:unassessed|not (?:been )?assessed|no assessment)\b", lower) else "likely_ready" if re.search(r"\b(?:doing well|likely ready|mastered|ready)\b", lower) else "needs_support"
    return IntentResult(intent=intent, parameters=params)


def partial(message, **data):
    return OperationResult(operation="classroom_records", status=OperationStatus.PARTIAL,
                           evidence_summary=message, structured_data=data or None)


def execute_record_query(intent, request):
    conn = snapshot_connection.get()
    if conn is None or not request.workspace_id:
        return partial("Classroom records are not available. Sign in to your approved account and refresh the classroom evidence.")
    p = intent.parameters
    kind = p["record_query"]
    all_students = roster(request.workspace_id)
    named, ambiguous = mentioned_students(request.message, all_students)
    if ambiguous:
        return partial("Please specify the full student name: " + ", ".join(ambiguous) + ".")
    grade = p["grade"]
    students = all_students if p.get("all_grades") else [s for s in all_students if s["grade"] == grade]
    selected = named or [s for s in all_students if s["id"] == request.student_id]
    if request.student_id and request.screen_context == "student_copilot" and not re.search(r"\b(?:other students|students|learners|children|classroom|whole class|all grades)\b", request.message, re.I):
        selected = named or [s for s in all_students if s["id"] == request.student_id]
        if selected:
            students = selected
            grade = selected[0]["grade"]
    if request.student_id and request.screen_context == "student_copilot" and not p.get("all_grades"):
        selected = named or [s for s in all_students if s["id"] == request.student_id]
        if selected:
            students = selected
            grade = selected[0]["grade"]
    cids = p.get("concept_ids", [p["concept_id"]] if p.get("concept_id") else [])
    if p.get("concept_phrase") and not cids:
        return partial("No matching curriculum concept was identified. Please specify a valid concept or topic and grade.")
    kg = load_kg()
    titles = {cid: kg.nodes[cid]["concept"] for cid in cids}
    topic = ", ".join(f"{titles[cid]} ({cid})" for cid in cids)
    metadata = dict(conn.execute("SELECT key,value FROM classroom_meta"))
    result = dict(grade=grade, concept_ids=cids, basis="learner_state", as_of=metadata["as_of"], estimator_version=metadata["estimator_version"])
    if len(cids) == 1:
        result["concept_id"] = cids[0]
    w = request.workspace_id

    def assessments(student_ids, filter_concepts=True):
        rows = [dict(a) for a in conn.execute("SELECT * FROM assessments WHERE workspace_id=? ORDER BY date DESC,created_at DESC,id DESC", (w,))]
        return [a for a in rows if a["student_id"] in student_ids and (not filter_concepts or not cids or a["concept_id"] in cids)]

    def ok(message, data=None, **kwargs):
        return OperationResult(operation="classroom_records", evidence_summary=message,
                               structured_data=result if data is None else data, **kwargs)

    if kind == "read_only":
        return ok("Chat can read classroom evidence but cannot change your records. Open the Attendance screen to mark attendance, or Assessments to edit marks. No records have been changed.", dict(read_only=True))
    if kind == "unavailable_field":
        return partial("This information is not available in the supplied classroom records. I cannot infer personal contact details or diagnoses from assessment evidence.")
    if kind == "absence_reason":
        return partial("Reasons for absence are not recorded in this classroom evidence. Attendance can show an absence, but I cannot determine why a student was absent.")
    if kind in {"count", "roster"}:
        by_grade = dict(sorted(Counter(s["grade"] for s in students).items()))
        result.update(total_students=len(students), students=students, by_grade=by_grade)
        scope = "across all supplied grades" if p.get("all_grades") else f"in Grade {grade}"
        message = f"There are {len(students)} students {scope}. " + "; ".join(f"Grade {g}: {count}" for g, count in by_grade.items()) + "."
        if kind == "roster":
            message += " Students: " + ", ".join(s["name"] for s in students) + "."
        return ok(message)
    if kind == "attendance":
        meta = conn.execute("SELECT value FROM classroom_meta WHERE key='as_of'").fetchone()
        day = meta[0] if meta else date.today().isoformat()
        explicit = re.search(r"\b\d{4}-\d{2}-\d{2}\b", request.message)
        if explicit:
            day = explicit[0]
        elif "yesterday" in request.message.casefold():
            day = (date.fromisoformat(day)-timedelta(days=1)).isoformat()
        if selected:
            students = selected
        recorded = {a["student_id"]: a["status"] for a in conn.execute("SELECT student_id,status FROM attendance WHERE workspace_id=? AND date=?", (w, day))}
        lower = request.message.casefold()
        wanted = "unrecorded" if re.search(r"\b(?:not recorded|unrecorded|missing)\b", lower) else "absent" if "absent" in lower else "late" if "late" in lower else "present" if "present" in lower else None
        rows = [dict(**s, student_id=s["id"], student_name=s["name"], date=day, status=recorded.get(s["id"], "unrecorded")) for s in students]
        rows = [s for s in rows if wanted is None or s["status"] == wanted]
        result.update(date=day, attendance=rows)
        message = f"Attendance on {day}, Grade {grade}: " + ("; ".join(f"{s['name']}: {s['status']}" for s in rows) if rows else f"no students recorded as {wanted or 'attending'}") + "."
        return ok(message)
    if kind in {"state", "history", "comparison"}:
        if kind == "history" and not selected and not request.student_id and not p.get("student_name"):
            selected = students
        if not selected:
            return partial("No matching student was identified. Please specify the student's full name or select a student.")
        if kind == "comparison" and len(selected) < 2:
            return partial("Please specify two students to compare.")
        if kind == "state" and not cids and request.student_id and request.screen_context == "student_copilot":
            rows = assessments({request.student_id}, filter_concepts=False)
            state_rows = [dict(r) for r in conn.execute("SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id=? ORDER BY state_status,concept_id", (w, request.student_id))]
            supported = [r for r in state_rows if r["state_status"] == "needs_support"]
            unknown = [r for r in state_rows if r["state_status"] == "unknown"]
            name = selected[0]["name"]
            result.update(student=selected[0],concept_states=state_rows,assessment_count=len(rows))
            if not rows:
                return ok(f"There are no assessment records for {name} yet, so I cannot infer which concepts need support. Record an assessment to build a grounded learning picture.", result,
                          limitations=["No assessment evidence is available for this student."])
            titles = {cid: data["concept"] for cid, data in load_kg().nodes(data=True)}
            needs = ", ".join(titles.get(r["concept_id"], r["concept_id"]) for r in supported[:5]) or "no assessed concepts currently flagged as needing support"
            not_assessed = ", ".join(titles.get(r["concept_id"], r["concept_id"]) for r in unknown[:5])
            message = f"{name}: based on {len(rows)} recorded assessment(s), {needs}."
            if not_assessed:
                message += f" Evidence is still missing for concepts including {not_assessed}."
            return ok(message, result)
        if kind != "history" and not cids:
            return partial("Please specify which concept or topic to check.")
        if kind == "history":
            rows = assessments({s["id"] for s in selected})
            limit = re.search(r"\blast\s+(two|three|five|\d+)\b", request.message, re.I)
            count = {"two": 2, "three": 3, "five": 5}.get(limit[1].lower(), int(limit[1]) if limit and limit[1].isdigit() else 10) if limit else 1 if p.get("latest_assessment") else 10
            rows = rows[:min(count, 100)]
            names = {s["id"]: s["name"] for s in selected}
            message = "Recorded assessment history: " + ("; ".join(f"{names[a['student_id']]}: {a['date']}, {kg.nodes[a['concept_id']]['concept']} ({a['concept_id']}), {a['score']:g}/{a['maximum']:g}" for a in rows) if rows else "no assessment evidence recorded") + "."
            return ok(message, dict(assessments=rows, students=selected, basis="recorded_scores"))
        views, paragraphs = [], []
        for student in selected:
            for cid in cids:
                row = conn.execute("SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id=? AND concept_id=?", (w, student["id"], cid)).fetchone()
                state = dict(row) if row else dict(student_id=student["id"], concept_id=cid, mastery_estimate=None, state_status="unknown", evidence_count=0, last_evidence_at=None)
                state["student_name"] = student["name"]
                analysis = li.get_student_prerequisite_analysis(w, student["id"], cid, "request-snapshot")
                state["prerequisite_analysis"] = analysis
                views.append(state)
                if row:
                    paragraphs.append(f"{student['name']} — {titles[cid]} ({cid}): state={state['state_status']}, estimated mastery={state['mastery_estimate']:.0%}, evidence={state['evidence_count']} assessment(s); latest evidence {state['last_evidence_at']}.")
                else:
                    paragraphs.append(f"{student['name']}: no assessment evidence recorded for {titles[cid]} ({cid}); mastery is unknown, not zero.")
        graph = None
        if len(views) == 1:
            analysis = views[0]["prerequisite_analysis"]
            if analysis["prerequisites"]:
                graph = f"Prerequisite readiness score: {analysis['kg_prerequisite_readiness']:.2f}. " + analysis["recommendation"]
        return ok("\n".join(paragraphs), views[0] if len(views) == 1 else dict(students=views, concept_ids=cids), graph_finding=graph)
    if kind in {"group", "performance"}:
        if p.get("all_grades"):
            return partial("Please specify one grade for topic or latest-assessment support, so its curriculum and assessment evidence can be checked consistently.")
        if kind == "performance" and not cids:
            cids = [cid for cid, node in kg.nodes(data=True) if int(node["grade"]) == grade]
            topic = "overall Maths performance"
            result["concept_ids"] = cids
        if not cids and not p.get("latest_assessment"):
            return partial("Please specify a topic or ask about the last assessment.")
        selection = p["selection"]
        if p.get("latest_assessment") or "score_threshold" in p:
            threshold = p.get("score_threshold", li.MASTERY_THRESHOLD if selection == "likely_ready" else li.NEEDS_SUPPORT_THRESHOLD)
            rows = assessments({s["id"] for s in students})
            recent = {}
            for a in rows:
                if a["student_id"] not in recent:
                    recent[a["student_id"]] = []
                bucket = recent[a["student_id"]]
                if not bucket or a["date"] == bucket[0]["date"]:
                    bucket.append(a)
            listed, unknown = [], []
            for s in students:
                latest = recent.get(s["id"], [])
                if not latest:
                    unknown.append(s["name"])
                    if selection == "unknown":
                        listed.append(dict(**s, assessments=[]))
                elif (selection == "needs_support" and any(a["score"]/a["maximum"] < threshold for a in latest)) or (selection == "likely_ready" and all(a["score"]/a["maximum"] >= threshold for a in latest)):
                    listed.append(dict(**s, assessments=latest))
            rule = {"needs_support": f"need support based on recorded scores below {threshold:.0%}", "likely_ready": f"are doing well based on all recorded scores at least {threshold:.0%}", "unknown": "have no assessment evidence"}[selection]
            message = f"Grade {grade}: {len(listed)} students {rule} on each student's latest assessment date"
            if topic:
                message += f" for {topic}"
            message += ". "
            message += "; ".join(s["name"] + (": " + ", ".join(f"{a['date']} {kg.nodes[a['concept_id']]['concept']} ({a['concept_id']}) {a['score']:g}/{a['maximum']:g}" for a in s["assessments"]) if s["assessments"] else "") for s in listed) or "No recorded scores meet this filter."
            message += "."
            if unknown and selection != "unknown":
                message += " No assessment evidence: " + ", ".join(unknown) + "."
            result.update(students=listed, unassessed=unknown, threshold=threshold, basis="latest_recorded_scores")
            return ok(message)
        if len(cids) == 1:
            result = li.get_group_concept_summary(w, grade, cids[0], "request-snapshot")
            result.update(concept_ids=cids, basis="learner_state", as_of=metadata["as_of"], estimator_version=metadata["estimator_version"])
        else:
            rows = []
            for s in students:
                states = [dict(a) for a in conn.execute("SELECT concept_id,mastery_estimate,state_status FROM learner_concept_states WHERE workspace_id=? AND student_id=?", (w, s["id"])) if a["concept_id"] in cids]
                status = "needs_support" if any(a["state_status"] == "needs_support" for a in states) else "likely_ready" if len(states) == len(cids) and all(a["state_status"] == "likely_ready" for a in states) else "unknown" if not states else "insufficient"
                rows.append(dict(**s, state_status=status, concept_states=states, mastery_estimate=min((a["mastery_estimate"] for a in states), default=None)))
            result.update(students=rows, total_students=len(students), counts=dict(Counter(s["state_status"] for s in rows)))
        counts = result.get("counts", {})
        chosen = [s for s in result.get("students", []) if s["state_status"] == selection]
        unknown = [s["name"] for s in result.get("students", []) if s["state_status"] == "unknown"]
        message = f"Grade {grade}, {topic}: {result.get('total_students', 0)} students total — {counts.get('needs_support', 0)} need support, {counts.get('likely_ready', 0)} likely ready, {counts.get('unknown', 0)} unassessed, {counts.get('insufficient', 0)} with intermediate or incomplete evidence. "
        label = {"needs_support": "Students needing support", "likely_ready": "Students likely ready", "unknown": "No assessment evidence"}[selection]
        message += label + ": " + (", ".join(s["name"] for s in chosen) or "none") + "."
        if kind == "performance":
            message += " Student performance: " + "; ".join(
                f"{s['name']}: {s['state_status'].replace('_', ' ')}"
                + (f" ({s['mastery_estimate']:.0%} estimated mastery)" if s.get("mastery_estimate") is not None else "")
                for s in result.get("students", [])
            ) + "."
        message += f" Based on estimated learner states from recorded assessments, using evidence as of {metadata['as_of']}."
        if selection != "unknown" and unknown:
            message += " No assessment evidence: " + ", ".join(unknown) + "."
        recommendations = []
        if selection == "needs_support":
            for s in chosen:
                for cid in cids:
                    analysis = li.get_student_prerequisite_analysis(w, s["id"], cid, "request-snapshot")
                    recommendations.extend(p["concept_title"] for p in analysis["prerequisites"] if p["is_blocking"])
        next_step = "Revise prerequisites first: " + ", ".join(dict.fromkeys(recommendations)) + "." if recommendations else None
        return ok(message, result, recommended_next_step=next_step)
    return partial("Please clarify the classroom record or student you want to check.")
