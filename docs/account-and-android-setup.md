# Accounts, Preview and Android Builds

## Local Preview

Run the combined API from the repository root using the existing environment. This starts the unchanged RAG bridge plus teacher accounts:

```powershell
# Trusted local development; use HTTPS for deployed school servers.
$env:CALCMATE_ALLOW_INSECURE_AUTH='true'
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m src.api --host 0.0.0.0 --port 8000
```

In another terminal:

```powershell
cd frontend
# Unset defaults to Android emulator 10.0.2.2:8000 (localhost:8000 on iOS/web).
# Android emulator only: EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000
npm.cmd start -- --port 8082
```

Physical phone: set EXPO_PUBLIC_API_BASE_URL or the saved endpoint to your computer private LAN IP, for example http://192.168.1.100:8000, on the same Wi-Fi. HTTP accounts require CALCMATE_ALLOW_INSECURE_AUTH=true. No HTTPS certificate or public account deployment is provisioned by this project. Explore demo remains an explicit choice and never starts because a connection check fails. Android Studio emulator: use `http://10.0.2.2:8000` for the loopback API. The Expo development server may use LAN independently of the account server. No firewall or system security settings are changed by this project.

The API address can also be saved on the device through Welcome > Server connection or Settings > Server connection. This override takes precedence over the public environment variable and survives restarts. Settings checks actual `/health` and `/auth/config` responses, not model readiness. Changing an approved account's server address verifies the existing token and workspace on the new address first; a different teacher server cannot silently unlock the workspace. Android HTTP support is configured through withLocalApi; rebuild existing native apps after config changes. Set CALCMATE_CORS_ORIGINS to a comma-separated list of allowed Expo web origins when using other hostnames or ports.

If Expo reports Cannot connect to Expo CLI, restart Metro and reopen its QR/deep link. That warning does not diagnose the Python API. If Assistant reports unavailable, check the separate API address and server, then Retry the saved question.

The backend loads embedding models lazily. Cold initialization on a busy machine may exceed the app's 90-second request timeout; allow server initialization to finish, then Retry the existing saved question rather than sending duplicates. The live HTTP regression fixture preloads the real runtime with a separate bounded 300-second startup budget; it does not change app timeouts or substitute fake answers.

## Teacher Journey

1. Start the combined API and open `http://localhost:8000/admin` on the administrator computer (or the API LAN address on a phone). At startup the server prints an administrator access code. Use it to sign into the inbox. Set `CALCMATE_ADMIN_PASSWORD` before startup if you prefer a permanent code. Keep this code with the administrator.
2. Teachers sign up in CalcMate. The browser inbox automatically checks for new requests every ten seconds and displays their name, email, school, grades and teaching experience.
3. Click **Approve teacher**. The teacher can immediately log in; rejected requests remain locked. The old CLI approval command is still available but is no longer needed for routine approval.
4. Approved teacher accounts open with **32 fictional Indian students** (eight per grade) and sample assessments for presentations. Students > Add student enrolls additional students. Names, edits and deletions survive future logins. Existing enrollments with the same grade/roll number are preserved. Set `CALCMATE_PRESENTATION_ROSTER=false` before startup to disable the presentation roster for new workspaces; already-created local data is retained.
5. SecureStore persists the approved account session. Classroom data can reopen offline for up to the issued 24-hour expiry. Home exposes Log out at the top right. It clears the stored session and queues server revocation without deleting classroom records. Session expiry also locks access.
6. Explore demo remains a separate explicit workspace and never replaces a failed teacher login.

## Assistant readiness

Retrieval and generation are separate. `/health` now reports `generation_available`, `configured_model` and an actionable `generation_message`, and the connection screen displays these diagnostics. The default local model is `llama3.2:3b`; override it with `CALCMATE_RAG_MODEL` if needed.

Start Ollama on the server computer and install the configured model once:

```powershell
ollama serve
# In another terminal, if the model is not already installed:
ollama pull llama3.2:3b
```

If the Ollama desktop app is already running, another `ollama serve` process is unnecessary. The phone connects to the CalcMate API on port 8000, not directly to Ollama.

Chat generates a grounded explanation when Ollama is available. If generation fails after successful retrieval, it returns clearly labelled **textbook excerpts (retrieval only)** with sources rather than treating the excerpts as an AI explanation. Set `CALCMATE_RAG_ALLOW_RETRIEVAL_FALLBACK=false` if a strict 503 failure is preferred. The confidence gate still refuses unsupported questions. `CALCMATE_GENERATION_TIMEOUT` defaults to 65 seconds, within the app request budget.

