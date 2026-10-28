"""Natural classroom questions must read raw evidence or learner states deliberately."""
import copy
import hashlib
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.auth_api import connection
from src.classroom_contracts import curriculum_version


@pytest.fixture
def classroom(tmp_path, monkeypatch):
    monkeypatch.setenv("CALCMATE_AUTH_DB", str(tmp_path / "accounts.db"))
    monkeypatch.setenv("CALCMATE_ALLOW_INSECURE_AUTH", "true")
    with connection() as db:
        db.execute("INSERT INTO accounts VALUES(?,?,?,?,1,0)", ("query-test", "query@example.invalid", "test", json.dumps({"id": "query-test"})))
        db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (hashlib.sha256(b"query-token").hexdigest(), "query-test", 4000000000, 1700000000))
    evidence = dict(version=1, workspace_id="teacher-query-test", captured_at="2026-10-20T12:00:00Z",
                    as_of="2026-10-20", curriculum_version=curriculum_version(), estimator_version="score-ratio-v1:1",
                    students=[dict(id="s1", name="Asha Rao", grade=4), dict(id="s2", name="Kabir Ali", grade=4),
                              dict(id="s3", name="Meera Sen", grade=4), dict(id="s4", name="Arjun Nair", grade=5),
                              dict(id="s5", name="Asha Sen", grade=4)], assessments=[], attendance=[])
    for sid, cid, day, score in [("s1", "M403", "2026-10-18", 0), ("s1", "M403", "2026-10-19", 9),
                                 ("s2", "M403", "2026-10-19", 9), ("s2", "M404", "2026-10-19", 2),
                                 ("s4", "M503", "2026-10-19", 1), ("s1", "M408", "2026-10-19", 4),
                                 ("s1", "M407", "2026-10-19", 8), ("s2", "M408", "2026-10-19", 9)]:
        stamp = day+"T09:00:00Z"
        evidence["assessments"].append(dict(id=f"a{len(evidence['assessments'])}", student_id=sid, concept_id=cid,
                                            date=day, score=score, maximum=10, created_at=stamp, updated_at=stamp))
    for sid, day, status in [("s1", "2026-10-20", "present"), ("s2", "2026-10-20", "absent"),
                              ("s5", "2026-10-20", "late"), ("s3", "2026-10-19", "absent")]:
        evidence["attendance"].append(dict(student_id=sid, date=day, status=status))
    with TestClient(app) as client:
        def ask(question, grade=4, supplied=None, **context):
            response = client.post("/chat", headers={"Authorization": "Bearer query-token"}, json=dict(
                question=question, grade=grade, use_llm=False, workspace_id=evidence["workspace_id"],
                classroom_evidence=copy.deepcopy(supplied or evidence), **context))
            assert response.status_code == 200, response.text
            return response.json()
        yield evidence, ask


@pytest.mark.parametrize("context", [{}, {"student_id": "g1-a", "screen_context": "student_copilot"}])
def test_natural_class_performance_question(classroom, context):
    evidence, ask = classroom
    supplied = copy.deepcopy(evidence)
    supplied["students"] = [dict(id="g1-a", name="Nila", grade=1), dict(id="g1-b", name="Ravi", grade=1), dict(id="g1-c", name="Uma", grade=1)]
    supplied["attendance"] = []
    supplied["assessments"] = [dict(id="g1-score", student_id="g1-b", concept_id="M101", date="2026-10-19", score=4, maximum=10, created_at="2026-10-19T09:00:00Z", updated_at="2026-10-19T09:00:00Z")]
    response = ask("How about other students performance in counting objects upto 20 in grade 1?", grade=1, supplied=supplied, **context)
    data = response["structured_data"]
    assert data["concept_ids"] == ["M101"]
    assert data["total_students"] == 3
    assert data["counts"]["needs_support"] == 1
    assert data["counts"]["unknown"] == 2
    assert "Ravi" in response["answer"]
    assert "Please clarify" not in response["answer"]


def test_overall_class_performance_without_topic(classroom):
    _, ask = classroom
    response = ask("How is my class performing in Grade 4?")
    assert response["structured_data"]["total_students"] == 4
    assert "overall Maths performance" in response["answer"]


def test_class_assessment_question_overrides_student_thread(classroom):
    _, ask = classroom
    response = ask("What was the last assessment given for Grade 4 students?",
                   student_id="s1", screen_context="student_copilot")
    rows = response["structured_data"]["assessments"]
    assert len(rows) == 1
    assert rows[0]["date"] == "2026-10-19"
    assert all(student["grade"] == 4 for student in response["structured_data"]["students"])
    assert len(response["structured_data"]["students"]) == 4


def test_student_thread_can_ask_about_another_named_student(classroom):
    _, ask = classroom
    response = ask("Show Kabir Ali's last assessment on M403.",
                   student_id="s1", screen_context="student_copilot")
    assert [row["student_id"] for row in response["structured_data"]["assessments"]] == ["s2"]


