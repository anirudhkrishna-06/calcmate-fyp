# CALCMATE — Full-Fledged Five-Stage Development Roadmap for Review Three

## Project Title

**CALCMATE: Curriculum- and Knowledge-State-Aware Instructional Attention Allocation for Multi-Grade Classrooms**

## 1. Project Vision and Overall Development Strategy

### 1.1 The problem we are solving

In many resource-constrained primary schools, one teacher may be responsible for students across multiple grades simultaneously. These students may be learning different concepts, progressing at different rates, and experiencing different learning difficulties.

The teacher has limited direct instructional time. While the teacher works with one group, the other groups still need meaningful learning activities. The teacher must also track progress, recognise prerequisite gaps, decide what to teach next, plan activities, and maintain classroom records.

CALCMATE aims to address this problem through an integrated, teacher-centric AI copilot that connects classroom evidence, curriculum structure, learner knowledge states, educational resources, and instructional scheduling.

The central research idea is not simply to build a chatbot, a student monitoring application, a knowledge graph, or a timetable generator.

**The central contribution is a classroom intelligence framework that uses learner knowledge states and curriculum dependencies to support the allocation of limited teacher instructional attention across concurrent multi-grade groups.**

The mobile application is the interface through which this intelligence becomes useful to the teacher.

### 1.2 The intended final system

The final CALCMATE workflow should allow a teacher to:

1. Create or select a classroom containing students across Grades 1–5.
2. Record attendance and assessment evidence with minimal additional effort.
3. Maintain a structured understanding of each student's learning progress across Mathematics concepts.
4. Explore each student's concept-level knowledge representation.
5. Understand relationships between concepts, including prerequisite dependencies across grades.
6. Ask natural-language questions about students, groups, learning gaps, curriculum concepts, and classroom priorities.
7. Receive answers grounded in actual classroom records and relevant NCERT Mathematics resources.
8. Identify students who need support with a particular concept.
9. Understand why those students may be struggling, based on available evidence and prerequisite relationships.
10. Determine which group should receive direct teacher attention next.
11. Provide suitable independent learning activities to the groups that are not receiving direct instruction.
12. Generate a schedule that considers learner state, curriculum dependencies, instructional urgency, missed-learning context, and available time.
13. Accept, modify, or override recommendations.
14. Record new assessment evidence and update learner-state estimates.
15. Generate subsequent recommendations from the updated classroom state.

The system should support NCERT Mathematics across Grades 1–5 as its target curriculum scope. We should build the canonical curriculum representation for all five grades while developing and integrating the system through a manageable, complete end-to-end workflow.

### 1.3 The five development stages

The development process will be organised into exactly five stages.

| Stage | Name | Primary outcome |
|---|---|---|
| Stage 1 | Unified Curriculum and Classroom Data Foundation | One consistent Mathematics taxonomy and a connected application data model |
| Stage 2 | Curriculum Knowledge Graph and Student Knowledge Intelligence | A shared curriculum graph with student-specific knowledge-state representations |
| Stage 3 | Integrated AI Copilot and Curriculum-Grounded Chatbot | Natural-language access to actual classroom records, learner states, graph reasoning, and NCERT resources |
| Stage 4 | Intelligent Instructional Allocation and Multigrade Scheduling | A graph- and learner-state-aware decision engine that generates explainable instructional priorities and schedules |
| Stage 5 | Complete Application Integration and Review Three Delivery | One coherent end-to-end CALCMATE application with a functioning feedback loop and a defensible research demonstration |

The stages are ordered deliberately. The curriculum and data model must be consistent before the graph and learner intelligence can be connected. The chatbot must be able to access structured information before it can reliably explain classroom conditions. The allocation engine must use that same intelligence before the complete workflow can be demonstrated.

---

# STAGE 1 — UNIFIED CURRICULUM AND CLASSROOM DATA FOUNDATION

## 1.1 Objective

Establish a single, consistent data foundation across the mobile application, Mathematics curriculum, learner records, knowledge graph, retrieval system, and scheduling modules.

At present, the repository audit identified separate representations of concepts in the frontend and Python backend. The frontend contains a small, hardcoded concept taxonomy, while the backend has a broader curriculum graph and NCERT retrieval corpus. The application stores student assessments and attendance locally, but the graph and research estimators are not yet part of the same workflow.

This stage resolves that fragmentation.

The objective is to ensure that every component refers to the same students, groups, concepts, grade levels, curriculum resources, and assessment records.

## 1.2 Define the canonical NCERT Mathematics curriculum model

Create one authoritative concept taxonomy for the target curriculum: NCERT Mathematics, Grades 1–5.

The taxonomy should be the common reference for the frontend, learner-state estimator, knowledge graph, chatbot, RAG metadata, and allocation engine.

### A. Curriculum hierarchy

Represent the curriculum using a hierarchy such as:

- Subject
- Grade
- Curriculum unit or chapter
- Topic
- Concept
- Sub-concept
- Learning objective or learning outcome
- Assessment target
- Educational resource

For example, a conceptual hierarchy could be:

Mathematics → Grade 4 → Fractions → Understanding fractions → Equivalent fractions.

The exact concept coverage and relationships must be derived from the selected NCERT curriculum sources rather than invented solely for the application.

### B. Stable concept identifiers

Every concept must have a unique, stable identifier.

Concept identifiers must be consistent across:

- The frontend's seeded concept records.
- The SQLite database.
- The curriculum knowledge graph.
- The learner-state database.
- The RAG chunk metadata.
- The assessment records.
- The scheduling engine.
- The chatbot's structured query results.
- The simulation and evaluation pipeline.

The system must not rely on display names alone to identify concepts. Similar names may occur in different grades or curriculum contexts.

A display name can change without changing the concept's identity, but the concept ID should remain stable.

### C. Concept metadata

Each concept should have, where available:

- Unique concept ID.
- Concept name.
- Subject.
- Grade or grade range.
- Parent topic or chapter.
- Description.
- Learning objective.
- Difficulty or progression level.
- NCERT source reference.
- Relevant resource IDs.
- Assessment mapping.
- Prerequisite concept IDs.
- Dependent concept IDs, where derived.
- Status indicating whether the concept and its relationships have been validated.

The taxonomy should distinguish a verified curriculum relationship from an inferred relationship that still needs review.

### D. Coverage across Grades 1–5

The target curriculum representation must support all five grades, but implementation should not pretend that every grade is complete simply because the database permits five grades.

The development work must distinguish:

1. Textbook chapters available.
2. Concepts extracted or manually curated.
3. Prerequisite relationships represented.
4. Concepts linked to assessment targets.
5. Concepts linked to NCERT resources.
6. Concepts sufficiently reviewed to be used for allocation decisions.

This distinction is important for the research contribution. An accurate, bounded curriculum graph is more defensible than a much larger graph containing unverified relationships.

## 1.3 Unify the frontend and backend data models

The application should continue to serve as the teacher's primary workspace.

Existing working functionality should be retained wherever possible, including:

- Student and group management.
- Attendance records.
- Assessment entry and history.
- Student profiles.
- Competency displays.
- Schedule persistence.
- Chat history.
- Local classroom storage.

The implementation should connect these features to the canonical curriculum IDs rather than replacing the application with a new system.

### A. Classroom entities

The data model should clearly distinguish:

- Teacher.
- Classroom or workspace.
- Student.
- Grade.
- Teaching group.
- Subject.
- Curriculum concept.
- Assessment.
- Assessment result.
- Attendance record.
- Learner-state estimate.
- Learning activity.
- Schedule.
- Scheduled instructional slot.
- Teacher feedback or override.

A student belongs to a classroom and has a grade. A teaching group may contain students from the same grade or a defined instructional cohort. A concept belongs to the curriculum. Assessment evidence links a student to one or more concepts.

### B. Assessment records

Assessment records should preserve the original evidence, including:

- Student ID.
- Concept ID or assessment-to-concept mapping.
- Score obtained.
- Maximum score.
- Assessment date.
- Assessment type, where available.
- Source of the evidence.
- Optional assessment metadata.

The original score must be retained even if it is later transformed into a learner-state observation.

For example, a score of 3/10 must not be overwritten by a derived mastery estimate of 0.30. These represent different things: one is an observed assessment result, while the other may be an estimated state.

### C. Attendance records

Attendance must remain a separate evidence source.

Attendance can indicate that a student may have missed a lesson or learning opportunity. It must not automatically reduce a student's mastery estimate.

The system may use attendance to inform missed-learning context when there is a meaningful relationship between the absence and a particular lesson or concept. It should not assume that every absence means that a student has failed to learn the concept.

### D. Offline-first data ownership

Classroom records should remain locally stored by default.

If the Python backend is used as a local intelligence service, define what information is passed to it and when. The integration must not silently turn the local application into a system that requires uploading all student records to a remote server.

The architecture should identify which operations can execute locally, which require the Python service, and how the app behaves when the service is unavailable.

## 1.4 Connect NCERT RAG metadata to the canonical taxonomy

The existing NCERT retrieval system should reuse the same concept identifiers as the curriculum model.

Every relevant retrieval chunk should retain useful metadata, such as:

- Resource ID.
- NCERT source and chapter.
- Grade.
- Subject.
- Concept IDs.
- Textbook page or section, when available.
- Chunk content.
- Embedding reference.

This makes it possible to retrieve textbook content for a concept selected by the learner-state or scheduling engine.

For example, when the scheduler identifies a group that needs help with equivalent fractions, the copilot should be able to retrieve resources associated with that concept rather than searching an unrelated collection of Mathematics passages.

The RAG system should remain a retrieval mechanism for curriculum evidence. It should not become the source of truth for student mastery or prerequisite feasibility.

## 1.5 Consolidate the existing repository rather than duplicating it

The development team should inspect and reuse the existing modules identified in the audit.

Likely areas of work include:

- `frontend/src/services/database.ts`
- `frontend/src/services/demoService.ts`
- `frontend/src/services/storageService.ts`
- `frontend/src/services/generalScheduler.ts`
- `frontend/src/services/generalScheduleService.ts`
- `frontend/src/services/backendContracts.ts`
- `frontend/src/services/apiClient.ts`
- `src/knowledge_graph.py`
- `src/retrieve.py`
- `src/rag_api.py`
- `src/api.py`
- Curriculum files under `data/`
- Existing learner simulation and estimation modules under `src/sim/`

These are candidate integration points, not a mandate to rewrite each file. The actual changes should follow the verified implementation.

Avoid maintaining one taxonomy in TypeScript, another in Python, and a third in manually written chatbot prompts.

## 1.6 Expected output of Stage 1

At the end of this stage, CALCMATE should have:

1. One canonical Mathematics concept taxonomy designed for Grades 1–5.
2. Consistent concept IDs across the application and backend.
3. A clear mapping between student assessments and curriculum concepts.
4. Attendance and assessment data separated by their evidential role.
5. NCERT retrieval metadata linked to curriculum concepts.
6. A documented ownership model for local classroom data.
7. A clear interface through which graph, learner-state, chatbot, and scheduling modules can access the same curriculum and classroom identifiers.

### Stage 1 completion criterion

**Every major component must agree on what a student, group, concept, assessment, and curriculum resource is.**

No later stage should introduce its own incompatible concept taxonomy.

---

# STAGE 2 — CURRICULUM KNOWLEDGE GRAPH AND STUDENT KNOWLEDGE INTELLIGENCE

## 2.1 Objective

Develop the educational intelligence layer that represents curriculum dependencies and individual learning progress.

This stage establishes the main knowledge representation that distinguishes CALCMATE from a conventional teacher chatbot or static timetable generator.

The system will combine:

1. A shared NCERT Mathematics curriculum knowledge graph.
2. Student-specific knowledge states associated with the curriculum concepts.
3. Derived learner-graph views.
4. Group-level knowledge summaries.
5. Curriculum dependency and readiness calculations.

The central design principle is that the curriculum structure is shared, while student learning states differ.

## 2.2 Build the shared curriculum knowledge graph

The curriculum knowledge graph should represent the Mathematics curriculum and its concept relationships across Grades 1–5.

### A. Node types

The graph may include the following node categories:

- Subject.
- Grade.
- Chapter or unit.
- Topic.
- Concept.
- Sub-concept.
- Learning outcome.
- Assessment target.
- NCERT resource.
- Learning activity.

Not every node type needs to participate in every algorithm. The first implementation should prioritise the node and edge types that support prerequisite analysis, resource retrieval, and instructional planning.

### B. Edge types

Represent relationships explicitly.

Possible edge types include:

- `CONTAINS`: a chapter contains a concept.
- `HAS_SUBCONCEPT`: a concept contains or decomposes into a sub-concept.
- `PREREQUISITE_OF`: one concept is required before another.
- `SUPPORTS_OUTCOME`: a concept supports a learning outcome.
- `ASSESSED_BY`: an assessment target measures a concept.
- `HAS_RESOURCE`: a concept links to an educational resource.
- `RELATED_TO`: two concepts are related without asserting a strict prerequisite relationship.

The distinction between prerequisite and general relatedness is important. Not every related concept should become a hard scheduling constraint.

### C. Prerequisite direction

Use one consistent convention throughout the graph.

For example:

`Fractions: equal parts → Understanding fractions → Equivalent fractions`

The edge direction should have one documented meaning, such as `PREREQUISITE_OF` pointing from the prerequisite to the dependent concept.

Every graph query and scheduling calculation must follow that convention.

### D. Graph validity

The prerequisite subgraph should be checked for cycles and inconsistent relationships.

A prerequisite cycle can make it impossible to determine which concept should be taught first. If a cycle is detected, it should be reviewed rather than silently ignored.

The graph should support queries for:

- Direct prerequisites.
- Transitive prerequisite chains.
- Downstream dependent concepts.
- Concepts blocked by prerequisite gaps.
- Relevant curriculum resources.
- Concepts available for instruction within a selected curriculum scope.

## 2.3 Represent the knowledge state of each student

The individual learner model should associate every student with the relevant curriculum concepts.

For student \(u\) and concept \(c\), the system should maintain a knowledge-state record such as:

\[
K_{u,c} \in [0,1]
\]

Here, \(K_{u,c}\) represents the estimated level of mastery for the student and concept. It is not a directly observed fact.

The record should also preserve information needed to interpret that estimate:

- Student ID.
- Concept ID.
- Estimated mastery.
- Evidence count.
- Latest evidence timestamp.
- Evidence sources.
- Estimation method or model version.
- Confidence or uncertainty information, when available.
- Whether the state is sufficiently supported for a decision.

The system should distinguish at least three situations:

1. Evidence indicates that the learner may need support.
2. Evidence indicates that the learner may be ready to progress.
3. Insufficient evidence exists to make a reliable determination.

The third situation must not be treated as equivalent to either low mastery or high mastery.

## 2.4 Student-specific knowledge graphs

The project's intended student-level knowledge graphs should be implemented as individual knowledge representations linked to the shared curriculum graph.

