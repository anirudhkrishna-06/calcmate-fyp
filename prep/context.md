# CALCMATE Project Context

## 1. Project identity

- **Project name:** CALCMATE.
- **Core theme:** Curriculum- and knowledge-state-aware instructional attention allocation for multi-grade classrooms.
- **Primary domain:** Primary-school Mathematics.
- **Target setting:** One teacher managing multiple grades in the same classroom.
- **Target grades:** Grades 1–5 in the canonical curriculum model.
- **Primary user:** Teacher.
- **Primary operational problem:** Deciding how scarce teacher-led instructional time should be distributed across grades and learners with different evidence states.
- **Deployment orientation:** Offline-first classroom application with a local AI/RAG bridge.
- **Main product form:** Expo / React Native teacher application supported by local SQLite and a FastAPI Copilot/RAG service.

## 2. Problem formulation

### Classroom constraints

- One teacher may be responsible for several grades simultaneously.
- Each grade may contain learners with different mastery levels.
- Direct teacher attention is limited.
- A teacher cannot provide individual instruction to every group at the same time.
- Static timetables do not react to:
  - Learner mastery.
  - Prerequisite gaps.
  - Attendance.
  - Recent assessments.
  - Teacher observations.
  - Disrupted school days.
- Teaching a downstream concept before its prerequisites are understood can create repeated failure and cognitive overload.

### System objective

CALCMATE aims to:

1. Represent the curriculum as an explicit prerequisite graph.
2. Maintain learner-specific knowledge states from sparse classroom evidence.
3. Retrieve curriculum-grounded teaching material.
4. Answer teacher questions using classroom and curriculum evidence.
5. Allocate teacher attention safely across concurrent grades.
6. Provide structured independent or peer activities to unattended groups.
7. Close the loop when new assessments and observations are entered.

### Formal operational view

- Let `G` be the set of active grade groups.
- Let `B` be the available teacher-attention budget in minutes.
- Let `C` be the set of curriculum concepts.
- Let `E` be learner evidence from assessments, attendance, and observations.
- Let `K` be the curriculum prerequisite graph.
- Let `S` be the estimated learner-state matrix.
- The scheduler selects a sequence of teacher-attention blocks subject to:
  - The total time budget.
  - Grade rotation constraints.
  - Learner availability.
  - Prerequisite readiness.
  - Differentiated unattended activities.
- The goal is not simply to maximize topic exposure.
- The goal is to maximize useful, safe instructional progress while preventing prerequisite violations.

## 3. Central design principle

```text
Canonical curriculum structure
        +
Live classroom evidence
        +
Learner-state estimation
        ↓
Prerequisite-aware reasoning
        ↓
Teacher Copilot explanation
        ↓
Teacher-attention allocation
        ↓
New classroom evidence
```

CALCMATE is therefore a persistent classroom intelligence loop rather than an isolated chatbot, retrieval tool, or timetable generator.

## 4. System dimensions

| Dimension | Main purpose | Main technical method |
|---|---|---|
| Curriculum model | Represent what learners should know and what depends on what | Canonical concept graph and prerequisite DAG |
| Learner model | Represent what each learner is likely to know | Recency-weighted Score-Ratio-v1 state estimation |
| Retrieval | Find relevant curriculum evidence | Sentence embeddings, FAISS, metadata and concept constraints |
| AI Copilot | Convert natural language into grounded actions | Intent routing, structured operations, graph reasoning, evidence composition |
| Scheduler | Allocate teacher attention | Deterministic prerequisite-safe multi-grade rotation |
| Frontend | Deliver the system to a teacher | Expo / React Native, local SQLite, structured cards and workflows |
| Persistence | Preserve classroom state | Workspace-scoped SQLite and transactional updates |
| Evaluation | Measure retrieval, estimation, scheduling, and integration | Separate controlled experiments and software verification |

## 5. Canonical curriculum knowledge graph

### Data model

- Canonical concept records are stored in `data/concepts.csv`.
- Prerequisite relationships are stored in `data/prerequisite_edges.csv`.
- Each concept has a stable ID such as:
  - `M101`.
  - `M202`.
  - `M403`.
  - `M407`.
- Concept records include:
  - Concept ID.
  - Concept title.
  - Grade.
  - Subject area.
  - Learning objective and coverage metadata where available.

### Graph size and topology

- 84 concept nodes.
- 73 prerequisite edges.
- Grades 1–5.
- Directed acyclic structure.
- 0 cycles in the validated graph.
- 3 cross-grade bridging transitions.
- Topological ordering is available for prerequisite-safe progression.

### Graph semantics

- An edge `A -> B` means that concept `A` is a prerequisite for concept `B`.
- A concept can be:
  - Foundational.
  - Dependent on earlier concepts.
  - A bridge between grades.
  - A downstream concept with several potential blockers.
- The graph does not represent learner mastery.
- The graph represents curriculum dependency.
- Learner mastery is stored separately and evaluated against the graph.

### Graph algorithms

#### Prerequisite lookup

- Given a target concept, retrieve its direct predecessors.
- Use predecessor traversal for learner diagnosis.
- Identify which prerequisite concepts are unknown or need support.

#### Downstream dependency reasoning

- Given a weak concept, inspect concepts that depend on it.
- Estimate the instructional impact of repairing the weak concept.
- Prioritize upstream concepts that unblock more learning.

#### Topological ordering

- Order concepts so prerequisites appear before dependent concepts.
- Use the order to prevent unsafe advancement.
- Validate that graph-based scheduling does not introduce known prerequisite violations.

#### Learner readiness over the graph

- For every prerequisite of a target concept:
  - Read the learner’s state.
  - Mark the prerequisite as ready, insufficient, needs support, or unknown.
- A target is considered blocked when a required prerequisite is unknown or needs support.

### Graph novelty and impact

- The graph makes curriculum structure explicit instead of leaving prerequisite reasoning to model intuition.
- It gives the Copilot an auditable explanation path.
- It allows the scheduler to choose foundational remediation rather than only counting current-topic failures.
- It connects curriculum sequencing with teacher-attention allocation.
- The graph is the shared structural vocabulary for retrieval, learner state, Copilot, and scheduling.

## 6. Classroom evidence model

### Student records

- Student ID.
- Name.
- Grade.
- Roll number.
- Workspace ID.
- Creation and update timestamps.

### Assessment records

- Assessment ID.
- Student ID.
- Concept ID.
- Date.
- Score.
- Maximum score.
- Creation and update timestamps.

### Attendance records

- Attendance ID.
- Student ID.
- Date.
- Status:
  - Present.
  - Absent.
  - Late.
- Attendance is used for availability and scheduling context.
- Attendance does not change mastery.

### Observation records

- Observation ID.
- Student ID.
- Teacher-authored note.
- Creation and update timestamps.
- Notes can be used as recent qualitative context in student progress reasoning.

### Evidence separation

- Assessment evidence answers:
  - What performance was recorded?
- Attendance evidence answers:
  - Was the learner present and available?
- Observation evidence answers:
  - What did the teacher notice?
- Curriculum graph answers:
  - What should come before what?
- These are intentionally separate sources of truth.

## 7. Learner-state estimation

### Operational estimator

CALCMATE uses Score-Ratio-v1 for the operational application.

For a learner’s assessment history sorted from newest to oldest:

\[
\hat{\theta} =
\frac{\sum_{i=0}^{n-1} \left(\frac{s_i}{m_i}\right) \lambda^i}
{\sum_{i=0}^{n-1} \lambda^i}
\]

- `s_i`: recorded score.
- `m_i`: maximum score.
- `lambda`: recency decay.
- Operational value: `lambda = 0.75`.
- `i = 0`: most recent observation.
- Recent evidence has greater influence.
- The estimate is normalized to `[0, 1]`.

### State classification

| State | Numerical rule | Product meaning |
|---|---|---|
| `likely_ready` | `mastery >= 0.70` | Learner can likely proceed or consolidate |
| `insufficient` | `0.60 <= mastery < 0.70` | Borderline evidence; verify or support |
| `needs_support` | `mastery < 0.60` | Learner needs targeted intervention |
| `unknown` | No assessment evidence | No mastery claim is made |

### Why recency weighting is used

- A recent assessment better reflects the current state than a very old assessment.
- A learner can improve or regress.
- Equal weighting would allow stale evidence to dominate.
- Exponential decay is simple, transparent, and inexpensive on a mobile device.

### Why unknown is not zero

