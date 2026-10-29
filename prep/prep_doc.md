# CALCMATE Final Review Preparation Guide

## How to use this document

- Use this as the preparation document for a panel member who is seeing CALCMATE for the first time.
- Present the project as an integrated classroom intelligence system, not as five unrelated modules.
- Keep returning to the central problem:
  - One teacher.
  - Multiple grades in one classroom.
  - Different learner states.
  - Limited direct-teaching minutes.
  - Prerequisite gaps that make a static timetable unsafe.
- Use the phrase **teacher-attention allocation** instead of only saying “timetable generation.”
- Use the phrase **curriculum- and knowledge-state-aware retrieval** instead of describing CALCMATE as a conventional semantic-search chatbot.
- Clearly separate:
  - Measured research results.
  - Verified software behavior.
  - Product capabilities.
  - Future field-validation work.
- Do not claim that simulated learning gains are classroom learning gains.
- Do not claim that retrieval Precision@3 is answer-generation accuracy.
- Do not claim that zero simulated prerequisite violations proves zero violations in every real classroom.

---

## 1. The one-minute explanation

> CALCMATE is an offline-first teacher copilot and instructional-attention allocation system for a single teacher managing multiple primary-school grades simultaneously. It combines a canonical mathematics prerequisite graph, live classroom evidence from attendance and assessments, learner-state estimation, curriculum-aware retrieval, structured Copilot operations, and a deterministic multi-grade scheduler. The system identifies which foundational learning gaps should receive scarce teacher time, gives other grades safe differentiated activities while they wait, and updates the next recommendation when new evidence is recorded. Its research contribution is not simply generating a timetable; it is enforcing prerequisite-safe allocation of teacher attention under multi-grade constraints.

### The core classroom problem

- A conventional timetable assumes:
  - Each class has its own teacher.
  - All learners in a grade are approximately at the same level.
  - A missed lesson can simply be shifted to another period.
  - Teaching a later concept is safe even when prerequisite understanding is absent.
- A single-teacher multi-grade classroom violates all of those assumptions.
- The teacher must decide simultaneously:
  - Which grade needs direct attention now?
  - Which concept is the highest-leverage intervention?
  - Is the problem a current-topic problem or a prerequisite problem?
  - What should other grades do while the teacher is occupied?
  - Which learners are absent today?
  - What evidence is reliable, and what is still unknown?
- CALCMATE treats teacher attention as a scarce instructional resource.

### The central intelligence loop

```text
Canonical curriculum graph
        +
Assessments + attendance + teacher observations
        +
Learner-state estimation
        +
Prerequisite readiness and root-cause reasoning
        ↓
Copilot explanation and teacher prioritisation
        ↓
Multi-grade direct-instruction allocation
        ↓
Independent / peer / worksheet activities for unattended groups
        ↓
New assessments and observations
        ↓
Updated learner states and next schedule
```

### What makes this useful as a product

- It does not stop at answering a teacher’s question.
- It connects:
  - The teacher’s natural-language query.
  - The actual learner record.
  - The canonical concept graph.
  - The current instructional priority.
  - The next schedule.
  - The next assessment.
- The product therefore behaves like a persistent classroom memory and decision-support system.

---

## 2. What is genuinely novel and what must be stated carefully

### The strongest novelty claim

- CALCMATE is a **curriculum- and knowledge-state-aware orchestration system**.
- Its distinctive design is the combination of:
  - Structural curriculum dependencies.
  - Learner-specific evidence.
  - Scarce teacher-attention allocation.
  - Offline-first execution.
  - Natural-language Copilot access.
- The system does not treat retrieval, learner modeling, and scheduling as separate demonstrations.
- They share the same canonical concept identifiers and prerequisite relationships.

### The RAG novelty claim

- The embedding model itself is not claimed as novel.
- `all-MiniLM-L6-v2` is a practical, lightweight sentence-embedding model suitable for local retrieval.
- The novelty is the **retrieval architecture around the embeddings**:
  - Text is tagged with canonical concept IDs.
  - Every chunk carries grade and subject metadata.
  - Queries are mapped to canonical concepts where possible.
  - Search is restricted by curriculum metadata before similarity ranking.
  - Concept filtering is an intersection constraint, not a post-hoc display filter.
  - Retrieved evidence can be checked against the prerequisite graph and learner state.
- A safe statement is:
  - “CALCMATE uses semantically embedded curriculum passages, but the retrieval decision is structurally constrained by curriculum identity, grade, subject, and concept relationships.”
- Avoid saying:
  - “We invented a new embedding model.”
  - “The vectors themselves encode the entire prerequisite graph.”
- The stronger and more accurate claim is **structurally constrained retrieval** or **curriculum-aware semantic retrieval**.

### The scheduling novelty claim

- The scheduler is not only rotating grades.
- It ranks instructional need using:
  - Learner-state evidence.
  - Weakness counts.
  - Readiness status.
  - Prerequisite gaps.
  - Curriculum dependency importance.
  - Attendance.
  - Available minutes.
- It refuses unsafe advancement when foundational readiness is missing.
- It produces concurrent work for grades not receiving the teacher.
- The result is a **safety-aware attention allocation policy**, not a static timetable.

### The Copilot novelty claim

- The Copilot is not an unrestricted chatbot that invents a classroom answer.
- It is a structured natural-language interface over:
  - Live classroom evidence.
  - The curriculum graph.
  - Learner-state operations.
  - Curriculum retrieval.
  - Schedule generation.
- The language model is used where language generation helps.
- Deterministic operations are used where factual correctness matters.
- This separation is important for educational trust.

---

## 3. Complete system architecture

### Layered architecture

| Layer | Main responsibility | Key artifacts / components |
|---|---|---|
| Curriculum layer | Canonical concept vocabulary and dependencies | `data/concepts.csv`, `data/prerequisite_edges.csv`, knowledge graph |
| Evidence layer | Store classroom facts locally | SQLite students, assessments, attendance, observations |
| Estimation layer | Convert sparse assessments into learner states | Score-Ratio-v1, `learner_concept_states` |
| Retrieval layer | Find curriculum-grounded passages | PDF extraction, chunking, Sentence Transformers, FAISS |
| Copilot layer | Route teacher language to safe operations | intent extractor, operations, response composer |
| Allocation layer | Allocate teacher minutes across grades | deterministic TypeScript scheduler and research simulator |
| Application layer | Make the intelligence usable in a classroom | Expo / React Native frontend |
| Persistence layer | Preserve state offline and support recovery | local SQLite, message details, schedules, backups |

