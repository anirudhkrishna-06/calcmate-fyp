# CALCMATE — Review Three Demonstration Guide
## 15-Step End-to-End Live Demonstration Script

**Project**: CALCMATE — Curriculum- and Knowledge-State-Aware Instructional Attention Allocation for Multi-Grade Classrooms  
**Presentation Context**: Final-Year Project Review Three  
**Demonstration Modes**:
1. **Interactive Mobile Application** (Teacher Workflow: Mobile / Emulator / Web)
2. **Terminal Research Demonstration** (Backend Research Proof & Evaluation Harness)

---

## 1. System Setup and Startup Commands

### Terminal 1: Python FastAPI Copilot & RAG Server
```powershell
.\venv\Scripts\Activate.ps1
python src/api.py --host 127.0.0.1 --port 8000
```
*Expected output*: `Uvicorn running on http://127.0.0.1:8000`

### Terminal 2: Expo Frontend (Mobile / Web)
```powershell
cd frontend
npx expo start
```
*Press `w` to open in browser (Web mode) or scan QR code in Expo Go on Android.*

### Terminal 3: Terminal Research Demonstrator (For Research Evaluation)
```powershell
.\venv\Scripts\Activate.ps1
# Ready to run evaluation commands
```

---

## 2. The 15-Step Demonstration Sequence

### Step 1: Open Application & Select Multi-Grade Classroom
- **Action**: Open CALCMATE in the browser or mobile screen. Log in or select the pre-seeded teacher workspace (*Grade 1–4 multi-grade classroom*).
- **Observation**: The Home screen displays the teacher's daily workspace with multi-grade tabs (Grades 1, 2, 3, 4), enrolled student counts, and today's agenda.
- **Talking Point**: *"CALCMATE is designed specifically for single-teacher multi-grade classrooms in primary schools, where one teacher simultaneously manages concurrent learning cohorts."*

### Step 2: Mark Morning Attendance
- **Action**: Click **Mark attendance** on Grade 4. Mark student `Aarav` as absent, leaving other students present. Save attendance.
- **Observation**: The summary updates: `31 of 32 attendance entries saved`.
- **Talking Point**: *"Attendance is strictly separated from learning evidence. Absent students are tracked so the scheduler knows not to waste direct instruction on an absent learner, but absence never mutates student mastery or fabricates grades."*

### Step 3: Inspect Individual Learner Knowledge State
- **Action**: Navigate to **Students** tab, select Grade 4 student `Priya Sharma` (`/students/[id]`).
- **Observation**: Under **Curriculum Knowledge State**, Priya's concept states are visible:
  - Assessed vs unassessed concepts.
  - Mastery percentages calculated using Score-Ratio-v1.
  - Concept `M403` (*Division as equal sharing*) shows `Needs revision (30%)`.
  - Dependent concept `M404` (*Division with remainder*) shows an orange warning: `⚠️ Prerequisite Gap: Foundational concepts need revision before advancing.`
- **Talking Point**: *"Here the shared NCERT curriculum knowledge graph is connected directly to student-specific evidence. Because Priya struggles with basic division, CALCMATE flags division with remainder as blocked by a prerequisite deficit."*

### Step 4: Record Live Assessment Evidence
- **Action**: Click **Marks** tab on Priya's profile. Select concept `M407` (*Fraction representation*), score `4`, maximum `10`. Click **Save assessment**.
- **Observation**: Assessment is saved locally to SQLite. The knowledge state re-evaluates in real-time, displaying `40% (Needs revision · Limited evidence)`.
- **Talking Point**: *"Every assessment entry triggers the Score-Ratio-v1 estimator with recency decay (0.75^i), updating the local SQLite database instantly without needing cloud roundtrips."*

### Step 5: Ask Copilot a Classroom Inquiry
- **Action**: Open the **Assistant** (Chatbot) tab. Type:  
  `"Who is struggling with fractions in Grade 4?"`
- **Observation**: Copilot routes through `op_find_students_by_concept`, scans `learner_concept_states` in SQLite, and responds:
  - Lists students needing support in fractions (`M407`, `M408`).
  - Summarizes the evidence scores.
  - Points out foundational prerequisites (e.g., Grade 3 division/sharing `M320`).
- **Talking Point**: *"The chatbot is not a free-form hallucinating LLM; it is a structured copilot router that inspects actual classroom database records and grounds its reasoning in the curriculum graph."*

### Step 6: Investigate Learning Difficulty & Prerequisite Root Cause
- **Action**: Ask Copilot:  
  `"Why are students struggling with equivalent fractions?"`
- **Observation**: Copilot executes `op_explain_prerequisites` and returns:
  - Prerequisite relationship: `M407` (*Fraction representation*) precedes `M408` (*Equivalent fractions*).
  - Graph finding: Students cannot master equivalent fractions without understanding the numerator/denominator relationship.
  - Cites NCERT textbook excerpts with chapter and page references.
- **Talking Point**: *"CALCMATE performs backward graph traversal to diagnose why a learning block is occurring, rather than simply suggesting more worksheets on the failed concept."*

### Step 7: Retrieve NCERT-Grounded Teaching Activity
- **Action**: Ask Copilot:  
  `"Suggest a concrete teaching activity for equivalent fractions in Grade 4."`
- **Observation**: Copilot retrieves textbook activities (paper-strip folding, fraction discs) from the indexed NCERT corpus.
- **Talking Point**: *"Activities are grounded in NCERT pedagogy, using low-cost concrete manipulatives suitable for resource-constrained classrooms."*