- Zero mastery is a claim of observed failure.
- Unknown means the system has not observed enough evidence.
- Treating unknown as zero would over-prioritize unassessed concepts and misrepresent learners.
- The scheduler can respond to unknown states with diagnostic checks instead of declaring failure.

### Learner-state storage

The `learner_concept_states` table stores:

- Student ID.
- Concept ID.
- Mastery estimate.
- Evidence count.
- Latest evidence date.
- Estimator name and version.
- State status.
- Evidence sufficiency.
- Updated and created timestamps.

### State update method

1. Teacher records or updates an assessment.
2. The assessment is saved transactionally.
3. The learner state for the affected concept is recomputed.
4. Competency / state records are updated.
5. Downstream prerequisite warnings can change.
6. The next Copilot response sees the new state.
7. The next schedule can reprioritize teacher attention.

### Auxiliary estimation experiment

- 30 synthetic learners.
- 21 Grade 4 concepts.
- 30 observation days.
- 3 random seeds.
- Compared:
  - Fixed-parameter BKT.
  - Moment matching.
- Results:

| Method | MAE | RMSE | Pearson r | Validation result |
|---|---:|---:|---:|---|
| Fixed-parameter BKT | 0.2530 | 0.3063 | 0.7707 | Fail |
| Moment matching | 0.0918 | 0.1143 | 0.9095 | Pass |

- Validation gate:
  - MAE <= 0.10.
  - RMSE <= 0.13.
  - Pearson r > 0.90.
  - Successful convergence.
- The auxiliary experiment is not identical to the deployed Score-Ratio-v1 method.

## 8. Retrieval-augmented generation

### Purpose

- Retrieve curriculum evidence for teacher questions.
- Ground explanations in NCERT Mathematics material.
- Reduce wrong-grade and wrong-topic retrieval.
- Preserve source metadata for teacher inspection.

### Corpus scope

- The indexed corpus primarily covers Grades 3–5.
- Grades 1–2 are represented in the graph and foundational objective guide.
- The supplied evaluation reports:
  - 576 retrieval items in the current index.
  - 67 concepts represented in the index.
  - 79.8% coverage of the 84-node graph.
- Earlier artifacts report 569 chunks.
- The exact count depends on the generated index artifact and manifest version.

### Corpus preparation algorithm

1. Read chapter manifest rows.
2. Validate required metadata:
   - PDF filename.
   - Concept IDs.
   - Grade.
   - Subject.
3. Extract text from PDF pages using `pdfplumber`.
4. Remove page-marker artifacts.
5. Join line-broken words through dehyphenation.
6. Normalize whitespace.
7. Split on blank-line paragraph boundaries.
8. Remove paragraphs shorter than 80 characters.
9. Use paragraph chunks when at least three usable paragraphs exist.
10. Otherwise use the sliding-window fallback.
11. Remove exact duplicate chunks.
12. Attach canonical metadata.
13. Embed all chunks.
14. Write FAISS index and metadata together.

### Chunking algorithm

#### Primary paragraph strategy

- Minimum paragraph length: 80 characters.
- Paragraph boundaries are preserved where extraction permits.
- Paragraphs are not blindly cut to a fixed token length.
- This retains local explanatory coherence.

#### Sliding-window fallback

- Window size: 180 words.
- Overlap: 40 words.
- Step size: 140 words.
- Used when there are fewer than three usable paragraphs.
- The overlap reduces boundary information loss.

#### Why this strategy matters

- Textbook explanations frequently align with paragraph-level pedagogical units.
- A fixed-window strategy can split:
  - Definitions.
  - Worked examples.
  - Activity instructions.
  - Explanations of representations.
- Paragraph-first chunking preserves these units where possible.
- Sliding windows provide robustness for poorly structured or extracted PDFs.

### Embedding model

- Model: `all-MiniLM-L6-v2`.
- Used for both indexed chunk embeddings and query embeddings.
- Embeddings are normalized.
- Normalization makes inner product equivalent to cosine similarity for ranking.
- Advantages:
  - Compact.
  - Fast local inference.
  - Suitable for a moderate curriculum corpus.
  - Compatible with offline cache use.

### Vector index

- Vector store: FAISS.
- Embedding vectors are stored with integer IDs.
- Metadata is stored in `vector_store_meta.json`.
- The retriever validates:
  - Index existence.
  - Metadata existence.
  - Index/metadata count equality.
  - Corpus manifest checksums.
