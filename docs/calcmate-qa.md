# Calcmate Integration QA

## Account and Workflow Follow-up (2026-10-10)

This follow-up supersedes the authentication, logout and recovery limitations in the earlier snapshot below. It reuses the existing frontend and dependencies, and leaves original retrieval/model/knowledge-graph algorithms unchanged.

- Implemented Welcome, explicit demo banner/Exit demo, signup, pending operator approval, approved login and Logout. The separate account SQLite service uses salted scrypt, hashed server tokens, persistent rate limiting and a fixed 24-hour cached session policy. Passwords are not saved on the device or included in validation errors/backups.
- Added grade-aware Home actions, transactional whole-class attendance, focused student sections, clearer planning steps, atomic matching-workspace backup restoration and friendly chat delivery errors/connection diagnostics.
- Latest TypeScript, ESLint, database, workspace-screen and chat-screen tests passed. Database tests include zero HTTP classroom operations, seed idempotence, restart persistence, attendance rollback, backup restoration/rollback/isolation and refusal to send account credentials over LAN HTTP. Screen tests adapt native bridges and are not pixel/device tests.
- All eleven Python tests passed, including actual retrieval and Ollama generation using cached embeddings and llama3.2:3b. Expo Doctor passed 21/21 checks; installed Expo dependency validation reported up to date with its offline-mode caveat. No dependency version upgrades were made.
- Latest live HTTP integration passed actual signup, operator approval, login, offline database reopen, RAG/Ollama answer/source persistence and server logout revocation. Early reruns during native compilation hit the fixture's 120-second cold-model startup deadline, including outside the network sandbox. The fixture now captures runtime diagnostics and allows a bounded 300-second cold startup (`CALCMATE_TEST_STARTUP_MS` override). The actual frontend's 90-second chat request timeout was not extended. Cold backend initialization may still require Retry.
- Android Metro bundle returned HTTP 200 (9,764,688 bytes). Native prebuild passed without dependency version changes. The initial universal release build failed at D8 DEX merging with the generated 2 GB Java heap; retry with a 4 GB heap/two workers succeeded in 3m58s using cached compilation and a fresh final JavaScript bundle. The Expo build-memory plugin was verified through config introspection; Doctor passed 21/21 again afterward.
- APK: `frontend/android/app/build/outputs/apk/release/app-release.apk`, 107,620,232 bytes. ZIP inspection confirms 3,686,516 bytes of bundled JavaScript, twenty bundled fonts and four native architectures. AAPT confirms package `org.calcmate.teacher` and a launchable MainActivity. This proves packaging, not rendered Android launch. The APK uses development signing, not a production distribution key.
- No physical device is attached. The alternate Medium Phone emulator refused ADB authorization, so native visual/keyboard/airplane-mode/file-picker acceptance remains unverified.
- Account API remains bound to 127.0.0.1, per user preference. Phone signup/login requires a trusted HTTPS server; none is provisioned. Expo LAN preview is independent of that account restriction. No production-readiness claim is made.

Start commands, operator approval, offline security policy, APK build and a short Android acceptance walkthrough are in [account and Android setup](account-and-android-setup.md).

## Earlier Snapshot

Verification date: 2026-10-10. Changes in this pass are limited to regression tests and this record; no application components, dependencies or backend algorithms were changed. Existing research-log changes were preserved.

## Results

| Area | Evidence and result |
| --- | --- |
| TypeScript / ESLint | `npm.cmd run typecheck` and `npm.cmd run lint` passed, including the final rerun. |
| Expo configuration | `npx.cmd expo config --type public` succeeded; installed dependency check reported up to date (offline-mode caveat); `npx.cmd --yes expo-doctor` passed 21/21 checks. |
| Android bundle | CI-mode Metro started on port 8082. Android entry bundled 1,628 modules; HTTP bundle request returned 200 with 9,682,179 bytes. This is not proof of native app launch. |
| Navigation | Code inspection confirms protected Login/Signup, Home/Students/Schedule/Settings tabs, Chat, Profile, Student Details/Add and generated/saved plan routes. Native navigation taps remain unverified. |
| Demo and dashboard | Actual SQLite tests passed: 32 initial students, 8 per grade, no reseeding duplicates, initial attendance/revision totals, and totals updated after student/attendance changes. Initial attendance expectations apply to the seed date. |
| Local persistence / offline | Actual migrations and repositories ran against Node SQLite with Expo native bridges adapted. Zero HTTP calls during classroom CRUD, profile updates, planning and backup. Database close/reopen retained edited students, profile, attendance, assessments, competency, observations and plans. These are not native airplane-mode tests. |
| Authentication policy | Signup/login reject unavailable server authentication. Unapproved, missing-token, missing/invalid-expiry and expired cached sessions are rejected. Synthetic approved, unexpired cached sessions access only their owned workspace; this does not demonstrate real server authentication. Demo access is device-local without an expiry. Session credentials use SecureStore; raw passwords are not stored. |
| Schedule | Tests passed for current SQLite evidence (including a competency edit), deterministic prerequisite ordering, differing strong/weak/missing evidence, absent students, saved plan restoration and workspace isolation. Plans remain explicitly DEMO/MOCK. |
| Backup | Version-2 JSON serialization, parsing, scoped contents, credential-key exclusion, cancelled/failed selection and read-back verification passed with the file bridge mocked. Native folder selection/write is unverified; backup restore is not implemented. |
| Chat | SQLite conversation/message/source restoration, offline history, interrupted requests, retry without duplicate user messages, pending guards, HTTP 422/500/503, network/timeout/invalid JSON/source errors passed. Actual screen tests passed with native bridges mocked. |
| Python API | Seven unittest tests passed, including real retrieval and Ollama generation through FastAPI TestClient using cached embeddings and `llama3.2:3b`. Health, schema, CORS and redacted errors passed. This pass did not verify phone-to-server networking. |
| Backend / restricted UI | `git diff -- src` was empty. Frontend source inspection found no knowledge-graph surface or logout action. RAG algorithms were not rewritten. |
| Android usability | Existing shared theme, wrapping choices, compact lists and chat keyboard structure inspected. Pixel-level layout, actual keyboard avoidance, MathML and accessibility remain device checks. |

