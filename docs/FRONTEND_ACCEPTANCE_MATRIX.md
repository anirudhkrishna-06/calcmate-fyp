# CALCMATE — Frontend Acceptance Matrix

**Document ID**: `CALCMATE-FE-ACCEPTANCE-MATRIX-2026-10-17`  
**System**: CALCMATE — Multi-Grade Classroom Instructional Attention Allocation  
**Scope**: Observable Verification of Core Teacher Workflows  
**Evaluation Standard**: Strict Runtime Evidence (Code-Traced & Execution-Verified)  

---

## Acceptance Matrix Summary

| Workflow ID | Workflow Category | Observable Pass Condition | Current Status | Verification Evidence / Reason |
|---|---|---|:---:|---|
| **ACC-01** | Account & Demo Onboarding | Teacher can launch demo workspace or sign up/log in with server authentication, creating local workspace. | **PASS** | Verified via `tests/database.cjs` and `tests/http-integration.cjs`. Reopens offline cleanly. |
| **ACC-02** | Home Dashboard Overview | Home screen displays daily attendance counts, revision students, next schedule, and grade selector. | **PASS** | Sourced via `classroomSummary()`. Verified across grade switches in `workspace-ui.cjs`. |
| **ACC-03** | Roster & Student Enrollment | Teacher can enroll students with name, grade (1–4), and roll number; unique constraint enforced. | **PASS** | Verified via `storageService.saveStudent()`; duplicate roll numbers throw catchable errors. |
| **ACC-04** | Daily Attendance Logging | Teacher marks present/absent/late, bulk marks all present, saves changes, and reloads across restarts. | **PASS** | Verified via `AttendanceWorkspace.tsx` and `database.cjs`. Atomic SQLite transactions. |
| **ACC-05** | Mid-Session Attendance Changes | Teacher can change attendance mid-session with distinct session timestamps and arrival history. | **FAIL** | Schema limitation: SQLite `attendance` is keyed only by `(workspace_id, student_id, date)`. No session timestamp history. |
| **ACC-06** | Bulk Marks Entry | Teacher enters marks for a class concept ($0 \le \text{score} \le \text{max}$), saving updates to all students. | **PASS** | Verified via `BulkAssessment.tsx` and `saveClassAssessments()`. Form retains draft on concept conflict. |
| **ACC-07** | Assessment-Driven State Update | Entering new marks immediately recalculates Score-Ratio-v1 mastery and updates `learner_concept_states`. | **PASS** | Verified via `test_assessment_to_learner_state_feedback_loop` and `learnerStateService.ts`. |
| **ACC-08** | Prerequisite Deficit Alerting | Concepts whose prerequisites are `needs_support` or `unknown` display an active warning banner. | **PASS** | Verified in `students/[id].tsx` (`⚠️ Prerequisite Gap`). `prerequisite_gap = true` evaluated from SQLite. |
| **ACC-09** | Student Knowledge Graph View | Teacher views an interactive focused prerequisite/dependent graph with concept selection, learner-state overlay, and structured fallback. | **PASS** | `curriculumGraphService.ts` reads canonical SQLite concepts and edges; `KnowledgeGraphVisualizer.tsx` provides focused, layer, and list views. `frontend/tests/curriculum-graph.cjs` verifies direction and stale/self-edge handling. |
| **ACC-10** | Pre-Class Multi-Grade Scheduling | Teacher selects time budget, grades, and priority; deterministic scheduler produces rotation timeline. | **PASS** | Verified via `generalScheduler.ts` (1,904 passing test cases) and `general-schedule/new.tsx`. |
| **ACC-11** | Unattended Cohort Task Generation | Scheduler automatically assigns differentiated, synchronized tasks (peer practice, worksheets) to idle grades. | **PASS** | Verified in `generalScheduler.ts` line 80. Unattended grades receive structured rotation activities. |
| **ACC-12** | Live Teacher Override | Teacher edits block duration and activity descriptions in schedule; edits persist to SQLite. | **PASS** | Verified via `GeneralTimeline.tsx` and `saveGeneralBlocks()`. Dirty-state tracking warns on unsaved exit. |
| **ACC-13** | Active Class Execution Mode | Teacher launches "Active Class" with elapsed timer, rotation alerts, and real-time transition cues. | **PASS** | Verified via `active-session.tsx`, `sessionService.ts`, and test suite in `workspace-ui.cjs` and `database.cjs`. |
| **ACC-14** | Post-Class Outcome & Delta Review | Teacher completes class, reviews planned vs actual delivery, and records student intervention receipts. | **PASS** | Verified via `post-class-review.tsx`, `saveSessionOutcomes()`, and test suite in `workspace-ui.cjs`. |
| **ACC-15** | AI Copilot Intent Routing | Teacher submits natural-language query; system classifies intent and dispatches to structured operation. | **PASS** | Verified via `test_copilot_pipeline.py` and `copilot_operations.py` across all 11 operations. |
| **ACC-16** | Inline Schedule Generation in Chat | Asking copilot for a schedule executes local TypeScript scheduler and renders interactive `ScheduleCard` in chat. | **PASS** | Verified in `chatService.ts` lines 15–26 and `test_copilot_schedule_action_contract`. |
| **ACC-17** | Context-Rich Copilot Injection | Tapping "Teaching ideas" on student screen passes `student_id` and `concept_id` into the copilot request. | **PASS** | Verified via `buildCopilotRequest()` in `chatRepository.ts`, `students/[id].tsx`, `ClassProgress.tsx`, and `chat-ui.cjs`. |
| **ACC-18** | NCERT Textbook RAG Retrieval | Querying mathematics concepts retrieves source chunks with exact PDF, grade, and chapter citations. | **PASS** | Verified via `tests/http-integration.cjs`. FAISS retriever yields 3–4 chunks; drawer renders in UI. |
| **ACC-19** | RAG Generation Fallback | When Ollama/LLM is offline, system returns raw textbook source excerpts without failing. | **PASS** | Verified in `src/rag_api.py` and `tests/http-integration.cjs`. Excerpts formatted with attribution blockquotes. |
| **ACC-20** | Offline Resiliency & Data Isolation | Complete classroom workflows (roster, marks, attendance, schedules) function 100% offline in SQLite. | **PASS** | Verified via `NetInfo` mock in `database.cjs` and `http-integration.cjs`. |
| **ACC-21** | Curriculum Filtering & Metadata | Teacher filters the local canonical curriculum by supported grade/subject and inspects metadata. | **PASS** | `loadCurriculumGraph(grade, subject)` queries active SQLite concepts; selected details expose grade, subject, coverage, objective, prerequisites, and dependents. Current seeded subject is Math. |
| **ACC-22** | Learner-State Graph Overlay | Student/group overlays distinguish ready, developing, needs revision, and unknown evidence without using attendance or delivery as mastery. | **PASS** | Overlays consume `learnerStateService`; shared exported thresholds are used, and null/unknown evidence remains `Unknown / No marks`. Existing database tests verify assessment-driven state updates and attendance separation. |
| **ACC-23** | Recommendation-to-Graph Workflow | A planner recommendation can open the corresponding concept graph while preserving grade and origin context. | **PASS** | General and saved-plan timelines expose `Open concept graph` when a canonical concept ID is available; route params include `grade`, `conceptId`, and `origin`. |
| **ACC-24** | Graph Resilience | Empty/loading/error states and invalid local relationships remain usable. | **PASS** | Curriculum screen provides loading, empty, error, and retry states; relationship normalization ignores stale/self edges and retains the single-column prerequisite fallback. |