@pytest.mark.parametrize("question", [
    "Who needs support in grade 4 on last assessment?",
    "who need support in grade 4 on the latest assessment?",
    "WHO NEEDS SUPPORT IN CLASS FOUR ON THE LAST TEST?",
])
def test_latest_assessment_support_uses_raw_scores(classroom, question):
    _, ask = classroom
    data = ask(question)
    assert data["structured_data"]["basis"] == "latest_recorded_scores"
    # Asha still has a weak historical estimate on division, but her latest
    # division score is high. Her separate latest fraction score is low.
    assert "Kabir Ali" in data["answer"]
    assert "2026-10-19" in data["answer"]
    assert "2/10" in data["answer"]
    assert "Arjun Nair" not in data["answer"]
    assert "Meera Sen" in data["structured_data"]["unassessed"]


@pytest.mark.parametrize("question", ["who need support on topic division?", "Who is struggling with division in Grade 4?"])
def test_broad_division_covers_both_grade_four_concepts(classroom, question):
    _, ask = classroom
    data = ask(question)
    assert data["structured_data"]["concept_ids"] == ["M403", "M404"]
    assert "Asha Rao" in data["answer"] and "Kabir Ali" in data["answer"]
    assert "Arjun Nair" not in data["answer"]
    assert "Meera Sen" in data["answer"]


def test_specific_division_and_latest_division_are_distinct(classroom):
    _, ask = classroom
    specific = ask("Who needs support with division with remainder?")
    assert specific["structured_data"]["concept_id"] == "M404"
    assert [s["name"] for s in specific["structured_data"]["students"] if s["state_status"] == "needs_support"] == ["Kabir Ali"]
    latest = ask("Who needs support on division on the last assessment?")
    assert [s["name"] for s in latest["structured_data"]["students"]] == ["Kabir Ali"]
    assert len(latest["structured_data"]["students"][0]["assessments"]) == 2


def test_explicit_grade_changes_topic_scope(classroom):
    _, ask = classroom
    data = ask("Who needs support on division in Grade 5?")
    assert data["structured_data"]["concept_ids"] == ["M503", "M518"]
    assert "Arjun Nair" in data["answer"] and "Kabir Ali" not in data["answer"]


def test_raw_percentage_filter_does_not_filter_estimated_mastery(classroom):
    _, ask = classroom
    data = ask("List students scoring below 50% in division.")
    assert [s["name"] for s in data["structured_data"]["students"]] == ["Kabir Ali"]
    assert data["structured_data"]["threshold"] == .5


def test_names_mastery_actual_prerequisites_and_latest_timestamp(classroom):
    _, ask = classroom
    for question in ["What is Asha Rao's mastery of M408?", "what is asha rao's mastery of M408?", "What is Asha Rao\u2019s mastery of M408?"]:
        data = ask(question)
        assert data["structured_data"]["student_id"] == "s1"
        assert data["structured_data"]["mastery_estimate"] == .4
        assert "0.80" in data["graph_finding"]
    division = ask("Show mastery for Asha Rao on M403.")
    assert division["structured_data"]["last_evidence_at"] == "2026-10-19"
    assert division["structured_data"]["mastery_estimate"] == pytest.approx(.9/1.75)


def test_ambiguous_first_name_and_selected_student_context(classroom):
    _, ask = classroom
    ambiguous = ask("What is Asha's mastery of M408?")
    assert "Asha Rao" in ambiguous["answer"] and "Asha Sen" in ambiguous["answer"]
    assert "specify" in ambiguous["answer"]
    selected = ask("Show mastery for this student on M408.", student_id="s1")
    assert selected["structured_data"]["student_name"] == "Asha Rao"


def test_ready_unknown_and_assessment_history(classroom):
    _, ask = classroom
    ready = ask("Which students are doing well in M403?")
    assert "Students likely ready: Kabir Ali" in ready["answer"]
    unknown = ask("Who has not been assessed on M403?")
    assert "Meera Sen" in unknown["answer"]
    history = ask("What were Asha Rao's last two M403 scores and dates?")
    assert [a["score"] for a in history["structured_data"]["assessments"]] == [9, 0]
    assert "2026-10-18" in history["answer"] and "2026-10-19" in history["answer"]


def test_attendance_lists_and_historical_dates(classroom):
    _, ask = classroom
    assert "Kabir Ali: absent" in ask("Who is absent in Grade 4 today?")["answer"]
    assert "Asha Sen: late" in ask("Who arrived late in Grade 4 today?")["answer"]
    assert "Meera Sen: unrecorded" in ask("Whose attendance is not recorded today?")["answer"]
    assert "Meera Sen: absent" in ask("Who was absent yesterday?")["answer"]
    assert "Asha Rao: present" in ask("Who is present in Grade 4?")["answer"]
    assert "Kabir Ali: absent" in ask("Who was absent on 2026-10-20?")["answer"]


