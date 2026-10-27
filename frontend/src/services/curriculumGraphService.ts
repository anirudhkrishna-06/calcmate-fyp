import { getDatabase, ConceptRecord, LearnerConceptStateRecord } from "./database";
import { requireSession } from "./authService";
import {
  getStudentKnowledgeView,
  StateStatus,
  EvidenceSufficiency,
  MASTERY_THRESHOLD,
  NEEDS_SUPPORT_THRESHOLD
} from "./learnerStateService";

export interface GraphConceptNode {
  id: string;
  title: string;
  grade: number;
  prerequisiteId: string | null;
  learningObjective: string | null;
  subjectArea: string;
  coverageStatus: string | null;
  prerequisiteIds: string[];
  dependentIds: string[];
  depth: number;
  // Overlay data (null if not loaded/overlaying)
  masteryEstimate: number | null;
  stateStatus: StateStatus;
  evidenceSufficiency: EvidenceSufficiency;
  evidenceCount: number;
  prerequisiteGap: boolean;
  // Group summary overlay metrics (if grade group overlay active)
  studentsBelowThreshold?: number;
  studentsAssessed?: number;
  totalStudents?: number;
}

export interface CurriculumGraphData {
  nodes: GraphConceptNode[];
  edges: { from: string; to: string }[];
  gradeCounts: Record<number, number>;
}

export interface ConceptExplanation {
  conceptId: string;
  conceptTitle: string;
  grade: number;
  subjectArea: string;
  learningObjective: string | null;
  coverageStatus: string | null;
  prerequisites: { id: string; title: string; stateStatus?: StateStatus; mastery?: number | null }[];
  dependents: { id: string; title: string; grade: number }[];
  prerequisiteGap: boolean;
  gapReason: string | null;
  schedulerPriorityReason: string | null;
  isReadyToTeach: boolean;
  suggestedAction: string;
}

export type GraphRelationshipRow = { concept_id: string; prerequisite_id: string };

/** Normalize the two supported prerequisite representations and discard stale/cyclic self-edges. */
export function normalizeGraphRelationships(
  concepts: Pick<ConceptRecord, "id" | "prerequisite_id">[],
  edgeRows: GraphRelationshipRow[]
) {
  const ids = new Set(concepts.map(c => c.id));
  const pairSet = new Set<string>();
  const pairs: GraphRelationshipRow[] = [];
  const add = (concept_id: string, prerequisite_id: string | null) => {
    if (!prerequisite_id || concept_id === prerequisite_id || !ids.has(concept_id) || !ids.has(prerequisite_id)) return;
    const key = `${concept_id}\u0000${prerequisite_id}`;
    if (pairSet.has(key)) return;
    pairSet.add(key);
    pairs.push({ concept_id, prerequisite_id });
  };
  edgeRows.forEach(row => add(row.concept_id, row.prerequisite_id));
  // Use the legacy single-column value only when no canonical junction edge
  // exists for that concept. This keeps old databases readable without
  // merging stale relationships into the canonical graph.
  concepts.forEach(c => {
    if (!pairs.some(pair => pair.concept_id === c.id)) add(c.id, c.prerequisite_id);
  });

  const prerequisites = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const pair of pairs) {
    const current = prerequisites.get(pair.concept_id) ?? [];
    current.push(pair.prerequisite_id);
    prerequisites.set(pair.concept_id, current);
    const downstream = dependents.get(pair.prerequisite_id) ?? [];
    downstream.push(pair.concept_id);
    dependents.set(pair.prerequisite_id, downstream);
  }
  return { pairs, prerequisites, dependents };
}

/**
 * Load the complete canonical curriculum knowledge graph or a grade-filtered subset.
 * Reads directly from SQLite concepts and concept_prerequisites tables.
 */
export async function loadCurriculumGraph(gradeFilter?: number, subjectFilter = "Math"): Promise<CurriculumGraphData> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  // 1. Fetch all concepts
  const allConcepts = await db.getAllAsync<ConceptRecord>(
    "SELECT * FROM concepts WHERE workspace_id=? AND is_active=1 AND subject_area=? ORDER BY grade, id",
    w, subjectFilter
  );

  // 2. Fetch all prerequisite edges from junction table
  const edgeRows = await db.getAllAsync<GraphRelationshipRow>(
    "SELECT concept_id, prerequisite_id FROM concept_prerequisites WHERE workspace_id=?",
    w
  );

  // Build prerequisite adjacency maps
  const { pairs, prerequisites: prereqsOf, dependents: dependentsOf } = normalizeGraphRelationships(allConcepts, edgeRows);

  // Compute topological depth for layout (roots have depth 0)
  const depthMap = new Map<string, number>();
  function getDepth(id: string, visited = new Set<string>()): number {
    if (visited.has(id)) return 0;
    if (depthMap.has(id)) return depthMap.get(id)!;
    visited.add(id);
    const parents = prereqsOf.get(id) || [];
    if (parents.length === 0) {
      depthMap.set(id, 0);
      return 0;
    }
    const maxParentDepth = Math.max(...parents.map(p => getDepth(p, new Set(visited))));
    const d = maxParentDepth + 1;
    depthMap.set(id, d);
    return d;
  }

  for (const c of allConcepts) {
    getDepth(c.id);
  }

  // Build grade counts
  const gradeCounts: Record<number, number> = {};
  for (const c of allConcepts) {
    gradeCounts[c.grade] = (gradeCounts[c.grade] || 0) + 1;
  }

  // Filter if requested
  const filteredConcepts = gradeFilter && gradeFilter > 0
    ? allConcepts.filter(c => c.grade === gradeFilter)
    : allConcepts;

  const conceptIdSet = new Set(filteredConcepts.map(c => c.id));

  const nodes: GraphConceptNode[] = filteredConcepts.map(c => ({
    id: c.id,
    title: c.title,
    grade: c.grade,
    prerequisiteId: c.prerequisite_id,
    learningObjective: c.learning_objective ?? null,
    subjectArea: c.subject_area ?? subjectFilter,
    coverageStatus: c.coverage_status ?? null,
    prerequisiteIds: prereqsOf.get(c.id) || [],
    dependentIds: dependentsOf.get(c.id) || [],
    depth: depthMap.get(c.id) || 0,
    masteryEstimate: null,
    stateStatus: "unknown",
    evidenceSufficiency: "none",
    evidenceCount: 0,
    prerequisiteGap: false
  }));

  // Keep only visible edges in a grade-filtered graph; focused details still expose cross-grade IDs.
  const edges: { from: string; to: string }[] = [];
  for (const row of pairs) {
    if (conceptIdSet.has(row.concept_id) && conceptIdSet.has(row.prerequisite_id)) {
      edges.push({ from: row.prerequisite_id, to: row.concept_id });
    }
  }

  return { nodes, edges, gradeCounts };
}

/**
 * Overlay individual student learner knowledge state onto the graph nodes.
 */
export async function overlayStudentState(
  graph: CurriculumGraphData,
  studentId: string
): Promise<CurriculumGraphData> {
  const knowledgeView = await getStudentKnowledgeView(studentId);
  const stateByConcept = new Map(knowledgeView.concepts.map(c => [c.concept_id, c]));

  const updatedNodes = graph.nodes.map(node => {
    const cs = stateByConcept.get(node.id);
    if (!cs || !cs.state || cs.state.state_status === "unknown" || cs.state.mastery_estimate === null) {
      return {
        ...node,
        masteryEstimate: null,
        stateStatus: "unknown" as StateStatus,
        evidenceSufficiency: "none" as EvidenceSufficiency,
        evidenceCount: 0,
        prerequisiteGap: cs?.prerequisite_gap ?? false
      };
    }
    return {
      ...node,
      masteryEstimate: cs.state.mastery_estimate,
      stateStatus: cs.state.state_status,
      evidenceSufficiency: cs.state.evidence_sufficiency,
      evidenceCount: cs.state.evidence_count,
      prerequisiteGap: cs.prerequisite_gap
    };
  });

  return {
    ...graph,
    nodes: updatedNodes
  };
}

/**
 * Overlay grade-group aggregate knowledge state onto the graph nodes.
 */