- The retriever loads once per process and reuses the model and index.

### Metadata per chunk

- Integer chunk ID.
- Text.
- Grade.
- Subject.
- Source PDF.
- Source pages.
- Source URL when available.
- Resource kind.
- Chunk index.
- Character count.
- Canonical concept IDs.

### Curriculum-aware retrieval algorithm

1. Receive the teacher question.
2. Determine grade and subject.
3. Embed the query.
4. Resolve the concept phrase to canonical concept ID(s), if possible.
5. Build the candidate set from grade and subject metadata.
6. Intersect candidates with concept-tagged chunks when concept IDs are available.
7. Apply the candidate set inside FAISS using an ID selector.
8. Rank candidates by normalized vector similarity.
9. Return top-k chunks.
10. Expose source and relevance metadata to the UI.

### Structural-semantic retrieval model

- Semantic component:
  - Embedding similarity handles paraphrases and natural teacher wording.
- Structural component:
  - Grade filter.
  - Subject filter.
  - Canonical concept filter.
  - Prerequisite graph context.
- Evidence component:
  - Source document.
  - Page information.
  - Chunk metadata.
- CALCMATE does not claim a novel embedding model.
- Its novelty is the use of symbolic curriculum structure to constrain semantic retrieval.

### Retrieval confidence behavior

- A low retrieval score can prevent confident generation for Grades 3–5.
- Unsupported or weakly supported curriculum questions can receive a refusal or retrieval-only result.
- Retrieval-only answers are explicitly distinguished from generated explanations.
- The model is not allowed to silently present an unsupported answer as textbook-grounded.

### Grade 1 and Grade 2 retrieval strategy

- The graph includes Grades 1 and 2.
- PDF retrieval coverage is less extensive for these grades.
- Grade 1–2 questions use grade-specific foundational objectives.
- Grade 1 objective examples:
  - Counting to 20.
  - Number names.
  - One more and one less.
  - Addition and subtraction with objects.
  - Zero.
  - Shapes and measurement.
- Grade 2 objective examples:
  - Numbers to 100.
  - Tens and ones.
  - Two-digit addition and subtraction.
  - Regrouping and borrowing.
  - Skip counting.
  - Pictographs and basic measurement.
- The local model is instructed to produce:
  - Concrete representations.
  - Worked examples.
  - Guided practice.
  - Independent checks.

### Retrieval evaluation

- Development set:
  - 50 questions.
  - 48 with indexed target concepts.
  - 2 unindexed coverage failures.
- Test set:
  - 43 questions.
  - 3 duplicated questions across development and test.
  - 40 non-overlapping questions used for primary comparison.
- Relevance definition:
  - A chunk is relevant when its metadata contains the target concept.

| Set | Approach | Precision@3 | Hit Rate@3 | MRR |
|---|---|---:|---:|---:|
| Development | Generic | 0.308 | 0.462 | 0.385 |
| Development | Curriculum-aware | 0.872 | 1.000 | 0.962 |
| Held-out | Generic | 0.408 | 0.763 | 0.385 |
| Held-out | Curriculum-aware | 0.897 | 0.948 | 0.962 |

### Retrieval metric definitions

- Precision@3:
  - Average fraction of the top three chunks that are relevant.
- Hit Rate@3:
  - Fraction of questions with at least one relevant result in the top three.
- MRR:
  - Average reciprocal rank of the first relevant result.

### Retrieval interpretation

- Curriculum-aware filtering greatly increases relevant context.
- Development Precision@3 rises from 0.308 to 0.872.
- Held-out Precision@3 rises from 0.408 to 0.897.
- Development Hit Rate@3 reaches 1.000.
- Held-out Hit Rate@3 reaches 0.948.
- MRR reaches 0.962 for both reported curriculum-aware sets.
- These results measure retrieval relevance, not final answer correctness.

## 9. AI Copilot architecture

### Purpose

- Provide a natural-language interface to the classroom intelligence system.
- Convert teacher questions into grounded operations.
- Combine exact classroom facts with graph and curriculum reasoning.
- Make complex database and graph behavior usable without requiring the teacher to know query syntax.

### Request context

The Copilot request can contain:

- Natural-language message.
- Grade.
- Subject.
- Workspace ID.
- Student ID.
- Concept ID.
- Screen context.
- LLM-use flag.
- Retrieval depth.

### Copilot pipeline

```text
Natural-language teacher request
        ↓
Context binding
        ↓
Intent and parameter extraction
        ↓
Operation dispatch
        ↓
Classroom snapshot / SQLite evidence
        +
Knowledge graph reasoning
        +
Curriculum retrieval where required
        ↓
Structured operation result
        ↓
Deterministic factual composition
        +
Bounded model explanation where appropriate
        ↓
Answer, sources, evidence, limitations, and action payload
```

### Intent extraction

- Deterministic routing is the production default.
- Regex and alias patterns identify common teacher language.
- Grade extraction handles:
  - “Grade 4.”
  - “Class 3.”
  - “4th grade.”
- Concept resolution maps phrases to canonical IDs.
- Natural dates can be extracted for leave rescheduling.
- Student names can be resolved to IDs from the classroom roster.
- Optional model-assisted routing can be enabled explicitly but does not replace the deterministic fallback.

### Operation families

#### Learner operations

- Find students by concept.
- Get student concept state.
- Get student progress.
- Get assessment history.
- Explain learning difficulty.
- Recommend a learner-specific activity.

#### Classroom operations

- Classroom summary.
- Attendance query.
- Roster query.
- Counts and comparisons.
- Group prerequisite readiness.
- Unsupported record mutation detection.

#### Curriculum operations

- Explain prerequisites.
- Explain concept.
- Retrieve NCERT resource.
- Recommend curriculum activity.

#### Planning operations

- Generate instructional schedule.
- Reschedule instructional plan.

### Student Copilot mode

- The student profile provides a dedicated AI Bar.
- The AI Bar creates or reuses a student-scoped conversation.
- The conversation ID is associated with the student.
- Follow-up requests inherit:
  - Student ID.
  - Grade.
  - Student Copilot screen context.
- Student scope is locked to prevent accidental learner switching.
- Backend student operations can use the learner’s weakest or unassessed concept when no concept is explicitly repeated.

### Student diagnosis behavior

- A learning-difficulty query can use:
  - The student’s recorded mastery.
  - State status.
  - Evidence count.
  - Prerequisite IDs.
  - Prerequisite readiness.
  - Recent teacher observations.
  - Latest attendance record.
- The system distinguishes:
  - Observed weakness.
  - Missing evidence.
  - Curriculum dependency.
  - Teacher-authored observation.
- It does not infer medical or personal diagnoses from educational records.

### Response policy

- Structured facts are composed deterministically.
- The model can improve explanation quality for curriculum questions.
- The model is not used to rewrite:
  - Scores.
  - Mastery values.
  - Attendance.
  - Student names.
  - Concept IDs.
  - Dates.
- The response can contain:
  - Main answer.
  - Evidence summary.
  - Graph finding.
  - Recommended next step.
  - Limitations.
  - Retrieved sources.
  - Structured schedule or reschedule action.

### Grounding and failure behavior

- Backend operations catch internal failures.
- Technical exception details are logged rather than exposed to teachers.
- Unknown data is represented as unknown.
- Missing concepts produce a request for clarification.
- Retrieval failure can produce a labelled retrieval-only fallback.
- Model failure does not mutate classroom records.
- Classroom operations remain deterministic even when model generation is unavailable.

## 10. Scheduling algorithm

### Inputs

- Selected grades.
- Available minutes.
- Priority mode.
- Date.
- Student roster.
- Attendance.
- Assessment history.
- Learner states.
- Concept graph.
- Prerequisite relationships.
- Curriculum metadata.

### Priority logic

The scheduler considers:

- Number of learners needing support.
- Mastery state.
- Missing or weak prerequisites.
- Downstream dependency importance.
- Learner attendance.
- Whether the grade has already received direct attention.
- Remaining time budget.
- Need for rotation fairness.

### Block construction

1. Build planning evidence for each selected grade.
2. Identify concepts with support needs or prerequisite gaps.
3. Rank candidate grade/concept pairs.
4. Allocate an opening block when time allows.
5. Allocate direct teacher instruction to the highest-priority safe candidate.
6. Assign concurrent activities to other grades.
7. Insert transitions and rotate the teacher.
8. Allocate closing review or exit-ticket time.
9. Validate total duration.
10. Store the generated schedule locally.