### Runtime topology

- The mobile application is the primary classroom data store.
- Essential classroom operations run locally:
  - Roster.
  - Attendance.
  - Assessment entry.
  - Learner-state updates.
  - Knowledge-state views.
  - Multi-grade local schedule generation.
  - Saved plans and chat history.
- The Copilot/RAG bridge runs through a local FastAPI service for the current deployment.
- The local model is built from the repository `ModelFile`:
  - Runtime name: `calcmate:latest`.
  - Build command: `ollama create calcmate -f ModelFile`.
- The phone does not need direct access to Ollama.
- The phone communicates with the local FastAPI bridge.
- The scheduling engine does not depend on the RAG server.
- If the RAG/model path is unavailable:
  - Core classroom records remain local.
  - The local scheduler remains available.
  - Retrieval-only or deterministic Copilot behavior can be used where supported.

### Data ownership and privacy boundary

- Classroom evidence belongs to the teacher workspace.
- Requests are workspace-scoped.
- The backend reasons over a bounded classroom snapshot rather than receiving arbitrary database paths.
- The snapshot contains relevant classroom evidence and excludes credentials.
- SQL reads are scoped by workspace and student identifiers.
- Chat history is stored locally with the workspace and conversation.
- The application distinguishes:
  - Classroom evidence.
  - Model output.
  - Retrieved source material.
  - Teacher-authored notes.

---

## 4. Canonical curriculum and knowledge graph

### Graph contents

- 84 canonical mathematics concepts across Grades 1–5.
- 73 verified prerequisite edges.
- Directed acyclic graph structure.
- 0 cycles in the validated graph.
- 3 cross-grade bridging transitions.
- Canonical IDs such as `M403`, `M404`, and `M407` are shared across:
  - CSV curriculum data.
  - Prerequisite edges.
  - SQLite concepts.
  - Learner states.
  - Retrieval metadata.
  - Scheduler reasoning.
  - Copilot parameters.

### Why a graph is necessary

- A list of topics only says what exists.
- A prerequisite graph says what must be understood before what.
- For example:
  - A learner may appear weak in division with remainder.
  - The graph can show that the deeper issue is equal sharing or foundational division.
  - The scheduler can therefore allocate attention to the upstream blocker.
- This avoids the common failure mode of repeatedly teaching the visible downstream topic.

### Graph operations

- Forward dependency reasoning:
  - What later concepts depend on this concept?
- Backward prerequisite traversal:
  - What must a learner know first?
- Topological ordering:
  - Which concepts are safe to address before dependent concepts?
- Readiness inspection:
  - Are all direct prerequisites likely ready?
- Downstream importance:
  - How much future learning is blocked by the concept?
- Gap propagation:
  - A weak or unknown prerequisite can flag a downstream concept as unsafe to advance.

### Graph and RAG share one vocabulary

- The retriever does not operate on disconnected textbook text only.
- Every indexed resource is associated with canonical concept IDs.
- A teacher query can be resolved to a concept ID.
- The query can then be restricted to chunks tagged with that concept.
- The returned passage can be interpreted alongside prerequisite readiness.
- This creates a bridge between:
  - “What does the curriculum say?”
  - “What does this learner know?”
  - “What should the teacher do next?”

### Graph research impact

- It provides the safety constraint used by the proposed allocator.
- It enables interpretable explanations.
- It makes the scheduler auditable.
- It allows the Copilot to explain root causes rather than only symptoms.
- It makes cross-grade dependencies explicit.

### Defence answer: “Why not use only an LLM?”

- An LLM can produce plausible explanations, but it does not provide a reliable canonical prerequisite structure by itself.
- A graph provides:
  - Stable identifiers.
  - Explicit dependencies.
  - Deterministic traversal.
  - Auditable safety rules.
  - Consistent behavior across students and sessions.
- The LLM can make the explanation engaging after the graph has established the facts.

---

## 5. Learner-state estimation

### Evidence model

- Assessment evidence contains:
  - Student ID.
  - Concept ID.
  - Date.
  - Score.
  - Maximum score.
  - Creation and update timestamps.
- Attendance contains:
  - Student ID.
  - Date.
  - Present / absent / late status.
- Teacher observations contain:
  - Student ID.
  - Free-text note.
  - Creation and update timestamps.
- These evidence types are not conflated.

### Score-Ratio-v1 estimator

For assessment history sorted from most recent to oldest:

\[
\hat{\theta} =
\frac{\sum_{i=0}^{n-1} \left(\frac{s_i}{m_i}\right) \lambda^i}
{\sum_{i=0}^{n-1} \lambda^i}
\]

- `s_i`: score on assessment `i`.
- `m_i`: maximum score on assessment `i`.
- `lambda = 0.75`: recency decay.
- `i = 0`: most recent assessment.
- Recent evidence contributes more than older evidence.
- The estimate is normalized between 0 and 1.

### State categories

| State | Rule | Interpretation |
|---|---|---|
| `likely_ready` | mastery >= 0.70 | Evidence suggests the learner can proceed or consolidate |
| `insufficient` | 0.60 <= mastery < 0.70 | Borderline; additional evidence or support is needed |
| `needs_support` | mastery < 0.60 | Direct support should be considered |
| `unknown` | no evidence | No mastery claim is made |

### Important safety distinction

- No evidence is not treated as zero mastery.
- An absent learner is not assigned a lower mastery value.
- Attendance can influence scheduling availability and urgency.
- Attendance cannot create a score or mutate learner mastery.
- This distinction prevents the system from confusing:
  - “The learner was absent.”
  - “The learner attempted the concept and scored zero.”
  - “The learner has not yet been assessed.”

### Auxiliary learner-estimation experiment

- 30 synthetic learners.
- 21 Grade 4 concepts.
- 30 observation days.
- 3 random seeds.
- Compared estimators:
  - Fixed-parameter BKT.
  - Moment matching.
- Results:

| Estimator | MAE | RMSE | Pearson r | Gate |
|---|---:|---:|---:|---|
| BKT with fixed parameters | 0.2530 | 0.3063 | 0.7707 | Fail |
| Moment matching | 0.0918 | 0.1143 | 0.9095 | Pass |

- Metric meanings:
  - MAE: mean absolute distance between estimated and target mastery.
  - RMSE: square-rooted mean squared error; penalizes larger errors more strongly.
  - Pearson r: linear association between estimates and target values.
- Validation gate:
  - MAE <= 0.10.
  - RMSE <= 0.13.
  - Pearson r > 0.90.
  - Convergence must also be verified.
- Interpretation:
  - Moment matching passed the defined simulator gate.
  - This does not prove that moment matching is universally superior to all knowledge-tracing methods.
  - It shows that it fit the response-generating process used in this controlled experiment better than the tested fixed-parameter BKT.
- Operational application note:
  - The deployed application uses Score-Ratio-v1 with recency decay.
  - The auxiliary simulator experiment and operational estimator are different configurations and must not be conflated.

---

## 6. RAG: the complete technical story

### Corpus scope

- The indexed curriculum corpus consists of NCERT Mathematics textbook material.
- Operational retrieval coverage is primarily Grades 3–5.
- Grades 1–2 are represented in the canonical curriculum graph and foundational teaching guide, but do not have the same indexed PDF retrieval coverage.
- The supplied evaluation reports:
  - 576 indexed items in the current retrieval index.
  - 67 concepts represented by retrieval items.
  - 79.8% concept coverage of the 84-node graph.
- Other project reports refer to 569 chunks for an earlier corpus artifact.
- Defensible wording:
  - “The exact chunk count depends on the generated corpus artifact; the current evaluation reports 576 items, while an earlier verified report records 569. The architectural and evaluation conclusions are based on the corresponding manifest and index pair.”

### Source preparation

- Source documents are mapped through a chapter manifest.
- Required manifest fields:
  - PDF filename.
  - Canonical concept IDs.
  - Grade.
  - Subject.
- PDF text is extracted with `pdfplumber`.
- Cleaning includes:
  - Removal of page-marker artifacts.
  - Dehyphenation across line breaks.
  - Whitespace normalization.
  - Paragraph reconstruction.
- Empty or non-extractable pages are reported for inspection.

### Chunking strategy

- The primary strategy is paragraph-first chunking.
- Text is split on blank-line paragraph boundaries.
- Paragraphs shorter than 80 characters are removed as low-information fragments.
- If at least 3 usable paragraphs remain:
  - Each usable paragraph becomes a candidate chunk.
  - Exact duplicate chunks are removed.
- If a source has too few usable paragraphs:
  - A sliding-window fallback is used.
  - Window size: 180 words.
  - Overlap: 40 words.
  - Step: 140 words.
  - Windows shorter than the minimum character threshold are removed.
  - Exact duplicates are removed.
- Why this is appropriate:
  - Paragraphs preserve textbook explanation boundaries.
  - Sliding windows prevent short or poorly extracted chapters from disappearing.
  - Overlap prevents a concept explanation split at a boundary from losing context.
  - The strategy avoids arbitrarily cutting every document into equal tokens.

### Metadata attached to each chunk

- Chunk ID.
- Source PDF.
- Source URL when available.
- Source pages when available.
- Chapter / resource kind.
- Chunk index within the source.
- Grade.
- Subject.
- Canonical concept IDs.
- Character count.
- Fallback-use flag at retrieval time.

### Embedding model

- Model: `all-MiniLM-L6-v2`.
- It produces compact sentence embeddings suitable for local inference.
- The model is loaded from the local cache for offline operation.
- Text and query embeddings are normalized.
- Normalization makes the inner-product score equivalent to cosine similarity for ranking.
- The choice is engineering-conscious:
  - Lightweight compared with large embedding models.
  - Fast enough for a local teacher-support workflow.
  - Strong enough for short curriculum questions and textbook passages.
  - Compatible with a local FAISS index.

### Vector database / index

- Vector index: FAISS.
- Index uses normalized embeddings and ID-based storage.
- Metadata is stored separately in `vector_store_meta.json`.
- Index and metadata are validated together:
  - Index total count must equal metadata count.
  - Corpus manifest checksums verify that index and metadata were generated as a pair.
- The retriever is cached as a process-level singleton.
- This avoids reloading the embedding model and index for every question.

### Curriculum-aware retrieval algorithm

1. Validate that the query is non-empty.
2. Embed the teacher’s question with the same embedding model.
3. Determine the requested grade and subject.
4. Resolve a concept phrase to a canonical concept ID where possible.
5. Select candidate chunk IDs from the grade/subject bucket.
6. If concept IDs are present, intersect the candidates with the chunk concept tags.
7. Use FAISS ID selectors to restrict the similarity search itself.
8. Retrieve the top `k` chunks, normally `k=3` for general retrieval.
9. Return chunks sorted by similarity score.
10. Preserve source metadata for display and audit.

### Why this is not conventional global RAG

- Conventional baseline:
  - Embed the question.
  - Search the entire corpus.
  - Return the nearest passages.
- CALCMATE:
  - Uses embedding similarity only inside a curriculum-defined candidate set.
  - Restricts grade and subject before ranking.
  - Uses concept metadata when a concept can be resolved.
  - Prevents a high-similarity but wrong-grade passage from becoming the primary evidence.
  - Connects retrieved content to the prerequisite graph and learner state.
- This is a **hybrid symbolic-semantic retrieval architecture**:
  - Semantic layer: embedding similarity.
  - Symbolic layer: grade, subject, concept IDs, graph constraints.
  - Evidence layer: source and page metadata.
- The important design insight is that educational retrieval should optimize for **curriculum relevance and instructional safety**, not only textual similarity.

### Confidence gate

- For Grades 3–5, low top-score retrieval is treated as insufficient curriculum evidence.
- The system can refuse to generate a confident curriculum answer when retrieval is below the configured threshold.
- This prevents a fluent model answer from being mistaken for a grounded textbook answer.
- For Grades 1–2:
  - The system uses a foundational objective guide because PDF retrieval coverage is limited.
  - The LLM is constrained to grade-specific competencies.
  - It is prompted to give concrete representations, worked examples, guided practice, and a quick check.
- This is an explicit coverage-aware design, not an accidental gap.

### RAG evaluation dataset integrity

- Development file:
  - 50 questions.
  - 48 questions had target concepts present in the index.
  - 2 questions were unindexed concept coverage failures and excluded from retrieval metric calculations.
- Test file:
  - 43 questions.
  - Text normalization found 3 identical questions across development and test sets.
  - The primary non-overlapping comparison used the remaining 40 questions.
- Evaluation relevance definition:
  - A retrieved chunk is relevant when its metadata contains the target concept.
- This measures concept-tag retrieval relevance.
- It does not measure the correctness of the final generated answer.

### RAG retrieval results

| Question set | Retrieval approach | Precision@3 | Hit Rate@3 | MRR |
|---|---|---:|---:|---:|
| Development | Generic semantic search | 0.308 | 0.462 | 0.385 |
| Development | Curriculum-aware search | 0.872 | 1.000 | 0.962 |
| Held-out | Generic semantic search | 0.408 | 0.763 | 0.385 |
| Held-out | Curriculum-aware search | 0.897 | 0.948 | 0.962 |

### Metric meanings

- Precision@3:
  - Of the first three retrieved chunks, how many are relevant on average.
  - Higher means less irrelevant evidence in the top context.
- Hit Rate@3:
  - Proportion of questions for which at least one of the first three chunks is relevant.
  - Higher means more questions receive at least one useful passage.
- MRR, Mean Reciprocal Rank:
  - For each question, take the reciprocal of the rank of the first relevant result.
  - Average across questions.
  - A score near 1 means the first relevant passage usually appears at rank 1.

### Interpretation of the RAG results

- Development Precision@3 increased from 0.308 to 0.872.
- Development Hit Rate@3 increased from 0.462 to 1.000.
- Development MRR increased from 0.385 to 0.962.
- Held-out Precision@3 increased from 0.408 to 0.897.
- Held-out Hit Rate@3 increased from 0.763 to 0.948.
- Held-out MRR increased from 0.385 to 0.962.
- The result supports the claim that curriculum restrictions significantly improve concept-relevant retrieval.
- It does not prove that every generated explanation is correct.
- It does not prove field learning improvement.

### Answer-generation safeguards

- Retrieval is performed before generation for curriculum-grounded questions.
- The prompt explicitly sets the grade as a hard scope boundary.
- Retrieved passages are treated as evidence, not as executable instructions.
- The model is instructed not to invent:
  - Student data.
  - Page numbers.
  - Chapter names.
  - Quotes.
  - Unsupported citations.
- Structured classroom facts are composed deterministically.
- The language model is not allowed to rewrite mastery values or attendance records.
- Generation failures are redacted from user-facing messages.
- Retrieval-only output is explicitly labelled as retrieval-only evidence.

---

## 7. AI Copilot: from natural language to safe action

### What the Copilot is

- The AI Copilot is a natural-language control surface over classroom intelligence.
- It combines:
  - Intent extraction.
  - Context binding.
  - Classroom snapshot reasoning.
  - Knowledge graph traversal.
  - Curriculum retrieval.
  - Deterministic response composition.
  - Optional grounded LLM explanation.
- It is closer to a **state-aware agentic router** than a plain chatbot.

### Copilot request flow

```text
Teacher question
      ↓
Frontend context: workspace, grade, student, concept, screen
      ↓
Bounded classroom evidence snapshot
      ↓
Deterministic intent extraction
      ↓
Structured operation dispatch
      ↓
SQLite / graph / retrieval evidence
      ↓
Deterministic factual composition
      ↓
Optional grounded language generation for explanation
      ↓
Answer + evidence + sources + action card
```

### Context is part of the query

- A question from a general classroom screen is different from the same question launched from a student profile.
- The request can include:
  - `workspace_id`.
  - `student_id`.
  - `concept_id`.
  - `screen_context`.
  - Grade.
  - Subject.
- In a student Copilot thread:
  - The student ID is authoritative.
  - Follow-up questions inherit the learner scope.
  - A name mentioned casually in a follow-up cannot silently switch the student.
- This solves a major conversational grounding problem.

### Deterministic intent routing

- Deterministic routing is the production default.
- Model-assisted routing is optional and guarded by explicit configuration.
- The router first handles classroom-record queries before broad concept patterns.
- This prevents queries such as attendance questions from being misclassified as generic curriculum questions.
- Natural-language aliases and concept resolution map teacher language to canonical IDs.

### Copilot operation families

#### Learner-state operations

- Find students by concept.
- Get a student’s concept state.
- Get student progress.
- Get assessment history.
- Explain learning difficulty.
- Compare learner states where supported.

#### Classroom operations

- Classroom learning summary.
- Attendance lookup.
- Student roster and counts.
- Group prerequisite readiness.
- Classroom record queries.

#### Curriculum operations

- Explain prerequisites.
- Explain a concept.
- Recommend a curriculum activity.
- Retrieve an NCERT resource.

#### Planning operations

- Generate an instructional schedule.
- Reschedule an instructional plan around teacher leave.
- Assign safe independent or peer practice on the leave day.
- Move priority teacher attention to the next available school day.

### Examples of Copilot behavior

#### Query: “Who is struggling with fractions in Grade 4?”

- Extracts:
  - Intent: find students by concept.
  - Grade: 4.
  - Concept: fraction-related canonical ID(s).
- Reads:
  - Learner concept states.
  - Mastery estimates.
  - State statuses.
  - Student roster.
- Checks:
  - Prerequisite readiness.
  - Unknown evidence versus low evidence.
- Returns:
  - Students needing support.
  - Recorded evidence.
  - Relevant prerequisite explanation.
  - No fabricated student marks.

#### Query: “Why is Aarav struggling with place value?”

- Student thread supplies Aarav’s student ID.
- The operation reads the student’s actual state.
- The graph identifies prerequisite dependencies.
- The response can state:
  - Recorded mastery, if available.
  - Evidence count and status.
  - Which prerequisite is blocking progress.
  - A concrete intervention.
- If evidence is missing:
  - The system says that mastery is unknown.
  - It recommends a diagnostic check rather than inventing a diagnosis.

#### Query: “What should I teach Aarav next?”

- The student-thread operation prioritizes the learner’s highest-impact gap.
- It selects an unready or unassessed concept using the graph and learner state.
- It generates a concrete activity.
- It can recommend an exit check.
- The activity is still teacher-controlled.

#### Query: “I am on leave next Monday. Reschedule my Grades 3 and 4 sessions.”

- Extracts leave date and return date.
- Ensures zero direct teacher instruction on the leave day.
- Selects only previously mastered concepts for peer or worksheet consolidation.
- Queues urgent prerequisite remediation for the next school day.
- Returns a structured reschedule card.
- The teacher confirms before saving the plan locally.

### Response composition policy

- Factual classroom operations are formatted deterministically.
- This preserves exact:
  - Names.
  - Scores.
  - Mastery values.
  - Dates.
  - Attendance statuses.
  - Concept IDs.
- Curriculum explanations may use the local model for engaging language.
- The model receives bounded evidence and a strict educational prompt.
- If generation fails:
  - Internal exception details are logged, not displayed.
  - The user receives a readable fallback or a clearly labelled retrieval-only view.

### Why this is more reliable than direct LLM querying

- Direct LLM querying asks the model to infer facts.
- CALCMATE asks the system to retrieve and compute facts first.
- The model then explains those facts.
- This is the difference between:
  - “The model thinks Aarav is weak in place value.”
  - “SQLite records Aarav at 45% on M202, the graph shows M202 blocks M203, and the model explains an intervention using those facts.”

---

## 8. Scheduler and instructional allocation

### The operational scheduling problem

- Available direct teacher minutes are limited.
- Multiple grades compete for that time.
- Students within the same grade may have different needs.
- Direct attention must be prioritized.
- Unattended groups need structured work.
- A schedule should remain safe when evidence is incomplete.

### Production scheduler behavior

- The local TypeScript scheduler is the single production multi-grade scheduler.
- It runs on the device.
- It uses live local classroom evidence.
- It accounts for:
  - Selected grades.
  - Available minutes.
  - Attendance.
  - Assessment evidence.
  - Learner states.
  - Concept priorities.
  - Prerequisite gaps.
  - Activity type.
  - Opening and closing blocks.
  - Transitions.
- It creates rotation blocks with:
  - Teacher-directed grade.
  - Teacher activity.
  - Concurrent activities for other grades.
  - Reason for priority.
  - Duration.
  - Planned / completed / partial / postponed state.

### Typical generated rotation

- Opening warm-up:
  - Whole-class number sense or shared activation.
- Direct block:
  - Teacher works with the highest-priority grade and concept.
- Concurrent block:
  - Other grades perform peer practice, guided worksheets, or independent consolidation.
- Transition:
  - Learners move between teacher attention and independent work.
- Next direct block:
  - Teacher shifts to the next high-value group.
- Closing reflection:
  - Exit tickets or quick formative checks.

### Why unattended work matters

- A conventional schedule only says the teacher is with Grade 4.
- CALCMATE also says what Grades 2, 3, and 5 should do during that time.
- Activities are differentiated by:
  - Grade.
  - Concept.
  - Mastery state.
  - Whether the task is independent, pair, group, worksheet, or assessment.
- This converts waiting time into structured learning time.

### Scheduling policies evaluated

#### Round-Robin

- Cyclically rotates across grade cohorts.
- Does not use prerequisite safety.
- Useful as a simple baseline.

#### Static Timetable

- Uses fixed grade time quotas.
- Represents a conventional textbook-style timetable.
- Has low switching cost but cannot adapt well to learner evidence.

#### Needs-Only / Ablated policy

- Greedily selects the grade with the highest raw failure count.
- Does not use the knowledge graph prerequisite constraint.
- Tests whether learner need alone is sufficient.

#### CALCMATE policy

- Uses learning need and topological prerequisite readiness.
- Prioritizes upstream bottlenecks.
- Blocks unsafe downstream instruction.
- Uses attendance and differentiated concurrent tasks.
- Represents the proposed approach.

### Controlled simulation design

- 30 synthetic learners per grade for Grades 3–5 in the supplied Chapter 5 results.
- Total enrollment: 90 learners.
- 5 scenarios:
  - Balanced.
  - Heterogeneous.
  - Prerequisite-gap heavy.
  - Learning-gap heavy.
  - Attendance-disrupted.
- 5 random seeds.
- 25 trials per policy.
- 12 instruction slots.
- 180 total instructional minutes per trial.
- Same observation noise is used within comparable policy trials.
- The graph-aware policy is evaluated separately from the learner-estimation experiment.

### Scheduler metrics

| Metric | Meaning | Desired direction |
|---|---|---|
| Gap Coverage | Percentage of deficient learner–concept pairings offered instruction | Higher, but not at the cost of unsafe advancement |
| Mastery Resolution / Mastery Yield | Percentage of learners reaching simulator-defined mastery | Higher |
| Prerequisite Violations | Learner–instruction events where teaching occurs without required prerequisite readiness | Lower; ideally zero |
| Average Delay | Delay before a deficient learner–concept pairing receives attention | Lower |
| Time to Mastery | Time until the simulator marks the target as mastered | Lower |
| Switching Cost | Number of grade switches by the teacher | Lower, subject to instructional safety |
| Unaddressed Deficit | Remaining aggregate prerequisite deficit after the trial | Lower |

### Scheduler results from Chapter 5

| Policy | Gap Coverage | Mastery Resolution | Prerequisite Violations | Avg. Delay | Time to Mastery | Switching Cost |
|---|---:|---:|---:|---:|---:|---:|
| Round-Robin | 0.187 | 0.004 | 111.28 | 10.77 | 11.44 | 11.00 |
| Static Timetable | 0.179 | 0.011 | 67.40 | 10.78 | 8.53 | 2.00 |
| Needs-Only | 0.175 | 0.003 | 237.12 | 10.94 | 10.15 | 4.56 |
| CALCMATE | 0.169 | 0.008 | **0.00** | 10.81 | 10.41 | 9.12 |

### Alternate summary metrics used in earlier review material

| Policy | Unaddressed Deficit | Mastery Yield |
|---|---:|---:|
| Round-Robin | 248.6 | 0.4% |
| Static Timetable | 235.6 | 1.1% |
| Needs-Only | 259.7 | 0.3% |
| CALCMATE | **222.2** | **0.8%** |

- The exact display table depends on the evaluation artifact and metric naming.
- The stable findings are:
  - CALCMATE records zero prerequisite violations in the checked policy comparison.
  - CALCMATE has the lowest unaddressed deficit in the reported comparison.
  - CALCMATE has lower raw gap coverage than Round-Robin.
  - CALCMATE trades some short-term exposure for prerequisite safety.
  - Static timetable has lower switching cost and strong simulated time-to-mastery in this configuration, so CALCMATE should not be presented as best on every metric.

### How to defend the lower gap coverage

- Round-Robin reaches more deficient pairings because it teaches without checking prerequisite readiness.
- CALCMATE rejects unsafe direct instruction when foundations are not ready.
- The lower 16.9% coverage is therefore not automatically a failure.
- It reflects a safety policy:
  - Repair foundational blockers first.
  - Delay unsafe downstream topics.
  - Avoid repeated exposure that cannot be understood.
- The correct conclusion is a trade-off, not universal superiority.

### Teacher leave and smart rescheduling

- Leave-day logic detects:
  - Teacher absence window.
  - Leave date.
  - Next school day.
  - Affected grades.
- It creates:
  - No direct teacher instruction on the leave day.
  - Independent peer practice or consolidation.
  - Tasks selected from concepts with sufficient recorded readiness where possible.
  - Priority remediation slots on return.
- The frontend renders a proposal card.
- The teacher confirms before applying it to local schedule storage.
- This extends the same safety principle to disruption planning.

---

## 9. Frontend application: end-to-end teacher product

### Product principle

- The application is designed around teacher decisions, not around exposing raw model output.
- The teacher can move through:
  - Daily classroom overview.
  - Attendance.
  - Student evidence.
  - Knowledge states.
  - Copilot explanation.
  - Schedule generation.
  - Live teaching.
  - Post-class evidence.

### Main frontend capabilities

- Teacher account and workspace.
- Multi-grade dashboard.
- Student roster by grade.
- Student profiles.
- Attendance with Present / Absent / Late.
- Assessment entry and history.
- Teacher observations.
- Concept progress and prerequisite warnings.
- Student-specific Copilot AI Bar.
- General teacher Copilot.
- NCERT sources panel.
- General multi-grade schedule generation.
- Schedule editing and completion states.
- Leave-day rescheduling proposal.
- Offline SQLite persistence.
- Backup and restore.
- Retry for failed Assistant messages.

### Student profile AI Bar

- Mounted below the student hero card.
- Includes:
  - Learner name and grade context.
  - Gold sparkle affordance.
  - Natural-language input.
  - Active send button.
  - Dynamic suggestion chips.
- Suggestions reflect live state:
  - Why is the learner struggling with the weakest concept?
  - Show foundational gaps.
  - What has not been assessed?
  - What should I teach next?
- The AI Bar opens a dedicated student Copilot thread.
- The thread is persisted in SQLite.
- Student ID remains attached to follow-ups.

### Student Copilot Mode

- Header identifies:
  - Student name.
  - Grade.
  - Student-focused Copilot mode.
- The teacher sees that the answer is grounded in the learner’s evidence.
- The thread is separate from general classroom chat.
- This supports multi-turn interaction:
  - “Why is Aarav struggling with place value?”
  - “Give me a five-minute activity.”
  - “What should I check after the activity?”

### Offline-first behavior

- Local SQLite stores:
  - Workspace.
  - Students.
  - Concepts.
  - Prerequisite edges.
  - Attendance.
  - Assessments.
  - Competencies.
  - Learner states.
  - Observations.
  - Schedules.
  - Conversations.
  - Messages.
  - Source metadata.
- Local operations continue without internet:
  - Roster management.
  - Attendance.
  - Marks.
  - Knowledge-state updates.
  - Schedule generation.
  - Saved schedule edits.
- The RAG bridge and generated model answers require the local server / model path in the current deployment.
- This distinction is presented honestly to the panel.

### Data integrity safeguards

- Workspace scoping prevents cross-classroom reads.
- SQLite foreign keys preserve relationships.
- Assessment updates recompute learner state.
- Attendance does not mutate mastery.
- Exit assessments are idempotent in the tested workflow.
- Pending messages can be marked failed and retried after interruption.
- Schedule edits preserve the original evidence and provenance.
- Request and response metadata are stored with chat messages.

---

## 10. Closed-loop demonstration for the panel

### Recommended live story

1. Open a multi-grade classroom.
2. Show the teacher dashboard and grade counts.
3. Mark attendance for one learner.
4. Explain that absence changes availability, not mastery.
5. Open a student profile.
6. Show assessed, unassessed, likely-ready, and needs-support concepts.
7. Show a prerequisite warning on a downstream concept.
8. Record a new assessment.
9. Show the local knowledge-state update.
10. Use the student AI Bar.
11. Ask why the learner is struggling.
12. Show the response grounded in learner state and graph reasoning.
13. Ask for the next lesson.
14. Generate a multi-grade schedule.
15. Show the teacher-directed block and concurrent tasks.
16. Edit a block to demonstrate teacher agency.
17. Record a remediation assessment.
18. Generate the next schedule.
19. Show that priority changes after evidence changes.
20. Ask the leave-rescheduling query.
21. Show the proposal card.
22. Confirm and save it locally.

### The sentence to repeat

> Evidence changes the learner state; the learner state changes the explanation and the schedule; the next assessment closes the loop.

### Strong individual learner example

- Start with a student who has:
  - A recorded low score on a foundational concept.
  - A downstream concept marked with a prerequisite gap.
  - At least one observation note.
- Demonstrate:
  - The graph warning.
  - The student Copilot diagnosis.
  - The concrete intervention.
  - The exit assessment.
  - The changed state.
  - The changed scheduler priority.

### Strong multi-grade example

