/**
 * CALCMATE — Stage 2: Score-Ratio-v1 Learner State Estimator
 *
 * Core design decisions:
 *  - mastery_estimate is NULL when there is no evidence (not 0).
 *  - state_status 'unknown' means no evidence at all.
 *  - Attendance is NOT used as mastery evidence.
 *  - The curriculum graph is NOT duplicated per student; the shared
 *    concept_prerequisites junction table is read from SQLite.
 *  - MASTERY_THRESHOLD = 0.70 (from frozen_parameters.md).
 *  - Estimator name/version stored in each row for auditability.
 */

import { getDatabase, LearnerConceptStateRecord, AssessmentRecord } from "./database";
import { requireSession } from "./authService";


// ─── Constants ────────────────────────────────────────────────────────────────
export const MASTERY_THRESHOLD = 0.70;
export const NEEDS_SUPPORT_THRESHOLD = 0.60;
const ESTIMATOR_NAME = "score-ratio-v1";
const ESTIMATOR_VERSION = "1";

// Recency weight: most recent assessment weighted higher.
// Weight for assessment i (0 = most recent) is (DECAY^i).
const RECENCY_DECAY = 0.75;

// ─── Core Types ───────────────────────────────────────────────────────────────
export type StateStatus = "unknown" | "insufficient" | "needs_support" | "likely_ready";
export type EvidenceSufficiency = "none" | "limited" | "moderate" | "sufficient";

export interface MasteryEstimateResult {
  mastery_estimate: number | null;
  evidence_count: number;
  last_evidence_at: string | null;
  state_status: StateStatus;
  evidence_sufficiency: EvidenceSufficiency;
}

export interface ConceptWithState {
  concept_id: string;
  concept_title: string;
  concept_grade: number;
  state: LearnerConceptStateRecord | null;
  prerequisite_gap: boolean;   // true if a prerequisite has needs_support / unknown
  prerequisite_ids: string[];
}

export interface StudentKnowledgeView {
  student_id: string;
  student_name: string;
  grade: number;
  concepts: ConceptWithState[];
  assessed_count: number;
  unassessed_count: number;
  needs_support_count: number;
  likely_ready_count: number;
  unknown_count: number;
}

export interface GroupKnowledgeSummary {
  grade: number;
  total_students: number;
  assessed_count: number;
  below_threshold_count: number;
  mean_mastery: number | null;
  concepts_needing_support: { concept_id: string; concept_title: string; student_count: number }[];
  unassessed_concepts: { concept_id: string; concept_title: string }[];
}

export interface PrerequisiteAnalysis {
  concept_id: string;
  concept_title: string;
  prerequisites: {
    concept_id: string;
    concept_title: string;
    state_status: StateStatus;
    mastery_estimate: number | null;
    is_blocking: boolean;  // true if unknown or needs_support
  }[];
  has_blocking_gaps: boolean;
  recommendation: string;
}

// ─── Pure Estimation Logic ─────────────────────────────────────────────────────

/**
 * Compute mastery estimate from a list of assessment records.
 * Sorted by date (most recent first) before weighting.
 * Returns null mastery when evidence_count === 0.
 */
export function computeMasteryEstimate(assessments: Pick<AssessmentRecord, "score" | "maximum" | "date" | "created_at" | "id">[]): MasteryEstimateResult {
  const evidence_count = assessments.length;

  if (evidence_count === 0) {
    return {
      mastery_estimate: null,
      evidence_count: 0,
      last_evidence_at: null,
      state_status: "unknown",
      evidence_sufficiency: "none",
    };
  }

  // Sort descending by date, then created_at, then id for stability
  const sorted = [...assessments].sort((a, b) =>
    b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
  );

  // Recency-weighted average: weight[i] = DECAY^i
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ratio = sorted[i].score / sorted[i].maximum;
    const weight = Math.pow(RECENCY_DECAY, i);
    weightedSum += ratio * weight;
    weightTotal += weight;
  }
  const mastery_estimate = weightedSum / weightTotal;

  const last_evidence_at = sorted[0].date;

  const evidence_sufficiency: EvidenceSufficiency =
    evidence_count >= 4 ? "sufficient" :
    evidence_count >= 2 ? "moderate" :
    "limited";

  const state_status: StateStatus =
    mastery_estimate >= MASTERY_THRESHOLD ? "likely_ready" :
    mastery_estimate >= NEEDS_SUPPORT_THRESHOLD ? "insufficient" :
    "needs_support";

  return { mastery_estimate, evidence_count, last_evidence_at, state_status, evidence_sufficiency };
}

// ─── DB-backed Functions ────────────────────────────────────────────────────────

/**
 * Recompute and persist the learner_concept_states row for a student/concept.
 * Called after every saveAssessment / removeAssessment.
 * Must run inside or outside a transaction — uses getDatabase() directly.
 */
export async function updateLearnerConceptState(
  studentId: string,
  conceptId: string
): Promise<void> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  // Fetch all assessments for this student/concept
  const assessments = await db.getAllAsync<AssessmentRecord>(
    "SELECT * FROM assessments WHERE workspace_id=? AND student_id=? AND concept_id=? ORDER BY date DESC,created_at DESC,id DESC",
    w, studentId, conceptId
  );

  const result = computeMasteryEstimate(assessments);
  const now = new Date().toISOString();

  // Upsert using UNIQUE(workspace_id, student_id, concept_id)
  const existingRow = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM learner_concept_states WHERE workspace_id=? AND student_id=? AND concept_id=?",
    w, studentId, conceptId
  );
  const rowId = existingRow?.id ?? `lcs-${studentId}-${conceptId}`;

  await db.runAsync(
    `INSERT INTO learner_concept_states
       (id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,
        estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_id,student_id,concept_id) DO UPDATE SET
       mastery_estimate=excluded.mastery_estimate,
       evidence_count=excluded.evidence_count,
       last_evidence_at=excluded.last_evidence_at,
       estimator_name=excluded.estimator_name,
       estimator_version=excluded.estimator_version,
       state_status=excluded.state_status,
       evidence_sufficiency=excluded.evidence_sufficiency,
       updated_at=excluded.updated_at`,
    rowId, w, studentId, conceptId,
    result.mastery_estimate,
    result.evidence_count,
    result.last_evidence_at,
    ESTIMATOR_NAME, ESTIMATOR_VERSION,
    result.state_status,
    result.evidence_sufficiency,
    now,
    now   // created_at only applied on insert; ignored on conflict update
  ).catch(async () => {

    // Fallback: if the ON CONFLICT clause has issues with created_at, do a two-step upsert
    if (!existingRow) {
      await db.runAsync(
        `INSERT OR IGNORE INTO learner_concept_states
           (id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,
            estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        rowId, w, studentId, conceptId,
        result.mastery_estimate, result.evidence_count, result.last_evidence_at,
        ESTIMATOR_NAME, ESTIMATOR_VERSION,
        result.state_status, result.evidence_sufficiency,
        now, now
      );
    } else {
      await db.runAsync(
        `UPDATE learner_concept_states SET
           mastery_estimate=?,evidence_count=?,last_evidence_at=?,
           estimator_name=?,estimator_version=?,state_status=?,evidence_sufficiency=?,updated_at=?
         WHERE workspace_id=? AND student_id=? AND concept_id=?`,
        result.mastery_estimate, result.evidence_count, result.last_evidence_at,
        ESTIMATOR_NAME, ESTIMATOR_VERSION,
        result.state_status, result.evidence_sufficiency,
        now, w, studentId, conceptId
      );
    }
  });
}

/**
 * Retrieve a single learner concept state row. Returns null if not yet computed.
 */
export async function getLearnerConceptState(
  studentId: string,
  conceptId: string
): Promise<LearnerConceptStateRecord | null> {
  const session = await requireSession();
  const db = await getDatabase();
  return db.getFirstAsync<LearnerConceptStateRecord>(
    "SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id=? AND concept_id=?",
    session.workspaceId, studentId, conceptId
  );
}

/**
 * Return a full knowledge view for a student: every concept for their grade
 * with state labels and prerequisite gap flags.
 */
export async function getStudentKnowledgeView(
  studentId: string
): Promise<StudentKnowledgeView> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  const student = await db.getFirstAsync<{ id: string; name: string; grade: number }>(
    "SELECT id,name,grade FROM students WHERE workspace_id=? AND id=?",
    w, studentId
  );
  if (!student) throw new Error("Student not found.");

  // All concepts for this grade
  const concepts = await db.getAllAsync<{ id: string; title: string; grade: number }>(
    "SELECT id,title,grade FROM concepts WHERE workspace_id=? AND grade=? ORDER BY id",
    w, student.grade
  );

  // All learner states for this student
  const stateRows = await db.getAllAsync<LearnerConceptStateRecord>(
    "SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id=?",
    w, studentId
  );
  const stateMap = new Map(stateRows.map(r => [r.concept_id, r]));

  // Prerequisite edges for all these concepts
  const conceptIds = concepts.map(c => c.id);
  const prereqRows = await db.getAllAsync<{ concept_id: string; prerequisite_id: string }>(
    `SELECT concept_id, prerequisite_id FROM concept_prerequisites
     WHERE workspace_id=? AND concept_id IN (${conceptIds.map(() => "?").join(",")})`,
    w, ...conceptIds
  );
  const prereqMap = new Map<string, string[]>();
  for (const r of prereqRows) {
    if (!prereqMap.has(r.concept_id)) prereqMap.set(r.concept_id, []);
    prereqMap.get(r.concept_id)!.push(r.prerequisite_id);
  }

  const conceptsWithState: ConceptWithState[] = concepts.map(c => {
    const state = stateMap.get(c.id) ?? null;
    const prerequisite_ids = prereqMap.get(c.id) ?? [];

    // Prerequisite gap: any prerequisite has state 'unknown' or 'needs_support'
    const prerequisite_gap = prerequisite_ids.some(pid => {
      const pstate = stateMap.get(pid);
      return !pstate || pstate.state_status === "unknown" || pstate.state_status === "needs_support";
    });

    return {
      concept_id: c.id,
      concept_title: c.title,
      concept_grade: c.grade,
      state,
      prerequisite_gap: prerequisite_ids.length > 0 && prerequisite_gap,
      prerequisite_ids,
    };
  });

  const assessed_count = conceptsWithState.filter(c => c.state && c.state.state_status !== "unknown").length;
  const unassessed_count = conceptsWithState.filter(c => !c.state || c.state.state_status === "unknown").length;
  const needs_support_count = conceptsWithState.filter(c => c.state?.state_status === "needs_support").length;
  const likely_ready_count = conceptsWithState.filter(c => c.state?.state_status === "likely_ready").length;
  const unknown_count = conceptsWithState.filter(c => !c.state || c.state.state_status === "unknown").length;

  return {
    student_id: studentId,
    student_name: student.name,
    grade: student.grade,
    concepts: conceptsWithState,
    assessed_count,
    unassessed_count,
    needs_support_count,
    likely_ready_count,
    unknown_count,
  };
}

/**
 * Aggregate knowledge summary for an entire grade group.
 * Useful for the allocation algorithm (Stage 3) and group progress views.
 */
export async function getGroupKnowledgeSummary(
  grade: number
): Promise<GroupKnowledgeSummary> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  const students = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM students WHERE workspace_id=? AND grade=?",
    w, grade
  );
  const total_students = students.length;

  const concepts = await db.getAllAsync<{ id: string; title: string }>(
    "SELECT id,title FROM concepts WHERE workspace_id=? AND grade=? ORDER BY id",
    w, grade
  );

  if (total_students === 0) {
    return {
      grade, total_students: 0, assessed_count: 0, below_threshold_count: 0,
      mean_mastery: null, concepts_needing_support: [], unassessed_concepts: [],
    };
  }

  const studentIds = students.map(s => s.id);
  const stateRows = await db.getAllAsync<LearnerConceptStateRecord>(
    `SELECT * FROM learner_concept_states
     WHERE workspace_id=? AND student_id IN (${studentIds.map(() => "?").join(",")})`,
    w, ...studentIds
  );

  // Students with at least one assessed concept
  const studentsWithEvidence = new Set(
    stateRows.filter(r => r.state_status !== "unknown").map(r => r.student_id)
  );
  const assessed_count = studentsWithEvidence.size;

  const below_threshold = stateRows.filter(r => r.mastery_estimate !== null && r.mastery_estimate < MASTERY_THRESHOLD);
  const below_threshold_count = new Set(below_threshold.map(r => r.student_id)).size;

  const validMasteries = stateRows
    .filter(r => r.mastery_estimate !== null)
    .map(r => r.mastery_estimate as number);
  const mean_mastery = validMasteries.length > 0
    ? validMasteries.reduce((a, b) => a + b, 0) / validMasteries.length
    : null;

  // Per-concept: how many students need support
  const conceptsNeedingSupport = concepts
    .map(c => ({
      concept_id: c.id,
      concept_title: c.title,
      student_count: stateRows.filter(r => r.concept_id === c.id && r.state_status === "needs_support").length,
    }))
    .filter(c => c.student_count > 0)
    .sort((a, b) => b.student_count - a.student_count);

  // Concepts with zero assessments across all students
  const assessedConceptIds = new Set(stateRows.map(r => r.concept_id));
  const unassessed_concepts = concepts
    .filter(c => !assessedConceptIds.has(c.id))
    .map(c => ({ concept_id: c.id, concept_title: c.title }));

  return {
    grade,
    total_students,
    assessed_count,
    below_threshold_count,
    mean_mastery,
    concepts_needing_support: conceptsNeedingSupport,
    unassessed_concepts,
  };
}

/**
 * Graph-aware prerequisite analysis for a specific student and concept.
 * Inspects the concept_prerequisites table for direct prerequisites and
 * checks their learner states to identify blocking gaps.
 */
export async function getPrerequisiteAnalysis(
  studentId: string,
  conceptId: string
): Promise<PrerequisiteAnalysis> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  const concept = await db.getFirstAsync<{ id: string; title: string }>(
    "SELECT id,title FROM concepts WHERE workspace_id=? AND id=?",
    w, conceptId
  );
  if (!concept) throw new Error(`Concept ${conceptId} not found.`);

  // Direct prerequisites
  const prereqRows = await db.getAllAsync<{ prerequisite_id: string }>(
    "SELECT prerequisite_id FROM concept_prerequisites WHERE workspace_id=? AND concept_id=?",
    w, conceptId
  );

  const prerequisites: PrerequisiteAnalysis["prerequisites"] = [];
  for (const row of prereqRows) {
    const prereqConcept = await db.getFirstAsync<{ id: string; title: string }>(
      "SELECT id,title FROM concepts WHERE workspace_id=? AND id=?",
      w, row.prerequisite_id
    );
    const prereqState = await db.getFirstAsync<LearnerConceptStateRecord>(
      "SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id=? AND concept_id=?",
      w, studentId, row.prerequisite_id
    );
    const state_status: StateStatus = prereqState?.state_status ?? "unknown";
    const is_blocking = state_status === "unknown" || state_status === "needs_support";

    prerequisites.push({
      concept_id: row.prerequisite_id,
      concept_title: prereqConcept?.title ?? row.prerequisite_id,
      state_status,
      mastery_estimate: prereqState?.mastery_estimate ?? null,
      is_blocking,
    });
  }

  const has_blocking_gaps = prerequisites.some(p => p.is_blocking);

  const blockingNames = prerequisites
    .filter(p => p.is_blocking)
    .map(p => p.concept_title);

  const recommendation = prerequisites.length === 0
    ? "No prerequisites recorded for this concept. Proceed with readiness check."
    : has_blocking_gaps
    ? `Address prerequisite gaps before teaching ${concept.title}: ${blockingNames.join(", ")}.`
    : `All prerequisites for ${concept.title} show adequate evidence. Proceed with instruction.`;

  return { concept_id: conceptId, concept_title: concept.title, prerequisites, has_blocking_gaps, recommendation };
}

/** Human-readable label for state_status. */
export function stateLabel(status: StateStatus): string {
  return { unknown: "Not assessed", insufficient: "Limited evidence", needs_support: "Needs revision", likely_ready: "Likely ready" }[status];
}

/** Human-readable label for evidence_sufficiency. */
export function sufficiencyLabel(s: EvidenceSufficiency): string {
  return { none: "No evidence", limited: "Limited (1 assessment)", moderate: "Moderate (2–3 assessments)", sufficient: "Sufficient (4+ assessments)" }[s];
}

