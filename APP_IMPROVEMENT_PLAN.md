# CalcMate App Improvement Plan

Status: Code implemented and automated validation passed. The recorded physical-device walkthrough remains pending. See [implementation and validation](docs/app-improvement-validation.md) for delivered behavior and resource coverage.

This plan turns the recent code review into seven ordered work packages. It complements [PLAN_AHEAD.md](PLAN_AHEAD.md), particularly its requirements for shared learner states, one curriculum representation, connected instructional allocation, and a functioning feedback loop.

## 1. Intended outcome

The completed workflow should be:

**Record attendance and marks -> update learner states -> identify prerequisite gaps -> explain classroom needs -> allocate teacher time -> teach -> record new assessment evidence -> update the next plan.**

Local SQLite remains authoritative for classroom records. Account approval and online intelligence use the Python API. Classroom data sent for reasoning is a bounded request snapshot; implementing this plan does not require a background synchronization service.

## 2. Current flaws and expected improvements

| Area | Current flaw | Expected improvement |
| --- | --- | --- |
| Learner API | Classroom queries accept a server database path without verifying the teacher. | Requests use approved sessions and verified workspace ownership. |
| Backup/restore | Newer prerequisite, learner-state, and class-session data is omitted. | A restored workspace preserves classroom history and reconstructs consistent learner states. |
| Learner states | Some views use the latest mark; others use a weighted assessment history. | Dashboard, student views, graph, Assistant, and planner use the same defined estimate. |
| Assistant and planning | Python searches for a classroom database on the computer; the phone sends identifiers without the required records. | Both features reason from the teacher's actual, current classroom evidence. |
| Graph explanations | Individual student overlays have explanations calculated for a whole grade. | Explanations match the selected student or class and the displayed evidence. |
| Teaching feedback | Review notes are stored, while the UI claims direct influence on future planning. | Scored follow-up evidence updates learner states and influences subsequent planning. |
| Grade coverage | Curriculum data covers Grades 1-5, app flows support 1-4, and textbook passages cover 3-5. | Grade support and resource coverage are consistent and clearly communicated. |

## 3. Implementation order

| Package | Priority | Dependency | Completion gate |
| --- | --- | --- | --- |
| 1. Secure classroom APIs | High | Existing account/session service | Unauthenticated and cross-workspace classroom access is rejected. |
| 2. Complete backup and restore | High | Existing database schema | Full workspace round trip, older backup compatibility, and rollback checks pass. |
| 3. Unify learner-state calculations | High | Package 2 before data backfills | Identical evidence produces identical estimates and labels across consumers. |
| 4. Connect evidence to Assistant and planning | High | Packages 1 and 3 | A phone-recorded assessment changes a grounded answer and relevant planning inputs. |
| 5. Correct graph explanations | Medium | Package 3 | Selecting different students changes explanations according to their own records. |
| 6. Complete the teaching feedback loop | Medium | Packages 2-4 | Follow-up assessment evidence updates the next plan without duplicate records. |
| 7. Align grade and resource coverage | Medium | Packages 2-6 | Grade 5 completes the same workflows; textbook coverage is verified per grade. |

Review packages with their implementation, regression checks, and documentation changes. The checklist distinguishes completed code work from device verification.

## 4. Package 1: Secure classroom APIs

**Problem:** `src/learner_api.py` accepts `db_path`, workspace IDs, and student IDs from callers without account authorization. Contextual `/chat` requests also need an authenticated classroom boundary.

**Implementation**

- [x] Extract a reusable FastAPI dependency around `src/auth_api.py` session validation and its existing transport policy.
- [x] Derive teacher and workspace identity from the approved account session. Reject conflicting workspace identifiers in request bodies.
- [x] Apply this dependency to classroom learner queries, contextual Assistant requests, and the future planning endpoint.
- [x] Remove `db_path` from public request models. Keep any development database adapter behind server configuration and authenticated workspace checks.
- [x] Add authorization headers to the mobile client's classroom requests and retain account-change cancellation behavior.
- [x] Return clear errors for missing, expired, revoked, disabled, or unapproved sessions.
- [x] Define demo behavior explicitly: fictional local demo features remain available; demo identifiers never authorize access to real classroom data.

**Primary files:** `src/auth_api.py`, `src/learner_api.py`, `src/rag_api.py`, `src/api.py`, `frontend/src/services/apiClient.ts`, `frontend/src/services/ragClient.ts`, `frontend/src/services/authService.ts`.

**Acceptance checks**

- [x] An unauthenticated classroom query receives HTTP 401.
- [x] Teacher A cannot request Teacher B's workspace; a forged body does not override the session identity.
- [x] A public request containing a server database path is rejected without opening that path.
- [x] Approved account access, expiry, logout, local HTTP opt-in, and HTTPS behavior remain covered.
- [x] General textbook-only requests have an explicit access policy and cannot trigger classroom database lookups through intent routing.

## 5. Package 2: Complete backup and restore

**Problem:** The current version 2 backup handles the original workspace tables but omits newer records. Restore also writes only the older concept fields.

**Implementation**

- [x] Introduce a version 3 backup contract and retain readers for versions 1 and 2.
- [x] Add `concept_prerequisites`, `class_sessions`, `session_attendance_events`, and `session_outcomes` to workspace snapshots, serialization, validation, and restoration.
- [x] Preserve concept metadata such as learning objectives, coverage status, subject, and active status.
- [x] Define learner states as rebuildable derived data: recompute them from restored assessments using the supported estimator before restore commits. If cached state rows are included, validate their version and rebuild incompatible rows.
- [x] Preserve saved schedule ownership, block IDs/status, and the existing chat/conversation records.
- [x] Restore transactionally in foreign-key order, replacing the complete workspace record set covered by the backup.
- [x] For older backups, initialize missing session history as empty and reconstruct prerequisite relationships from the canonical curriculum. State any unavailable history in the restore result.
- [x] Validate active-session references, student/concept references, grades, numeric ranges, record limits, and workspace ownership before replacement.
- [x] Keep passwords, account sessions, and authentication tokens outside backup files. Teacher reauthentication remains a separate step.

**Primary files:** `frontend/src/services/storageService.ts`, `backupFormat.ts`, `backupService.ts`, `restoreService.ts`, `database.ts`, and `frontend/tests/database.cjs`.

**Acceptance checks**

- [x] Export and restore a workspace containing multiple prerequisite edges, assessments, learner states, an active class, attendance events, outcomes, schedules, and chat history.
- [x] Compare restored source records and recomputed learner estimates; allow derived timestamps to change where documented.
- [x] Older version 1/2 backups restore their supported data with explicit handling of missing newer history.
- [x] A malformed or foreign-workspace backup leaves the original workspace unchanged.
- [x] Restarting after restore shows the expected graph, progress, schedule, and active-class state.

## 6. Package 3: Use one learner-state calculation

**Problem:** `refreshCompetency()` stores the latest score ratio, while `computeMasteryEstimate()` uses a recency-weighted history. Planning and progress can therefore disagree.

**Implementation**

- [x] Adopt the existing `score-ratio-v1` estimator as the initial shared rule, recording its exact formula and version.
- [x] Initially retain recency decay `0.75`, support threshold `0.60`, and readiness threshold `0.70`; describe these as implementation parameters requiring evaluation.
- [x] Use the existing bands consistently: no evidence = `unknown`, below 0.60 = `needs_support`, 0.60 to below 0.70 = the documented intermediate state, and at least 0.70 = `likely_ready`.
- [x] Keep evidence sufficiency separate from the score band. Explain the existing `insufficient` label so users can distinguish intermediate scores from limited evidence.
- [x] Retain raw marks and clearly labeled latest results for teachers, while making learner recommendations consume the shared estimate.
- [x] Make assessment creation, edits, deletion, bulk entry, and derived-state updates atomic within the current workspace.
- [x] Backfill existing workspaces from their assessment history. Preserve manually entered legacy competencies with an explicit migration rule and provenance.
- [x] Update dashboard revision counts, student progress, graph overlays, planning payloads, and scheduling inputs to consume the same learner-state contract.
- [x] Define evidence cutoffs for plans: a historical planning date must not use later assessments. Apply consistent date ordering and tie-breaking.
- [x] Add common fixtures for the TypeScript and Python implementations, including estimator version and numeric tolerance.
- [x] Treat attendance as participation context; mastery updates come from assessment evidence.