Conceptually, a student-specific graph view contains the same curriculum concept nodes but attaches the student's own estimated state and evidence to the relevant concepts.

For example:

- Student A may have strong evidence of understanding basic fractions but limited evidence of equivalent fractions.
- Student B may struggle with the prerequisite concept of equal parts.
- Student C may have insufficient recent evidence for either concept.

These differences should be represented through student-specific state records or graph overlays rather than by independently copying the entire curriculum structure for every student.

This approach offers several benefits:

- Shared prerequisite relationships remain consistent.
- Student states can be updated without changing curriculum definitions.
- Cross-student and group comparisons are easier to compute.
- The system avoids unnecessary duplication of graph data.
- The application can display individual learner-graph views when needed.
- Classroom-level intelligence can aggregate the relevant states without rebuilding the curriculum graph.

The graph view for a student can therefore be generated by combining the shared curriculum graph with that student's state records.

## 2.5 Graph embeddings and student-conditioned representations

The project may investigate graph embeddings as part of its knowledge representation pipeline, but this must be implemented with a clear purpose.

Three distinct representations should be kept separate.

### A. Text embeddings

These represent the semantic content of NCERT textbook passages, explanations, questions, and activities. They support retrieval in the existing RAG system.

### B. Curriculum graph embeddings

These represent structural information from curriculum nodes and relationships. They may capture similarities or structural relationships between concepts.

### C. Student-conditioned knowledge representations

These combine curriculum structure with an individual student's knowledge-state information. They may help identify patterns in the learner's profile or compare learning trajectories.

The initial system should use explicit graph reasoning for prerequisite feasibility and explainable allocation. Graph embeddings can be introduced as an additional representation if they improve a clearly defined task.

For example, a future component might use student-conditioned graph representations to identify similar patterns of concept gaps. However, the system must not treat embedding similarity as proof of a prerequisite relationship or mastery.

For Review Three, a defensible implementation is:

1. Use the explicit graph for prerequisite reasoning.
2. Attach individual learner-state values to curriculum concepts.
3. Generate student-specific graph views.
4. Aggregate those states into group summaries.
5. Keep graph embeddings modular so that they can be added or evaluated without rewriting the allocation engine.

If graph embeddings are implemented, document their node features, training or construction method, dimensionality, update strategy, and intended use. Do not describe ordinary text embeddings as graph embeddings.

## 2.6 Implement learner-state estimation

The application currently records assessment scores and calculates a simple competency percentage from recorded results. The research code includes BKT and alternative estimation experiments.

These should be connected through a documented learner-state interface.

### A. Preserve observed evidence

A score such as 3/10 is an observation. A mastery estimate such as 0.35 is an inference.

The system should preserve both separately.

### B. Select the estimator deliberately

The integration must establish how raw assessment scores become learner-state evidence.

Possible approaches include:

- A score-aware model that uses the observed score directly.
- A documented conversion from an assessment result to evidence suitable for a binary knowledge-tracing model.
- An estimator based on a validated observation model.

The selected approach must be compatible with the actual assessment format and the assumptions of the estimator.

The existing controlled-simulation results are useful groundwork, but they do not automatically establish that an estimator will be accurate on real classroom data.

### C. Update the state

When a new assessment is entered:

1. Identify the student and concept.
2. Preserve the raw score and assessment metadata.
3. Pass the observation to the selected estimator.
4. Update the concept-level state estimate.
5. Update evidence count and timestamp.
6. Recalculate affected group summaries.
7. Make the updated state available to the chatbot and allocation engine.

Attendance may contribute to missed-learning context, but it must not be used as a direct mastery observation.

## 2.7 Aggregate individual states into group readiness

The scheduler requires group-level information, but the system must not lose individual differences when calculating it.

For group \(g\) and concept \(c\), a simple group mastery summary may be:

\[
K_{g,c} =
\frac{1}{|U_g|}
\sum_{u \in U_g} K_{u,c}
\]

where \(U_g\) contains the students in the group with an available estimate under the chosen aggregation policy.

However, the mean alone can conceal substantial differences between students.

Therefore, group summaries should also consider:

- The proportion of students below a mastery threshold.
- The number of students with insufficient evidence.
- The distribution of mastery estimates.
- The number of students affected by a prerequisite gap.
- The number of students for whom additional evidence is needed.

The system should not assume that every student in a group has the same learning need simply because the group has one average mastery value.

## 2.8 Implement prerequisite reasoning

For each target concept, the graph engine should determine:

- Which concepts are direct prerequisites.
- Which prerequisite chains lead to the target concept.
- Whether relevant prerequisite states have sufficient evidence.
- Which prerequisite concepts may be blocking progress.
- Which downstream concepts may be affected by a prerequisite gap.

For example, when a teacher asks about equivalent fractions, the system should inspect the represented prerequisite relationships and the relevant student states.

If the graph identifies a prerequisite gap, CALCMATE should be able to explain that the target concept may be difficult because a prerequisite is not sufficiently established.

It should not claim that the prerequisite gap definitively caused the difficulty unless the available evidence supports that conclusion.

## 2.9 Expected output of Stage 2

At the end of Stage 2, CALCMATE should have:

1. A shared Mathematics curriculum knowledge graph.
2. Consistent prerequisite relationships and graph queries.
3. Student-specific knowledge-state records associated with curriculum concepts.
4. Student-specific graph views or overlays.
5. Group-level mastery and readiness summaries.
6. A documented learner-state estimation pipeline.
7. A way to identify potential prerequisite gaps.
8. A way to identify downstream concepts affected by those gaps.
9. Curriculum resources linked to relevant concepts.
10. A structured interface through which the chatbot and allocation engine can query the graph and learner states.

### Stage 2 completion criterion

**For a selected student and Mathematics concept, CALCMATE must be able to retrieve the learner's available evidence, estimate the relevant knowledge state, inspect prerequisite relationships, and explain what is known and what remains uncertain.**

---

# STAGE 3 — INTEGRATED AI COPILOT AND CURRICULUM-GROUNDED CHATBOT

## 3.1 Objective

Transform the existing NCERT chatbot into a teacher copilot that can answer questions using actual classroom records, individual learner states, curriculum graph reasoning, and NCERT resources.

The chatbot must no longer be limited to retrieving textbook passages and generating educational explanations.

It should become the natural-language interface to the classroom intelligence already developed in Stages 1 and 2.

The key principle is:

**The language model interprets the teacher's request and explains the result; structured application data and explicit reasoning operations provide the facts and decisions.**

## 3.2 Define the copilot architecture

The copilot should consist of five cooperating components.

### A. Natural-language interface

The teacher enters a question through the existing chat interface.

Example:

"Who is struggling with fractions in Grade 4?"

The interface sends the message along with the relevant classroom or workspace context.

### B. Intent and parameter extraction

The language model or a suitable deterministic parser identifies the type of request and extracts the necessary parameters.

Possible intents include:

- Find learners needing support.
- Retrieve a learner's concept state.
- Explain a prerequisite gap.
- Retrieve a curriculum resource.
- Recommend a learning activity.
- Explain an instructional priority.
- Request an instructional schedule.
- Summarise changes after a new assessment.

Extracted parameters may include:

- Grade.
- Group.
- Concept.
- Student, if specified.
- Requested operation.
- Time range, if relevant.
- Desired output type.

The extracted request should be validated before execution.

### C. Deterministic request router

The router maps the extracted intent to a known operation.

For example:

`find_students_by_concept` → query classroom records and learner-state estimates.

`explain_prerequisites` → query the curriculum graph and learner states.