- Select Grades 2, 3, and 4.
- Use 60 minutes.
- Select learning-needs priority.
- Show:
  - Opening block.
  - Direct support on the highest-leverage prerequisite gap.
  - Independent or peer work for other grades.
  - Teacher rotation.
  - Closing check.
- Explain that the system allocates attention, not merely time.

---

## 11. Software verification and metrics

### Backend and research checks

- Supplied Chapter 5 result:
  - 71 backend tests passed.
  - Seven subtests passed.
- Earlier review material references smaller historical test counts.
- Use the latest Chapter 5 figure when asked about final verification.
- Backend checks cover:
  - Classroom evidence handling.
  - Learner-state consistency.
  - Copilot routing.
  - Workspace isolation.
  - Structured responses.
  - Retrieval contracts.

### Frontend / scheduler checks

- Supplied Chapter 5 result:
  - 2,856 local scheduling timing and grade-coverage cases passed.
- Additional assertions cover:
  - Ordering.
  - Attendance.
  - Incomplete evidence.
  - Prerequisite priority.
  - Editing.
  - Repeated rotations.
  - Short-duration warnings.
- Earlier reports cite 1,904 scheduler regressions.
- Explain this as an evolving test-count difference between project stages, not as contradictory algorithms.

### What these tests prove

- The tested implementation preserves expected data and scheduling behavior under the checked cases.
- They do not prove:
  - Classroom learning gains.
  - Universal generalization.
  - Phone energy or latency performance.
  - Teacher usability at scale.
  - Real-world model quality under all questions.

### Functional verification matrix

| Area | What was verified |
|---|---|
| Assessment updates | State recalculation and persistence |
| Attendance | Presence status stored independently from mastery |
| Exit evidence | Repeated reviews do not create duplicate tested scores in the checked workflow |
| Workspace isolation | Classroom records stay within the authorized workspace |
| Planning behavior | Timing, grade coverage, priorities, warnings, and editing |
| Recovery | Interrupted messages can be marked failed and retried |
| Retrieval | Index and metadata alignment, curriculum filtering, source attribution |
| Copilot | Structured intent routing and operation contracts |

---

## 12. Metric interpretation cheat sheet

### Retrieval metrics

- Precision@3:
  - Relevance density in the top three.
- Hit Rate@3:
  - Whether at least one relevant item appears in the top three.
- MRR:
  - How early the first relevant item appears.
- Do not call these “answer accuracy.”

### Learner-estimation metrics

- MAE:
  - Average absolute estimation error.
- RMSE:
  - Error with a stronger penalty for large misses.
- Pearson correlation:
  - Whether estimated and target learner ordering move together linearly.
- Convergence:
  - Whether the estimation procedure reaches a stable valid solution.

### Scheduler metrics

- Gap Coverage:
  - How many initial deficiencies were offered instruction.
  - It does not mean the gap was closed.
- Mastery Resolution:
  - How many simulator learner-concept pairs reached the defined mastery level.
- Prerequisite Violations:
  - Unsafe learner-instruction events under the simulator’s within-grade prerequisite rule.
- Average Delay:
  - How long a deficient pairing waits.
- Time to Mastery:
  - How many time units until simulated mastery.
- Switching Cost:
  - Number of grade changes demanded from the teacher.
- Unaddressed Deficit:
  - Remaining aggregate learning deficit after allocation.

### Product verification metrics

- Test pass count:
  - Software behavior under automated checks.
- Concept coverage:
  - Percentage of canonical graph concepts represented in retrieval metadata.
- Source count:
  - Number of indexed retrieval units, not number of concepts or answers.
- Offline capability:
  - Whether the function uses local data and does not require a network call.

---

## 13. Likely panel questions and strong answers

### “What is the main contribution?”

- The main contribution is prerequisite-safe instructional attention allocation for a single teacher serving multiple grades.
- The graph, learner state, Copilot, and frontend support that allocator.
- The system converts heterogeneous classroom evidence into an interpretable direct-teaching priority and concurrent task plan.

### “Is this just a chatbot?”

- No.
- The chatbot is one interface.
- The main system stores and reasons over classroom state.
- It can identify learners, inspect prerequisites, recommend activities, generate schedules, and reschedule leave days.
- A plain chatbot answers text; CALCMATE changes its answer when classroom evidence changes.

### “Is this just SQL querying?”

- No.
- Classroom facts are retrieved from SQLite because they must remain exact.
- The Copilot also performs:
  - Intent routing.
  - Concept resolution.
  - Graph traversal.
  - Readiness analysis.
  - Curriculum retrieval.
  - Evidence-aware activity generation.
  - Natural-language composition.
- SQL is the evidence access layer, not the complete intelligence layer.

### “What happens if there is no assessment data?”

- The concept remains `unknown`, not zero.
- The system does not claim mastery.
- The scheduler can use balanced rotation and readiness checks.
- The teacher is prompted to collect a diagnostic or exit assessment.

### “What if a student is absent?”

- Attendance is stored separately.
- Absence can affect who is available for direct instruction.
- Absence never changes mastery and never creates an assessment.

### “Why not use BKT in the product?”

- BKT was evaluated as an auxiliary estimator under a controlled synthetic observation model.
- Fixed-parameter BKT failed the defined validation gate in that experiment.
- Moment matching passed that specific gate.
- The operational product uses an intentionally transparent recency-weighted estimator that is easier to audit with sparse teacher-entered evidence.
- This is a methodological and deployment choice, not a claim that BKT is invalid in general.

### “Why is CALCMATE not best on raw coverage?”

- Because it applies a safety constraint.
- It does not count unsafe downstream instruction as successful progress.
- The research result is a trade-off:
  - Lower superficial coverage.
  - Zero checked prerequisite violations.
  - Lowest reported unaddressed deficit.

### “Why use a deterministic scheduler instead of an LLM?”

- Scheduling needs reproducible constraints.
- A teacher should receive the same plan for the same evidence and parameters.
- Determinism improves:
  - Auditability.
  - Testing.
  - Offline execution.
  - Teacher trust.
- The LLM can explain or suggest activities, but it should not be the authority for hard schedule constraints.

### “Why use FAISS?”