export async function overlayGroupState(
  graph: CurriculumGraphData,
  grade: number
): Promise<CurriculumGraphData> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  // Query learner states for this grade's students
  const studentRows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM students WHERE workspace_id=? AND grade=?",
    w,grade
  );
  const studentIds = studentRows.map(s => s.id);
  const total = studentIds.length;

  let stateRows: LearnerConceptStateRecord[] = [];
  if (total > 0) {
    stateRows = await db.getAllAsync<LearnerConceptStateRecord>(
      `SELECT * FROM learner_concept_states WHERE workspace_id=? AND student_id IN (${studentIds.map(() => "?").join(",")})`,
      w, ...studentIds
    );
  }

  // Pre-calculate per-concept stats
  const conceptStats = new Map<string, { belowThreshold: number; support:number; assessed: number; totalMastery: number; count: number }>();
  for (const r of stateRows) {
    if (!conceptStats.has(r.concept_id)) {
      conceptStats.set(r.concept_id, { belowThreshold: 0, support:0, assessed: 0, totalMastery: 0, count: 0 });
    }
    const stat = conceptStats.get(r.concept_id)!;
    if (r.state_status !== "unknown") {
      stat.assessed += 1;
    }
    if (r.mastery_estimate !== null) {
      stat.totalMastery += r.mastery_estimate;
      stat.count += 1;
      if(r.mastery_estimate<NEEDS_SUPPORT_THRESHOLD)stat.support++;
      if (r.mastery_estimate < MASTERY_THRESHOLD) {
        stat.belowThreshold += 1;
      }
    }
  }

  const updatedNodes = graph.nodes.map(node => {
    if (node.grade > grade || total === 0) {
      return node;
    }
    const stat = conceptStats.get(node.id);
    if (!stat || stat.assessed === 0) {
      return {
        ...node,
        masteryEstimate: null,
        stateStatus: "unknown" as StateStatus,
        evidenceSufficiency: "none" as EvidenceSufficiency,
        evidenceCount: 0,
        prerequisiteGap: false,
        studentsBelowThreshold: 0,
        studentsAssessed: 0,
        totalStudents: total
      };
    }

    const meanMastery = stat.count > 0 ? stat.totalMastery / stat.count : null;
    let status: StateStatus = "unknown";
    if (meanMastery !== null) {
      status = stat.support>0?"needs_support":stat.assessed<total?"unknown":stat.belowThreshold>0?"insufficient":"likely_ready";
    }

    // Check if any prerequisite has unresolved gaps
    const hasPrereqGap = node.prerequisiteIds.some(pid => {
      const pstat = conceptStats.get(pid);
      return !pstat || pstat.assessed<total || pstat.support>0;
    });

    return {
      ...node,
      masteryEstimate: meanMastery,
      stateStatus: status,
        evidenceSufficiency: (stat.assessed >= total * 0.75 ? "sufficient" : stat.assessed >= total * 0.4 ? "moderate" : "limited") as EvidenceSufficiency,
      evidenceCount: stat.assessed,
      prerequisiteGap: node.prerequisiteIds.length > 0 && hasPrereqGap,
      studentsBelowThreshold: stat.belowThreshold,
      studentsAssessed: stat.assessed,
      totalStudents: total
    };
  });

  return {
    ...graph,
    nodes: updatedNodes
  };
}

/**
 * Produce an explanation for why a concept or grade group is ready or needs revision,
 * linking prerequisite status and scheduler reasoning.
 */