`retrieve_ncert_activity` → search the curriculum-constrained RAG index.

`generate_allocation` → invoke the allocation engine.

The router must not allow a free-form language-model response to substitute for an operation that requires actual classroom data.

### D. Intelligence services

The router calls the appropriate structured services:

- Classroom data service.
- Learner-state service.
- Knowledge graph service.
- NCERT retrieval service.
- Allocation service, once Stage 4 is integrated.

These services should return structured results.

### E. Response generation

The language model turns those results into a concise, teacher-friendly explanation.

It should explain:

- What the system found.
- Which evidence supports the result.
- What the graph indicates.
- What action is recommended.
- What limitations apply.

The model must not invent student names, scores, mastery estimates, textbook references, or allocation results.

## 3.3 Implement the first set of supported teacher queries

The initial copilot should support a defined collection of useful queries instead of attempting to answer every possible question.

### Query 1: Identify learners who need support

Example:

"Who is struggling with fractions in Grade 4?"

The copilot should:

1. Identify the relevant grade and concept.
2. Resolve the concept to its canonical ID.
3. Query the selected classroom.
4. Retrieve relevant assessment records and learner-state estimates.
5. Apply the configured definition of "needs support".
6. Separate evidence-supported concerns from insufficient evidence.
7. Return a student list with concise supporting evidence.

The response should be structured, not merely conversational.

A useful result may contain:

- Student identifier or teacher-visible name.
- Relevant concept.
- Available assessment evidence.
- Estimated mastery, where available.
- Relevant prerequisite gaps.
- Evidence recency.
- Recommended follow-up.

The system must not label a student as weak merely because the student has not been assessed.

### Query 2: Explain why learners may be struggling

Example:

"Why are these students struggling with equivalent fractions?"

The copilot should:

1. Retrieve the relevant student states.
2. Inspect the prerequisite paths for equivalent fractions.
3. Identify prerequisite concepts with evidence of difficulty.
4. Retrieve relevant NCERT explanations or activities.
5. Summarise the evidence and possible instructional implications.

The answer should distinguish observed evidence from the system's interpretation.

For example, a low assessment result on a prerequisite is evidence of difficulty, whereas a claim that the prerequisite caused the later difficulty is a stronger causal claim and should not be asserted automatically.

### Query 3: Identify prerequisite concepts to revise

Example:

"What should I revise before teaching equivalent fractions?"

The graph engine should return the relevant prerequisite chain.

The copilot should then distinguish:

- Required prerequisites.
- Prerequisites for which the group has adequate evidence.
- Prerequisites for which evidence suggests a gap.
- Prerequisites for which there is insufficient evidence.

This makes the answer specific to the selected classroom rather than a generic explanation of the curriculum.

### Query 4: Suggest a curriculum-grounded activity

Example:

"Give me an activity for the students who need help with fractions."

The system should:

1. Identify the target concept and learners.
2. Check relevant prerequisite readiness.
3. Retrieve suitable NCERT resources.
4. Select or construct an activity appropriate to the identified gap.
5. Return the resource reference and a practical activity description.

The activity can use textbook examples, drawings, fraction strips, paper folding, or locally available objects where suitable.

For the first integrated version, curated activities and deterministic templates linked to NCERT resources are preferable to unconstrained activity generation.

### Query 5: Explain a learner's progress

Example:

"Has this student improved in fractions?"

The copilot should retrieve the student's chronological assessment evidence and relevant state estimates.

It should distinguish an actual change in recorded assessment performance from a change in the estimated mastery value.

It should not claim improvement where there is no comparable evidence.

### Query 6: Explain the current instructional priority

Example:

"Why should I teach Grade 4 now instead of Grade 3?"

Once the allocation engine is connected, the copilot should retrieve the actual priority scores, relevant learner states, prerequisite conditions, urgency, and scheduling constraints.

It should explain the factors that influenced the recommendation rather than generate a plausible explanation after the fact.

### Query 7: Generate or explain a schedule

Example:

"Plan the next 30 minutes for my Grade 3 and Grade 4 groups."

The copilot should invoke the allocation engine and return the actual generated schedule.

It should not ask the LLM to invent a schedule independently of the deterministic scheduling logic.

## 3.4 Integrate the existing NCERT RAG system

The current RAG implementation should be retained and extended where appropriate.

It should provide curriculum evidence for:

- Concept explanations.
- Teacher-requested activities.
- Prerequisite revision.
- Examples and exercises.
- Lesson support.
- Relevant learning outcomes.

Retrieval should use the canonical curriculum metadata from Stage 1.

When the question includes a known concept and grade, retrieval should apply the appropriate grade, subject, and concept constraints.

The response should preserve resource references so that the teacher can inspect the underlying NCERT material.

If relevant retrieval evidence is unavailable, the copilot should communicate that limitation rather than confidently generating an unsupported textbook-specific claim.

## 3.5 Keep the language model separate from educational decision logic

The model should not be the authority on:

- Which students are in a classroom.
- Which assessment scores were recorded.
- Whether a student has mastered a concept.
- Whether a prerequisite is satisfied.
- Which group wins the allocation decision.
- Whether a schedule satisfies the constraints.
- Whether attendance proves mastery.

Those facts and decisions must come from structured operations.

The model can:

- Interpret natural-language questions.
- Extract request parameters.
- Help formulate explanations.
- Summarise retrieved curriculum evidence.
- Convert structured results into clear teacher-facing language.

This separation supports transparency, reliability, and reproducibility.

## 3.6 Integrate the copilot into the existing application

The existing teacher-facing interface should remain the main access point.

The copilot should be available from the normal application workflow and from relevant classroom or lesson contexts.

For example, when viewing a group or concept, the teacher should be able to ask a related question without manually re-entering information that the application already knows.

The application should pass the current workspace, selected group, or concept context when appropriate.

The copilot should not require the teacher to repeatedly type student names or scores that are already stored in the application.

## 3.7 Expected output of Stage 3

At the end of Stage 3, CALCMATE should have:

1. A natural-language interface connected to actual classroom records.
2. A validated intent and routing mechanism.
3. Access to individual learner-state estimates.
4. Access to curriculum prerequisite queries.
5. Curriculum-constrained NCERT retrieval.
6. Evidence-grounded answers about students and learning gaps.
7. Concept-specific activity recommendations.
8. A structured interface for invoking scheduling operations.
9. Responses that distinguish evidence, estimates, recommendations, and uncertainty.
10. A teacher-facing chatbot integrated into the existing application.

### Stage 3 completion criterion

**When the teacher asks who is struggling with a concept, the response must be derived from actual classroom records and learner-state estimates. When the teacher asks why, the response must use curriculum graph reasoning and relevant evidence. When the teacher requests an activity, the response must be grounded in suitable curriculum resources.**

---

# STAGE 4 — INTELLIGENT INSTRUCTIONAL ALLOCATION AND MULTIGRADE SCHEDULING

## 4.1 Objective

Implement the central research component of CALCMATE: a curriculum- and knowledge-state-aware instructional-attention allocation engine.

This engine should decide how the teacher's limited direct instructional time can be allocated across concurrent grade groups.

It should use the intelligence developed in the earlier stages:

- Student-level knowledge-state estimates.
- Group-level mastery summaries.
- Curriculum prerequisite relationships.
- Prerequisite feasibility.
- Downstream concept importance.
- Instructional urgency.
- Missed-learning context.
- Available time.
- Teacher switching cost.
- Suitable activities for groups not receiving direct instruction.

The output should be a feasible, explainable instructional plan that the teacher can inspect and modify.