### Unattended activity policy

- Activities may be:
  - Independent.
  - Pair-based.
  - Group-based.
  - Worksheet-based.
  - Assessment-based.
- Activities are tied to the grade and concept.
- Learners with adequate readiness can receive consolidation.
- Learners with unknown readiness can receive a diagnostic check.
- The product avoids presenting unattended work as equivalent to direct teaching.

### Safety constraint

- A downstream concept should not receive direct instruction when required prerequisites are not ready.
- Instead:
  - Allocate teacher time to the prerequisite.
  - Give the downstream group safe consolidation or preparation.
  - Revisit the downstream concept after new evidence.

### Leave rescheduling algorithm

1. Detect teacher leave or absence intent.
2. Resolve leave date.
3. Compute next school day.
4. Identify affected grades.
5. Set direct teacher instruction on leave day to zero.
6. Select safe consolidation tasks from sufficiently mastered concepts where evidence exists.
7. Queue urgent prerequisite-support slots for the return day.
8. Return a structured reschedule proposal.
9. Let the teacher confirm before applying it to the local timetable.

### Scheduler research policies

- Round-Robin:
  - Cyclic grade rotation.
  - No graph safety.
- Static Timetable:
  - Fixed grade quotas.
  - Low switching cost.
- Needs-Only:
  - Raw failure-count prioritization.
  - No prerequisite constraint.
- CALCMATE:
  - Learner need plus graph readiness.
  - Topological prerequisite safety.
  - Differentiated unattended work.

### Simulation design

- Grades 3–5.
- Synthetic classroom learners.
- Five classroom scenarios.
- Five random seeds.
- 25 trials per policy.
- 12 slots.
- 180 minutes.
- Same within-policy observation noise conditions where applicable.

### Reported scheduler results

| Policy | Gap Coverage | Mastery Resolution | Prerequisite Violations | Avg. Delay | Time to Mastery | Switching Cost |
|---|---:|---:|---:|---:|---:|---:|
| Round-Robin | 0.187 | 0.004 | 111.28 | 10.77 | 11.44 | 11.00 |
| Static Timetable | 0.179 | 0.011 | 67.40 | 10.78 | 8.53 | 2.00 |
| Needs-Only | 0.175 | 0.003 | 237.12 | 10.94 | 10.15 | 4.56 |
| CALCMATE | 0.169 | 0.008 | **0.00** | 10.81 | 10.41 | 9.12 |

### Scheduler result interpretation

- CALCMATE’s strongest result is zero checked prerequisite violations.
- CALCMATE records the lowest reported unaddressed prerequisite deficit in the alternate summary table:
  - CALCMATE: 222.2.
  - Round-Robin: 248.6.
  - Static Timetable: 235.6.
  - Needs-Only: 259.7.
- CALCMATE has lower raw gap coverage than Round-Robin.
- This is the expected safety/coverage trade-off.
- Static Timetable has lower switching cost and can show strong short-term time-to-mastery under the tested simulator.
- The proposed method is not best on every metric.
- Its contribution is the safety-constrained allocation objective.

## 11. Frontend application

### Technology

- Expo / React Native.
- TypeScript.
- Expo Router navigation.
- Local SQLite through Expo SQLite.
- Secure session storage through Expo SecureStore.
- React Native UI components.
- FastAPI bridge for Copilot/RAG requests.

### Main screens and workflows

- Home / classroom dashboard.
- Student register.
- Student profile.
- Attendance.
- Assessments.
- Observations.
- Curriculum and concept views.
- General schedule planner.
- Weekly schedules.
- Active instructional session.
- Post-class review.
- Assistant / Copilot.
- Settings and backup / restore.

### Student profile

- Hero card:
  - Name.
  - Grade.
  - Roll number.
  - Last-seen information.
- Knowledge summary:
  - Assessed concepts.
  - On-track concepts.
  - Needs-support concepts.
  - Unassessed concepts.
- Concept cards:
  - Mastery bar.
  - State label.
  - Evidence count.
  - Last evidence date.
  - Prerequisite warning.
- Assessment history.
- Attendance history.
- Teacher observations.
- Student Copilot AI Bar.

### Student AI Bar