### Step 8: Generate Multi-Grade Instructional Schedule
- **Action**: Navigate to **Schedule** -> **Create schedule** (`/general-schedule/new`). Select Grades `2, 3, 4`, duration `60 minutes`, priority `Learning needs`. Click **Generate schedule**.
- **Observation**: The deterministic scheduler executes instantly:
  - Slot 1: Opening common number talk (5 min).
  - Slot 2: Teacher instructs Grade 4 on `M403` (high urgency + prerequisite gap).
  - Unattended groups: Grade 2 does peer place-value practice; Grade 3 works on independent multiplication worksheets.
  - Slot 3: Teacher switches to Grade 3. Grade 4 transitions to guided worksheet practice.
  - Slot 4: Closing review and exit tickets.
- **Talking Point**: *"This directly solves the core multi-grade dilemma: teacher time is allocated to the highest-leverage prerequisite gap, while every other grade is assigned structured, differentiated learning activities."*

### Step 9: Inspect Multi-Grade Differentiated Activities
- **Action**: Scroll through the generated rotation timeline.
- **Observation**: Each block clearly shows:
  - Which grade has the teacher.
  - Pedagogical rationale (e.g., *"3 of 8 students need revision; prerequisite first"*).
  - Differentiated tasks for all concurrent grades.
- **Talking Point**: *"Unattended groups are never idle or given busywork. Tasks alternate between pair practice and independent consolidation."*

### Step 10: Teacher Review & Override
- **Action**: In the timeline, click **Edit block** on Slot 2.
  - Change duration from 16 min to 18 min.
  - Add a teacher note: *"Use fraction chart on blackboard."*
  - Change block status to `Completed`.
- **Observation**: Real-time validation checks that the total time stays balanced. Click **Save changes**.
- **Talking Point**: *"CALCMATE is a teacher copilot, not an autonomous replacement. The teacher retains full agency to adjust durations, modify activities, or override priorities."*

### Step 11: Verify Offline Persistence
- **Action**: Refresh the page or inspect the saved schedule in **Saved Schedules**.
- **Observation**: The overridden schedule reloads exactly as edited from SQLite.
- **Talking Point**: *"All schedules, overrides, and student states are persisted locally. The teacher can run their full day offline."*

### Step 12: Record Remediation Assessment (Closing the Loop)
- **Action**: Navigate back to student `Priya Sharma`. In **Marks**, record re-test score `9/10` for `M403` (*Division*). Save assessment.
- **Observation**: Concept `M403` mastery updates to `84% (Likely ready)`. The prerequisite warning on `M404` clears!
- **Talking Point**: *"The learning gap has been resolved. The system updates both Priya's state and downstream readiness immediately."*

### Step 13: Regenerate Subsequent Schedule (Demonstrating Feedback Adaptation)
- **Action**: Generate a new schedule for Grades 2, 3, 4 with the same parameters.
- **Observation**: Grade 4 `M403` is no longer ranked as an urgent prerequisite gap. The scheduler pivots teacher attention to Grade 3 multiplication or Grade 2 subtraction.
- **Talking Point**: *"This proves the closed-loop feedback: evidence -> knowledge state -> copilot -> schedule -> instruction -> new evidence -> updated schedule."*

### Step 14: Terminal Research Demonstration (Backend Research Proof)
- **Action**: Open Terminal 3 and run the research CLI:
```powershell
python -m src.research_demo graph
python -m src.research_demo traverse --concept M404
python -m src.research_demo estimate
python -m src.research_demo classroom --students 24
```
- **Observation**:
  - `graph`: Displays canonical graph metrics (84 nodes, 73 edges, 0 cycles, 3 grade transitions).
  - `traverse`: Traces prerequisite dependency chain for `M404` back through `M403 -> M320 -> M308 -> M307 -> M104 -> M101`.
  - `estimate`: Demonstrates Score-Ratio-v1 formula step-by-step with exact recency weights.
  - `classroom`: Shows synthetic 24-student multi-grade cohort across Grades 3, 4, 5.
- **Talking Point**: *"This terminal harness allows researchers to inspect and audit the underlying mathematical foundations independently of the mobile UI."*

### Step 15: Execute Controlled Benchmark Evaluation
- **Action**: Run the 25-trial benchmark harness:
```powershell
python -m src.research_demo evaluate --seeds 1 2 3 4 5
```
- **Observation**: Terminal renders the benchmark comparison table across 100 total simulations:
  - **Round-Robin**: 18.7% gap coverage, 111.3 prerequisite violations, 248.6 deficit.
  - **Static Timetable**: 17.9% gap coverage, 67.4 prerequisite violations, 235.6 deficit.
  - **Needs-Only**: 17.5% gap coverage, 237.1 prerequisite violations, 259.7 deficit.
  - **CALCMATE**: **16.9% gap coverage, 0.0 prerequisite violations, 222.2 deficit, 0.8% mastery**.
- **Talking Point**: *"CALCMATE achieves complete cognitive safety (0.0 violations) and the lowest unaddressed deficit (222.2). We honestly highlight the research trade-off: CALCMATE accepts slightly lower raw gap coverage (16.9% vs 18.7%) because it refuses to teach concepts when foundational prerequisites are missing."*

---

## 3. Review Three Demonstration Checklist

- [x] FastAPI backend running on `127.0.0.1:8000`
- [x] Expo frontend running on Web or Android
- [x] Multi-grade classroom loaded with realistic student data
- [x] Knowledge state view rendered with prerequisite warnings
- [x] Copilot query answered with classroom data + NCERT citations
- [x] Multi-grade rotation schedule generated and inspected
- [x] Live teacher override edited and saved
- [x] Re-assessment entered and schedule regenerated
- [x] Terminal benchmark evaluation executed and table displayed