**Primary files:** `frontend/src/services/learnerStateService.ts`, `storageService.ts`, `classroomService.ts`, `scheduleService.ts`, `generalScheduler.ts`, `frontend/src/types/planning.ts`, `src/learner_intelligence.py`, and `data/frozen_parameters.md`.

**Acceptance checks**

- [x] Earlier 10% followed by 90% produces approximately 55.7% with the current two-assessment weighting, consistently across consumers.
- [x] No evidence remains unknown; a genuine zero score remains an assessed zero.
- [x] Add/edit/delete/bulk-entry operations update all affected states and visible summaries.
- [x] Failure during an assessment update cannot leave source marks and derived states inconsistent.
- [x] Historical plans exclude future evidence; attendance-only changes do not change mastery.

## 7. Package 4: Connect classroom evidence to Assistant and planning

**Problem:** Python cannot read the phone's SQLite database by searching computer paths. The current local scheduler also has its own allocation formula, separate from the intended research integration.

**Implementation**

- [x] Define a versioned classroom-evidence contract shared by TypeScript and Pydantic. Proposed locations: `frontend/src/services/classroomEvidenceService.ts` and `src/classroom_contracts.py`.
- [x] Include the selected grade(s), relevant student identifiers/display names, assessments, attendance context, prerequisite evidence, planning date, and snapshot/estimator/curriculum versions.
- [x] Build a coherent snapshot inside one scoped local read transaction. Include earlier-grade prerequisite evidence needed for the selected students.
- [x] Send only evidence needed for the request. Keep credentials in authorization headers and omit unrelated notes and classroom history.
- [x] Validate record membership, concept IDs, score ranges, dates, schema versions, and tested byte/record limits. Report oversize or incomplete snapshots explicitly.
- [x] Resolve curriculum relationships against the server's canonical curriculum version and derive learner estimates with the shared rule.
- [x] Refactor classroom copilot operations to use the supplied snapshot instead of `_find_db()` in the mobile request path.
- [x] Return structured findings with the supporting student/concept IDs, evidence cutoff, missing evidence, and limitations. Limit LLM composition to those findings and retrieved textbook sources.
- [x] Extract the intended observed-evidence allocation logic into a reusable Python core; evaluate its suitability from `src/sim/stage4_evaluation.py` before adopting it. Simulation-only true knowledge values must remain outside app inputs.
- [x] Expose that core through an authenticated planning endpoint, for example `POST /planning/general`, using the same evidence contract.
- [x] Make Planner and chat-triggered scheduling call the same planning service. Validate returned duration, ownership, grade activities, and schedule structure before saving.
- [x] Store policy version, evidence revision, and prioritization reasons with each plan. Preserve teacher edits and identify plans based on older evidence.
- [x] Keep existing offline rotations available with an explicit local-heuristic label. Display the engine actually used; online research-policy results and local fallback results have distinct provenance.
- [x] Preserve saved questions and useful retry messages when the API or Ollama is unavailable. Recheck the current session and refresh evidence before a deliberate retry, recording the revision used.

**Primary files:** `frontend/src/services/backendContracts.ts`, `chatRepository.ts`, `ragClient.ts`, `chatService.ts`, `scheduleService.ts`, `generalScheduleService.ts`, `src/rag_api.py`, `src/copilot_contract.py`, `src/copilot_operations.py`, `src/response_composer.py`, `src/learner_api.py`, and `src/sim/stage4_evaluation.py`.

**Acceptance checks**

- [x] A teacher records marks on the phone and asks which students need support; the answer identifies the correct students and evidence without a copied phone database on the computer.
- [x] Missing assessments are reported as unknown, and prerequisite gaps cite the relevant concepts.
- [x] Changing evidence changes the next answer and planning inputs; a controlled allocation fixture also changes the expected priority.
- [x] Planner and chat requests using identical evidence and policy return equivalent allocations.
- [x] Every schedule uses the exact minute budget, has one teacher assignment per instruction block, and provides an activity for every selected grade.
- [x] Missing/expired credentials, malformed snapshots, account changes, network failures, and unavailable models produce actionable outcomes without another account's data appearing.

