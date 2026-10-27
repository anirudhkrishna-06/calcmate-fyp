# Multigrade classroom schedules

Planner has two separate workflows: General Schedule for one teacher rotating between grades, and the existing Lesson Plan for detailed activities in one grade.

General schedules run entirely on the device. The local scheduler reads the selected grades' enrolled students, planning-date attendance, dated assessments, competencies and concept prerequisites. It prioritises weak prerequisites, then learning need. Balanced priority provides modest extra time for gaps; Learning needs gives them a larger share. Missing marks trigger readiness checks and are never treated as failed assessments. Current absences reduce the attending group used for allocation. Every selected grade retains activities, including grades without enrolled students.

Sequential slots cover the exact requested duration with one teacher assignment and an activity for every grade. Sessions of at least 30 minutes include a common opening and closing. Grade changes include transition time. Longer sessions use repeated rotations. Very short requests explicitly warn when grades receive independent work only or guided slots are shorter than eight minutes. This deterministic scheduler is not an AI service. Teachers prepare the worksheet examples and materials before class.

General schedules use their own `general-schedule` record type in the existing workspace-scoped SQLite schedules table. Lesson plans remain `lesson-plan` records, and earlier blocks are retained. No schema migration or new dependency is required. Edits and completion/postponement states persist through restart and backup/restore. Save checks require positive whole-minute durations, the original total, one teacher grade per instruction slot, and activities for every selected grade. Postponing a block records its status; it does not automatically rearrange the timetable.

## Physical Android testing

1. Connect the computer and phone to the same trusted Wi-Fi. Run `ipconfig` in PowerShell and find the Wi-Fi adapter's IPv4 address. The examples below use `192.168.1.100`; replace it with that address. A phone cannot reach the computer through `10.0.2.2`.
2. Start the account/RAG server from the repository root:

```powershell
cd D:\FYP\calcmate-fyp
$env:CALCMATE_ALLOW_INSECURE_AUTH='true'
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m src.api --host 0.0.0.0 --port 8000
```

3. Open `http://192.168.1.100:8000/health` in the phone browser. If it does not load, check the IP, Wi-Fi isolation and Windows Firewall access for the Python server. Start Ollama with the configured model if testing live Assistant answers; general scheduling does not require it.
4. Start the Expo preview in a second terminal:

```powershell
cd D:\FYP\calcmate-fyp\frontend
$env:EXPO_PUBLIC_API_BASE_URL='http://192.168.1.100:8000'
npm.cmd start -- --lan --port 8082
```

5. Open the QR link using an Expo Go installation compatible with the project's SDK 57, or the project's Android development build. On Welcome > Server connection, or Settings > Server connection, save the same API URL. A previously saved endpoint overrides the environment variable. For a signed-in account, the destination must accept that teacher's existing token and workspace.
6. Sign up, approve the request through the computer's `/admin` inbox using the configured administrator code, and log in. Alternatively, choose the explicit demo workspace. In Planner choose Create General Schedule. Confirm profile grades are preselected; try 90 minutes, then 10 minutes with all four grades. Inspect guided and independent work, transitions, exact totals and short-time warnings.
7. Edit a teacher task and an independent activity, mark a block Completed or Postponed, save, leave and reopen. Change durations while preserving the original total; confirm an incorrect total cannot save. Verify Create Lesson Plan still opens the existing one-grade workflow.
8. For an airplane-mode cold-start test, rebuild and install a bundled APK following [Android build instructions](account-and-android-setup.md#standalone-android-apk). An old APK does not contain these changes, and Expo Go needs Metro to load the current bundle. Force-stop the installed app, enable airplane mode, reopen, generate and edit a schedule, then force-stop/reopen again. Do not clear app storage or uninstall. Test backup/restore and check the general schedule and lesson plan both survive.
9. Check a small phone and increased system font size: timetable text wraps, tabs remain reachable, dates can be selected, and the keyboard leaves the fixed save/create button visible. Check chat maths scrolling and the existing student/attendance/marks flows.

No connected Android device was available during implementation. Automated component tests use native bridge mocks; production Android bundle export verifies packaging, not physical layout or keyboard behaviour.
