# CALCMATE — Frontend Gap & Defect Register

**Document ID**: `CALCMATE-FE-GAP-REGISTER-2026-10-17`  
**System**: CALCMATE — Multi-Grade Classroom Instructional Allocation  
**Scope**: Prioritized Technical Findings from Frontend Repository Audit  
**Status**: Authoritative Register  

---

## Priority Overview

| Finding ID | Title | Classification | Severity | Affected Area |
|---|---|---|---|---|
| **FE-001** | Obsolete Toy Concept IDs Seeded into SQLite | Defect | **CRITICAL** | Data Consistency, KG Alignment, Copilot |
| **FE-002** | Absence of Active Class Mode & Session Tracker | Missing | **HIGH** | Teacher Workflow, Class Execution |
| **FE-003** | Conflicting Dual Scheduling / Planning Engines | Partially Wired / UX Defect | **HIGH** | Planning Workflow, Engine Authority |
| **FE-004** | Missing Visual Graph Component for Knowledge Graph | UI Only (List View) | **MEDIUM** | Student Profile, Research Representation |
| **FE-005** | Copilot Context Dropped on Chatbot Navigation | Partially Wired | **MEDIUM** | AI Copilot, Student Inquiries |
| **FE-006** | Absence of Post-Class Outcome & Delivery Tracking | Missing | **MEDIUM** | Post-Class Workflow, Feedback Loop |
| **FE-007** | Absence of Session-Level & Mid-Lesson Attendance | Missing / Schema Limitation | **LOW** | Attendance, Session History |
| **FE-008** | Lack of In-Bubble Indicator for Fallback / Retrieval-Only Answers | UX Defect | **LOW** | RAG Attribution, Teacher Transparency |

---

## Correction-pass addendum (2026-10-17)

- **FE-001 status corrected:** the current frontend seeds canonical Grade 1–4 IDs, not the obsolete toy IDs described in the original gap entry. The correction pass also repairs the supported canonical junction edges, including multi-prerequisite concepts, and the database regression test verifies this. The original entry remains historical evidence of the defect that was corrected.
- **FE-002 status corrected:** persistent active-session, attendance-event, and post-class screens now exist. Timer recovery is improved with timestamp-derived elapsed seconds, but real wall-clock restart/device validation remains PARTIAL.
- **FE-004 status corrected:** the dependency-free focused graph, layer view, and structured fallback are implemented in `KnowledgeGraphVisualizer.tsx` and covered by `curriculum-graph.cjs`.
- **FE-005 status corrected:** `chatRepository.prepareMessage()` now calls `buildCopilotRequest()` and structured context tests pass.
- **Scope limitation:** the mobile database and scheduler support Grades 1–4. The repository’s canonical CSV contains additional Grade 5 records, which are not silently represented as mobile concepts.

## Detailed Gap Profiles

### FE-001: Obsolete Toy Concept IDs Seeded into SQLite
- **Unique ID**: `FE-001`
- **Capability / Workflow**: Data Model, Curriculum Knowledge Graph, Assessment Entry, Copilot Queries.
- **Current Behavior**:
  When a workspace is created or demo mode is seeded, the application seeds 8 toy concepts (`count`, `add`, `place`, `subtract`, `multiply`, `divide`, `fractions`, `measure`) into the SQLite `concepts` table. Even though `canonicalConceptSeed` (`M101`–`M425`) is defined in `demoService.ts`, the seeding loops in `demoService.ts` and `workspaceService.ts` still iterate over `conceptSeed`.
- **Expected Behavior**:
  The SQLite `concepts` and `concept_prerequisites` tables must be populated strictly with canonical NCERT concept IDs (`M101` through `M425`), matching `data/concepts.csv` and the Python backend knowledge graph.
- **Evidence**:
  - `frontend/src/services/demoService.ts`, Line 101: `for (const [id,title,grade,prerequisite] of conceptSeed)`
  - `frontend/src/services/workspaceService.ts`, Line 10: `for (const [id, title, grade, prerequisite] of conceptSeed)`
  - `frontend/src/services/demoService.ts`, Lines 12–79: `canonicalConceptSeed` is defined but unused.
- **Classification**: **Defect**.
- **Severity**: **CRITICAL**.
- **Dependencies & Affected Workflows**:
  - Blocks cross-component alignment between mobile app and backend copilot.
  - When copilot queries `learner_concept_states` for canonical IDs (e.g. `M403`), it finds 0 rows because the local SQLite table stores `divide`.
- **Recommended Investigation / Next Area**:
  - Migrate `demoService.ts` and `workspaceService.ts` to seed `canonicalConceptSeed`.
  - Update `frontend/tests/database.cjs` to assert canonical IDs (`M101`, `M202`, etc.) instead of toy strings.

---

### FE-002: Absence of Active Class Mode & Session Tracker
- **Unique ID**: `FE-002`
- **Capability / Workflow**: In-Class Execution, Time Tracking, Active Class Mode.
- **Current Behavior**:
  The application has no runtime concept of an "Active Class". The teacher views saved schedules as static documents in `GeneralTimeline.tsx`. There is no session state machine, no start/finish button, no countdown or elapsed timer for rotation blocks, and no session ID tracking in the database.