## 8. Package 5: Correct graph explanations

**Problem:** The graph supports student overlays, but `getConceptExplanation()` accepts only a concept and grade. Its explanation queries the whole class.

**Implementation**

- [x] Introduce an explicit explanation context: curriculum-only, selected student, or selected grade group.
- [x] Pass the selected student ID for individual explanations and use that student's shared learner states.
- [x] Refresh explanations when overlay mode, student, concept, grade, or the underlying evidence revision changes.
- [x] Include relevant prerequisite states across grades in individual overlays and explanations.
- [x] Make group explanations disclose the number assessed and the number with missing evidence. A class mean must retain the distribution and gaps needed for the recommendation.
- [x] Use the same prerequisite-readiness rule for graph explanations and allocation reasons.
- [x] Treat curriculum-only views as structural information until learner evidence is selected.

**Primary files:** `frontend/src/services/curriculumGraphService.ts`, `learnerStateService.ts`, and `frontend/app/curriculum.tsx`.

**Acceptance checks**

- [x] Two students with different prerequisite evidence receive different explanations for the same concept.
- [x] Changing only the selected student refreshes the detail panel.
- [x] Student details, graph colors, evidence counts, and planning reasons agree for the same evidence.
- [x] A prerequisite with no evidence is shown as unknown and prompts a readiness check.

## 9. Package 6: Complete the teaching feedback loop

**Problem:** Post-class review stores delivery records and observations, but its description implies direct influence on mastery and the next plan.

**Implementation**

- [x] Add an optional scored exit assessment to post-class review: student, concept, score, maximum, date, and source session/block.
- [x] Link this evidence to the existing assessment model through additive schema changes and include the link in backups.
- [x] Reuse the shared assessment/state update path. Save outcomes and linked assessments transactionally before concluding the session.
- [x] Give follow-up assessments stable identifiers so saving or retrying a review cannot duplicate evidence.
- [x] Keep free-text observations as teacher notes. Explain which structured inputs influence learning estimates and scheduling.
- [x] Carry incomplete/delayed instruction forward as explicit planning context under a documented rule, separately from mastery.
- [x] Offer generation of a new plan from updated evidence while retaining the delivered plan and teacher edits as history.
- [x] Update UI copy to describe the behavior that has actually been implemented.

**Primary files:** `frontend/app/post-class-review.tsx`, `frontend/app/active-session.tsx`, `frontend/src/services/sessionService.ts`, `storageService.ts`, `learnerStateService.ts`, `database.ts`, and the planning/backup services.

**Acceptance checks**

- [x] A scored exit assessment changes the relevant learner state and a controlled subsequent allocation.
- [x] Saving a note alone preserves mastery while storing the observation.
- [x] Repeated review saves/retries produce one assessment per intended evidence item.
- [x] Interrupted saves leave the session recoverable and its evidence consistent.
- [x] Original schedules, delivery outcomes, and revised plans remain available after restart and backup/restore.

## 10. Package 7: Align grade and textbook coverage

**Problem:** Grades differ between the canonical curriculum, mobile types and SQLite constraints, API validators, and indexed resources.

**Implementation**

- [x] Retain the roadmap's target of Mathematics Grades 1-5 and publish current coverage by grade and concept while expansion is pending.
- [x] Generate or validate mobile curriculum seeds against `data/concepts.csv` and `data/prerequisite_edges.csv`, using stable IDs and verified edge direction.
- [x] Add Grade 5 across domain types, selectors, student enrollment, teacher profiles, account requests, planning, chat, restoration, and backend validation.
- [x] Migrate existing SQLite `CHECK` constraints allowing only Grades 1-4. Rebuild affected tables transactionally where required, preserving keys, indexes, relationships, and existing classroom data.
- [x] Ensure backup readers respect supported schema/grade versions and reject unsupported future formats before replacement.
- [x] Add selected reviewed Grade 1-2 source summaries and short textbook excerpts, source references, concept mappings, and retrieval checks; verify existing Grade 3-5 coverage. Full chapter coverage remains future corpus work.
- [x] Rebuild the vector index and metadata together, recording their corpus/curriculum version.
- [x] Derive retrieval availability from actual indexed coverage. Display source grade and explicitly disclose missing or cross-grade support.
- [x] Keep curriculum availability, assessed learner evidence, and textbook-resource coverage as separate reported properties.

