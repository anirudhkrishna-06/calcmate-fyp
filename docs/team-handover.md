# CalcMate teammate and presentation guide

See [current implementation and validation](app-improvement-validation.md) for the seven improvement packages, real HTTP checks, Grade 1-2 coverage limits, and pending device walkthrough.

## First setup on Windows

Clone the repository, install Python 3.11, Node compatible with Expo SDK 57, and Android tooling or an SDK-compatible Expo Go installation. Run these commands from the repository root:

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-api.txt
cd frontend
npm.cmd ci
cd ..
```

RAG also needs `data/vector_store.index`, `data/vector_store_meta.json` and the `all-MiniLM-L6-v2` embedding model cache. Ask the project owner for existing index artifacts if they are absent from the clone. Install the Ollama desktop application, then run these optional Assistant setup commands from the repository root:

```powershell
.\venv\Scripts\python.exe -m pip install ollama
ollama pull llama3.2:3b
ollama list
# Only if the desktop application is not already serving Ollama:
ollama serve
```

Keep Ollama running while using generated Assistant answers. The register, attendance, marks, progress and general scheduler work without Ollama. The lesson planner remains labelled Local mock planner.

## App features and roles

The teacher app supports Maths for Grades 1-5, with one teacher managing multiple grades. Home provides a grade selector, daily attendance/marks actions, students needing revision, upcoming schedules/plans and logout. Classroom contains the searchable student register, enrollment/editing, student notes/history, class attendance with Present/Absent/Late and undo, bulk marks and concept progress. Planner separates observed-evidence multigrade rotations with a local offline fallback from the existing labelled mock lesson planner; both support saved edits and completion states. Assistant supports Markdown/maths, source excerpts, saved conversations and failed-request retries. Settings exposes server connection, profile/teaching grades, storage summary and backup/restore.

Teachers manage classroom records on their phone. Administrators use the computer's protected `/admin` inbox to review, approve or reject account requests; bulk approval is available. Administrators do not have a central dashboard of student marks or attendance. There is no student login role. Demo is an explicitly selected separate workspace, not an authentication bypass for real accounts.

## What is stored where

| Location | Records |
|---|---|
| Phone SQLite `calcmate.db` | Teacher profile, students, concepts/prerequisites, attendance, assessment marks/history, competencies, notes, general schedules, lesson plans, conversations, messages, sources and request/retry state |
| Phone SQLite `app_meta` | Selected grade, grade/workspace-specific attendance and marks drafts, active conversation reference and last-backup time |
| Phone Expo SecureStore | Account session/token and expiry, saved server address, pending signup email, approval-tracking receipt and pending logout revocations |
| Computer backend SQLite `data/auth.sqlite3` | Account email/profile, salted password hash, approval/disabled state, hashed session tokens/expiry, rate-limit attempts, signup timestamps and hashed approval receipts |
| Computer RAG files | Textbook index/metadata, model cache and retrieval/generation logs |
| Teacher-selected backup folder | Workspace JSON backup of classroom records, curriculum relationships, class sessions, exit-assessment links and chats; derived learner states are rebuilt; no account passwords or session tokens; unsaved drafts are excluded |

SQLite is the phone's local storage for classroom data; it is not a second cloud copy. Expo SecureStore is separate credential storage. Plaintext teacher passwords are not persisted on the phone or server. Logging out clears the active session but keeps classroom records behind the login gate. An unexpired approved session can reopen local records offline for up to the issued 24-hour window. New signup/login, approval checks and new Assistant answers need the server. Uninstalling or clearing app storage can remove phone records: make a backup first.

Classroom data is not automatically synchronized between phones or sent to the administrator. Git transfers code and tracked project assets, not phone data or accounts. A teammate signs up against their server and gets their own workspace; backups currently restore only to the matching unlocked workspace. Contextual Assistant requests send a bounded snapshot of relevant student names, assessments and attendance from the local workspace; chat history, unrelated notes and credentials are excluded. Python reasons over an isolated in-memory snapshot. Online general scheduling uses the same authenticated evidence service; offline/demo schedules use a labeled local heuristic. Curriculum graph screens show student or group evidence and prerequisite details.

## Start the presentation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-presentation.ps1
```

This launches the API on all interfaces, waits for health, prints the phone server URL and administrator URL/code, then runs Expo with its QR code in the foreground. It does not change firewall rules, create accounts or delete records. Ctrl+C stops the presentation; the script cleans up its API process. If more than one network adapter is available, run `ipconfig` and specify the Wi-Fi IPv4 address:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-presentation.ps1 -LanIp 192.168.1.100
```

Replace the example address. `-ApiPort 8001 -ExpoPort 8083` selects different ports. `-CheckOnly` validates paths and parameters without launching processes. Stop a previously running API/Metro first; the script refuses occupied ports.

The script enables insecure authentication only for trusted LAN presentation use. It respects an existing `CALCMATE_ADMIN_PASSWORD`; otherwise the administrator password is `admin123` for local presentations. Production needs HTTPS and a deployment plan; this script is not production hosting.

## Connect a phone and approve a teacher

1. Use the same Wi-Fi as the computer. Open the printed `/health` URL in the phone browser first. If unreachable, check the IP, Wi-Fi client isolation and firewall permission for the Python server.
2. Scan Expo's QR using a compatible Expo Go installation or development build. In the app, open **Server connection** and save the printed phone server address. Previously saved addresses override Expo's initial environment value. Do not use `localhost` or `10.0.2.2` on a physical phone.
3. Choose **Create teacher account**. Use an address such as `presentation.teacher@example.com` and choose a unique password of at least 8 characters including letters and numbers. No presentation password is committed to Git.
4. On the computer open the printed `/admin` URL. Log in with `admin123`, or the configured `CALCMATE_ADMIN_PASSWORD`. Requests include teacher name, email, school, grades and request time. Search, approve one teacher, or select several and choose **Approve selected**. Use the Pending/Approved/Rejected/All requests selector to see stored request history after login. Rejection requires confirmation.
5. The teacher's waiting screen checks every ten seconds while visible and in the foreground. When approved, choose **Log in** and enter the password. Approval tracking alone cannot unlock records. New signups receive a seven-day tracking receipt held in SecureStore; expired tracking or older accounts use ordinary login to check approval.
6. Presentation accounts receive 40 fictional Indian students, eight per grade across Grades 1-5, unless `CALCMATE_PRESENTATION_ROSTER=false`. Existing presentation workspaces add Grade 5 once at login or online session refresh; existing demos do so on reopening. Further enrollments, edits and deletions persist. **Explore demo** is a separate explicit workspace; it never replaces a failed login. There is no new destructive reset command.

## Five-minute professor walkthrough

- Home: show the grade selector and teaching actions.
- Classroom: search a student, show learning filters, mark attendance and enter class marks. Save before switching sections.
- Planner: generate a 90-minute General Schedule for several grades. Show one teacher group and concurrent independent work; edit and complete a block. Try ten minutes to demonstrate realistic warnings. Open Lesson Plan separately.
- Assistant: ask a Maths question, inspect textbook sources and a maths block. Real generated answers require API and Ollama readiness; retrieval-only answers are explicitly labelled.
- Settings: show server feedback and backup/restore. Home's Log out locks the device session while preserving records.

For airplane-mode cold starts use a freshly rebuilt bundled APK, rather than Expo Go requiring Metro. Follow [Android build and acceptance instructions](account-and-android-setup.md) and [multigrade phone tests](multigrade-scheduling.md). Never uninstall or clear storage to demonstrate persistence.

## Architecture and ownership

| Area | Main files |
|---|---|
| Five tabs and teacher workflows | `frontend/app/(tabs)` |
| Local SQLite and backups | `frontend/src/services/database.ts`, `storageService.ts`, `restoreService.ts` |
| Multigrade scheduling | `generalScheduler.ts`, `generalScheduleService.ts` |
| Existing lesson plans | `mockPlanner.ts`, `scheduleService.ts` |
| SecureStore sessions and approval tracking | `frontend/src/services/authService.ts` |
| Combined API and accounts | `src/api.py`, `src/auth_api.py` |
| Protected approval inbox | `src/admin_api.py`, `src/admin.html` |
| RAG bridge and model readiness | `src/rag_api.py` |

General schedules and lesson plans have separate JSON record kinds in the existing SQLite schedules table. Teacher accounts use a separate backend SQLite database. New additive account tables store signup timestamps and hashed, expiring approval receipts; existing accounts and sessions are retained. `/auth/approval` requires the signup receipt, and `/admin/approve-selected` requires administrator authorization and updates atomically. Classroom work never needs these endpoints once an unexpired account session is cached.

## Validation before Git handover

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\venv\Scripts\python.exe -m pytest -q tests
cd frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:db
npm.cmd run test:scheduling
npm.cmd run test:workspace-ui
npm.cmd run test:admin-ui
npm.cmd run test:chat-ui
# Optional: real local Ollama and cached RAG dependencies required
npm.cmd run test:http
```

Copy `frontend/.env.example` to `.env` only if starting Expo manually. Environment files, auth databases, generated Android folders and presentation logs are ignored. Keep administrator passwords, teacher passwords, tokens, virtual environments and `node_modules` out of Git. Review staged files for unrelated research logs. This implementation does not commit or push automatically.

Remaining limits: no cloud server, email notifications, school invitation links or QR-based API configuration were added. The startup QR opens Expo; API connection is manual once per device. Native keyboard and layout acceptance require a connected phone. The admin page remains protected by the existing operator code (`admin123` by default) rather than introducing a second account system.

Earlier presentation validation (superseded by [the improvement validation report](app-improvement-validation.md)): TypeScript and ESLint passed; database, 1,904 scheduling cases, workspace/chat interactions and admin-script interactions passed. Backend suite ran 20 tests with two optional model tests skipped; a separate live HTTP test exercised approval tracking, login, roster and actual Ollama RAG. Android production export passed. Startup was checked without launching processes and smoke-tested with a real API plus an adapted Expo launcher, including API cleanup. Full phone/QR acceptance remains manual.
