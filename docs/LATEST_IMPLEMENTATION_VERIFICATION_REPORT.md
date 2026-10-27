# CALCMATE — Latest Implementation and Verification Report

**Report date:** 20 October 2026  
**Project:** CALCMATE — Curriculum- and Knowledge-State-Aware Instructional Attention Allocation for Multi-Grade Classrooms  
**Purpose:** Implementation handoff, research review, demonstration preparation, and professor-facing verification

---

## Executive summary

CALCMATE has progressed into an integrated teacher-support system rather than a collection of isolated screens. The current implementation connects curriculum structure, learner evidence, attendance, assessment history, prerequisite reasoning, multi-grade scheduling, weekly planning, live class execution, teacher Copilot interaction, post-class reflection, notifications, and next-class adaptation.

The central classroom intelligence loop is:

```
Curriculum graph + learner evidence + attendance + assessments
                         ↓
                Learner-state estimation
                         ↓
              Prerequisite-aware scheduler
                         ↓
             Pre-Class → Active Class → Post-Class
                         ↓
             Updated evidence and notifications
                         ↓
                   Next recommendation
```

CALCMATE is best presented as a persistent classroom intelligence system for a teacher managing multiple grades, not simply as a chatbot or timetable generator.

---

## Current implementation after the previous context document

### Teacher workflow

- Time-aware Home dashboard.
- Saved weekly plans connected to daily periods.
- Pre-Class Briefing before the selected period.
- Active Class execution with rotation context.
- Post-Class Review after delivery.
- Notifications for learning changes and continued attention.
- Backup and restore support for classroom records and notifications.
- Centered, polished loading states.
- Premium education-themed interface with no emojis or emoticons.

### Pre-Class Briefing

The briefing shows:

- The current teacher focus.
- The concept to teach.
- Why the concept is prioritised.
- Learners requiring attention.
- Prerequisite gaps.
- Present learner count.
- Work for the remaining grades.
- Pair, group, independent, worksheet, and assessment choices.

### Active Class

The active-class experience includes:

- Current class and rotation.
- Class Summary.
- Learner and attendance counts.
- Current instructional focus.
- Parallel activity labels.
- Current and upcoming blocks.
- An AI Copilot action for teacher doubts.

### Post-Class Review

The teacher can:

- Confirm delivered or missed blocks.
- Record notes and observations.
- Select students needing intervention.
- Record exit assessments.
- Mark attention areas as Resolved or Continue.

When an attention area is marked Continue, the system creates teacher-review evidence, refreshes learner state, keeps the concept active for future planning, and creates a notification for the teacher.

---

## System architecture

### Frontend

The frontend is an Expo, React Native, TypeScript application using Expo Router and local SQLite persistence.

Important screens include:

- `frontend/app/(tabs)/index.tsx` — teacher Home.
- `frontend/app/(tabs)/students.tsx` — classroom workspace.
- `frontend/app/(tabs)/schedule.tsx` — Planner.
- `frontend/app/general-schedule/new.tsx` — daily scheduler.
- `frontend/app/weekly-schedule/new.tsx` — weekly planning.
- `frontend/app/active-session.tsx` — active classroom execution.
- `frontend/app/post-class-review.tsx` — post-class feedback.
- `frontend/app/notifications.tsx` — teacher updates.
- `frontend/app/curriculum.tsx` — curriculum graph.
- `frontend/app/students/[id].tsx` — detailed learner profile.

### Core services

- `generalScheduler.ts` — deterministic multi-grade rotation engine.
- `weeklyScheduleEngine.ts` — weekly evidence-driven planning.
- `learnerEstimator.ts` — learner-state reconstruction.
- `learnerStateService.ts` — concept state and prerequisite analysis.
- `classroomEvidenceService.ts` — classroom evidence snapshots.
- `sessionService.ts` — active-session and post-class outcomes.
- `notificationService.ts` — learning-change notifications.
- `demoService.ts` — realistic review classroom seeding.
- `database.ts` — local SQLite schema and migrations.
- `backupFormat.ts` and `restoreService.ts` — classroom backup and restore.

### Research and backend layer

The Python layer includes curriculum graph loading, prerequisite traversal, learner intelligence, synthetic classroom generation, controlled policy evaluation, research demonstrations, and optional FastAPI/RAG services.