- **Expected Behavior**:
  A teacher should be able to tap "Start Class" from a schedule, launching an active session view that highlights the current rotation block, shows elapsed/remaining minutes, displays current teacher vs unattended group tasks, and preserves active session state if the teacher navigates to check student marks or consult the copilot.
- **Evidence**:
  - `frontend/app/(tabs)/index.tsx`: Has no "Start Class" or "Resume Class" action.
  - `frontend/app/general-schedule/[id].tsx` & `GeneralTimeline.tsx`: Purely a static block list with manual status dropdowns.
  - Database schema (`database.ts`): No `sessions` or `active_class` table.
- **Classification**: **Missing**.
- **Severity**: **HIGH**.
- **Dependencies & Affected Workflows**:
  - Affects real-time classroom orchestration and live teacher guidance.
- **Recommended Investigation / Next Area**:
  - Design an `active_sessions` state store (or ephemeral SQLite table) and an `ActiveSessionScreen` with a rotation timer and quick copilot drawer.

---

### FE-003: Conflicting Dual Scheduling / Planning Engines
- **Unique ID**: `FE-003`
- **Capability / Workflow**: Lesson Planning & Multigrade Scheduling.
- **Current Behavior**:
  The Planner tab (`(tabs)/schedule.tsx`) exposes two parallel scheduling features:
  1. "General Schedule": Multi-grade rotation planner $\to$ `general-schedule/new.tsx` $\to$ calls `generalScheduler.ts` (the true research allocation engine with 1,904 passing tests).
  2. "Lesson Plan": Single-grade lesson plan $\to$ `schedule/generated.tsx` $\to$ calls `mockPlanner.ts` (explicitly labels itself "Local mock planner" and uses hardcoded rules).
- **Expected Behavior**:
  The application should present one unified, authoritative scheduling framework. If single-grade planning is retained, it should be explicitly positioned as a single-grade sub-mode of the general scheduler rather than a separate mock engine.
- **Evidence**:
  - `frontend/app/(tabs)/schedule.tsx`, Lines 20–25: Presents both "Create General Schedule" and "Create Lesson Plan".
  - `frontend/app/schedule/generated.tsx`, Line 24: `<LocalStatus text="Local mock planner | Works offline; not a live AI scheduling service"/>`.
  - `frontend/src/services/scheduleService.ts`, Line 7: `mockSchedulingEngine: SchedulingEngine = { generate: async payload => generateMockPlan(payload) }`.
- **Classification**: **Partially Wired / UX Defect**.
- **Severity**: **HIGH**.
- **Dependencies & Affected Workflows**:
  - Causes user/reviewer confusion during evaluation regarding which algorithm is the actual research scheduler.
- **Recommended Investigation / Next Area**:
  - Deprecate or unify `mockPlanner.ts` under `generalScheduler.ts`, or clearly designate `General Schedule` as the primary multi-grade copilot workflow on the Planner screen.

---

### FE-004: Missing Visual Graph Component for Knowledge Graph
- **Unique ID**: `FE-004`
- **Capability / Workflow**: Student Knowledge Representation & Visual Graph Inspection.
- **Current Behavior**:
  `frontend/app/students/[id].tsx` renders the student's concept knowledge as a vertical list of rectangular cards (`View style={{ padding: 10, borderRadius: 8... }}`). It displays mastery percentages and warning text banners, but has zero node-and-edge graphical visualization.
- **Expected Behavior**:
  As described in research objectives, the interface should provide a glanceable visual DAG (directed acyclic graph) or interactive tree showing how mastered concepts lead to dependent concepts, and visually highlighting prerequisite bottlenecks.
- **Evidence**:
  - `frontend/package.json`: No visual graph or SVG libraries (`react-native-svg`, `d3`, etc.) are installed.
  - `frontend/app/students/[id].tsx`, Lines 84–110: Slices `data.knowledgeView.concepts` directly into standard `<View>` cards.
- **Classification**: **UI Only (List View)**.
- **Severity**: **MEDIUM**.
- **Dependencies & Affected Workflows**:
  - Weakens the visual demonstration of the curriculum knowledge graph during academic presentations.
- **Recommended Investigation / Next Area**:
  - Implement a lightweight, dependency-free SVG or canvas-based mini-DAG component for student concept trees, or embed a structured visual hierarchy tree.

---

### FE-005: Copilot Context Dropped on Chatbot Navigation
- **Unique ID**: `FE-005`
- **Capability / Workflow**: AI Copilot, Context-Aware Inquiries.
- **Current Behavior**:
  `frontend/src/services/copilotService.ts` defines `buildCopilotRequest(question, context)` accepting `studentId`, `conceptId`, and `screenContext`. However, this function is never imported or called. When screens navigate to `/chatbot`, they pass only `grade` and `prompt`. In `chatRepository.ts`, `prepareMessage()` creates `ChatRequest` containing only `workspace_id`, omitting student, concept, and screen context.
- **Expected Behavior**:
  When a teacher taps "Teaching ideas" on a student's weak concept card, the student ID and concept ID should be passed to `/chatbot` and forwarded in the API payload so the backend can immediately dispatch `op_explain_learning_difficulty` or `op_get_student_concept_state` without relying on string regex parsing of the message text.
- **Evidence**:
  - `frontend/src/services/copilotService.ts`, Lines 28–42: `buildCopilotRequest` defined but orphaned.
  - `frontend/src/services/chatRepository.ts`, Line 53: `const request: ChatRequest = { question: text, grade: grade, subject: "Math", use_llm: true, workspace_id: scope.workspaceId };`.
  - `frontend/app/students/[id].tsx`, Line 115: Only passes `prompt` string in route params.
- **Classification**: **Partially Wired**.
- **Severity**: **MEDIUM**.
- **Dependencies & Affected Workflows**:
  - Degrades copilot intent extraction accuracy; forces backend to guess intent from free text rather than structured context.
- **Recommended Investigation / Next Area**:
  - Update `chatRepository.prepareMessage()` to accept an optional `context` object, and update `chatbot.tsx` to read `studentId` and `conceptId` from route parameters.

---

### FE-006: Absence of Post-Class Outcome & Delivery Tracking
- **Unique ID**: `FE-006`
- **Capability / Workflow**: Post-Class Review, Closed-Loop Tracking.
- **Current Behavior**:
  There is no post-class review step. When a lesson ends, the teacher can manually mark block statuses in `GeneralTimeline.tsx`, but there is no screen or form to record:
  - Which specific students actually received individual attention during the teacher block.
  - Whether unattended groups successfully completed their assigned worksheets or peer activities.
  - New learning observations arising specifically from the conducted lesson.
- **Expected Behavior**:
  A post-class summary screen where the teacher can confirm delivered interventions and log quick assessment checks, directly feeding back into the next day's schedule.
- **Evidence**:
  - `frontend/app/general-schedule/[id].tsx`: Only contains timeline editor; no "Finish Class" or "Post-Class Summary" flow.
- **Classification**: **Missing**.
- **Severity**: **MEDIUM**.
- **Dependencies & Affected Workflows**:
  - Closes the final loop between schedule execution and updated classroom state.
- **Recommended Investigation / Next Area**:
  - Create a lightweight `PostClassReviewModal` that pops up when all blocks are marked complete, allowing rapid multi-student exit-ticket logging.

---

### FE-007: Absence of Session-Level & Mid-Lesson Attendance
- **Unique ID**: `FE-007`
- **Capability / Workflow**: Attendance Tracking & Mid-Class Disruption.
- **Current Behavior**:
  The SQLite `attendance` table is uniquely keyed by `(workspace_id, student_id, date)`. Attendance is recorded once per date per student. If a student leaves early or arrives late during a multi-period day, changing their attendance overwrites the daily record without any timestamped session history.
- **Expected Behavior**:
  The research framework specifies handling mid-session departures. Attendance should support session-specific or time-tagged records.
- **Evidence**:
  - `frontend/src/services/database.ts`, Migration 1, Line 25: `UNIQUE(workspace_id, student_id, date)`.
  - `frontend/src/services/classroomService.ts`, Line 57: `ON CONFLICT(workspace_id, student_id, date) DO UPDATE SET status=excluded.status`.
- **Classification**: **Missing / Schema Limitation**.
- **Severity**: **LOW**.
- **Dependencies & Affected Workflows**:
  - Edge-case scenario for attendance disruption during multi-hour days.
- **Recommended Investigation / Next Area**:
  - Add optional `session_id` or `period` column to `attendance` in a future migration if session-level granularity is required.

---

### FE-008: Lack of In-Bubble Indicator for Fallback / Retrieval-Only Answers
- **Unique ID**: `FE-008`
- **Capability / Workflow**: Copilot UI & RAG Transparency.
- **Current Behavior**:
  When Ollama/local LLM generation is unavailable, the backend returns raw textbook excerpts formatted as markdown blockquotes (`mode: "retrieval-only"`). In the chat UI, this is rendered inside the same standard assistant chat bubble with no visual header or badge indicating that generation is offline.
- **Expected Behavior**:
  The chat bubble should display a clear chip or badge: `[Retrieval Only — Local AI Inactive]`, so teachers and reviewers immediately understand the provenance of the answer.
- **Evidence**:
  - `frontend/app/chatbot.tsx`, Lines 139–144: Renders `item.text` directly through `AssistantMessage` without inspecting `item.mode` or rendering a fallback badge.
- **Classification**: **UX Defect**.
- **Severity**: **LOW**.
- **Dependencies & Affected Workflows**:
  - Reviewer transparency during offline or low-resource demonstrations.
- **Recommended Investigation / Next Area**:
  - Check `message_details.request_json` or add `mode` to `message_details` to display a subtle `"Textbook Excerpt"` chip when `mode === 'retrieval-only'`.

