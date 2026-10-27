# App improvement implementation and validation

Updated: 18 October 2026. Companion checklist: [APP_IMPROVEMENT_PLAN.md](../APP_IMPROVEMENT_PLAN.md).

## Delivered behavior

| Area | Implementation |
| --- | --- |
| API access | Approved bearer sessions own classroom access. Learner requests, contextual chat, and planning validate workspace ownership. Public models reject database paths. |
| Evidence exchange | The phone sends bounded, versioned evidence from its local workspace. Python validates it and adapts it to an isolated in-memory SQLite database for existing reasoning operations. Classroom snapshots are released after each request. |
| Shared estimates | `score-ratio-v1:1` uses recency decay 0.75. Assessment writes, derived states, and compatibility competencies update transactionally. Earlier manual competencies are preserved as explicit legacy assessment records. Planning reconstructs estimates at its evidence date. |
| Reliable explanations | Classroom facts use deterministic response composition. Student-specific graph details include earlier-grade prerequisites. Group explanations expose support/missing-evidence gaps. Intermediate scores are labeled Developing; evidence sufficiency is separate. |
| Allocation | Planner and chat scheduling call the same authenticated Python service when online. `observed-allocation-v1` uses observed assessment pressure, participation, prerequisite gaps, downstream importance, and postponed instruction. Offline/demo schedules use an explicitly labeled local heuristic. |
| Feedback | Post-class review accepts optional scored exit evidence. Stable assessment IDs prevent duplicate records. Outcomes, scores, learner states, schedule status, and session completion commit together. Teacher notes remain notes. |
| Recovery | Backup format 3 includes concept metadata, prerequisite edges, class sessions, attendance events, outcomes, and assessment origins. Restore validates ownership/references, replaces records atomically, and rebuilds learner states. Versions 1/2 remain readable with missing-history warnings. |
| Grades | Grade 5 is supported through account validation, enrollment, SQLite constraints, progress, graph, chat, planning, review, and recovery. Mobile seeds are generated from the canonical CSV files: 84 concepts and 73 edges. |
| Resources | Paired index/metadata artifacts contain 576 chunks across Grades 1-5. Checksums and a coverage manifest detect mismatched artifacts. Grade/subject searches keep their filter when a bucket is empty. |

The production allocation policy is versioned independently of historical simulation results. Simulation and production share the observable pressure calculation; older experimental results do not validate the new complete production policy automatically. Allocation weights and learner thresholds remain parameters requiring educational evaluation.

## Resource provenance and coverage

Grades 1 and 2 each have two reviewed **source summaries**, supplemented by two short Grade 1 excerpts and one short Grade 2 excerpt, authored from the following official NCERT chapters. Summaries are labeled `source_summary`; short verbatim selections are labeled `textbook_excerpt` in metadata and the app.