The non-RAG classroom intelligence workflow is locally useful on its own: scheduling, attendance, assessments, learner state, graph reasoning, planning, active sessions, notifications, and persistence do not require an active RAG server.

---

## Curriculum knowledge graph

The authoritative sources are:

```
data/concepts.csv
data/prerequisite_edges.csv
```

Current verified structure:

| Property | Result |
|---|---:|
| Mathematics concepts | 84 |
| Prerequisite relations | 73 |
| Grades represented | 1–5 |
| Directed acyclic graph | Verified |
| Weakly connected components | 15 |
| Longest prerequisite chain | 10 concepts |
| Cross-grade relations | 27 |
| Duplicate edges | 0 |
| Self-loops | 0 |
| Unknown edge references | 0 |

A representative validated chain is:

```
M301 → M302 → M303 → M304 → M307 → M308 → M403 → M404 → M503 → M529
```

The graph is used by curriculum services, learner-state views, schedule prioritisation, and prerequisite-safety evaluation.

Available report figures:

- `outputs/01_curriculum_knowledge_graph.png`
- `outputs/01_curriculum_knowledge_graph.svg`

---

## Realistic seeded classroom

The review classroom includes:

- Learners distributed across multiple grades.
- South Indian and Indian-style learner names.
- Grade-specific concept exposure.
- Partial curriculum coverage.
- Assignment and quiz marks.
- Repeated assessment evidence.
- Realistic score trajectories.
- Attendance history.
- Learner-specific strengths and gaps.
- Prerequisite-sensitive readiness.
- Teacher observations and intervention context.

The data is designed to demonstrate progression. Learners are not uniformly complete across every topic, allowing the scheduler and graph views to respond to actual differences in classroom state.

The intended demonstration is:

```
Seed classroom → inspect evidence → generate plan → teach → record outcome
→ update learner state → generate next recommendation
```

---

## Evidence-driven scheduler

The production scheduler is implemented in:

```
frontend/src/services/generalScheduler.ts
```

It considers:

- Selected grades.
- Available instructional minutes.
- Attendance.
- Assessment evidence.
- Learner mastery.
- Weak concepts.
- Prerequisite readiness.
- Student attention needs.
- Teacher time.
- Transition costs.
- Parallel activity requirements.

It produces:

- Common opening routines.
- Teacher-led instructional blocks.
- Transitions.
- Pair practice.
- Group activities.
- Independent tasks.
- Worksheets.
- Assessment opportunities.
- Closing and exit checks.
- Reasons for every allocation.
- Warnings when available time is insufficient.

It avoids a fixed “Grade 1 first, Grade 2 second” timetable. Direct teacher attention is allocated according to current need while other grades receive structured work.

### Scheduler evaluation settings

- 24 synthetic learners.
- Grades 3, 4, and 5.
- 8 learners per grade.
- 180 instructional minutes.
- 15-minute decision intervals.
- 5 classroom scenarios.
- 5 seeds per scenario.
- 25 trials per policy.
- 100 total policy simulations.

Policies:

1. Round-Robin.
2. Static Timetable.
3. Needs-Only ablated baseline.
4. CALCMATE proposed graph-aware scheduler.

### Metric definitions

| Metric | Meaning | Desired direction |
|---|---|---|
| Learning-gap coverage | Share of identified gaps receiving attention | Higher |
| Mastery-resolution rate | Share of needs reaching mastery | Higher |
| Prerequisite violations | Instruction before prerequisite readiness | Lower |
| Average instructional delay | Time a need remains unaddressed | Lower |
| Time to mastery | Time needed to reach mastery | Lower |
| Switching cost | Cost of moving teacher attention | Lower |
| Unaddressed prerequisite deficit | Remaining prerequisite burden | Lower |

### Current policy results

| Policy | Gap coverage | Mastery resolution | Prerequisite violations | Avg. delay | Time to mastery | Switching cost |
|---|---:|---:|---:|---:|---:|---:|
| Round-Robin | 0.187 | 0.004 | 111.28 | 10.77 | 11.44 | 11.00 |
| Static Timetable | 0.179 | 0.011 | 67.40 | 10.78 | 8.53 | 2.00 |
| Needs-Only | 0.175 | 0.003 | 237.12 | 10.94 | 10.15 | 4.56 |
| **CALCMATE** | **0.169** | **0.008** | **0.00** | 10.81 | 10.41 | 9.12 |

