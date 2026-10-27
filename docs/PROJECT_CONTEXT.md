# CALCMATE — Current Project Context

## Purpose of this document

This document is the authoritative context brief for the current state of the CALCMATE project. It can be given to ChatGPT, a project teammate, a reviewer, or a future development session before asking for analysis, implementation, presentation support, evaluation design, or documentation.

The project is an AI-powered teacher copilot and intelligent classroom-orchestration system for multi-grade mathematics classrooms. It is designed around the practical reality of one teacher managing several grades, different learning levels, limited instructional time, attendance variation, prerequisite gaps, assessment evidence, and the need to make fast, meaningful classroom decisions.

CALCMATE is not positioned as only a chatbot, a timetable generator, or a student dashboard. Its central contribution is a persistent classroom intelligence loop:

```text
Curriculum knowledge graph
        +
Attendance, assessments, observations, and classroom evidence
        +
Learner-state estimation and prerequisite reasoning
        ↓
Teacher prioritisation and multi-grade schedule generation
        ↓
Pre-class briefing → Active class → Post-class review
        ↓
Updated learner evidence and next-class recommendations
```

The system is designed to help a teacher make better decisions with less administrative effort while preserving teacher judgement and real classroom flexibility.

---

## Research motivation and field context

CALCMATE addresses the instructional and administrative difficulty of teaching multiple grades in the same classroom. The intended field setting includes:

- Approximately 40–50 children.
- Multiple grades handled by one teacher.
- Roughly three hours of daily instruction.
- Wide variation in prior knowledge.
- Limited learning resources and technology.
- Manual teaching logs and attendance records.
- Weak or unreliable network connectivity as an important design consideration.

The teacher-reported challenge is not simply delivering content. The deeper challenge is tracking the learning flow across groups while deciding who needs attention, what should be taught next, which prerequisite is blocking progress, and what meaningful activity the remaining groups can perform independently.

The core design insight is:

> Managing groups is possible, but tracking learning flow is difficult.

CALCMATE responds to this by maintaining a persistent classroom state and converting that state into concise, actionable teacher support.

---

## Research objectives addressed

### RO5 — AI-powered teacher copilot

CALCMATE supports instructional and administrative decision-making through a unified teacher workspace. The teacher can inspect learner status, review attendance, view assessment evidence, ask the Copilot questions, generate plans, monitor a live class, and record post-class outcomes.

### RO6 — Intelligent classroom orchestration

The scheduling engine coordinates teacher-led instruction and parallel activities across grades. It considers learner needs, current evidence, prerequisites, attendance, available time, and the instructional structure of the classroom.

### RO7 — Learner monitoring and adaptive assistance

The system maintains learner mastery, learning gaps, prerequisite status, progress history, assessment evidence, attendance, and observations. These states are used to produce attention priorities, differentiated activities, and next-learning recommendations.

### RO8 — Human–AI interaction

The application uses teacher-oriented mobile interactions: briefings, cards, status controls, focused actions, contextual Copilot entry points, time-aware home content, clean schedule views, and structured post-class review. The aim is to make AI assistance understandable and actionable without requiring the teacher to operate a complex analytical system.

### RO9 — Teacher workload and personalised learning

The system is structured to reduce repetitive planning and record-keeping, improve attention allocation across grades, and support personalised learning through evidence-driven prioritisation rather than a fixed timetable.

---

## Current system architecture

### Frontend

The frontend is an Expo, React Native, TypeScript application with a teacher-first mobile workflow. It uses Expo Router for navigation and local SQLite persistence for classroom records.

Important frontend areas include:

- `frontend/app/(tabs)/index.tsx` — time-aware teacher home dashboard.
- `frontend/app/(tabs)/students.tsx` — classroom roster, attendance, assessment, and progress workspace.
- `frontend/app/(tabs)/schedule.tsx` — planner and saved schedule access.
- `frontend/app/general-schedule/new.tsx` — daily multi-grade schedule creation.
- `frontend/app/general-schedule/[id].tsx` — saved schedule and rotation execution view.
- `frontend/app/weekly-schedule/new.tsx` — weekly planning generation.
- `frontend/app/weekly-schedule/[id].tsx` — saved weekly agenda and period access.
- `frontend/app/active-session.tsx` — active classroom execution.
- `frontend/app/post-class-review.tsx` — post-class recording and learner-state feedback.
- `frontend/app/notifications.tsx` — learning-change and teacher-action notifications.
- `frontend/app/curriculum.tsx` — curriculum knowledge graph and learner-state overlays.
- `frontend/app/students/[id].tsx` — detailed learner profile and evidence history.

### Core services

- `frontend/src/services/generalScheduler.ts` — deterministic multi-grade rotation scheduler.
- `frontend/src/services/generalScheduleService.ts` — schedule persistence and loading.
- `frontend/src/services/weeklyScheduleEngine.ts` — weekly evidence-driven planning.
- `frontend/src/services/weeklyScheduleService.ts` — weekly plan persistence and period mapping.
- `frontend/src/services/learnerEstimator.ts` — learner-state reconstruction.
- `frontend/src/services/learnerStateService.ts` — learner knowledge views, concept states, and prerequisite analysis.
- `frontend/src/services/classroomEvidenceService.ts` — evidence snapshots used by planning and teacher views.
- `frontend/src/services/sessionService.ts` — active-session execution and post-class outcomes.
- `frontend/src/services/notificationService.ts` — teacher notification persistence and read state.
- `frontend/src/services/demoService.ts` — realistic seeded review classroom.
- `frontend/src/services/database.ts` — local SQLite schema and migrations.
- `frontend/src/services/backupFormat.ts` and `restoreService.ts` — classroom backup and restore.

### Backend and research layer

The Python research and service layer includes:

- Curriculum knowledge-graph loading and validation.
- Prerequisite traversal and readiness analysis.
- Learner intelligence and estimation utilities.
- Synthetic classroom generation.
- Controlled multi-policy scheduling evaluation.
- Research demonstration CLI.
- Optional FastAPI/RAG services for textbook-grounded Copilot support.

The non-RAG classroom intelligence pipeline is intentionally independent of the RAG service. Scheduling, attendance, assessment recording, learner state, knowledge graph reasoning, and local classroom persistence do not require an active RAG server.

---

## Curriculum knowledge graph

The authoritative mathematics curriculum is represented through:

- `data/concepts.csv`
- `data/prerequisite_edges.csv`

The current curated graph contains:

| Property | Current state |
|---|---:|
| Concepts | 84 |
| Prerequisite relations | 73 |
| Grades represented | 1–5 |
| Directed acyclic graph | Yes |
| Weakly connected components | 15 |
| Longest prerequisite chain | 10 concepts |
| Cross-grade relations | 27 |
| Duplicate edges | 0 |
| Self-loops | 0 |
| Edges to unknown concepts | 0 |

The graph is used to represent the fact that learning is progressive. For example, foundational number concepts can support later operations, fractions, geometry, measurement, and other higher-level concepts. The scheduler uses this structure to avoid recommending a dependent concept when a prerequisite gap is the more appropriate instructional priority.

The graph visualization is generated from the actual CSV files and stored in:

- `outputs/01_curriculum_knowledge_graph.png`
- `outputs/01_curriculum_knowledge_graph.svg`

The SVG version is preferred for reports because it remains sharp when resized.

---

## Learner-state model

CALCMATE maintains learner state from classroom evidence rather than treating attendance or a single score as mastery. Evidence sources include:

- Assignments.
- Quizzes.
- Classwork.
- Exit checks.
- Assessment scores.
- Attendance.
- Teacher observations.
- Class-session outcomes.
- Post-class attention reviews.
- Historical evidence and recency.

The learner-state workflow distinguishes between:

- Unknown evidence.
- Limited evidence.
- Developing or insufficient mastery.
- Needs-support states.
- Likely-ready states.
- Prerequisite gaps.
- Concept-level progress history.

