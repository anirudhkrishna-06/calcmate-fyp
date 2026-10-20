# Classroom Assistant: supported record questions

The Assistant reads the approved teacher's current classroom snapshot. It uses recorded marks for assessment questions and the same versioned estimator as the phone for learner-state questions. It does not generate student facts from textbook passages.

## Latest assessment versus current learner state

| Ask | Evidence used |
| --- | --- |
| Who needs support in grade 4 on last assessment? | Each Grade 4 student's latest assessment date. Any recorded score below 60% on that date flags support. The answer includes the dates, concepts and marks. |
| Who needs support on division on the last assessment? | Each student's latest date with a matching division assessment. All matching division scores on that date are considered. |
| who need support on topic division? | Current estimated states for the division concepts in the active grade. Grade 4 includes M403, division as equal sharing, and M404, division with remainder. |
| Who needs support on division with remainder in grade 4? | M404 only. |
| Which students are doing well in division on the latest assessment? | All matching scores on each student's latest matching assessment date must be at least 70%. |
| List students scoring below 50% in division. | Latest recorded division marks below the requested raw-score threshold. |

An assessment date is the available grouping key; the evidence does not contain an assessment-session ID. “Latest assessment” therefore means the latest recorded **date for each student**, not a single shared class test. With a topic filter, it means the latest date assessed on that topic.

An explicit grade in the question overrides the active screen's grade. Otherwise the active grade is used. Topic support requires one grade so curriculum concepts can be matched consistently. Counts can span all supplied grades.

Students without matching assessment evidence are listed separately. Missing evidence never means zero mastery or demonstrated failure. With a broad topic, support on any matching concept flags support; readiness requires ready evidence for every matching concept. Intermediate or incomplete evidence is reported separately.

A learner can pass a latest assessment and still have an estimated state that needs support: the current BKT estimator incorporates assessment history. Both answers state their evidence basis. Updating marks produces a new evidence revision and a new result.

## Other supported questions

- What is Dhruv Subramaniam's mastery of M408?
- What were Dhruv Subramaniam's last two M408 scores and dates?
- Compare Dhruv Subramaniam and Pihu Bhat on M408.
- Who is absent in Grade 4 today?
- Who was absent in Grade 4 yesterday?
- Who was absent in Grade 4 on 2026-10-19?
- Whose attendance is not recorded in Grade 4 today?
- How many students are in my classroom across all grades?
- What prerequisites does Pihu Bhat need before M408?
- Suggest an activity for Dhruv Subramaniam to learn M408.

Use the names actually enrolled in your workspace. Full names and unique first names are supported; ambiguous first names ask for clarification. A group question keeps its grade scope even when a student is selected. An unknown explicit name cannot inherit another student's selected-screen identity.

Prerequisite readiness uses observed prerequisite states. Missing prerequisite evidence leads to a diagnostic check; a recorded gap leads to prerequisite practice. The latest-evidence timestamp uses the newest assessment, and “today”/“yesterday” use the snapshot's `as_of` date.

## Curriculum grounding and limits

Concept IDs are expanded to curriculum titles before semantic retrieval. Grade, subject and concept metadata are intersected before search. An empty concept filter cannot fall back to unrelated material, and weak operation-source matches are rejected. Already generated explanations retain their grounded answer rather than being generated again from a short source description.

Activities use inspectable practice templates. Student-specific activities first address an observed blocking prerequisite, when present. Source coverage remains partial: Grade 1 length comparisons currently have a useful practice template but no sufficiently relevant indexed NCERT passage. The answer discloses that gap.

Phone numbers, medical information and reasons for absence are not in the evidence. Chat explains that limitation. Chat does not write attendance or marks; it directs teachers to the relevant screen. A vague follow-up without student/concept context asks for clarification.

An approved teacher login is required for classroom evidence. Explore Demo does not send its student records to the Assistant. Each real-account request reads the current workspace, including all five grades and historical attendance. Snapshots remain limited to 500 students, 12,000 assessments, 20,000 attendance records and 2 MiB; oversized requests fail explicitly. No records are silently truncated.

These fixes do not guarantee every possible wording or every generated mathematical explanation. The local model can vary between runs; the saved prompt report reviews exact captured answers rather than treating matching source metadata as proof of correctness.

## Verification and startup

See [the reviewed 84-prompt report](report/evaluation/state-awareness-2026-10-20-refined/report.md) for every question and exact answer, and [the validation summary](report/evaluation/state-awareness-2026-10-20-refined/summary.md) for the remaining limitations and broader frontend check failures.

Restart the backend and reload the Expo app after updating both:

```powershell
.\venv\Scripts\python.exe -m src.api --host 0.0.0.0 --port 8000
```

Reproduce the backend regression checks, including cached retrieval and Ollama:

```powershell
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:CALCMATE_TEST_REAL_RAG='1'
$env:CALCMATE_TEST_LLM='1'
.\venv\Scripts\python.exe -B -m pytest -q tests
```

From `frontend`, run the real Assistant service-to-HTTP integration:

```powershell
npm.cmd run typecheck
npm.cmd run test:http -- --assistant-only
```

The integration adapts the Expo native bridges to Node SQLite. Physical phone networking and native rendering still require device verification.