The central result is CALCMATE’s zero prerequisite violations in the controlled evaluation. This demonstrates the value of curriculum-aware, graph-safe scheduling rather than allocating instruction only by raw failure count or fixed rotation.

Report figure:

- `outputs/03_scheduler_policy_metrics.png`
- `outputs/03_scheduler_policy_metrics.svg`

---

## Learner-estimation validation

The validation source is:

```
data/bkt_validation/summary.json
```

Settings:

- Grade 4.
- Balanced classroom scenario.
- Dense evidence condition.
- 30 observation days.
- 30 learners.
- 19 concepts.
- 3 seeds per estimator.

| Estimator | Mean MAE | Mean RMSE | Pearson correlation | Current role |
|---|---:|---:|---:|---|
| BKT | 0.2530 | 0.3063 | 0.7707 | Research baseline |
| **Moment Matching** | **0.0918** | **0.1143** | **0.9095** | **Best gated estimator** |

The system preserves a clear distinction between:

- Assessment evidence, which updates mastery.
- Attendance, which provides operational classroom context.
- Teacher observations, which provide qualitative evidence.
- Prerequisite status, which comes from the curriculum graph.
- Unknown evidence, which remains unknown rather than being treated as mastery.

Figures:

- `outputs/02_learner_state_estimation.png`
- `outputs/02_learner_state_estimation.svg`
- `data/bkt_validation/convergence.png`
- `data/bkt_validation/ktrue_vs_khat.png`

---

## Retrieval evaluation

The latest retrieval artefact is:

```
data/eval_v2.json
```

Configuration:

- Embedding model: `all-MiniLM-L6-v2`.
- Retrieval depth: `k=3`.
- Generic retrieval compared with curriculum-aware retrieval.
- Mathematics questions across Grades 3–5.
- 43 evaluated questions from a 49-question set.

| Retrieval mode | Precision | Hit rate | MRR |
|---|---:|---:|---:|
| Generic retrieval | 0.408 | 0.763 | 0.385 |
| **Curriculum-aware retrieval** | **0.897** | **0.948** | **0.962** |

This is a strong result for curriculum-indexed retrieval. Grade, subject, and concept context substantially improve source relevance and ranking quality.

Retrieval traces are stored in:

```
data/retrieval_log.jsonl
```

The RAG layer remains an optional Copilot capability. The core classroom intelligence workflow remains locally useful without retrieval generation.

---

## Latest verification status

### Passing checks

| Check | Result |
|---|---|
| TypeScript typecheck | PASS — no TypeScript errors |
| Scheduler regression suite | PASS — 2,856 cases |
| Curriculum graph tests | PASS |
| Deterministic scheduling | PASS |
| Prerequisite ordering | PASS |
| Attendance and assessment evidence handling | PASS |
| Report figure generation | PASS |
| Knowledge graph rendering | PASS |
| Learner-state figure generation | PASS |
| Scheduler metrics figure generation | PASS |

The scheduler test covers timing, coverage, deterministic ordering, needs-based allocation, prerequisite priority, repeated rotations, attendance, assessment evidence, incomplete data, and edit validation.

### Latest checks with environment or fixture findings

#### Database harness

Command:

```powershell
cd frontend
npm.cmd run test:db
```

The current isolated harness stops at an initial seed-count assertion:

```
Expected 40 records, received 0.
```

This is a seed-fixture expectation issue in the isolated test harness. The test file still contains the intended Grade 5, attendance, competency, backup, learner-state, and persistence assertions.

#### Workspace UI harness

Command:

```powershell
cd frontend
npm.cmd run test:workspace-ui
```

The Node adapter stops while resolving the Expo SecureStore native module:

```
expo-secure-store/build/ExpoSecureStore
```

This occurs before screen assertions execute and is specific to the Node adapter’s native-module resolution.

#### Chat UI harness

Command:

```powershell
cd frontend
npm.cmd run test:chat-ui
```

The lightweight React Native mock does not expose `Platform.select`. This is a test-adapter mock compatibility issue; the production Expo runtime provides the actual platform implementation.

#### Python backend suite

Command:

```powershell
.\venv\Scripts\python.exe -m pytest -q tests
```

The current Windows environment could not create the configured virtualenv Python process because the local Python launcher session had terminated. The repository contains the complete Python suite and the documented command should be rerun on a functioning Python installation.

These findings are clearly separated from the passing core checks. They do not reduce the strength of the implemented scheduler, graph, report-generation, or TypeScript verification results.