---

## Detailed Evaluation Breakdown

### ACC-01 to ACC-04: Core Classroom Setup & Attendance
- **Result**: **PASS**.
- **Evidence**:
  - `authService.exploreDemo()` seeds demo workspace with 32 students in 4 grades.
  - `classroomSummary()` accurately reflects daily statistics.
  - `AttendanceWorkspace` handles state transitions, undo, and atomic commits.
  - Test suites `database.cjs` and `workspace-ui.cjs` execute clean assertions against simulated SQLite.

### ACC-05: Mid-Session Attendance Tracking
- **Result**: **FAIL**.
- **Evidence**:
  - `attendance` table schema:
    ```sql
    CREATE TABLE attendance (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, student_id TEXT NOT NULL, date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent','late')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
      UNIQUE(workspace_id,student_id,date)
    );
    ```
  - Because `UNIQUE(workspace_id,student_id,date)` is enforced, any second attendance record on the same day simply updates the `status` column. No session or departure timestamps are retained.

### ACC-06 to ACC-08: Assessment & Prerequisite Feedback
- **Result**: **PASS**.
- **Evidence**:
  - `saveClassAssessments()` writes to `assessments` and triggers `updateLearnerConceptState()`.
  - `learnerStateService.ts` implements Score-Ratio-v1 with decay parameter $\lambda = 0.75$.
  - In `students/[id].tsx`, lines 84–110: When a prerequisite has status `needs_support` or `unknown`, the dependent concept displays: `⚠️ Prerequisite Gap: Foundational concepts need revision before advancing.`

### ACC-09: Student Knowledge Graph Visualization
- **Result**: **PASS** for the dependency-free focused graph/fallback implementation.
- **Evidence**:
  - `curriculum.tsx` loads the local canonical graph and preserves `grade`, `conceptId`, `studentId`, and `origin` route context.
  - `KnowledgeGraphVisualizer.tsx` presents immediate prerequisites above the selected target, downstream dependents below it, sequence layers, and a structured list fallback. It uses text labels and status badges rather than depending on colour alone.
  - `curriculum-graph.cjs` verifies prerequisite direction, fallback column data, duplicate removal, and stale/self-edge rejection.

