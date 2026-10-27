# CalcMate teacher workspace

The existing Expo project, routes, SQLite schema, account approval and Python RAG contracts are retained. No dependencies were added.

- Bottom navigation: Home, Classroom, Planner, Assistant, Settings. Existing Students, Schedule, Attendance and Chatbot paths remain valid.
- Selected grade is stored locally in app_meta and shared across Home, Classroom, Planner and new assistant requests.
- Classroom combines the student register, attendance, class marks and evidence-based progress. Search accepts names or roll numbers; filters distinguish revision, practicing, secure and unassessed students.
- Attendance and marks use a fixed save action. Attendance supports rapid P/A/L marking and undo for Mark all present. Class marks are validated and saved in one SQLite transaction, with competency updates and individual history preserved.
- Date selection uses an offline calendar. Pending class drafts are scoped to the workspace and grade, survive navigation, and are excluded from backups. Empty drafts do not replace today's defaults. Restore clears obsolete drafts.
- Plans keep their original evidence and mock-engine label. Teachers can edit titles, objectives, steps and durations, reorder blocks, and record planned/completed/partially completed/postponed states. Changes are stored in existing schedule JSON and included in backups. Total plan time must stay between 20 and 240 minutes.
- Assistant is available as a tab and through contextual drafts from progress and planning. Context is explicit text reviewed by the teacher before sending; no student records are silently attached. RAG, saved conversations, sources, retries and math rendering remain intact.
- Settings exposes Server connection at the top, followed by profile, storage, backup and app information. Home has Log out at the top right: it clears the device session and queues server revocation while retaining classroom records. Navigation actions use visible buttons. Revision-plan developer details are not displayed.
- Changing an account endpoint requires the same token, teacher identity and workspace to be accepted by the destination server.
- Planner separates General Schedule (one teacher, multiple grades) from the existing Lesson Plan. The offline rotation algorithm uses classroom evidence, exact minute budgets, guided/independent tasks, transitions and short-time warnings. General schedules have a separate JSON record type, including edit and completion states, without a schema change. See [multigrade scheduling and Android testing](multigrade-scheduling.md).

Validation includes TypeScript, ESLint, offline SQLite/regression suites, component interaction tests, backend account/admin tests, live HTTP/RAG integration and Android bundle export. Device keyboard and visual layout require a connected Android device; none was available during this implementation.