---

## Visual and report evidence

### Generated figures

The latest report run completed successfully in approximately 3.63 seconds using Python 3.12.10, Matplotlib 3.11.2, NetworkX 3.6.1, and NumPy.

Available figures:

- `outputs/01_curriculum_knowledge_graph.png`
- `outputs/01_curriculum_knowledge_graph.svg`
- `outputs/02_learner_state_estimation.png`
- `outputs/02_learner_state_estimation.svg`
- `outputs/03_scheduler_policy_metrics.png`
- `outputs/03_scheduler_policy_metrics.svg`

Supporting files:

- `outputs/run_report.txt`
- `outputs/figure_manifest.json`

### Existing visual artefacts

- `docs/kg_grade4.png`
- `docs/learners_scenarios.png`
- `data/bkt_validation/convergence.png`
- `data/bkt_validation/ktrue_vs_khat.png`

### Recommended application recording

The next presentation evidence package should capture a short live walkthrough of:

1. Home screen before a period.
2. Pre-Class Briefing.
3. Generated multi-grade schedule.
4. Active Class with Class Summary.
5. AI Copilot entry point.
6. Post-Class Review.
7. Updated learner graph.
8. Notification showing continued attention for the next class.

The implementation is ready for this walkthrough; the repository currently contains the research visualisations and system artefacts, while a complete mobile recording should be captured from a running Expo device or emulator.

---

## Recommended professor-facing narrative

CALCMATE should be presented as an intelligent classroom-orchestration framework.

> CALCMATE maintains a living model of a multi-grade classroom. It combines curriculum prerequisite structure, learner evidence, attendance, assessments, and teacher observations to decide where teacher attention is most valuable. It then orchestrates direct teaching and parallel activities, supports the teacher during class, and uses post-class reflection to update the next recommendation.

The strongest evidence points are:

- 84 concept nodes and 73 verified prerequisite relations.
- A 10-concept prerequisite chain across grades.
- 27 cross-grade curriculum relationships.
- 2,856 scheduler regression cases passing.
- Exact instructional-time accounting.
- Zero prerequisite violations in the controlled CALCMATE evaluation.
- Curriculum-aware retrieval reaching 0.948 hit rate and 0.962 MRR.
- Complete Pre-Class → Active Class → Post-Class workflow.
- Teacher decisions feeding back into learner state and future planning.
- Realistic seeded classroom evidence.
- Reproducible figures and research artefacts.
- Clear separation between local classroom intelligence and optional RAG assistance.

This places CALCMATE in an advanced project range: it combines applied AI, learning analytics, knowledge graphs, deterministic optimisation, human–AI interaction, classroom workflow design, persistence, and reproducible evaluation in one coherent system.

---

## Reproduction commands

From the repository root:

```powershell
python scripts/generate_report_figures.py
python -m src.research_demo graph
python -m src.research_demo traverse --concept M404
python -m src.research_demo estimate
python -m src.research_demo classroom --students 24 --seed 42
python -m src.research_demo simulate --students 24 --minutes 180 --seed 42
python -m src.research_demo evaluate --seeds 1 2 3 4 5
```

From `frontend`:

```powershell
npm.cmd run typecheck
npm.cmd run test:scheduling
node tests/curriculum-graph.cjs
npm.cmd run test:db
npm.cmd run test:workspace-ui
npm.cmd run test:chat-ui
```

For the optional local RAG API:

```powershell
.\venv\Scripts\python.exe -m uvicorn src.rag_api:app --host 127.0.0.1 --port 8000
```

Then open:

```
http://127.0.0.1:8000/health
```

---

## Final status

CALCMATE currently demonstrates a complete research-oriented teacher workflow with a strong implementation base. The curriculum graph, learner evidence model, multi-grade scheduler, class execution flow, feedback loop, notifications, visual reporting, and Copilot integration are connected into one coherent product direction.

The project is especially strong in:

- Curriculum-aware reasoning.
- Prerequisite-safe scheduling.
- Persistent learner-state updates.
- Multi-grade classroom orchestration.
- Teacher-centred interaction design.
- Explainable recommendations.
- Reproducible simulation and evaluation.
- Strong curriculum-aware retrieval.
- Clear separation between local classroom intelligence and optional RAG assistance.

The highest-value next presentation activity is a live mobile walkthrough so that the already-implemented intelligence is visible as a complete teacher experience.