- It is lightweight, local, and efficient for the corpus size.
- It supports normalized vector similarity.
- ID selectors allow curriculum candidate restriction before search.
- It avoids requiring a cloud vector database for a resource-constrained classroom.

### “Why use all-MiniLM-L6-v2?”

- It is a compact sentence-embedding model suitable for local use.
- It supports semantic matching between teacher questions and textbook passages.
- It is not presented as a novel model.
- The research contribution is the curriculum-aware filtering and graph-linked use of retrieval evidence.

### “Why not use only metadata search?”

- Metadata is precise when concept mapping succeeds.
- Embeddings help handle natural teacher language, paraphrases, and wording variation.
- The hybrid approach combines:
  - Semantic flexibility.
  - Symbolic curriculum control.

### “How are hallucinations controlled?”

- Intent routes to structured operations.
- Classroom facts come from bounded evidence.
- Student state is computed from stored assessments.
- Graph facts come from canonical edges.
- Retrieval is curriculum-filtered.
- Structured responses are deterministic.
- The LLM receives bounded evidence and strict instructions.
- Internal errors are redacted.
- Unknown evidence remains unknown.

### “What happens for Grades 1 and 2?”

- The canonical graph includes Grades 1–2.
- PDF retrieval coverage is focused on Grades 3–5.
- Grade 1–2 questions use a foundational objective guide with the local model.
- The model is constrained to age-appropriate competencies such as:
  - Counting.
  - Number names.
  - One more / one less.
  - Addition and subtraction with objects.
  - Tens and ones.
  - Basic shapes and measurement.
- The answer is still teacher-facing and activity-oriented.

### “Does the system work completely offline?”

- Essential classroom operations and scheduling work offline on SQLite.
- Current textbook RAG and generated model answers use the local FastAPI/Ollama bridge.
- If that bridge is unavailable, the classroom data and local scheduler continue to work.
- This is an offline-first hybrid deployment, not a claim that every language-generation feature runs on the phone.

### “What are the main limitations?”

- Synthetic scheduler learners and simulated transitions.
- Retrieval evaluation based on concept-tag relevance, not full answer correctness.
- Limited indexed PDF coverage for Grades 1–2.
- Sparse teacher evidence can leave many states unknown.
- No field trial proving learning improvement.
- No complete physical-device latency, memory, thermal, or energy study.
- Current scheduler safety metric covers the simulator’s within-grade prerequisite rule; it is not a proof of all possible cross-grade safety conditions.

### “What would you do next?”

- Conduct a teacher usability study.
- Add field data from real multi-grade classrooms.
- Expand and independently annotate the retrieval benchmark.
- Add Grades 1–2 textbook retrieval coverage.
- Measure answer faithfulness and latency separately.
- Evaluate cross-grade prerequisites in the simulator.
- Compare more learner-state estimators under real sparse evidence.
- Measure teacher workload and learning outcomes longitudinally.

---

## 14. Claims to avoid and better replacements

| Avoid saying | Say instead |
|---|---|
| “The LLM knows the student.” | “The Copilot is grounded in the student’s recorded evidence and graph state.” |
| “The model is hallucination-proof.” | “The architecture reduces hallucination risk by separating deterministic facts from bounded generation.” |
| “The RAG is structurally embedded.” | “The semantic embeddings are constrained by curriculum metadata and prerequisite structure.” |
| “The scheduler always improves learning.” | “The controlled simulation showed zero checked prerequisite violations and a lower unaddressed deficit.” |
| “The retrieval score proves answer correctness.” | “The retrieval metrics measure concept-relevant evidence retrieval.” |
| “All functionality is offline.” | “Core classroom workflows are offline-first; current RAG generation uses the local bridge.” |
| “BKT is inferior.” | “Fixed-parameter BKT failed this experiment’s validation gate; that is not a universal claim.” |
| “Higher coverage is always better.” | “Coverage must be interpreted together with prerequisite safety and mastery.” |

---

## 15. Final closing statement

> CALCMATE addresses a real operational problem in multi-grade classrooms: one teacher must make safe instructional decisions for learners who are not at the same point in the curriculum. The system combines a shared curriculum graph, live learner evidence, curriculum-aware retrieval, grounded Copilot operations, and deterministic local scheduling. Its strongest result is not that it generates fluent answers; it is that it connects evidence to prerequisite reasoning, prerequisite reasoning to teacher attention, and teacher attention to the next measurable learning action. The research results show a clear prerequisite-safety trade-off, while the software integration demonstrates that the idea can be delivered as a usable offline-first teacher product.

### The final three points to leave with the panel

1. **The problem is real and constrained:** one teacher, several grades, limited direct attention, heterogeneous evidence.
2. **The method is structurally grounded:** graph-aware learner state plus curriculum-filtered retrieval, not unconstrained generation.
3. **The result is an actionable loop:** classroom evidence changes the Copilot answer and changes the next instructional schedule.

---

## 16. Quick pre-review checklist

- [ ] Start with the single-teacher multi-grade problem.
- [ ] Explain the intelligence loop before opening individual modules.
- [ ] Show the canonical graph count: 84 concepts, 73 edges, 0 cycles.
- [ ] Explain why unknown is not zero mastery.
- [ ] Explain Score-Ratio-v1 and `0.75^i` recency weighting.
- [ ] Explain paragraph-first chunking and 180/40 fallback windows.
- [ ] Name the embedding model: `all-MiniLM-L6-v2`.
- [ ] Name the vector index: FAISS.
- [ ] Explain grade, subject, and concept filtering before similarity ranking.
- [ ] State the retrieval metrics and their meanings.
- [ ] Distinguish retrieval relevance from answer correctness.
- [ ] Explain why Grades 1–2 use foundational guidance rather than the same PDF index.
- [ ] Explain Copilot intent routing and deterministic classroom facts.
- [ ] Demonstrate a student-specific Copilot query.
- [ ] Demonstrate a multi-grade schedule.
- [ ] Show concurrent work for unattended grades.
- [ ] Explain the safety/coverage trade-off.
- [ ] State zero prerequisite violations as a controlled simulation result.
- [ ] State the synthetic-data and no-field-trial limitations.
- [ ] Show that new assessment evidence changes the next schedule.
- [ ] End with the closed-loop feedback sentence.