## 4.2 Define the allocation problem

Let:

- \(G\) be the set of instructional groups.
- \(C\) be the set of curriculum concepts.
- \(T\) be the set of available instructional time slots.
- \(K_{g,c}\) be the estimated mastery of group \(g\) for concept \(c\).
- \(KG\) be the shared curriculum knowledge graph.
- \(A_{g,c}\) represent relevant missed-learning context.
- \(D_{g,c}\) represent urgency or deadline information where available.

The teacher can directly instruct only one group at a time.

The system must choose which group and concept should receive teacher attention in each slot while maintaining feasible curriculum progression and providing meaningful activities for the other groups.

The objective is not to generate the most complicated possible schedule. It is to produce a useful, interpretable decision under practical classroom constraints.

## 4.3 Compute learner and group needs

For a concept \(c\), a simple gap measure is:

\[
G_{g,c} = 1 - K_{g,c}
\]

A group with lower estimated mastery may have a larger learning gap, but the gap score must be interpreted alongside the evidence available for the group.

A group with no assessment evidence should not automatically be treated as having the largest gap.

The system should therefore consider:

- Estimated mastery.
- Evidence sufficiency.
- Proportion of students needing support.
- Severity of prerequisite gaps.
- Whether the group has already received relevant instruction.
- Whether additional evidence is needed before deciding.

The initial implementation should use an explicit policy for handling uncertainty rather than hiding it inside an unexplained priority score.

## 4.4 Compute curriculum readiness and prerequisite deficit

For each group and target concept, query the shared knowledge graph.

The engine should identify:

- Direct prerequisites.
- Relevant prerequisite chains.
- Estimated mastery of those prerequisites.
- The proportion of students who may not be ready.
- Missing evidence for required prerequisite concepts.

A simple group-level prerequisite readiness summary may be represented as \(PR_{g,c}\), with a prerequisite deficit:

\[
PD_{g,c} = 1 - PR_{g,c}
\]

The implementation must define how these values are calculated and how missing prerequisite evidence is treated.

The system should also calculate downstream importance, \(DI_c\), from the number or weighted importance of dependent concepts represented in the graph.

This enables the scheduler to recognise that a concept may deserve attention not only because learners currently struggle with it, but also because it supports several later concepts.

### Important scheduling rule

If a target concept is blocked by a required prerequisite, the engine should not simply discard the target concept.

It should identify the prerequisite that needs attention and consider scheduling that prerequisite instead.

For example, if students struggle with equivalent fractions because the relevant prerequisite concepts are not sufficiently established, the system should consider a prerequisite-focused intervention rather than scheduling an advanced lesson that assumes readiness.

The graph should influence the actual decision, not merely appear in the explanation.

## 4.5 Construct the priority function

The initial implementation can use an explainable weighted heuristic.

A candidate priority score may be defined as:

\[
\begin{aligned}
P_{g,c,t} ={}&
w_G G_{g,c}
+ w_R R_{g,c}
+ w_D D_{g,c,t}\\
&+ w_M M_{g,c,t}
- w_S S_{g,t}
\end{aligned}
\]

where:

- \(G_{g,c}\) represents the learning gap.
- \(R_{g,c}\) represents curriculum readiness or prerequisite-related priority.
- \(D_{g,c,t}\) represents urgency or deadline.
- \(M_{g,c,t}\) represents relevant missed-learning context.
- \(S_{g,t}\) represents a switching penalty.
- \(w_G, w_R, w_D, w_M, w_S\) are configurable weights.

The existing research draft uses provisional weights of 0.35, 0.25, 0.15, 0.15 and 0.10 respectively, with the switching term subtracted.

These weights should remain configurable and documented. They should not be described as empirically optimal unless an appropriate optimisation or evaluation process establishes that.

The readiness term also needs a precise definition. It must not reward teaching a downstream concept that is infeasible because its prerequisites are unresolved. Hard prerequisite constraints and soft priority factors should remain distinct.

## 4.6 Enforce scheduling constraints

The allocation engine should enforce explicit constraints.

### A. One teacher-led group per slot

A single teacher cannot directly teach two groups simultaneously.

The schedule must assign at most one group to teacher-led instruction in each time slot.

### B. Prerequisite feasibility

The scheduler should not recommend progression to a concept when a required prerequisite condition is violated under the selected policy.

Where the prerequisite is not sufficiently established, the engine should prioritise prerequisite revision, an appropriate diagnostic activity, or another feasible action.

### C. Curriculum scope

Every scheduled concept must belong to the selected Mathematics curriculum and the relevant group.

### D. Available instructional time

The schedule must respect the available time budget and slot duration.

### E. Instructional progression

The schedule should avoid unnecessary jumps between unrelated concepts when a coherent instructional sequence is available.

### F. Independent activities

Groups that are not receiving teacher-led instruction must receive an appropriate activity, rather than an empty schedule entry.

### G. Teacher agency

The teacher must be able to inspect, modify, or override the proposed schedule.

The scheduler should not present a recommendation as a compulsory decision.

## 4.7 Generate meaningful activities for unattended groups

One of the main practical challenges in multi-grade classrooms is what the other groups do while the teacher is occupied.

CALCMATE should provide activities suited to the group's curriculum context and readiness.

Activity categories may include:

- NCERT textbook practice.
- Worked-example completion.
- Peer discussion.
- Manipulative-based Mathematics tasks.
- Short revision exercises.
- Concept-specific practice.
- Student-generated examples.
- Self-checking exercises where suitable.

The system should retrieve or select activities associated with the relevant curriculum concept.

Each activity should have useful metadata:

- Activity ID.
- Concept ID.
- Grade suitability.
- Prerequisite requirements.
- Estimated duration.
- Resource reference.
- Required materials.
- Level of teacher supervision.
- Instructions for students.
- Optional completion evidence.

Activities must not assume that assigning or completing an activity proves mastery. Learner state should change only when suitable evidence is recorded.

For the initial version, curated activity templates linked to NCERT resources are preferable to relying on unrestricted LLM generation.

## 4.8 Implement a deterministic scheduling algorithm

A deterministic greedy heuristic is a suitable starting point because it is lightweight, explainable, and easier to inspect than an opaque optimisation model.

At each scheduling slot, the engine should:

1. Retrieve the current learner-state summaries.
2. Identify relevant concepts and candidate actions for each group.
3. Check prerequisite feasibility.
4. Generate feasible teacher-led candidates.
5. Compute priority scores.
6. Apply switching and scheduling constraints.
7. Select the highest-priority feasible action.
8. Assign suitable independent activities to other groups.
9. Record the decision and the factors that influenced it.
10. Advance to the next slot and update scheduling context.

The implementation should retain enough structured information to explain why the selected action was preferred.

A deterministic heuristic is not necessarily globally optimal. CALCMATE should describe it as a constrained, explainable allocation method unless a formal optimisation approach is actually implemented and evaluated.

## 4.9 Implement allocation explanations

Each scheduled action should have a structured explanation.

For example:

"Grade 4 is prioritised for direct instruction because the current evidence indicates a substantial gap in the target concept, a prerequisite requires revision, and the concept supports later curriculum progression."

The explanation should be assembled from actual decision factors, such as:

- Estimated mastery.
- Evidence sufficiency.
- Prerequisite status.
- Downstream importance.
- Urgency.
- Missed-learning context.
- Switching penalty.
- Relevant scheduling constraints.

The chatbot can convert these structured factors into natural language, but the explanation must reflect the actual allocation calculation.

## 4.10 Connect allocation to the chatbot