CPU inference and HF Hub authentication warnings are not themselves the cause of a generation 503. A configured model missing from Ollama, Ollama not running, or failed generation are separate conditions. Embedding downloads still require a cached model or internet access.

## Storage and Security

- Account database: `data/auth.sqlite3`, ignored by git. Override using `CALCMATE_AUTH_DB`; do not commit or export it.
- Server passwords: salted scrypt (N=131072, r=8, p=1); no raw password logging/storage. Server session tokens are SHA-256-hashed in the database. Tokens are returned only at login and stored with SecureStore on the phone.
- Account operations require HTTPS unless the explicit trusted-development opt-in is set. The app refuses public HTTP account URLs; HTTP is allowed for loopback, Android emulator and private IPv4 LAN addresses. Bind to 0.0.0.0 for physical devices on a trusted development network. Login/signup are persistently rate-limited to ten attempts per client IP per fifteen minutes. Validation responses do not echo supplied passwords.
- Cached offline approval cannot learn a new server revocation while disconnected. The maximum offline window is the issued 24-hour expiry. Connected app resumes check the session without overwriting edited local profiles.
- Classroom JSON backups exclude account sessions, tokens, revocation queues and passwords. They still contain personal classroom records and must be stored securely. Restore only accepts the currently unlocked matching workspace and runs atomically. This is local recovery, not cloud synchronization or cross-account transfer.

Security references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Standalone Android APK

Expo Go is a development preview. An installed release/preview APK containing its JavaScript is required to verify airplane-mode cold starts without Metro.

The project now has Android package `org.calcmate.teacher`, resize keyboard behavior and an EAS internal APK profile. Android prebuild was run without reinstalling npm dependencies; generated native directories are ignored by git and can be regenerated.

Local build using the installed SDK/JDK:

```powershell
cd frontend
$env:JAVA_HOME='C:\Program Files\Java\jdk-21'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_ENV='production'
npx.cmd expo prebuild --platform android --no-install
cd android
.\gradlew.bat assembleRelease --console=plain --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g'
```

Expected output **only after a successful build**: `frontend/android/app/build/outputs/apk/release/app-release.apk`. Expo's generated release configuration uses a debug signing key for local development; use a proper release signing process for distribution. Native Gradle/SDK dependencies may need downloading on the first build. Do not assume an APK exists just because prebuild passed.

Verification on 2026-10-10 produced that APK successfully (107,620,232 bytes). Its JavaScript and icon fonts are bundled, so Metro is not required by the installed build. Android launch and native acceptance remain manual checks; no physical device was attached and the QA emulator refused ADB authorization.

The initial universal native build compiled successfully but D8 exhausted the generated 2 GB Java heap during DEX merging. The command above supplies 4 GB and limits workers without changing dependencies. The small `withBuildMemory` Expo config plugin retains those values on future prebuilds/cloud builds. A sufficiently provisioned build machine is required.

Optional cloud alternative: `eas build --platform android --profile preview` after setting up your own EAS account/project. No cloud build or paid service was initiated here. Release networking should use HTTPS; the local HTTP API opt-in does not enable Android release cleartext traffic.

## Android Acceptance

- First installation: Welcome, unavailable-server state without credential fields, signup > pending approval > approved login. Presentation accounts receive the configured starter roster.
- Demo: clear banner, initial 32 students/eight per grade only in a fresh demo; force-stop and reopen to confirm edits persist without duplication. Home > Log out returns to Welcome and preserves records.
- Home grade selector, class attendance confirmation/save, student edit/assessment/notes, and profile save. Force-stop/reopen without clearing storage.
- Airplane mode in an installed bundled build: CRUD, plans/history, backup/restore and saved chats work; new AI answers do not pretend to generate.
- Backup pick/cancel/restore confirmation and invalid-file rollback. Never restore across accounts or while an assistant request is pending.
- Actual assistant request, error outside the question bubble, connection diagnostics, Retry without duplicate question, sources, history, keyboard avoidance, Markdown and MathML.
- Small Android screen and enlarged system text: check wrapped labels, header, composer, touch targets and no overlaps.

Automated screen tests adapt native bridges and cannot replace these physical-device checks. See [QA record](calcmate-qa.md) for actual verification history.

Expo Go and the standalone APK have separate app-private databases. Existing preview edits do not automatically appear in the APK; export and restore a matching-workspace backup when moving between them.