Non-failing tool warnings: react-test-renderer deprecation, FastAPI/Starlette httpx deprecation, and an Ollama socket ResourceWarning. No dependency upgrades were made for these warnings.

## Native Blocker

No physical Android device was attached. The existing Pixel 5 emulator was cold-booted without wiping data and Expo Go was invoked. Android UI inspection returned a null root node; shared storage returned permission denied and Android's Bluetooth process logged a native abort. A screenshot eventually captured through `/data/local/tmp` was entirely black. A rendered Calcmate screen could not be verified. Metro and the QA emulator were stopped afterward. Native launch and device usability are not marked passed.

## Start

From the repository root, using the already installed Python environment and available Ollama model:

```powershell
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m uvicorn src.rag_api:app --host 0.0.0.0 --port 8000
```

In another terminal:

```powershell
cd frontend
# Emulator address; for a physical phone use the computer's actual LAN IPv4.
$env:EXPO_PUBLIC_API_BASE_URL='http://10.0.2.2:8000'
npm.cmd start
```

The Python API is an unauthenticated development bridge, not a production deployment. The phone must reach the computer on the same network with port 8000 allowed by the firewall. Never use localhost as the physical phone's API address. Real teacher signup/approval still has no backend endpoint.

## Physical Android Walkthrough

1. Launch in compatible Expo Go or an installed native build. Before entering demo, submit valid-format Login and Signup inputs: both must report unavailable authentication/approval, never open a real workspace. Enter Explore Demo. A fresh workspace should show 32 students, 8 per grade; existing demo edits must not be reset.
2. Tap each Home, Students, Schedule and Settings tab, then Home's teacher profile and Curriculum chat links. Use Back to return. Confirm no logout action or knowledge-graph view. Check long names and form labels on a small Android screen and with increased system text size.
3. Open a student, edit the name, save today's attendance, add a Maths assessment and observation. Edit the teacher profile. Force-stop/reopen without clearing app data; verify each saved value and dashboard/grade totals. Relaunch again and confirm no duplicate demo records.
4. Enable airplane mode and disable Wi-Fi. Search/filter/add/edit students, save attendance/assessment/competency/observations/profile, and create a schedule for a grade with students. Review actual evidence and missing-information summary, generate a DEMO/MOCK plan and inspect prerequisite reasons/durations. Change evidence and create another plan to verify the new payload. Reopen saved plan history offline.
5. Settings > Create Backup: choose a writable external folder, then repeat and cancel. Open the exported file outside the app, parse it as JSON, confirm format `calcmate-workspace`, version 2 and workspace records including plans/chat. Verify no session/token/password fields are exported. Test an unwritable destination if available.
6. Offline, open existing chat history and switch conversations. Submit a new question: it must save with an unavailable/retry error, not generate a fake answer. With networking restored and API running, retry; the original user message must remain single. Confirm the actual answer/source panels, New Chat/history restoration, pending duplicate guard, Markdown/code/math and scrolling. Open the multiline keyboard: send controls and latest messages must remain reachable. Stop the API and submit again to verify the saved network error.
7. For a true airplane-mode cold-start test, use an installed build containing its JavaScript bundle. A Metro-dependent Expo Go preview is not evidence of standalone offline startup. Force-stop/reopen that build in airplane mode and verify local records, schedule history and chat history. Do not clear storage or uninstall between persistence checks.

## Repeat Automated Checks

```powershell
cd frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:db
npm.cmd run test:chat-ui
npx.cmd expo install --check
npx.cmd --yes expo-doctor
cd ..
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:CALCMATE_TEST_REAL_RAG='1'
$env:CALCMATE_TEST_LLM='1'
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_rag_api.py -v
```