Once the allocation engine is implemented, the chatbot should be able to invoke it directly.

Example questions:

- "Which group should I teach next?"
- "Why is Grade 4 prioritised over Grade 3?"
- "What should the other groups do meanwhile?"
- "What happens if I teach fractions before revising the prerequisite?"
- "Can you plan the next 30 minutes?"
- "What should I teach after this activity?"

These requests must invoke structured scheduling operations rather than asking the LLM to produce an independent timetable.

The chatbot should be able to explain an existing schedule and request a new one when the teacher changes the relevant constraints.

## 4.11 Implement feedback-driven rescheduling

After the teacher records new assessment evidence:

1. The original assessment record is saved.
2. The learner-state estimator updates the relevant student–concept state.
3. Affected group summaries are refreshed.
4. Relevant prerequisite-readiness values are recalculated.
5. Candidate priorities are recomputed.
6. The allocation engine generates an updated recommendation.

This is a critical component of the research workflow.

The system should not simply repeat the same timetable every day or recalculate priorities from a static list of weak students.

It should be able to respond to new evidence.

## 4.12 Expected output of Stage 4

At the end of Stage 4, CALCMATE should have:

1. A deterministic instructional allocation engine.
2. Group-level learning-gap calculations.
3. Prerequisite-aware candidate selection.
4. Downstream concept importance.
5. Urgency and missed-learning context where supported by data.
6. A configurable priority function.
7. Explicit scheduling constraints.
8. A teacher-led slot assignment mechanism.
9. NCERT-grounded activities for unattended groups.
10. Structured allocation explanations.
11. Chatbot access to the actual allocation engine.
12. A feedback mechanism that updates later recommendations after new assessment evidence.

### Stage 4 completion criterion

**Changing relevant learner evidence or prerequisite relationships must be capable of changing the allocation decision. The resulting schedule must be feasible, explainable, and connected to the actual classroom data.**

---

# STAGE 5 — COMPLETE APPLICATION INTEGRATION AND REVIEW THREE DELIVERY

## 5.1 Objective

Integrate all the preceding work into one coherent teacher-facing application.

The goal is to demonstrate CALCMATE as a complete workflow rather than a collection of modules.

The application should connect classroom records, student knowledge representations, curriculum reasoning, the chatbot, NCERT retrieval, scheduling, teacher control, and feedback-driven updates.

This stage should prioritise end-to-end functionality, clarity, and a polished research demonstration over adding new unrelated features.

## 5.2 Complete the unified application workflow

The teacher should be able to follow a natural sequence through the application.

### Step 1: Select or prepare the classroom

The teacher opens CALCMATE and selects the classroom or workspace.

The application displays the available grade groups and students.

The curriculum context is Mathematics, with concepts linked to the canonical taxonomy.

### Step 2: Record attendance and available evidence

The teacher records attendance through the existing workflow.

Assessment evidence can be entered when available.

The application should avoid requiring continuous manual entry for every student and concept.

Attendance and assessment evidence should remain distinct.

### Step 3: View learner knowledge states

The teacher opens a student or group profile.

The application presents relevant concept-level information, including:

- Concepts with evidence of difficulty.
- Concepts with evidence of sufficient understanding.
- Prerequisite gaps.
- Evidence recency.
- Concepts for which evidence is insufficient.

Where practical, the interface should provide a visual learner-graph view showing the relevant curriculum concepts and their relationships.

The visualisation should prioritise useful interpretation over displaying a large, unreadable network.

A teacher should be able to inspect an individual concept and understand why it is highlighted.

### Step 4: Ask the copilot a classroom question

The teacher opens the chatbot and asks:

"Who is struggling with fractions in Grade 4?"

The application routes the request to the structured classroom and learner-state services.

The response shows the students supported by the available evidence, the relevant concept states, and any important prerequisite relationships.

### Step 5: Investigate the learning difficulty

The teacher asks:

"Why are these students struggling with equivalent fractions?"

The copilot retrieves the relevant student states, queries the curriculum graph, and retrieves appropriate NCERT material.

It explains the relevant evidence and potential prerequisite concerns.

### Step 6: Request a teaching activity

The teacher asks:

"Give me an activity to help these students."

The copilot retrieves or selects an appropriate NCERT-grounded activity.

The activity should be suitable for the selected concept and group, and it should account for prerequisite readiness where that information is available.

### Step 7: Generate the instructional schedule

The teacher requests a schedule for the selected groups and time period.

The allocation engine computes the teacher-led priorities using the current learner states, curriculum graph, and scheduling constraints.

The application displays:

- The selected group.
- The target concept.
- The instructional slot.
- The reason for the priority.
- Relevant prerequisite information.
- The activity assigned to each unattended group.
- The associated NCERT resources.

### Step 8: Review or modify the recommendation

The teacher can accept the recommendation, modify it, or override it.

The interface should make it clear that CALCMATE supports the teacher rather than replacing the teacher's judgement.

Where the teacher changes a scheduled action, the application should preserve the teacher's choice and distinguish it from the original recommendation.

### Step 9: Record new evidence

After teaching or practice, the teacher can record an assessment result or other supported evidence.

The learner-state estimator updates the relevant concept state.

The application then makes the updated state available to subsequent queries and scheduling operations.

### Step 10: Regenerate the recommendation

The teacher requests the next schedule.

The application should calculate a new recommendation using the updated learner states and scheduling context.

The demonstration should make it possible to see why the recommendation changed—or why it did not change, if the new evidence does not materially affect the decision.

This completes the core CALCMATE feedback loop.

## 5.3 Consolidate the service interfaces

By this stage, the frontend should not need to know the internal implementation details of every intelligence module.

It should interact with a small set of clearly defined services.

Conceptually, these include:

- Classroom data access.
- Student and group selection.
- Learner-state retrieval and update.
- Curriculum graph queries.
- NCERT resource retrieval.
- Classroom question routing.
- Instructional allocation.
- Schedule persistence.
- Teacher feedback and overrides.

The existing Python backend may serve as an integration layer for the graph, estimator, RAG, and allocation engine.

However, the offline-first requirement must be handled honestly.

If the Python service runs on the same device, that is different from running on a separate development machine. If the service runs on a separate machine, the app's behaviour without that machine must be documented.

For Review Three, a local development service can be an acceptable integration strategy if it is stable and the deployment limitations are clearly stated. It must not be presented as proof of fully on-device execution.

## 5.4 Make the interface teacher-centric

The interface should expose the research intelligence without overwhelming the teacher.

Prioritise:

- Clear student and group selection.
- Concept-level learning summaries.
- Direct access to the copilot.
- Readable allocation recommendations.
- Concise explanations.
- Easy access to relevant NCERT resources.
- Editable schedules.
- Visible teacher overrides.
- Minimal repeated data entry.

Avoid displaying every internal graph metric on the primary screen.

Advanced information, such as prerequisite paths, evidence history, and detailed priority factors, can be available when the teacher wants to inspect a recommendation.

The teacher should be able to answer three questions quickly:

1. Who needs attention?
2. Why does that group need attention?
3. What should I do next?

## 5.5 Integrate individual and group graph visualisations

The project specifically intends to maintain student-specific knowledge representations and connect them through the shared curriculum graph.

The application should therefore support two complementary views.

### A. Individual learner view

Display the relevant curriculum concepts for one student, with visual indicators for:

- Evidence-supported mastery.
- Potential learning gaps.
- Prerequisite relationships.
- Insufficient evidence.
- Relevant learning resources.

The view should be generated from the shared curriculum graph and the student's state records.

### B. Group or classroom view