Attendance is used as contextual classroom evidence and planning information. It is not treated as a direct substitute for mastery. Assessment evidence and learner-state estimation drive concept mastery, while attendance helps the system interpret availability, participation, and scheduling needs.

Post-class attention reviews create new evidence and feed the updated state back into future scheduling. This enables the classroom to behave as a living system rather than a static seeded demo.

The current learner-state report artefact is:

- `outputs/02_learner_state_estimation.png`
- `outputs/02_learner_state_estimation.svg`

The supporting validation source is:

- `data/bkt_validation/summary.json`

The report figure compares the learner-state estimation approaches transparently and identifies the best gated estimator in the current validation artefact. This allows the project to present an evidence-based research narrative instead of overstating an algorithmic result.

---

## Realistic seeded classroom

The seeded classroom is designed for a convincing review and demonstration flow. It includes:

- Learners distributed across multiple grades.
- Indian and South Indian-style names.
- Grade-specific concept exposure.
- Partial curriculum coverage rather than all concepts being marked complete.
- Assignment and quiz marks.
- Repeated assessment evidence across time.
- Realistic score trajectories.
- Attendance from the academic period leading into the October review point.
- Learner-specific strengths and gaps.
- Prerequisite-sensitive readiness.
- Teacher observations and intervention context.

The purpose of the seeded state is to allow the reviewer to see why a recommendation was made. The teacher should be able to inspect a student, understand the current gap, open the relevant graph context, generate a schedule, execute a class, record outcomes, and observe the next recommendation change.

The seed is intended to demonstrate progression. Students are not uniformly complete across the entire curriculum. Different learners and grades should expose different states, which makes the scheduler and learner graph meaningfully responsive.

---

## Evidence-driven daily scheduler

The daily scheduler is implemented in:

```text
frontend/src/services/generalScheduler.ts
```

It receives a classroom snapshot and a teacher time budget. It considers:

- Selected grades.
- Available instructional minutes.
- Attendance and present learners.
- Assessment history.
- Current learner-state estimates.
- Weak concepts.
- Prerequisite gaps.
- Grade-level instructional needs.
- Teacher priority.
- Transition costs.
- Time required for meaningful direct teaching.

The scheduler produces:

- Common opening routines.
- Teacher-led instructional blocks.
- Grade-specific parallel activities.
- Pair activities.
- Group activities.
- Independent practice.
- Worksheets.
- Assessment and exit-check opportunities.
- Transition blocks.
- Closing routines.
- Reasons for each allocation.
- Warnings when the available time is insufficient.

The scheduler is deterministic and explainable. The same classroom evidence and time selection produce the same plan, which is important for reproducibility, teacher trust, and research evaluation.

It does not follow a rigid “Grade 1 first, Grade 2 second” timetable. It allocates direct teacher attention according to the current learning need and keeps other groups meaningfully engaged.

The current scheduler has been tested across thousands of timing, ordering, coverage, attendance, evidence, prerequisite, and incomplete-data cases.

---

## Weekly planning

The weekly planner generates a multi-day instructional agenda from current classroom needs and remaining curriculum portions. It is designed to be read as a teaching plan rather than as a dense timetable.

The weekly workflow is:

1. Inspect the present classroom state.
2. Identify unresolved concepts and prerequisite needs.
3. Allocate instructional focus across the week.
4. Generate teacher-led and parallel activities.
5. Show reasons and learning objectives.
6. Save the plan.
7. Make the relevant daily period available from the Home screen.
8. Open the selected period as a Pre-Class Briefing.
9. Transition into Active Class.
10. Record Post-Class outcomes.

The weekly plan is therefore connected to daily execution instead of being a disconnected planning screen.

---

## Time-aware teacher experience

The Home screen is designed around the teacher’s current time of day.

### Before the period

The teacher sees the Pre-Class Briefing, including:

- Current class and period.
- What needs to be taught.
- Learners who require attention.
- Prerequisite gaps.
- Present learner count.
- Tasks for the other grades.
- Suggested group, pair, worksheet, independent, or assessment activities.