**Primary files:** `data/concepts.csv`, `data/prerequisite_edges.csv`, `data/chapter_manifest.csv`, `data/chunks.csv`, vector-store artifacts, `frontend/src/types/domain.ts`, `frontend/src/services/database.ts`, `demoService.ts`, `workspaceService.ts`, frontend validators/screens, `src/auth_api.py`, `src/rag_api.py`, `src/copilot_contract.py`, `src/copilot_operations.py`, and `src/retrieve.py`.

**Acceptance checks**

- [x] An existing Grade 1-4 workspace upgrades with its records and relationships intact.
- [x] A Grade 5 teacher/student completes signup, approval, enrollment, assessment, graph, Assistant, planning, feedback, and backup/restore workflows.
- [x] Canonical concept IDs and prerequisite edges agree between mobile and Python.
- [x] Coverage checks reflect the actual index; unsupported concepts receive an honest limitation message.
- [x] Reviewed retrieval examples for each grade return correctly attributed resources.

## 11. Validation and delivery

Use isolated synthetic classroom fixtures for automated integration checks and two separate teacher accounts for ownership checks. Avoid tests that overwrite local account/classroom databases.

Extend the existing database, scheduling, graph, copilot, learner API, and HTTP integration suites for each package. Add shared estimator/allocation fixtures and backup round-trip assertions where the current suites lack coverage.

Run relevant checks after each package; run the combined validation before delivery:

```powershell
# From the repository root
.\venv\Scripts\python.exe -m unittest discover -s tests -v

cd frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:db
npm.cmd run test:scheduling
node tests/curriculum-graph.cjs
npm.cmd run test:admin-ui
npm.cmd run test:chat-ui
npm.cmd run test:workspace-ui
npm.cmd run test:http
```

Review HTTP-test runtime/model requirements before running that suite. Report separately which checks use mocks, real HTTP, actual retrieval, and Ollama generation; passing a mocked test does not establish model readiness.

**Final demonstration**

1. Sign in as an approved teacher and open a multigrade classroom.
2. Save attendance and assessments containing a known prerequisite gap.
3. Verify consistent learner states on Home, student progress, and the graph.
4. Ask the Assistant which students need help; compare its evidence with the saved records.
5. Generate a schedule and inspect teacher time, concurrent activities, missing evidence, and prioritization reasons.
6. Teach a block, record an exit assessment, and create a new plan showing the expected response to changed evidence.
7. Restart offline and reopen saved records within the existing session policy.
8. Export and restore the workspace; verify graph relationships, learner states, class history, and saved plans.
9. Repeat the supported workflow for Grade 5 and verify per-grade textbook coverage.

Update `README.md`, `docs/team-handover.md`, the acceptance matrix, and research limitations to match delivered behavior. Include engine/estimator/corpus versions and remaining coverage gaps. Synthetic demonstrations establish integration and controlled behavior; learning-gain or workload claims require suitable classroom evidence.

**Definition of done**

- [x] All seven packages meet their acceptance checks.
- [ ] The full evidence-to-planning-to-feedback workflow passes automated integration checks and a recorded device walkthrough. Automated checks are implemented; ADB found no connected device for the recorded walkthrough.
- [x] Existing account approval, local records, teacher overrides, offline access, and earlier backup compatibility remain verified.
- [x] Documentation accurately distinguishes delivered capabilities from pending research or resource coverage.

Review baseline: the preceding review passed TypeScript checking, existing database tests, and 1,904 scheduling cases. Those results predate this implementation and do not satisfy the new acceptance checks above.