- Placed immediately below the hero card.
- Provides a learner-specific entry point.
- Dynamic suggestions are derived from live state.
- Sends:
  - Student ID.
  - Grade.
  - Concept ID when applicable.
  - Student Copilot screen context.
- Opens a persistent student-scoped thread.
- Contains no dependency on emojis or emoticons for meaning.

### Chat persistence

- Conversations are workspace-scoped.
- Student conversations contain a nullable student ID.
- Existing general conversations remain compatible.
- Message details store:
  - Status.
  - Request JSON.
  - Source JSON.
  - Error state.
  - Reply relationship.
- Pending messages can be recovered as failed and retried.

### Schedule presentation

- Schedule card shows:
  - Date.
  - Selected grades.
  - Duration.
  - Instruction slots.
  - Needs summary.
  - Warnings.
  - Activities.
- Teacher can edit and save blocks.
- Schedule records remain in the local schedules table.
- Reschedule proposal card shows:
  - Leave day strategy.
  - Return-day priority slots.
  - Confirmation action.

## 12. Persistence and consistency

### SQLite entities

- Workspaces.
- Profiles.
- Students.
- Concepts.
- Prerequisite edges.
- Attendance.
- Assessments.
- Competencies.
- Learner concept states.
- Observations.
- Schedules.
- Conversations.
- Messages.
- Message details.
- Assessment metadata.
- Sessions and outcomes.
- Notifications.

### Transactional behavior

- Assessment entry and learner-state updates are coordinated.
- Workspace scope is checked for reads and writes.
- Foreign keys preserve referential consistency.
- Schema migrations are versioned.
- SQLite uses WAL mode for local operation.
- Backups preserve classroom records and schedule data.

### Data flow after an assessment

```text
Teacher enters score
        ↓
Assessment row saved
        ↓
Learner state recomputed
        ↓
Competency / prerequisite view updated
        ↓
Copilot reads new evidence
        ↓
Scheduler changes future priority
```

## 13. Evaluation methodology

### Evaluation separation

The project separates evaluation into different computational experiments:

1. Retrieval evaluation.
2. Learner-estimation evaluation.
3. Scheduler simulation.
4. Software integration verification.

These are not merged into one artificial accuracy score.

### Retrieval evaluation

- Compares generic semantic retrieval with curriculum-aware retrieval.
- Uses development and held-out question sets.
- Relevance is based on canonical concept metadata.
- Metrics:
  - Precision@3.
  - Hit Rate@3.
  - MRR.

### Learner estimation evaluation

- Uses synthetic learners and simulated observations.
- Compares BKT and moment matching.
- Metrics:
  - MAE.
  - RMSE.
  - Pearson correlation.
- Uses explicit validation thresholds.

### Scheduler evaluation

- Uses synthetic learners across controlled scenarios.
- Compares four policies.
- Uses repeated random seeds.
- Measures safety, coverage, delay, mastery, and switching.

### Functional integration evaluation

- Backend test suite:
  - 71 tests passed in the supplied Chapter 5 result.
- Local scheduling:
  - 2,856 timing and grade-coverage cases passed in the supplied result.
- Additional checks cover:
  - SQLite updates.
  - State consistency.
  - Workspace isolation.
  - Recovery.
  - Planning behavior.
  - Evidence handling.

## 14. Novelty by dimension

### Curriculum graph novelty

- Converts a primary mathematics curriculum into an explicit, reusable dependency structure.
- Uses one canonical graph across application layers.
- Makes prerequisite safety computable and explainable.
- Links graph traversal to both Copilot diagnosis and scheduler priority.

### Learner-state novelty

- Maintains student-specific state instead of treating a grade as homogeneous.
- Uses recency-weighted sparse evidence.
- Preserves unknown as a valid epistemic state.
- Separates attendance from mastery.
- Provides a practical estimator that is transparent to a teacher and inexpensive on a mobile device.

### RAG novelty

- Uses semantic embeddings inside explicit curriculum constraints.
- Applies grade, subject, and concept filters before vector ranking.
- Uses canonical concept tags as the bridge between text retrieval and graph reasoning.
- Treats retrieval as evidence for instructional decisions, not only as a text-answer source.
- Preserves source metadata for auditability.

### Copilot novelty