### During the period

The teacher sees the Active Class experience, including:

- Current class focus.
- Rotation progress.
- Learner and attendance context.
- Class Summary.
- Parallel activity information.
- AI Copilot entry point for teacher doubts.
- Current and upcoming instructional blocks.

### After the period

The teacher sees the Post-Class Review, including:

- Planned versus delivered blocks.
- Attention areas.
- Resolved or continuing decisions.
- Exit assessments.
- Observations.
- Student interventions.
- Follow-up recommendations.

### Outside scheduled teaching time

The Home screen directs the teacher to planning, saved weekly schedules, notifications, and classroom readiness rather than displaying a misleading active-class state.

The application uses the device’s local time so that the experience reflects the actual teacher’s day.

---

## Pre-Class Briefing

The Pre-Class Briefing is intentionally concise and teacher-friendly. It answers the questions a teacher needs immediately before entering a period:

- Which grade is the direct focus?
- Which concept should be addressed?
- Why is this concept important now?
- Which students require attention?
- Is a prerequisite blocking progress?
- Who is present?
- What should the remaining grades do while direct instruction is happening?
- Is a quick assessment or exit check appropriate?

The briefing avoids excessive AI-generated prose. It presents the decision context in short, readable cards and actions.

---

## Active Class

The Active Class screen supports real classroom execution rather than displaying a static lesson plan. It includes:

- A live elapsed session context.
- Current block and upcoming block.
- Direct teacher focus.
- Parallel activity labels.
- Class Summary.
- Attendance and learner counts.
- Rotation progress.
- AI Copilot action for teacher questions.

The teacher can use the Copilot when a classroom doubt arises without abandoning the active teaching workflow.

---

## Post-Class Review and classroom feedback loop

The Post-Class Review is a central part of the research contribution. It allows the teacher to record what actually happened instead of forcing the classroom to behave exactly like the generated plan.

The teacher can:

- Confirm delivered or missed blocks.
- Record notes.
- Select students requiring intervention.
- Record exit assessments.
- Add observations.
- Mark attention areas as resolved.
- Mark attention areas as continuing.

When an attention area is marked as continuing:

1. The system creates new teacher-review evidence.
2. The learner state is recalculated.
3. The concept remains active for future scheduling.
4. A teacher notification is created.
5. The next planning cycle can retain the concept instead of moving blindly to a new topic.

This implements a realistic classroom feedback loop where the schedule adapts to what was observed after instruction.

---

## Notifications and learning changes

The notification system is designed for meaningful teacher updates rather than generic alerts. Notifications can communicate:

- A concept that should remain active.
- A follow-up attention area.
- A missed teaching entry.
- A system-level classroom update.

The Planner provides access to updates, and notifications can be marked as read. Notification records are scoped to the teacher workspace and included in backup/restore support.

---

## AI Copilot and RAG boundary

The project includes an AI Copilot with curriculum-grounded support and optional NCERT/RAG integration. The Copilot can be used for teacher questions and contextual assistance.

The current non-RAG classroom intelligence layer is intentionally complete and independently useful. The following do not depend on the RAG service:

- Classroom seed data.
- Student monitoring.
- Attendance.
- Assessment history.
- Learner-state updates.
- Knowledge graph reasoning.
- Prerequisite analysis.
- Daily scheduling.
- Weekly planning.
- Active-class execution.
- Post-class review.
- Notifications.
- Backup and restore.

This separation ensures that the core teacher workflow remains explainable and locally useful even when textbook retrieval or external model generation is not active.

---

## Visual design and interaction principles

The frontend has been redesigned around the following principles:

- Teacher-first rather than system-first language.
- Clear hierarchy and concise cards.
- Clean education-themed visual design.
- Minimal unnecessary data entry.
- Strong separation between preparation, teaching, and reflection.
- Clear status labels instead of dense paragraphs.
- Contextual actions placed near the decision they support.
- Centered, polished loading states.
- Readable knowledge graph overlays.
- Visible reasons behind schedule decisions.
- No emojis or emoticons in the application interface.
- Support for a living, changing classroom state.