Display selected curriculum concepts and summarise the relevant states across the group.

The group view may highlight:

- Concepts with widespread learning gaps.
- Prerequisites affecting several students.
- Concepts that may block subsequent learning.
- Students whose evidence differs substantially from the group summary.
- Concepts that need additional assessment evidence.

This is where individual learner representations become useful for classroom-level decision-making.

The system should not create an unnecessarily large visual graph that combines every student and every concept on one screen. Use filtering, concept selection, grade filters, and student-specific views to make the representation navigable.

## 5.6 Establish the evaluation and demonstration layer

The project already has research work on curriculum-constrained RAG and synthetic learner-state estimation.

The integrated system should retain those results while separating them from new claims about classroom orchestration.

The review should distinguish:

- Retrieval performance.
- Learner-state estimation performance under the tested simulation assumptions.
- Functional integration of the graph and allocation engine.
- Scheduling performance in simulated classroom scenarios.
- Usability and teacher-workload claims, which require separate evidence.

### A. Allocation baselines

Use three scheduling approaches:

1. Static rotating timetable.
2. Gap-only scheduling.
3. Full CALCMATE scheduling using learner state and curriculum graph reasoning.

Run the methods on equivalent simulated classroom conditions.

### B. Allocation metrics

Use the previously defined research metrics where implemented and appropriately defined:

- Learning-gap coverage.
- Prerequisite violations.
- Average instructional delay.
- Teacher-attention utilisation.
- Context-switch count.

Report each metric's definition, direction of improvement, and evaluation conditions.

Do not claim that the full system improves every metric unless the results show that.

### C. Ablation studies

Where feasible, compare the full allocator against variants that remove one source of intelligence.

For example:

- Remove graph-based prerequisite reasoning.
- Remove the learner-state signal and use a simpler gap-only measure.
- Remove missed-learning context.
- Remove switching-cost penalties.

These comparisons help establish which components influence the scheduler's behaviour.

### D. RAG evaluation

Preserve the existing curriculum-aware retrieval evaluation and report its benchmark, corpus scope, metrics, and results accurately.

Do not present retrieval performance as evidence that the scheduler improves student learning.

### E. Learner-state estimation

Preserve the controlled learner-state estimation results with their assumptions and limitations.

The existing moment-matching results are specific to the tested synthetic observation model. They do not establish universal superiority over BKT or prove that the same error rates will occur in real classrooms.

### F. End-to-end evidence

For Review Three, prepare one reproducible scenario showing:

1. A selected classroom and grade groups.
2. Actual stored assessment records.
3. Updated student concept states.
4. Relevant prerequisite graph paths.
5. A chatbot answer derived from classroom evidence.
6. NCERT resource retrieval.
7. A generated instructional allocation.
8. Teacher review or modification.
9. New assessment evidence.
10. A subsequent recommendation generated from the updated state.

This demonstration should show that the components genuinely affect one another.

## 5.7 Prepare the Review Three research narrative

The presentation should explain the work as one research contribution.

### Problem

A teacher in a multi-grade classroom has limited direct instructional time and must decide which group needs attention while keeping the other groups engaged.

### Research gap

Conventional educational chatbots and content-generation tools do not, by themselves, provide a unified, explicit representation of individual learner knowledge states, curriculum prerequisites, and constrained teacher-attention allocation.

### Proposed solution

CALCMATE combines a shared curriculum knowledge graph, student-specific knowledge-state representations, curriculum-grounded retrieval, a lightweight language interface, and a deterministic allocation engine.

### Primary contribution

The primary contribution is the curriculum- and knowledge-state-aware allocation of limited teacher instructional attention across concurrent grade groups.

### Supporting contributions

- Shared curriculum knowledge representation.
- Student-specific learning-state estimation.
- Curriculum-aware NCERT retrieval.
- Natural-language teacher assistance.
- Explainable multigrade scheduling.
- Teacher-in-the-loop control.
- Offline-first application architecture.

### Demonstrated result

The review should show the integrated workflow operating on a clearly defined Mathematics classroom scenario, with supporting retrieval results, learner-state experiments, and scheduling comparisons where available.

### Limitations

State clearly which parts are validated through synthetic data, which parts are implemented and connected, which deployment conditions are required, and which real-classroom claims remain future evaluation objectives.

## 5.8 Expected output of Stage 5

At the end of Stage 5, CALCMATE should have:

1. One teacher-facing mobile application.
2. One consistent NCERT Mathematics taxonomy for Grades 1–5.
3. A shared curriculum knowledge graph.
4. Student-specific knowledge-state representations.
5. Group-level learner summaries.
6. A connected learner-state update pipeline.
7. A chatbot that queries actual classroom records and curriculum intelligence.
8. NCERT-grounded resource retrieval.
9. A connected graph- and learner-state-aware allocation engine.
10. A schedule that respects instructional constraints.
11. Suitable activities for unattended groups.
12. Teacher review, modification, and override functionality.
13. A feedback loop that updates later recommendations.
14. A coherent research demonstration and evaluation narrative.

### Stage 5 completion criterion

**A teacher must be able to complete the intended workflow through the application without manually transferring classroom information between disconnected modules. The system must demonstrate how evidence flows into learner states, how curriculum reasoning informs priorities, how those priorities produce a schedule, and how new evidence affects subsequent recommendations.**

---

# 6. How the Five Stages Address Research Objectives RO5–RO9

The development roadmap should be explicitly connected to the stated research objectives.

## RO5 — AI-powered teacher copilot

"To investigate the design of an AI-powered teacher copilot that supports instructional and administrative decision-making in multi-grade classrooms operating in resource-constrained educational environments."

**Primary stages:** Stages 1, 3 and 5.

The classroom data foundation provides the necessary information. The integrated chatbot gives the teacher natural-language access to classroom and curriculum intelligence. The final application integrates those capabilities into a teacher-facing workflow.

Administrative assistance can include attendance and assessment access, classroom summaries, and schedule management. Instructional assistance can include learner-gap identification, prerequisite explanations, resource retrieval, and teaching priorities.

## RO6 — Intelligent classroom orchestration

"To develop an intelligent classroom orchestration framework that assists teachers in lesson planning, instructional scheduling, learner progression, and classroom management across multiple grade levels."

**Primary stages:** Stages 2, 4 and 5.

The learner-state model and curriculum graph supply the intelligence needed for orchestration. The allocation engine uses that information to select feasible teacher-led actions and coordinate activities for unattended groups.

The complete application demonstrates the workflow in a multi-grade classroom.

## RO7 — Learner monitoring and curriculum-guided planning

"To develop an intelligent teacher assistance framework that supports learner monitoring, adaptive educational resource generation, and curriculum-guided instructional planning through a unified AI-driven workflow."

**Primary stages:** Stages 1, 2, 3, 4 and 5.

The shared taxonomy connects assessments to concepts. Learner-state estimation supports monitoring. Curriculum-aware RAG provides grounded resources. The graph and allocation engine use learner evidence and prerequisite structure to guide planning.

Adaptive resource generation should remain grounded in curriculum evidence and the actual learning need. The initial implementation can rely on curated NCERT-linked activities rather than unrestricted generation.

## RO8 — Human–AI interaction and on-device interfaces

"To investigate multimodal human–AI interaction techniques that enable teachers to effectively access AI-assisted recommendations through intuitive on-device interfaces."

**Primary stages:** Stages 3 and 5.

The conversational interface and teacher-facing application support natural-language interaction with the system. Relevant context should be passed from the selected student, group, or concept so that the teacher does not need to repeat information.