- Routes natural language into structured educational operations.
- Combines live learner state, graph reasoning, and curriculum retrieval.
- Keeps classroom facts deterministic while allowing engaging language generation.
- Supports student-scoped persistent threads.
- Supports structured schedule and reschedule actions from conversational requests.

### Scheduler novelty

- Allocates direct teacher attention rather than only assigning fixed periods.
- Incorporates prerequisite safety into grade rotation.
- Generates structured work for unattended grades.
- Supports leave-day asynchronous consolidation and return-day remediation.
- Produces reproducible, testable schedules locally.

### Frontend novelty

- Connects teacher workflows end to end:
  - Evidence entry.
  - Learner state.
  - Copilot reasoning.
  - Schedule generation.
  - Instructional follow-up.
- Provides learner-specific AI interaction directly from the student profile.
- Makes graph and state reasoning visible to the teacher without exposing implementation complexity.
- Preserves core classroom operation without cloud dependency.

## 15. Research findings

### Retrieval finding

- Curriculum-aware retrieval improves concept-relevant evidence retrieval substantially over unrestricted semantic search.
- The improvement is strongest in:
  - Top-three precision.
  - First-relevant-result rank.
  - At-least-one-relevant-result coverage.

### Learner-estimation finding

- Moment matching passed the specified synthetic validation gate.
- Fixed-parameter BKT failed that gate under the tested response model.
- The result is specific to the experiment and not a universal estimator ranking.

### Scheduler finding

- Graph-aware allocation eliminates the checked prerequisite violations in the controlled simulator.
- The method reduces the reported unaddressed deficit.
- Safety comes with lower raw gap exposure and higher switching than a static timetable.
- The result supports a multi-objective interpretation of instructional scheduling.

### Integration finding

- The software connects:
  - Local classroom state.
  - Knowledge graph.
  - Learner estimation.
  - Copilot operations.
  - Retrieval.
  - Scheduling.
  - Frontend workflows.
- The system demonstrates a closed loop rather than independent prototypes.

## 16. Limitations

- Retrieval corpus coverage is stronger for Grades 3–5 than Grades 1–2.
- Retrieval metrics use concept-tag relevance rather than full generated-answer evaluation.
- Scheduler learners and learning transitions are synthetic.
- Simulated mastery does not establish real classroom learning gains.
- Sparse teacher entry can leave many learner states unknown.
- Field trials with real teachers and learners are still required.
- Physical-device latency, energy, thermal behavior, and memory require separate measurement.
- The checked prerequisite safety metric focuses on the simulator’s modeled dependencies.
- The local model’s generation quality needs continued evaluation with teacher-authored questions.
- The project does not claim universal superiority on every scheduler metric.

## 17. Future methodology extensions

- Expand NCERT retrieval coverage to Grades 1 and 2.
- Add independently annotated answer-faithfulness evaluation.
- Evaluate retrieval with real teacher questions collected in classrooms.
- Add cross-grade prerequisite safety to the simulator.
- Compare more learner-state estimators under sparse real evidence.
- Evaluate teacher workload and decision time.
- Run longitudinal classroom trials.
- Add uncertainty calibration for learner-state predictions.
- Measure local model latency, memory, and energy on target devices.
- Improve source-level citation display and answer traceability.
- Add teacher feedback signals to activity recommendation evaluation.

## 18. Project summary

CALCMATE is a classroom intelligence system for multi-grade Mathematics teaching. Its methodology is based on a shared curriculum graph, evidence-based learner states, structurally constrained semantic retrieval, safe Copilot operations, and deterministic teacher-attention allocation. Its novelty is not a single isolated model. It is the integration of explicit curriculum structure, learner evidence, retrieval, natural-language interaction, and offline-first scheduling into one closed instructional loop.

The essential algorithmic idea is:

```text
Estimate the learner state
        ↓
Locate the learner or group in the curriculum graph
        ↓
Identify the highest-impact safe prerequisite intervention
        ↓
Retrieve curriculum evidence when explanation is needed
        ↓
Allocate scarce teacher attention
        ↓
Assign structured concurrent work to other grades
        ↓
Collect new evidence and repeat
```

The result is a system that helps a teacher answer not only:

> “What does this concept mean?”

but also:

> “Which learner needs me now, why do they need me, what should I do, what should the other grades do meanwhile, and what evidence should I collect next?”