The interface is intended to feel premium, calm, and useful under real classroom pressure.

---

## Research demonstration and report assets

The research demonstration CLI is located at:

```text
src/research_demo.py
```

Useful commands from the repository root:

```powershell
python -m src.research_demo graph
python -m src.research_demo traverse --concept M404
python -m src.research_demo estimate
python -m src.research_demo classroom --students 24 --seed 42
python -m src.research_demo simulate --students 24 --minutes 180 --seed 42
python -m src.research_demo evaluate --seeds 1 2 3 4 5
```

The report figure generator is:

```text
scripts/generate_report_figures.py
```

Run it with:

```powershell
python scripts/generate_report_figures.py
```

It produces:

```text
outputs/01_curriculum_knowledge_graph.png
outputs/01_curriculum_knowledge_graph.svg
outputs/02_learner_state_estimation.png
outputs/02_learner_state_estimation.svg
outputs/03_scheduler_policy_metrics.png
outputs/03_scheduler_policy_metrics.svg
outputs/figure_manifest.json
```

The supporting run log is:

```text
outputs/run_report.txt
```

These figures are based on real repository artefacts rather than manually created sample values.

---

## Verification status

The project includes frontend, database, scheduling, curriculum, classroom, Copilot, backend, and research tests. The main verification commands are:

```powershell
.\venv\Scripts\python.exe -m pytest -q tests
```

```powershell
cd frontend
npm.cmd run typecheck
npm.cmd run test:db
npm.cmd run test:scheduling
node tests/curriculum-graph.cjs
npm.cmd run test:workspace-ui
npm.cmd run test:chat-ui
```

The scheduler and curriculum graph tests validate deterministic allocation, exact time accounting, prerequisite direction, graph integrity, evidence handling, attendance interaction, and classroom workflow behaviour.

---

## Recommended demonstration flow

For a review or project presentation, use this sequence:

1. Open the application and enter the teacher workspace.
2. Load the review classroom or seeded classroom.
3. Open Home and show the current classroom summary.
4. Open the Classroom page and select a grade.
5. Show attendance, assessments, and learner-state indicators.
6. Open the Curriculum page and show prerequisite relationships.
7. Generate a daily multi-grade schedule.
8. Explain why direct teacher attention was assigned to a particular grade.
9. Show the parallel activities for the remaining grades.
10. Save the plan.
11. Return to Home and show the time-aware plan card.
12. Open the Pre-Class Briefing.
13. Start the Active Class.
14. Use the AI Copilot action for a teacher question.
15. Open Class Summary and show the live classroom context.
16. Complete Post-Class Review.
17. Mark one attention area as continuing.
18. Show the updated learner state and notification.
19. Open Planner and generate the next plan.
20. Demonstrate that the unresolved concept remains part of the next recommendation.

This flow demonstrates the complete intelligence loop rather than isolated screens.

---

## Strong project positioning

The strongest way to describe CALCMATE is:

> CALCMATE is a persistent, evidence-driven classroom intelligence system for multi-grade teachers. It combines curriculum prerequisite reasoning, learner-state estimation, attendance and assessment evidence, adaptive scheduling, teacher Copilot support, live classroom orchestration, and post-class feedback into one continuous teacher workflow.

Its distinguishing strengths are:

- It models the classroom as a changing state.
- It recognises that different learners need different support.
- It understands that prerequisites matter.
- It allocates teacher attention instead of blindly rotating grades.
- It keeps other groups meaningfully engaged.
- It connects planning with actual execution.
- It turns post-class teacher judgement into future recommendations.
- It preserves a clear separation between evidence, estimation, recommendation, and teacher decision.
- It is structured for realistic teacher interaction rather than a purely technical demonstration.

The project is therefore best presented as an intelligent classroom-orchestration framework with an integrated teacher copilot, not as a collection of disconnected application screens.