export async function getConceptExplanation(
  conceptId: string,
  grade: number,
  context:{mode:"none"|"group"|"student";studentId?:string|null}={mode:"group"}
): Promise<ConceptExplanation> {
  const session = await requireSession();
  const db = await getDatabase();
  const w = session.workspaceId;

  const concept = await db.getFirstAsync<ConceptRecord>(
    "SELECT * FROM concepts WHERE workspace_id=? AND id=?",
    w, conceptId
  );
  if (!concept) throw new Error(`Concept ${conceptId} not found.`);

  // Load prerequisites
  const prereqRows = await db.getAllAsync<{ prerequisite_id: string; title: string }>(
    `SELECT cp.prerequisite_id, c.title
     FROM concept_prerequisites cp
     JOIN concepts c ON c.workspace_id=cp.workspace_id AND c.id=cp.prerequisite_id
     WHERE cp.workspace_id=? AND cp.concept_id=?`,
    w, conceptId
  );
  if (concept.prerequisite_id && !prereqRows.some(row => row.prerequisite_id === concept.prerequisite_id)) {
    const fallback = await db.getFirstAsync<{ title: string }>(
      "SELECT title FROM concepts WHERE workspace_id=? AND id=?",
      w, concept.prerequisite_id
    );
    if (fallback) prereqRows.push({ prerequisite_id: concept.prerequisite_id, title: fallback.title });
  }

  // Load dependents
  const depRows = await db.getAllAsync<{ concept_id: string; title: string; grade: number }>(
    `SELECT cp.concept_id, c.title, c.grade
     FROM concept_prerequisites cp
     JOIN concepts c ON c.workspace_id=cp.workspace_id AND c.id=cp.concept_id
     WHERE cp.workspace_id=? AND cp.prerequisite_id=?`,
    w, conceptId
  );

  // Check group knowledge for prerequisites
  const students = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM students WHERE workspace_id=? AND (?=0 OR grade=?) AND (? IS NULL OR id=?)",
    w,context.mode==="student"?0:grade,grade,context.mode==="student"?(context.studentId??null):null,context.mode==="student"?(context.studentId??null):null
  );
  const studentIds = context.mode==="none"?[]:students.map(s => s.id);
  if(context.mode==="student"&&(!context.studentId||studentIds.length!==1))throw new Error("Select a student in this workspace.");

  const prereqDetails: ConceptExplanation["prerequisites"] = [];
  let hasPrereqGap = false;
  let gapReason: string | null = null;

  for (const p of prereqRows) {
    let distribution="";
    let meanMastery: number | null = null;
    let status: StateStatus = "unknown";
    if (studentIds.length > 0) {
      const states = await db.getAllAsync<LearnerConceptStateRecord>(
        `SELECT * FROM learner_concept_states WHERE workspace_id=? AND concept_id=? AND student_id IN (${studentIds.map(() => "?").join(",")})`,
        w, p.prerequisite_id, ...studentIds
      );
      const valids = states.filter(s => s.mastery_estimate !== null).map(s => s.mastery_estimate!);
      if (valids.length > 0) {
        meanMastery = valids.reduce((a, b) => a + b, 0) / valids.length;
        status = meanMastery >= MASTERY_THRESHOLD ? "likely_ready" : meanMastery >= NEEDS_SUPPORT_THRESHOLD ? "insufficient" : "needs_support";
      }
    }
    if(context.mode==='group'&&studentIds.length){
      const all=await db.getAllAsync<LearnerConceptStateRecord>(`SELECT * FROM learner_concept_states WHERE workspace_id=? AND concept_id=? AND student_id IN (${studentIds.map(()=>'?').join(',')})`,w,p.prerequisite_id,...studentIds);
      const weak=all.filter(r=>r.mastery_estimate!==null&&r.mastery_estimate<NEEDS_SUPPORT_THRESHOLD).length;
      const unknown=studentIds.length-all.filter(r=>r.mastery_estimate!==null).length;
      if(weak)status='needs_support';else if(unknown)status='unknown';
      distribution=`${weak} students need support; ${unknown} of ${studentIds.length} have no prerequisite evidence.`;
    }
    if (context.mode!=="none"&&(status === "needs_support" || status === "unknown")) {
      hasPrereqGap = true;
      gapReason = `Prerequisite "${p.title}" has unresolved learning gaps (mean mastery: ${meanMastery !== null ? Math.round(meanMastery * 100) + "%" : "no evidence"}). ${distribution}`;
    }
    prereqDetails.push({
      id: p.prerequisite_id,
      title: p.title,
      stateStatus: status,
      mastery: meanMastery
    });
  }

  // Check target concept status in this group
  let targetStatus: StateStatus = "unknown";
  if (studentIds.length > 0) {
    const states = await db.getAllAsync<LearnerConceptStateRecord>(
      `SELECT * FROM learner_concept_states WHERE workspace_id=? AND concept_id=? AND student_id IN (${studentIds.map(() => "?").join(",")})`,
      w, conceptId, ...studentIds
    );
    const valids = states.filter(s => s.mastery_estimate !== null).map(s => s.mastery_estimate!);
    if (valids.length > 0) {
      targetStatus = valids.some(v=>v<NEEDS_SUPPORT_THRESHOLD)?"needs_support":valids.length<studentIds.length?"unknown":valids.some(v=>v<MASTERY_THRESHOLD)?"insufficient":"likely_ready";
    }
  }

  const isReady = context.mode!=="none" && !hasPrereqGap && targetStatus === "likely_ready";

  let suggestedAction = "Introduce with guided teacher modeling and concrete manipulatives.";
  if (hasPrereqGap) {
    suggestedAction = `Revise foundational prerequisite concepts first before teaching ${concept.title}.`;
  } else if (targetStatus === "needs_support") {
    suggestedAction = `Priority revision required: model another example and conduct pair practice.`;
  } else if (targetStatus === "likely_ready") {
    suggestedAction = `Concept is secure: assign independent practice or advance to downstream topics.`;
  }

  let schedulerPriorityReason: string | null = null;
  if (hasPrereqGap) {
    schedulerPriorityReason = "Deprioritized for direct introduction until prerequisite readiness is established.";
  } else if (targetStatus === "needs_support") {
    schedulerPriorityReason = "High instructional attention priority due to demonstrated revision gaps.";
  } else if (targetStatus === "unknown") {
    schedulerPriorityReason = "Moderate priority: initial diagnostic assessment recommended.";
  }

  if(context.mode==="none"){suggestedAction="Select a student or class overlay to inspect learner readiness.";schedulerPriorityReason=null;}
  return {
    conceptId,
    conceptTitle: concept.title,
    grade: concept.grade,
    subjectArea: concept.subject_area ?? "Math",
    learningObjective: concept.learning_objective ?? null,
    coverageStatus: concept.coverage_status ?? null,
    prerequisites: prereqDetails,
    dependents: depRows.map(d => ({ id: d.concept_id, title: d.title, grade: d.grade })),
    prerequisiteGap: hasPrereqGap,
    gapReason,
    schedulerPriorityReason,
    isReadyToTeach: isReady,
    suggestedAction
  };
}