- Grade 1: [Joyful Mathematics chapter 2](https://ncert.nic.in/textbook/pdf/aejm102.pdf), [chapter 12](https://ncert.nic.in/textbook/pdf/aejm112.pdf).
- Grade 2: [Joyful Mathematics chapter 4](https://ncert.nic.in/textbook/pdf/bejm104.pdf).

The source labels include chapter file, printed page range, source kind, and link. Complete Grade 1-2 chapter extraction and comprehensive concept coverage remain future corpus work. Grades 3-5 retain existing indexed passages. `/health` reports actual indexed coverage by grade and concept; the connection screen displays that coverage. An available curriculum concept does not imply an indexed textbook resource or an assessed learner state.

Reproducible generation, from the repository root:

```powershell
.\venv\Scripts\python.exe scripts/generate_curriculum.py
.\venv\Scripts\python.exe scripts/rebuild_resource_index.py
```

Index rebuilding uses the existing cached `all-MiniLM-L6-v2` embedding model and replaces the index and metadata together. Restart the API after rebuilding. Keep `data/corpus_manifest.json`, the index, and metadata in the same Git change.

## Automated verification

Final results for this implementation:

| Check | Result |
| --- | --- |
| Backend pytest suite with real retrieval and Ollama enabled | 74 passed, plus 7 passing subtests; no skipped tests |
| TypeScript and ESLint | Passed |
| SQLite/database integration | Passed, including Grade 5, student/group graph consistency, feedback idempotence, full recovery and cold reopening |
| Scheduling | 2,856 timing/grade-coverage cases passed |
| Graph, workspace, chat and administrator UI suites | Passed with native/DOM adapters |
| Live frontend services -> Python HTTP -> Ollama | Passed, including named classroom findings and a changed next-plan focus after exit evidence |
| Android Hermes export | Passed; 1,476 bundled modules |
| Physical Android walkthrough | Pending; no connected device |

The test tools emit existing deprecation notices for the FastAPI HTTPX adapter and React test renderer. These notices are separate from failed checks.

### Session timer follow-up

The reported `Completed sessions cannot be changed` rejection exposed a navigation lifecycle bug: the active screen remained mounted behind post-class review and continued its periodic writes. The timer now runs only while the screen is focused, reads refreshed session status on return, and handles rejected progress saves. Completed sessions disable execution controls; the database still rejects late writes without changing completed records.

The expanded workspace UI suite retains the active screen while review completes the session. It covers blur/refocus, elapsed-time recovery, pause/resume, failed block changes, periodic save errors, a pending save that rejects after completion, and no further writes for 60 simulated seconds after return. The original screen fails the new blur assertion; the updated screen passes. TypeScript, ESLint, workspace UI, and SQLite integration checks passed for this follow-up. Physical Android verification remains pending.

### Grade 5 sample roster follow-up

Demo and presentation rosters now contain 40 fictional Indian students: eight per grade across Grades 1-5. Grade 5 uses rolls 01-08 with the same sample-assessment pattern as earlier grades; demo learners also receive sample attendance and observations. Separate one-time Grade 5 markers upgrade existing rosters without reseeding earlier grades. Existing student IDs and grade/roll enrolments take precedence. SQLite integration checks cover fresh rosters, both upgrade paths, existing roll conflicts, assessment history, and preserving edited/deleted students after another launch. TypeScript and ESLint also passed.

The final verification covers:

- Backend account/approval, ownership, snapshot validation, learner reasoning, allocation, real retrieval, and Ollama generation.
- Shared TypeScript/Python estimator fixtures for unknown evidence, assessed zero, history weighting, and threshold boundaries.
- SQLite upgrades, classroom CRUD, rollback, cross-grade student graph explanations, Grade 5 records, idempotent review, complete version 3 backup, older backup handling, and cold reopening after restore.
- Rotation time budgets and grade activities across single-grade and multigrade selections, including Grade 5.
- React screen interactions and administrator-page interactions using native/DOM bridge adapters.
- Live frontend services communicating with an isolated real HTTP server: signup/approval/login, offline records, named classroom findings, Grade 5 planning, exit evidence, changed next-plan focus, recovery, actual RAG/Ollama sources, and logout revocation.
- TypeScript checking, ESLint, and Android Hermes JavaScript export.

Run the backend suite including real cached-model tests:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:CALCMATE_TEST_REAL_RAG='1'
$env:CALCMATE_TEST_LLM='1'
.\venv\Scripts\python.exe -m pytest -q tests
```

The optional real-generation checks require the configured Ollama model, normally `llama3.2:3b`, to be running. Offline environment settings above refer to the cached embedding model; Ollama serves locally.

From `frontend`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:db
npm.cmd run test:scheduling
node tests/curriculum-graph.cjs
npm.cmd run test:admin-ui
npm.cmd run test:chat-ui
npm.cmd run test:workspace-ui
npm.cmd run test:http
.\node_modules\.bin\expo.cmd export --platform android --output-dir .expo/validation-export
```

Automated tests use temporary account/classroom databases and synthetic learner records. They do not reset the user's existing local account database or classroom workspace.

## Remaining verification

ADB reported no connected Android device during this implementation. The Hermes export verifies JavaScript bundling, not APK installation or physical-device behavior. A signed APK build and a device walkthrough remain separate checks.

On a device, verify the new Grade 5 selectors, student-specific graph details, exit-assessment form, source links, native keyboard/scrolling, file picker permissions, offline cold starts, and restore. The recorded walkthrough checkbox in the plan remains pending until that is done.

Passing regression tests establishes the checked behavior. It cannot prove the application has no flaws or establish improved learning outcomes. Full textbook coverage and classroom evaluation remain explicitly bounded work.