The current implementation should be described accurately. A conversational interface alone does not establish multimodal interaction, and a locally stored application does not automatically establish on-device language-model inference.

If multimodal interaction or fully on-device inference is part of the final claimed contribution, it must be implemented and demonstrated separately.

## RO9 — Effectiveness, workload, and personalized learning

"To evaluate the effectiveness of the proposed AI copilot in reducing teacher workload, improving classroom orchestration, and supporting personalized learning in single-teacher and multi-grade government schools."

**Primary stages:** Stages 4 and 5.

The allocation baselines and simulated scenarios can evaluate scheduling behaviour and learner-gap prioritisation. The feedback loop demonstrates whether the system responds to updated evidence.

However, synthetic simulation cannot establish that teacher workload has actually decreased or that real students have learned more. Those claims require suitable user studies or classroom evidence.

The Review Three demonstration should therefore establish functional capability and report the available algorithmic evaluation, while treating real-world effectiveness as an evaluation objective rather than a proven result.

---

# 7. Cross-Stage Technical Architecture

The following architecture should guide the implementation across all five stages.

## 7.1 Application layer

Responsibilities:

- Teacher interface.
- Classroom and group selection.
- Student profiles.
- Attendance.
- Assessment entry.
- Learner-state visualisation.
- Chat interface.
- Schedule presentation.
- Teacher overrides.
- Local persistence.

The application should not independently maintain a competing curriculum taxonomy or duplicate the allocation algorithm in a separate implementation.

## 7.2 Classroom data layer

Responsibilities:

- Student and group records.
- Assessment evidence.
- Attendance records.
- Learner-state records or caches.
- Schedule persistence.
- Teacher feedback and overrides.

The source of truth for each data item must be clear.

Where the application is offline-first, the local classroom store should remain authoritative for the teacher's local records.

## 7.3 Curriculum intelligence layer

Responsibilities:

- Canonical curriculum concepts.
- Prerequisite relationships.
- Curriculum graph queries.
- Student-specific knowledge-state association.
- Group-level mastery aggregation.
- Readiness and prerequisite deficit calculations.
- Relevant downstream dependency analysis.

## 7.4 Educational retrieval layer

Responsibilities:

- NCERT document and chunk management.
- Text embeddings.
- Vector retrieval.
- Grade and subject filtering.
- Concept-aware retrieval.
- Resource references.
- Curriculum-grounded evidence for explanations and activities.

## 7.5 Copilot orchestration layer

Responsibilities:

- Natural-language intent extraction.
- Request validation.
- Routing to structured operations.
- Classroom query execution.
- Retrieval invocation.
- Allocation invocation.
- Explanation generation.
- Evidence-aware responses.

## 7.6 Allocation layer

Responsibilities:

- Candidate generation.
- Learner-gap scoring.
- Prerequisite feasibility.
- Instructional priority scoring.
- Time-slot assignment.
- Switching-cost handling.
- Independent activity assignment.
- Schedule explanations.
- Teacher override handling.
- Feedback-driven regeneration.

## 7.7 Research evaluation layer

Responsibilities:

- Synthetic classroom scenarios.
- Learner-state estimation experiments.
- Retrieval benchmarks.
- Scheduling baselines.
- Allocation metrics.
- Ablation studies.
- Reproducible experiment configuration.
- Result reporting.

The research evaluation layer should remain separate from live classroom records. Synthetic experiments should not accidentally overwrite application data or be presented as observations from real students.

---

# 8. Priority Order Within the Five Stages

Although the roadmap contains five stages, development should proceed through a strict dependency order.

The priorities are:

1. Establish the canonical curriculum and classroom data model.
2. Connect individual learner states to the shared curriculum graph.
3. Make the chatbot query actual classroom data and curriculum intelligence.
4. Make the allocation engine use the same learner states and graph relationships.
5. Integrate the complete feedback loop into the teacher application.

Avoid parallel implementations of the same feature.

For example, do not build a second graph-aware scheduler in the frontend if the Python backend already contains the intended allocation logic. Likewise, do not create a chatbot-specific copy of student mastery values that can become inconsistent with the learner-state service.

A component is complete only when the application invokes it through the intended workflow and its result affects the output.

---

# 9. What Should Be Deferred Until the Core Workflow Is Complete

The project has a broad research vision, but Review Three requires a working, integrated system rather than every possible feature.

Defer the following unless they are already implemented and can be integrated with minimal effort:

- Adding new subjects beyond Mathematics.
- Adding new features that do not contribute to the end-to-end workflow.
- Replacing the existing mobile application unnecessarily.
- Replacing the working RAG implementation without a clear reason.
- Building a separate full curriculum graph for every student.
- Introducing a graph neural network without a defined task and evaluation plan.
- Treating text embeddings as graph embeddings.
- Allowing an LLM to generate unconstrained allocation decisions.
- Adding complex reinforcement learning or bandit optimisation before the deterministic scheduler works.
- Building a cloud-dependent backend while claiming complete offline operation.
- Requiring continuous per-student data entry.
- Claiming real classroom effectiveness from synthetic experiments.
- Claiming global scheduling optimality for a greedy heuristic.
- Generating large visual graphs that are difficult for teachers to navigate.

These are not necessarily bad future research directions. They are lower priority than connecting the current components into one reliable workflow.

---

# 10. Final Definition of Success for Review Three

The project should be considered ready for the intended Review Three demonstration when the following scenario can be completed through the application.

A teacher opens CALCMATE and selects Mathematics groups from the target Grades 1–5 scope.

The teacher records assessment evidence for selected students. The system links that evidence to the canonical curriculum concepts and updates the relevant learner-state estimates.

The teacher asks:

"Who is struggling with fractions, and what should I teach next?"

CALCMATE identifies the relevant students from the available evidence, displays their concept-level learning states, and explains any important prerequisite gaps using the curriculum graph.

The teacher asks for a suitable activity. The copilot retrieves relevant NCERT material and presents a curriculum-grounded recommendation.

The teacher requests a schedule for the next instructional period. The allocation engine computes a feasible schedule using the current learner states, prerequisite relationships, and scheduling constraints. The application shows which group receives teacher attention, why it was prioritised, and what the other groups should do meanwhile.

The teacher accepts or modifies the recommendation. After new assessment evidence is entered, CALCMATE updates the relevant learner states and generates a subsequent recommendation using the updated classroom information.

That single workflow demonstrates the integration of the mobile application, classroom records, learner-state estimation, curriculum knowledge graph, RAG, chatbot, instructional allocation, and feedback loop.

It also provides a direct, defensible connection to the central research contribution.

# Conclusion

CALCMATE should be developed as one coherent intelligence pipeline, not as a collection of individually impressive but disconnected modules.

The five-stage roadmap establishes the necessary sequence:

1. **Unified Curriculum and Classroom Data Foundation** — establish the shared vocabulary and data model.
2. **Curriculum Knowledge Graph and Student Knowledge Intelligence** — represent curriculum dependencies and individual learning states.
3. **Integrated AI Copilot and Curriculum-Grounded Chatbot** — make the intelligence accessible through natural language.
4. **Intelligent Instructional Allocation and Multigrade Scheduling** — use learner states and curriculum structure to allocate teacher attention.
5. **Complete Application Integration and Review Three Delivery** — connect the full workflow and present it as one research system.

The key is not to maximise the number of features. It is to ensure that each component contributes to the same educational decision-making process.

**The strongest version of CALCMATE is one in which the teacher's question, the student's evidence, the curriculum graph, the chatbot's response, and the next instructional allocation are all connected through a consistent, explainable system.**