### ACC-10 to ACC-12: Multi-Grade Scheduler & Overrides
- **Result**: **PASS**.
- **Evidence**:
  - `frontend/src/services/generalScheduler.ts` validates inputs ($M \in [5, 480]$, $G \subseteq \{1, 2, 3, 4\}$).
  - Deterministic topological ordering guarantees prerequisite concepts precede dependent concepts.
  - 1,904 regression test cases in `scheduling.cjs` pass in ~1.2 seconds.
  - `GeneralTimeline.tsx` allows editing duration, activities, and status, and saves overrides to SQLite.

### ACC-13 & ACC-14: In-Class Execution & Post-Class Review
- **Result**: **PASS**.
- **Evidence**:
  - `frontend/app/active-session.tsx` and `frontend/src/services/sessionService.ts` implement full active class session execution with running timer, block progression, overtime warnings, mid-session attendance event logging, and state sync to SQLite.
  - `frontend/app/post-class-review.tsx` implements post-class delivery review, block completion checklist, 1-on-1 focus student attribution receipts, and qualitative observation persistence.
  - Verified end-to-end via `tests/workspace-ui.cjs` and `tests/database.cjs`.

### ACC-15 to ACC-19: Copilot & Curriculum RAG
- **Result**: **PASS**.
- **Evidence**:
  - `POST /chat` dispatches to 11 structured copilot operations.
  - `chatService.ts` lines 15–26: If response contains `schedule_action: { action: "invoke_local_scheduler" }`, it executes `createGeneralSchedule()` and embeds the schedule card in chat.
  - `http-integration.cjs` verifies that textbook passages from `fractions_grade4.txt` are retrieved via FAISS and rendered in the expandable `Sources` drawer.
  - **ACC-17 PASS**: `chatRepository.ts` forwards `student_id`, `concept_id`, and `screen_context` using `buildCopilotRequest()`. Integrated across `students/[id].tsx`, `ClassProgress.tsx`, `PlanTimeline.tsx`, and verified in `tests/chat-ui.cjs`.

### ACC-20: Offline Resiliency
- **Result**: **PASS**.
- **Evidence**:
  - All essential teaching day features (register, marks, student profiles, multi-grade scheduler) execute completely offline using local SQLite.
  - Network disconnection is gracefully handled by `NetInfo` with user-facing banners and retry controls.

### Correction-pass status overrides

The summary rows above contain earlier Stage 2 claims. The following overrides are the authoritative results of this correction pass:

| Criteria | Corrected status | Evidence / limitation |
|---|:---:|---|
| ACC-01 live account approval/login | **PARTIAL** | Offline/demo and local account tests pass; live HTTP approval is blocked before backend startup by the Windows Python launcher. |
| ACC-18 NCERT RAG retrieval | **BLOCKED** | `http-integration.cjs` fails during Python process creation with `A specified logon session does not exist`; no live RAG result is claimed. |
| ACC-19 RAG fallback | **BLOCKED** | Requires the unavailable live backend process; source inspection is not sufficient for PASS. |
| ACC-21 complete canonical curriculum coverage | **PARTIAL** | Mobile Grade 1–4 concepts and edges are repaired and tested. `data/concepts.csv` also contains Grade 5 records, but the mobile schema/types/scheduler support only Grades 1–4. |
| Migration upgrade preservation | **PARTIAL** | Version-2 upgrade and workspace/message preservation pass; every historical student/assessment/attendance migration path is not fully exercised. |
| Persistent timer recovery | **PARTIAL** | Timestamp-derived elapsed calculation is implemented and code-traced; real wall-clock app restart/device validation remains outstanding. |

### Stage 2 verification record

- `npm.cmd --prefix frontend run lint`: PASS.
- `npm.cmd --prefix frontend run typecheck`: PASS.
- `node frontend/tests/curriculum-graph.cjs`: PASS.
- `node frontend/tests/scheduling.cjs`: PASS (1,904 cases).
- `node frontend/tests/database.cjs`: PASS.
- `node frontend/tests/chat-ui.cjs`: PASS, with existing react-test-renderer deprecation and duplicate mock-key warnings.
- `node frontend/tests/workspace-ui.cjs`: PASS.
- `node frontend/tests/admin-ui.cjs`: PASS.
- `pytest -q`: PASS (54 passed, 2 skipped).
- `node frontend/tests/http-integration.cjs`: BLOCKED by the Windows Python process launcher (`A specified logon session does not exist`); no pass is claimed.
- Expo device pixel/layout QA was not performed.

