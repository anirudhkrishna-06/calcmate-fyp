# Calcmate Frontend

Offline-first Expo + React Native teacher workspace. Use **Explore Demo** to open an isolated classroom of 32 fictional students (8 per Grade 1-4). Demo edits persist locally; no server is needed.

## Local Workspace

- SQLite versioned transactional migrations and scoped repositories store profiles, students, attendance, Maths concepts, assessments, competencies, observations, schedules and chat history.
- Search/filter/add/edit students, record assessments and teacher competency, and save observations from focused Student Details tabs. Class Attendance marks a whole grade with confirmation for Mark all present and an explicit transactional Save action.
- Home has grade-aware SQLite totals, attendance, revision priorities, saved lesson access and a visible demo/account distinction. Profile supports Maths only.
- Home and Schedule open a grade/Maths/date selection, followed by a SQLite evidence summary and payload preview. Generate an ordered DEMO/MOCK lesson plan with objectives, activities, durations and reasons. Whole plans and their input snapshots are stored in SQLite and appear in schedule history.
- The deterministic mock engine uses local prerequisite rules, a 60% evidence threshold, the lower of latest assessment and teacher competency when both exist, and explicit readiness checks for missing evidence. Multiplication revision precedes division. Students recorded absent on the planning date are excluded; missing attendance is disclosed. Older competency revisions are not reconstructed; available date-filtered records are used. The typed `SchedulingEngine` interface allows a future real engine.
- Create Backup asks for an external folder, writes versioned JSON and read-verifies it. Restore Backup validates ownership, types and relationships, requires explicit replacement confirmation, and restores in a transaction. Versions 1 and 2 are supported. Foreign-account backups are rejected; failed restores retain current records. Credentials are excluded and cloud sync is not implemented.
- Core records use no network, remote images or remote fonts. Icons are bundled assets.
- First-time users see Welcome with Create account, Log in and Explore demo. The combined `src.api` service implements signup, pending operator approval, login and logout. No raw password is stored on the phone or server. Approved sessions use SecureStore and a server-issued 24-hour offline expiry; server revocations are checked when reachable. See [account and Android setup](../docs/account-and-android-setup.md).
- Settings provides Log out or Exit demo. Records are retained but local account access is locked. Offline logout queues server-token revocation in SecureStore until connection recovery; demo exit preserves edits. Workspaces never mix.
- AI Assistant has persistent conversations, New Chat/history switching, a keyboard-aware multiline composer, loading and retry states. Version-3 SQLite migrations preserve earlier messages in an "Earlier chat" conversation. Interrupted pending requests become retryable after restart; retry reuses the saved user message. Sources and delivery status are persisted with each message and included in version-2 backups.
- The assistant calls the actual FastAPI bridge. Configure the address through Welcome/Settings > School server connection, or `EXPO_PUBLIC_API_BASE_URL`. Error summaries appear outside user bubbles with Retry and Check connection. Historical service notices are explicitly identified as non-AI messages. Requests remain single-question, non-streaming; no on-device inference is claimed. A LAN server can be reachable without public internet.
- Assistant Markdown uses markdown-it and mathematical expressions use KaTeX MathML through the Expo-compatible WebView. Rendering needs no remote scripts, images or fonts. Headings/lists/code, dollar and bracket TeX delimiters are supported; advanced maths depends on the device WebView's MathML support. Raw HTML is escaped, remote assets blocked, and rendering failures fall back to readable text. Source panels show only returned retrieval metadata, including grade-filter fallback warnings.

## Verified Backend Findings

- Original backend: Python library/CLIs using FAISS, NetworkX, Sentence Transformers and NumPy. The separate `src/rag_api.py` now exposes `GET /health` and `POST /chat` through FastAPI.
- Run commands found:
  - `python src/retrieve.py --test`
  - `python src/copilot.py "What are equivalent fractions?" --grade 4 --no-llm`
  - `python src/demo.py --grade 4`
- Verified library contracts:
  - `Retriever.retrieve(query, grade?, subject?, k?, log_call?) -> list[RetrievedChunk]`
  - `answer_question(retriever, question, grade, subject="Math", k=3, model="qwen2.5:3b", stream=False, use_llm=True) -> tuple[str, list[RetrievedChunk]]`
- Missing endpoints:
  - The RAG-only service has no accounts; the combined service adds `/auth/config`, `/auth/signup`, `/auth/login`, `/auth/me` and `/auth/logout`.
  - No teacher profile endpoint.
  - No student/register endpoint.
  - No schedule generation endpoint.
  - No backup/sync endpoint.

The frontend service layer keeps missing network contracts explicit and does not expose knowledge graph data. See [RAG API setup](../docs/rag_api.md) for runtime dependencies, requests and Android emulator/physical-device addresses.

## Run

```bash
cd frontend
npm install
npm run typecheck
npm run lint
npm run test:db
npm run test:chat-ui
npm run test:workspace-ui
# Opt-in actual Python/Ollama HTTP integration using the existing venv:
npm run test:http
npm start
```

Native startup smoke test: `CI=1 EXPO_OFFLINE=1 npx expo start --port 8082` (PowerShell: set `$env:CI='1'` and `$env:EXPO_OFFLINE='1'` first). Open with a compatible Expo Go or development client. Web is not configured.

Database tests run the actual migrations/services against Node's SQLite implementation with an adapter for Expo's native bridge. They cover restart persistence, seed idempotence, isolation, CRUD, transactions, session expiry, deterministic planning with different evidence profiles, saved-plan restoration and backup serialization/cancellation/error handling. Native file selection and physical-device airplane-mode verification still require an Android/iOS device.

Chat tests also cover migration of earlier messages, conversation restoration, interrupted requests, duplicate submission guards, retry without duplicate user messages, persisted sources, HTTP/network/timeout/malformed-response errors and local Markdown/MathML rendering. `test:chat-ui` renders the actual screen with native bridges mocked to verify composer/keyboard structure, loading, retry, history switching and offline notices. Native Android bundling passes; final visual, keyboard and MathML device verification remains required because the local emulator repeatedly reported Android System UI/process failures during the smoke test.

File API reference: [Expo FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/). The implementation was checked against the installed SDK's TypeScript and native sources.