def test_group_question_overrides_selected_student_and_counts_support(classroom):
    _, ask = classroom
    data = ask("Who needs support in Grade 4 on last assessment?", student_id="s1")
    assert {s["id"] for s in data["structured_data"]["students"]} == {"s1", "s2"}
    counts = ask("How many students need support on division?")
    assert counts["structured_data"]["counts"]["needs_support"] == 2
    missing = ask("What is Rahul Imaginary's mastery of M408?", student_id="s1")
    assert "No matching student" in missing["answer"]


def test_latest_ready_unknown_and_individual_history(classroom):
    _, ask = classroom
    ready = ask("Which students are doing well on division on last assessment?")
    assert [s["id"] for s in ready["structured_data"]["students"]] == ["s1"]
    unknown = ask("Who has not been assessed on division on latest assessment?")
    assert {s["id"] for s in unknown["structured_data"]["students"]} == {"s3", "s5"}
    history = ask("Show Asha Rao's last assessment on M403.")
    assert [a["score"] for a in history["structured_data"]["assessments"]] == [9]


def test_plain_chat_without_evidence_does_not_invent_students():
    with TestClient(app) as client, patch("src.rag_api._get_runtime", side_effect=AssertionError("No textbook lookup needed")):
        for question in ("Who needs support on division?", "What is Asha Rao's mastery of M408?"):
            response = client.post("/chat", json=dict(question=question, grade=4))
            assert response.status_code == 200
            assert "Classroom records are not available" in response.json()["answer"]


def test_workspace_attendance_history_can_exceed_old_daily_snapshot_bound(classroom):
    from datetime import date, timedelta
    evidence, ask = classroom
    expanded = copy.deepcopy(evidence)
    expanded["students"] = [dict(id=f"history-{i}", name=f"History Learner {i}", grade=i//8+1) for i in range(40)]
    expanded["assessments"] = []
    expanded["attendance"] = [dict(student_id=s["id"], date=str(date(2026, 7, 1)+timedelta(days=day)), status="absent") for s in expanded["students"] for day in range(102)]
    data = ask("Who was absent in Grade 4 on 2026-10-10?", supplied=expanded)
    assert len(data["structured_data"]["attendance"]) == 8


def test_compare_students_and_count_all_grades(classroom):
    _, ask = classroom
    compared = ask("Compare Asha Rao and Kabir Ali on M403.")
    states = {s["student_id"]: s["mastery_estimate"] for s in compared["structured_data"]["students"]}
    assert states == {"s1": pytest.approx(.9/1.75), "s2": .9}
    counts = ask("How many students are in my classroom across all grades?")
    assert counts["structured_data"]["total_students"] == 5


def test_unsupported_writes_and_personal_facts_do_not_use_llm(classroom):
    _, ask = classroom
    with patch("src.rag_api._get_runtime", side_effect=AssertionError("Classroom facts do not need textbook RAG")):
        assert "cannot change" in ask("Mark all Grade 4 students present now.")["answer"]
        assert "not available" in ask("What is Asha Rao's phone number?")["answer"]
        assert "cannot determine why" in ask("Why was Kabir Ali absent today?")["answer"]


def test_new_marks_change_latest_assessment_answer(classroom):
    evidence, ask = classroom
    before = ask("Who needs support on division on last assessment?")
    updated = copy.deepcopy(evidence)
    for cid in ("M403", "M404"):
        updated["assessments"].append(dict(id="exit-"+cid, student_id="s2", concept_id=cid, date="2026-10-20", score=10, maximum=10, created_at="2026-10-20T11:00:00Z", updated_at="2026-10-20T11:00:00Z"))
    after = ask("Who needs support on division on last assessment?", supplied=updated)
    assert "Kabir Ali" in before["answer"]
    assert after["structured_data"]["students"] == []
    assert before["evidence_revision"] != after["evidence_revision"]


def test_explanation_keeps_the_already_grounded_answer():
    from src.copilot_contract import CopilotRequest, CopilotIntent, IntentResult, OperationResult
    from src.response_composer import compose_with_llm
    grounded = "Three equal groups of four counters make twelve: 3 x 4 = 12."
    with patch("ollama.Client", side_effect=AssertionError("Do not generate a second answer without the retrieved content")):
        response = compose_with_llm(OperationResult(operation="explain_concept", evidence_summary="Relevant passages found."), IntentResult(intent=CopilotIntent.EXPLAIN_CONCEPT), CopilotRequest(message="Explain multiplication.", grade=3), rag_answer=grounded)
    assert response.answer == grounded


def test_comparing_objects_is_an_activity_even_with_a_selected_student():
    from src.copilot_contract import CopilotRequest, CopilotIntent
    from src.intent_extractor import extract_intent
    request = CopilotRequest(message="Suggest an activity to compare long and short classroom objects.", grade=1, student_id="s1", use_llm=False)
    assert extract_intent(request).intent == CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY
