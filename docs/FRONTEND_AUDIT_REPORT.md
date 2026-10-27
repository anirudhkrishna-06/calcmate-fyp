# CALCMATE — Complete Frontend Architecture & Integration Audit Report

**Document ID**: `CALCMATE-FE-AUDIT-2026-10-17`  
**Audit Type**: Strict Inspection & Non-Destructive Verification (Code-Traced, Runtime-Verified)  
**System**: CALCMATE — Curriculum- and Knowledge-State-Aware Instructional Attention Allocation for Multi-Grade Classrooms  
**Auditor**: Senior Frontend Architect & Systems Integration Auditor  
**Date**: October 17, 2026  
**Status**: Completed  

---

## 1. Executive Summary

> Correction-pass note (2026-10-17): This report predates the current correction pass and contains historical findings that are no longer current, including toy-concept seeding, absent session screens, orphaned copilot context, and the linear-only graph claim. See `FRONTEND_GAP_REGISTER.md` and `FRONTEND_ACCEPTANCE_MATRIX.md` for the revalidated status. The mobile implementation currently supports Grades 1–4; Grade 5 records present in the repository CSV remain outside the mobile schema/scheduler scope.

CALCMATE is conceived as an offline-first, teacher-centric mobile application to support single teachers managing concurrent grade cohorts (primarily Grades 1–4/5) in resource-constrained Indian primary classrooms. This audit evaluates the actual state of the frontend repository located at `frontend/`.

### Core Verdict
The frontend is a functional, locally persistent Expo/React Native application with robust offline SQLite storage, clean TypeScript typings (0 type errors), an extensive test suite (1,904 passing scheduler test cases, 5 passing node test suites), and a functioning production multi-grade rotation scheduler (`generalScheduler.ts`). 

However, the audit identified **critical architectural disconnects and missing workflow phases**:
1. **Curriculum Taxonomy Fragmentation (Critical)**: While `data/concepts.csv` and `src/knowledge_graph.py` define an 84-concept canonical NCERT taxonomy (`M101`–`M518`), the frontend database seed functions in `demoService.ts` and `workspaceService.ts` populate local SQLite with an obsolete 8-concept toy taxonomy (`count`, `add`, `place`, `subtract`, `multiply`, `divide`, `fractions`, `measure`).
2. **Missing Active Class & Post-Class Modes (High)**: There is no "Active Class Mode", session timer, in-flight classroom tracker, or post-class outcome review screen. The teacher can create a schedule and manually edit block status (`planned`, `completed`, `postponed`), but there is no runtime concept of an active teaching session.
3. **Split Planning Architecture (High)**: The UI presents two conflicting scheduling paths: the multi-grade rotation scheduler (`general-schedule/new.tsx` $\to$ `generalScheduler.ts`), which is deterministic and robust, versus a single-grade lesson planner (`schedule/generated.tsx` $\to$ `mockPlanner.ts`), which explicitly labels itself as a "Local mock planner".
4. **Knowledge Graph Visualizer is Linear List (Medium)**: The student knowledge view displays concept status badges and prerequisite warnings, but does not provide an interactive visual DAG/graph view (no SVG/Canvas libraries are installed).
5. **Context Disconnection in AI Copilot (Medium)**: The helper function `buildCopilotRequest()` in `copilotService.ts` is never called. Screens navigating to `/chatbot` pass only `grade` and `prompt`; metadata such as `student_id`, `concept_id`, and `screen_context` are dropped before the HTTP request is dispatched.

---

## 2. Actual Frontend Architecture and Screen Inventory

### 2.1 Technology Stack & Runtime Configuration
- **Runtime & Framework**: Node.js v22.13.1, React Native 0.86.3, React 19.2.3.
- **App Framework**: Expo SDK ~57.0.27 (`expo-router` ~57.0.25).
- **Language**: TypeScript ~6.0.3 (`tsconfig.json` targeting ES2022, bundler module resolution).
- **Local Database**: `expo-sqlite` ~57.0.4 using WAL journal mode and foreign key enforcement.
- **Secure Storage**: `expo-secure-store` ~57.0.4 for session credentials and API endpoint persistence.
- **Math & Text Rendering**: `katex` ^0.19.0, `markdown-it` ^15.0.2, `markdown-it-texmath` ^1.0.0.
- **Visuals/Icons**: `@expo/vector-icons` ^15.1.1 (Ionicons). Noticeably, **`react-native-svg` is absent**.

### 2.2 Navigation Structure & Entrypoints
Navigation is governed by Expo Router file-based routing:
- `app/_layout.tsx`: Root layout with session verification (`RootLayout`), active app state re-validation, and authentication gate guards:
  - Unauthenticated (`!session`): Restricted to `(auth)` stack (`welcome.tsx`, `login.tsx`, `signup.tsx`, `pending.tsx`).
  - Authenticated (`!!session`): Unlocks `(tabs)` and detail modals (`students/[id]`, `general-schedule/[id]`, `chatbot`, `attendance`, `profile`).
- `app/(tabs)/_layout.tsx`: Bottom tab bar with 5 destinations:
  1. `Home` (`(tabs)/index.tsx`)
  2. `Classroom` (`(tabs)/students.tsx`)
  3. `Planner` (`(tabs)/schedule.tsx`)
  4. `Assistant` (`(tabs)/assistant.tsx` embedding `chatbot.tsx`)
  5. `Settings` (`(tabs)/settings.tsx`)

### 2.3 Detailed Screen Inventory

| Screen Route | File Path | Primary Purpose | Key Components | Data Sources | Persistence / Actions | Integration Status |
|---|---|---|---|---|---|---|
| `/` | `app/index.tsx` | App gateway and initial redirect | `Screen`, `AppText` | `authService.getSession()` | Redirects to `/(tabs)`, `/welcome`, or `/pending` | **Implemented & Verified** |
| `/welcome` | `app/(auth)/welcome.tsx` | Initial teacher onboarding | `Button`, `Link` | `pendingAccount()` | Opens demo mode or routes to login/signup | **Implemented & Verified** |
| `/login` | `app/(auth)/login.tsx` | Teacher account login | `TextField`, `Button` | Local secure store + `POST /auth/login` | Authenticates teacher token and pulls profile | **Implemented & Verified** |
| `/signup` | `app/(auth)/signup.tsx` | Teacher registration | `TextField`, `Choices` | `POST /auth/signup` | Submits approval request to school admin | **Implemented & Verified** |
| `/pending` | `app/(auth)/pending.tsx` | Approval polling status | `FormStatus`, `Button` | `GET /auth/approval` | Checks admin inbox approval status | **Implemented & Verified** |
| `/(tabs)/index` | `app/(tabs)/index.tsx` | Daily teacher dashboard | `GradeSelector`, `Section`, `ActionRow` | `classroomService.classroomSummary()` | Displays daily attendance counts, revision needs, next schedule | **Implemented & Verified** |
| `/(tabs)/students` | `app/(tabs)/students.tsx` | Multi-section classroom hub | `ClassroomSections`, `StudentRegister`, `BulkAssessment` | `storageService.loadStudents()`, SQLite | Sub-tabs: Students roster, Attendance, Marks, Progress | **Implemented & Verified** |
| `/(tabs)/schedule` | `app/(tabs)/schedule.tsx` | Planning management | `Section`, `ActionRow`, `GradeSelector` | `scheduleService.getScheduleSummary()`, `listGeneralSchedules()` | Launches multi-grade scheduler or single-grade lesson plan | **Implemented & Verified** |
| `/(tabs)/assistant` | `app/(tabs)/assistant.tsx` | Embedded teacher AI copilot | `ChatbotScreen (embedded=true)` | `chatService`, SQLite `conversations` | Embedded container for conversational assistant | **Implemented & Verified** |
| `/(tabs)/settings` | `app/(tabs)/settings.tsx` | Configuration & backups | `Section`, `ActionRow`, `Button` | `backupService`, `storageService` | Creates/restores JSON database backups; server config | **Implemented & Verified** |
| `/attendance` | `app/attendance.tsx` | Dedicated attendance screen | `AttendanceWorkspace`, `GradeSelector` | `classroomService.attendanceRegister()` | Batch saves student attendance for date | **Implemented & Verified** |
| `/students/[id]` | `app/students/[id].tsx` | Student profile & learning view | `Choices`, `DateField`, `TextField` | `learnerStateService.getStudentKnowledgeView()` | Tabs: Progress, Attendance, Marks, Notes, Edit | **Implemented & Verified** |
| `/students/new` | `app/students/new.tsx` | Student enrollment | `StudentEditor` | `storageService.saveStudent()` | Inserts new student row with roll number check | **Implemented & Verified** |
| `/general-schedule/new` | `app/general-schedule/new.tsx` | Multi-grade rotation planner | `Choices`, `TextField`, `DateField` | `generalScheduleService.createGeneralSchedule()` | Runs `generalScheduler.ts`, saves multi-grade rotation | **Implemented & Verified** |
| `/general-schedule/[id]` | `app/general-schedule/[id].tsx` | Multi-grade rotation timeline | `GeneralTimeline` | `generalScheduleService.loadGeneralSchedule()` | Live block edits, duration changes, block completion | **Implemented & Verified** |
| `/schedule/generated` | `app/schedule/generated.tsx` | Single-grade revision plan | `GradeSelector`, `TextField`, `DateField` | `scheduleService.generateSchedule()` | Uses `mockPlanner.ts` (explicit mock engine) | **Implemented & Verified (Mock)** |
| `/schedule/[id]` | `app/schedule/[id].tsx` | Saved lesson plan view | `PlanTimeline` | `scheduleService.loadSavedPlan()` | Reorder lessons, edit objectives, update status | **Implemented & Verified** |
| `/chatbot` | `app/chatbot.tsx` | Full-screen conversational copilot | `FlatList`, `AssistantMessage`, `Sources` | `chatService.sendMessage()`, `POST /chat` | Saves messages to SQLite; parses RAG sources | **Implemented & Verified** |
| `/connection` | `app/connection.tsx` | Server connection manager | `Card`, `TextField`, `Button` | `apiClient.checkConnection()`, `GET /health` | Configures and tests API bridge URL | **Implemented & Verified** |
| `/profile` | `app/profile.tsx` | Teacher profile editor | `TextField`, `Choices`, `Button` | `storageService.loadTeacher()` | Edits teacher name, school, experience, grades | **Implemented & Verified** |

---

## 3. Capability-by-Capability Audit

### B1. Home / Teacher Dashboard
- **Screen**: `frontend/app/(tabs)/index.tsx`.
- **Findings**:
  - Live local data sourced via `useLocalData(classroomSummary)`.
  - Accurately renders teacher name, school, date, and selected grade (`useGrade` hook).
  - Displays enrolled students, marked attendance, and students needing revision count.
  - Links to attendance (`openClassroom("attendance")`), mark entry (`openClassroom("assessments")`), general multi-grade schedule creation (`/general-schedule/new`), and single-grade lesson planning (`/schedule/generated`).
  - Lists up to 5 students needing revision (`data.revisionStudents`).
  - **Limitation**: The dashboard summarizes data strictly per single selected grade (`grade = 1..4`), rather than providing a unified multi-grade concurrent overview on the home screen.

### B2. Attendance Workflow
- **Screens/Components**: `frontend/app/attendance.tsx`, `frontend/src/components/AttendanceWorkspace.tsx`.
- **Data Flow**:
  1. Teacher selects grade and date.
  2. `attendanceRegister(grade, date)` queries `students` and joins `attendance` on `(workspace_id, student_id, date)`.
  3. Teacher toggles status (`present`, `absent`, `late`) or uses "Mark all present".
  4. Changes are held in local React state (`changes` map) and draft recovery store (`useWorkspaceDraft`).
  5. Teacher clicks "Save attendance". `saveClassAttendance()` executes a transaction inserting/updating rows with `ON CONFLICT(workspace_id, student_id, date)`.
- **Audit Points**:
  - **Persistence**: 100% persisted to local SQLite; survives restarts and navigation.
  - **Attendance vs. Mastery Separation**: Verified. Absences do NOT mutate `learner_concept_states` or competencies.
  - **Session-Level Attendance**: **MISSING**. The table schema only records a single date (`YYYY-MM-DD`). There is no session ID, period, or timestamped history for students leaving mid-class.

### B3. Pre-Class Planning
- **Screens/Components**: `frontend/app/general-schedule/new.tsx`, `frontend/app/schedule/generated.tsx`.
- **Data Flow**:
  - Teacher specifies available time ($M \in [5, 480]$ minutes), selects grades (e.g. Grades 2, 3, 4), and priority (`balanced` vs `learning-needs`).
  - `createGeneralSchedule()` reads `PlanningPayload` for each grade from SQLite.
  - Calls `buildGeneralSchedule()` in `generalScheduler.ts`.
  - Determines grade instructional priorities by inspecting weak student counts ($v < 0.60$) and unassessed counts, factoring out absent students.
  - Topologically prioritizes prerequisite concepts over dependent concepts.
  - Allocates teacher time and generates differentiated concurrent tasks for unattended groups.
- **Audit Points**:
  - Deterministic and reproducible. Verified across 1,904 automated unit tests.
  - **Gap**: Displays recommendations clearly, but does not provide direct links to open external NCERT textbook PDFs from the pre-class plan view.

### B4. Start Class / Active Class Mode
- **Status**: **MISSING / NOT IMPLEMENTED**.
- **Audit Findings**:
  - There is no "Start Class" button, active session runner, or running timer.
  - Navigating to a schedule (`/general-schedule/[id]`) opens `GeneralTimeline.tsx`, which allows reviewing and manually editing block statuses (`planned`, `completed`, `postponed`), but does not track elapsed time, active phase, or real-time transitions.
  - If a student leaves midway through a lesson, the teacher must navigate back to `Classroom -> Attendance`, change the daily record, and return; there is no mid-session attendance event logging.

### B5. Scheduler During Class
- **Screens/Components**: `frontend/app/general-schedule/[id].tsx`, `frontend/src/components/GeneralTimeline.tsx`.
- **Data Flow**:
  - Sourced from SQLite `schedules` table where `kind = 'general-schedule'`.
  - Displays opening number talk, sequential instructional blocks, transitions, and closing exit checks.
  - Each block displays:
    - Teacher allocation (`Teacher -> Grade X` with rationale and target concept).
    - Concurrent grade activities (e.g. Grade 2 pair practice, Grade 3 independent worksheet).
  - Teacher can click "Edit block" to override duration, teacher activity, and grade-specific tasks.
  - Saves updates via `saveGeneralBlocks()` in `generalScheduleService.ts`.
- **Audit Points**:
  - **Teacher Override Integrity**: Overrides persist in SQLite.
  - **Future Influence**: Overriding a scheduled block does NOT retrospectively alter the algorithm's mathematical weights; it updates the stored plan record for that day.
  - **Dual Engine Confusion**: Teachers might inadvertently use `/schedule/generated` instead of `/general-schedule/new`, leading them to the mock planner.

### B6. Individual Student Knowledge Graph
- **Screens/Components**: `frontend/app/students/[id].tsx`.
- **Data Flow**:
  - Calls `getStudentKnowledgeView(studentId)` in `learnerStateService.ts`.
  - Fetches student row, all grade concepts, `learner_concept_states`, and prerequisite edges from `concept_prerequisites`.
  - Computes `prerequisite_gap = true` if any direct prerequisite has state `unknown` or `needs_support`.
- **Audit Findings**:
  - Concept cards display mastery percentage, status label (`Likely ready`, `Needs revision`, `Insufficient evidence`, `Unknown`), evidence sufficiency, and warning banner: `⚠️ Prerequisite Gap: Foundational concepts need revision before advancing.`
  - **Visual Representation**: **UI IS A LINEAR CARD LIST, NOT A GRAPH**. There is no visual node-and-edge interactive diagram or canvas.
  - **Taxonomy Mismatch**: If seeded with `conceptSeed`, student states map to `count`, `add`, etc., rather than canonical `M101`–`M425`.

### B7. Assessments and Learning Evidence
- **Screens/Components**: `frontend/app/students/[id].tsx` (single student mark entry), `frontend/src/components/BulkAssessment.tsx` (class bulk mark entry).
- **Data Flow**:
  1. Teacher enters score and maximum score.
  2. Input validated: $0 \le \text{score} \le \text{maximum} \le 1000$.
  3. `storageService.saveAssessment()` or `saveClassAssessments()` writes to `assessments` table.
  4. Calls `updateLearnerConceptState(studentId, conceptId)`.
  5. `computeMasteryEstimate()` executes Score-Ratio-v1:
     $$\hat{\theta} = \frac{\sum (s_i / m_i) \cdot 0.75^i}{\sum 0.75^i}$$
  6. Upserts row into `learner_concept_states` in SQLite.
  7. Updates legacy `competencies` table for backward compatibility.
- **Audit Points**:
  - Verified atomic persistence.
  - Updates reflect immediately across student detail screen, classroom progress screen, and subsequent schedule calculations.

### B8. Complete Class / Post-Class Review
- **Status**: **PARTIALLY WIRED / MANUAL ONLY**.
- **Audit Findings**:
  - In `GeneralTimeline.tsx`, teacher can set block statuses to `completed` and click "Save changes".
  - In `PlanTimeline.tsx`, teacher can set lesson status to `completed` and click "Save lesson changes".
  - **Missing**: No structured "Complete Class" summary modal, no recording of which individual students received teacher direct attention, and no automated delta report showing what changed after class.

### B9. AI Copilot — Classroom and Mathematics Questions
- **Screens/Components**: `frontend/app/chatbot.tsx`, `frontend/src/services/chatService.ts`, `frontend/src/services/ragClient.ts`.
- **Data Flow**:
  - Teacher inputs question or selects prompt pill.
  - `chatRepository.prepareMessage()` inserts pending row in `messages` and `message_details`.
  - Dispatches `POST /chat` to FastAPI bridge.
  - Backend extracts intent and dispatches to one of 11 operations in `copilot_operations.py`.
  - Returns `ChatResponse` with `answer`, `chunks`, `intent`, `evidence_found`, `graph_finding`, `schedule_action`.
  - If `schedule_action` is returned (`invoke_local_scheduler`), `chatService.ts` automatically calls `createGeneralSchedule()` locally and embeds an interactive `ScheduleCard` directly inside the conversation stream!
- **Audit Points**:
  - Fully functional end to end when FastAPI server is running.
  - Graceful degradation: If server is offline, clear banner is displayed (`Offline. Saved chats remain available.`), and failed questions offer a "Retry" button.
  - **Gap**: `copilotService.buildCopilotRequest()` is orphaned; `student_id` and `concept_id` context fields are not packaged into `request_json`.

### B10. NCERT RAG and Learning Resources
- **Components**: `frontend/app/chatbot.tsx` (`Sources` sub-component), `AssistantMessage.tsx`.
- **Audit Findings**:
  - When backend returns retrieved chunks, `chatbot.tsx` renders an expandable source drawer: `X retrieved source(s) [+]`.
  - Expanding displays textbook file name (e.g. `fractions_grade4.txt`), grade, fallback warning if retrieved cross-grade, and raw textbook passage.
  - `AssistantMessage` uses `markdown-it` and `KaTeX` to render mathematical formulas, markdown tables, and lists.
  - **Limitation**: Indexed corpus is strictly NCERT Mathematics Grades 3–5 (569 chunks). Grade 1 and 2 queries have no textbook text in the vector store and return graph/curriculum explanations only.

### B11. Authentication, Offline Use, and Data Consistency
- **Services**: `frontend/src/services/authService.ts`, `apiClient.ts`, `database.ts`.
- **Audit Findings**:
  - **Demo Mode**: 100% offline; requires no server; seeds local demo workspace.
  - **Real Teacher Accounts**:
    - Signup and login require connection to school server or private LAN.
    - Server verifies approval status via admin workflow.
    - Once logged in, cached teacher token allows offline access for 24 hours.
    - Revocation queue: If teacher logs out while offline, revocation token is saved in `expo-secure-store` and flushed automatically upon reconnection.
  - **Data Scoping**: Every table enforces `workspace_id` scoping with cascade delete on workspace destruction.

### B12. Navigation and UX Consistency
- **Audit Findings**:
  - Navigation between Home, Classroom, Planner, Assistant, and Settings is fluid via bottom tabs.
  - Clean visual design using consistent color palette (`colors.forest`, `colors.ivory`, `colors.sage`, `colors.charcoal`).
  - Forms implement dirty checking and warn on unsaved navigation (`useUnsavedChanges` hook).
  - **Defect/Risk**: Terminology split between "General Schedule" (multi-grade rotation) and "Lesson Plan" (single-grade mock plan).

---

## 4. Frontend-to-Backend Integration Matrix

| Capability | Frontend Entry Point | Frontend Service / Function | Persistence / API | Backend Route / Service | Actual Data Flow | Status | Evidence / Gap |
|---|---|---|---|---|---|---|---|
| **Teacher Signup** | `/signup` | `authService.signUp()` | `expo-secure-store` | `POST /auth/signup` | Form $\to$ API $\to$ Admin inbox | **Implemented & Verified** | `tests/http-integration.cjs` passes |
| **Teacher Login** | `/login` | `authService.signIn()` | `expo-secure-store` + SQLite | `POST /auth/login` | Form $\to$ API $\to$ Session token saved | **Implemented & Verified** | Verified in auth suite |
| **Account Approval Check** | `/pending` | `authService.checkApproval()` | `expo-secure-store` | `GET /auth/approval` | Polls approval tracking token | **Implemented & Verified** | Verified in admin/auth suites |
| **Server Health Check** | `/connection` | `apiClient.checkConnection()` | None | `GET /health` | Fetches RAG/Ollama status | **Implemented & Verified** | Displays connection and model status |
| **Classroom Summary** | `/(tabs)/index` | `classroomService.classroomSummary()` | SQLite `students`, `attendance`, `competencies` | None (Local SQLite) | Direct SQLite aggregation queries | **Implemented & Verified** | Dashboard renders live counts |
| **Mark Attendance** | `/attendance` | `classroomService.saveClassAttendance()` | SQLite `attendance` | None (Local SQLite) | Batch insert `ON CONFLICT` | **Implemented & Verified** | Persists across app reboots |
| **Bulk Assessment Entry** | `/(tabs)/students` (Marks tab) | `storageService.saveClassAssessments()` | SQLite `assessments`, `learner_concept_states` | None (Local SQLite) | Recomputes Score-Ratio-v1 on save | **Implemented & Verified** | Verified in `database.cjs` |
| **Individual Student Knowledge View** | `/students/[id]` | `learnerStateService.getStudentKnowledgeView()` | SQLite `learner_concept_states`, `concept_prerequisites` | None (Local SQLite) | Local DB join & prereq gap flags | **Implemented & Verified** | Renders cards & gap warnings |
| **Multi-Grade Schedule Creation** | `/general-schedule/new` | `generalScheduleService.createGeneralSchedule()` | SQLite `schedules` | None (Pure Local TS Engine) | Reads evidence $\to$ `generalScheduler.ts` $\to$ saves JSON | **Implemented & Verified** | 1,904 test cases passing |
| **Multi-Grade Schedule Override** | `/general-schedule/[id]` | `generalScheduleService.saveGeneralBlocks()` | SQLite `schedules` | None (Local SQLite) | Mutates block array $\to$ updates SQLite row | **Implemented & Verified** | Validates duration & order |
| **Single-Grade Lesson Plan** | `/schedule/generated` | `scheduleService.generateSchedule()` | SQLite `schedules` | None (Local Mock) | Calls `mockPlanner.generateMockPlan()` | **Implemented (Mock Engine)** | Labels itself as mock in UI |
| **AI Copilot Message Send** | `/chatbot`, `/(tabs)/assistant` | `chatService.sendMessage()` | SQLite `messages`, `message_details` | `POST /chat` | Saves pending $\to$ API request $\to$ saves response | **Implemented & Verified** | Verified in `http-integration.cjs` |
| **Copilot Schedule Action** | `/chatbot` | Handled in `chatService.ts` | SQLite `schedules`, `message_details` | `POST /chat` returning `schedule_action` | Backend signals $\to$ triggers `createGeneralSchedule()` | **Implemented & Verified** | Generates inline `ScheduleCard` |
| **Copilot Context Binding** | `copilotService.ts` | `buildCopilotRequest()` | None | None | **ORPHANED CODE** | **Partially Wired / Dead Code** | Function defined but never invoked |
| **Learner Intelligence Backend API** | None in UI | None in UI | Local SQLite | `POST /learner/*` | Backend endpoints exist in `learner_api.py` | **Backend Only** | Frontend does not call Python learner API |
| **Active Class Runner** | None | None | None | None | None | **Missing** | No active class screen or timer |
| **Post-Class Delta Review** | None | None | None | None | None | **Missing** | No post-class delivery review |
| **Visual Knowledge Graph** | `/students/[id]` | None (Card list) | None | None | None | **UI Only (List Form)** | No SVG/Canvas interactive network |

---

## 5. End-to-End Critical Workflow Traces

### Trace 1: Taking Attendance and Reopening
`Teacher taps "Mark attendance" on Home` $\to$ `router.push({pathname: "/students", params: {section: "attendance"}})` $\to$ `AttendanceWorkspace` mounts $\to$ `attendanceRegister(grade, date)` reads students and existing attendance from SQLite $\to$ Teacher marks students present/absent $\to$ `useWorkspaceDraft` stores draft in `app_meta` $\to$ Teacher clicks "Save attendance" $\to$ `saveClassAttendance()` writes to SQLite $\to$ Reloads register $\to$ Teacher navigates back $\to$ `HomeScreen` re-mounts $\to$ `classroomSummary()` reflects updated present/recorded count $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 2: Mid-Session Attendance Update
Teacher in middle of day wants to mark student absent $\to$ Navigates to `Classroom -> Attendance` $\to$ Changes status from `present` to `absent` $\to$ Clicks Save $\to$ SQLite `attendance` row updated $\to$ **Limitation**: The original timestamp of arrival is lost; no session history exists $\to$ **STATUS: FUNCTIONAL FOR DAILY ATTENDANCE, SESSIONS MISSING**.

### Trace 3: Recording Assessment and Updating Knowledge State
Teacher opens student `Priya Sharma` (`/students/[id]`) $\to$ Switches to "Marks" tab $\to$ Selects concept, enters score `4/10` $\to$ Clicks "Save assessment" $\to$ `storageService.saveAssessment()` runs $\to$ Inserts into `assessments` $\to$ Calls `updateLearnerConceptState()` $\to$ `computeMasteryEstimate()` computes $\hat{\theta} = 0.40$ (`needs_support`) $\to$ Upserts `learner_concept_states` $\to$ `StudentDetailsScreen` reloads $\to$ Progress tab displays `40% (Needs revision)` $\to$ Downstream concepts show `⚠️ Prerequisite Gap` $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 4: Viewing Individual Student Concept Knowledge
Teacher opens `/students/[id]` $\to$ `getStudentKnowledgeView(id)` runs $\to$ Fetches concepts, states, and prerequisites $\to$ Renders concept cards with mastery percentage and prerequisite gap alerts $\to$ **STATUS: VERIFIED & WORKING (AS CARD LIST)**.

### Trace 5: Requesting a Multi-Grade Schedule
Teacher taps "Create schedule" on Home $\to$ Navigates to `/general-schedule/new` $\to$ Selects Grades 2, 3, 4, 90 mins, `learning-needs` $\to$ Clicks "Create schedule" $\to$ `createGeneralSchedule()` reads `PlanningPayload` from SQLite $\to$ `buildGeneralSchedule()` executes deterministically $\to$ Inserts into `schedules` $\to$ Redirects to `/general-schedule/[id]` $\to$ `GeneralTimeline` renders rotation blocks and differentiated activities $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 6: Starting and Completing a Class
Teacher navigates to `/general-schedule/[id]` $\to$ Reads timeline $\to$ **GAP**: There is no "Start Class" button or session tracker $\to$ Teacher manually marks blocks `completed` $\to$ Clicks "Save changes" $\to$ Updates SQLite row $\to$ **STATUS: PARTIAL (MANUAL STATUS TOGGLE ONLY)**.

### Trace 7: Asking Learner-Specific Question in Copilot
Teacher opens `/chatbot` $\to$ Types *"Who is struggling with fractions in Grade 4?"* $\to$ `sendMessage()` inserts pending message $\to$ Sends `POST /chat` with `question`, `grade: 4`, `workspace_id` $\to$ FastAPI `_run_copilot_pipeline()` $\to$ `extract_intent()` classifies `FIND_STUDENTS_BY_CONCEPT` $\to$ `op_find_students_by_concept()` queries SQLite `learner_concept_states` $\to$ `compose_deterministic()` formats answer $\to$ Response returned $\to$ Chat screen renders formatted student list $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 8: Asking Mathematics Question with NCERT Retrieval
Teacher asks *"What are equivalent fractions?"* (Grade 4) $\to$ `POST /chat` $\to$ Classifies `GENERAL_QUESTION` $\to$ `op_general_question()` $\to$ Calls `retriever.retrieve("equivalent fractions", grade=4)` $\to$ FAISS finds 3 chunks in `fractions_grade4.txt` $\to$ Returns chunks and answer $\to$ Chat UI renders answer and expandable `Sources` drawer $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 9: Applying and Persisting a Teacher Override
In `/general-schedule/[id]`, teacher clicks "Edit block" on Slot 2 $\to$ Changes duration from 16 to 20 minutes $\to$ Edits activity text $\to$ Clicks "Save changes" $\to$ `saveGeneralBlocks()` validates total time and saves to SQLite $\to$ Reopening schedule reloads overridden blocks $\to$ **STATUS: VERIFIED & WORKING**.

### Trace 10: Handling Backend / Network Failure
Teacher disconnects from Wi-Fi $\to$ NetInfo sets `offline = true` $\to$ Chatbot displays offline notice banner $\to$ Teacher asks a question $\to$ `requestRag()` throws clear offline error $\to$ Message status marked `failed` $\to$ UI displays retry button $\to$ Classroom records, rosters, marks, and scheduler remain 100% operational $\to$ **STATUS: VERIFIED & WORKING**.

---

## 6. Test and Verification Results

All tests were directly executed during this audit session:

| Test Suite / Command | Execution Scope | Result | Observed Output / Evidence |
|---|---|---|---|
| `npm --prefix frontend run lint` | ESLint & Expo lint rules | **PASS (Code 0)** | 0 lint errors, clean exit. |
| `npm --prefix frontend run typecheck` | TypeScript static type check (`tsc --noEmit`) | **PASS (Code 0)** | 0 type errors across entire frontend. |
| `node frontend/tests/scheduling.cjs` | Multi-grade rotation scheduler tests | **PASS (Code 0)** | **1,904 rotation timing/coverage cases passed**. |
| `node frontend/tests/database.cjs` | SQLite offline CRUD, migrations, rollbacks | **PASS (Code 0)** | All offline CRUD, bulk marks rollback, attendance passed. |
| `node frontend/tests/chat-ui.cjs` | Chatbot component rendering, sources, composer | **PASS (Code 0)** | UI composer, prompt focus, retry, source rendering passed. |
| `node frontend/tests/workspace-ui.cjs` | Classroom UI navigation, forms, attendance | **PASS (Code 0)** | Auth guards, attendance/undo/save, marks recovery passed. |
| `node frontend/tests/admin-ui.cjs` | Admin web console and teacher approval | **PASS (Code 0)** | DOM/fetch adapters, search, bulk approval passed. |
| `node frontend/tests/http-integration.cjs` | Live HTTP bridge, signup, RAG retrieval | **PASS (Code 0)** | Full-stack HTTP integration, live RAG sources passed. |

---

## 7. Confirmed Defects and Incomplete Wiring

1. **Toy Taxonomy in Seeding Functions (`demoService.ts:101`, `workspaceService.ts:10`)**:
   - `demoService.ts` defines `canonicalConceptSeed` (`M101`–`M425`), but the seeding loop explicitly iterates over `conceptSeed` (8 toy concepts).
   - This breaks concept ID continuity between the mobile database and the Python backend canonical knowledge graph.
2. **Orphaned Copilot Context Builder (`copilotService.ts:28`)**:
   - `buildCopilotRequest` is exported but never imported or called anywhere.
   - Screen context, student ID, and concept ID are never attached to `ChatRequest`.
3. **Split Scheduling Engines**:
   - Two separate schedule generation screens exist with conflicting methodologies: `general-schedule/new.tsx` (real multi-grade engine) vs `schedule/generated.tsx` (mock single-grade planner).
4. **Non-Existent Active Class Phase**:
   - There is no active lesson runtime screen or session state machine in the app.
5. **No Visual Knowledge Graph Component**:
   - The knowledge graph view is a text-based card list; no graph visualization rendering exists.

---

## 8. Implemented vs. Promised Functionality Matrix

| Promised Feature (from Roadmap / FYP Objectives) | Actual Status in Repository | Technical Evidence |
|---|---|---|
| **Multi-Grade Teacher Copilot** | **Implemented & Verified** | 11 intent operations, FastAPI bridge, RAG fallback |
| **Deterministic Multi-Grade Scheduler** | **Implemented & Verified** | `generalScheduler.ts`, 1904 passing tests |
| **Offline-First SQLite Architecture** | **Implemented & Verified** | 5 migrations, WAL mode, foreign keys, transaction safety |
| **Score-Ratio-v1 Knowledge Estimator** | **Implemented & Verified** | Numerical parity between Python and TypeScript verified |
| **Prerequisite Deficit Warnings** | **Implemented & Verified** | Warnings rendered on student concept cards |
| **Teacher Timeline Overrides** | **Implemented & Verified** | Live editing and persistence in `GeneralTimeline.tsx` |
| **Canonical NCERT Seeding in Mobile SQLite** | **PARTIALLY WIRED (Defect)** | Seed loop still uses 8 toy concepts; canonical array unused |
| **Interactive Visual Concept Graph** | **UI ONLY (List View)** | Rendered as card list; no interactive SVG/Canvas graph |
| **Active Class Mode / Session Runner** | **MISSING** | No active session entity, timer, or in-class execution view |
| **Post-Class Outcome & Delta Review** | **MISSING** | No post-class summary of delivered interventions |
| **Session-Level Attendance Tracking** | **MISSING** | Daily attendance only; no session or time-of-day history |

