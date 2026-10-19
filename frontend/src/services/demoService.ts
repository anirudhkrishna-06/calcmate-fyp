/**
 * CalcMate Demo Seed — Review 3 (Enhanced)
 *
 * Creates a "mid-year" classroom starting from June 1:
 *  - 40 students across Grades 1-5 (8 per grade), Indian names
 *  - Teacher: Ananya Rao, Vidya Primary School
 *  - Full attendance history from June 1 to today (school days, Mon-Fri)
 *  - 5-8 assessments per covered concept per student (score trajectory)
 *  - Assignment / quiz marks differentiated by archetype
 *  - Observations per student archetype
 *  - Learner concept states rebuilt from evidence
 *
 * Archetypes (index % 8 within grade):
 *  0,1 → Strong    (mastery 0.85-0.93, rare absences)
 *  2,3 → Average   (mastery 0.65-0.74, occasional absences)
 *  4,5 → Developing(mastery 0.46-0.56, some absences)
 *  6,7 → Weak      (mastery 0.25-0.36, frequent absences)
 */

import { seedCanonicalCurriculum } from "./curriculumStore";
import { withTransaction, today } from "./database";
import type { SQLiteDatabase } from "expo-sqlite";
import { canonicalConceptSeed, canonicalPrerequisiteSeed } from '../data/curriculum';
import { rebuildWorkspaceStates } from './learnerEstimator';

export const demoScope = { workspaceId: "demo-workspace-v1", teacherId: "demo-teacher-v1" };
export { canonicalConceptSeed, canonicalPrerequisiteSeed } from '../data/curriculum';
export const conceptSeed = canonicalConceptSeed;

export const indianStudentNames = [
  // Grade 1
  "Aadhavan Krishnan", "Nila Subramanian", "Vihan Rao", "Ananya Iyer",
  "Arjun Nair", "Ishita Menon", "Kavin Kumar", "Meera Srinivasan",
  // Grade 2
  "Rithvik Narayanan", "Aditi Krishnan", "Rohan Reddy", "Saanvi Prasad",
  "Devan Nambiar", "Tara Menon", "Yashwanth Rao", "Nandhini Bose",
  // Grade 3
  "Aditya Murugan", "Kavya Thomas", "Krishnan Pillai", "Siya Reddy",
  "Neelakandan Iyer", "Avni Bhat", "Ibrahim Rahman", "Riya Narayanan",
  // Grade 4
  "Dhruv Subramaniam", "Pihu Bhat", "Atharv Kumar", "Sara Fernandes",
  "Pranav Menon", "Zoya Ahmed", "Harish Yadav", "Lakshmi Pillai",
  // Grade 5
  "Vivek Desai", "Aanya Krishnan", "Ishaan Chatterjee", "Anvi Saxena",
  "Shaurya Shetty", "Maya Joseph", "Vedanth Bansal", "Suhana Qureshi",
];

// Base mastery per archetype
const ARCHETYPE_BASE   = [0.91, 0.86, 0.72, 0.67, 0.54, 0.48, 0.33, 0.28];
// Absence probability per archetype
const ARCHETYPE_ABSENT = [0.03, 0.04, 0.07, 0.09, 0.13, 0.16, 0.21, 0.24];
// Number of assessment events per concept per archetype
const ARCHETYPE_ASMTS  = [8, 7, 6, 6, 5, 5, 5, 5];

const DEMO_V6_MARKER = `demo-seed-v6:${demoScope.workspaceId}`;

let seeding: Promise<void> | undefined;
export function seedDemo() {
  seeding ??= seed().catch(err => { seeding = undefined; throw err; });
  return seeding;
}
export async function reseedDemo() {
  seeding = undefined;
  await withTransaction(async tx => {
    await tx.runAsync("DELETE FROM workspaces WHERE id=?", demoScope.workspaceId);
    await tx.runAsync("DELETE FROM app_meta WHERE key LIKE ?", `%:${demoScope.workspaceId}`);
    await tx.runAsync("DELETE FROM app_meta WHERE key=?", DEMO_V6_MARKER);
  });
  return seedDemo();
}

async function seed() {
  await withTransaction(async tx => {
    const existing = await tx.getFirstAsync<{ seeded_at: string | null }>(
      "SELECT seeded_at FROM workspaces WHERE id=?", demoScope.workspaceId
    );

    if (existing?.seeded_at) {
      for (const [id, title, grade, prereq] of conceptSeed) {
        await tx.runAsync(
          "INSERT OR IGNORE INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          id, demoScope.workspaceId, title, grade, prereq,
          new Date().toISOString(), new Date().toISOString()
        );
      }
      await repairCanonicalPrerequisites(tx, demoScope.workspaceId);
      await seedCanonicalCurriculum(tx, demoScope.workspaceId);
      if (!await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?", DEMO_V6_MARKER)) {
        // Older demo versions could have written evidence for the whole
        // curriculum. Remove only generated demo evidence before reseeding the
        // classroom so the review state always represents a mid-year class.
        await clearDemoClassroom(tx);
        await seedMidYearStudents(tx);
      }
      await rebuildWorkspaceStates(tx, demoScope.workspaceId);
      return;
    }

    const w   = demoScope.workspaceId;
    const now = new Date().toISOString();
    await tx.runAsync(
      "INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)",
      w, demoScope.teacherId, "demo", now
    );
    const profile = {
      id: demoScope.teacherId, name: "Ananya Rao",
      schoolName: "Vidya Primary School",
      experience: 6, grades: [1,2,3,4,5], preferredSubject: "Math",
    };
    await tx.runAsync("INSERT INTO profiles VALUES(?,?,?,?,?)",
      profile.id, w, JSON.stringify(profile), now, now);

    for (const [id, title, grade, prereq] of conceptSeed) {
      await tx.runAsync(
        `INSERT INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at,
           learning_objective,coverage_status,is_active,subject_area) VALUES(?,?,?,?,?,?,?,NULL,'verified',1,'Math')`,
        id, w, title, grade, prereq, now, now
      );
    }
    await repairCanonicalPrerequisites(tx, w);
    await seedCanonicalCurriculum(tx, w);
    await seedMidYearStudents(tx);
    await rebuildWorkspaceStates(tx, w);
    await tx.runAsync("UPDATE workspaces SET seeded_at=? WHERE id=?", now, w);
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function isWeekday(d: Date): boolean { const day = d.getDay(); return day !== 0 && day !== 6; }
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function schoolDaysSinceJune(): string[] {
  const end   = new Date();                         // today
  end.setDate(end.getDate() - 1);                   // evidence is historical through the previous school day
  const start = new Date(end.getFullYear(), 5, 1);  // June 1
  const days: string[] = [];
  const c = new Date(start);
  while (c <= end) { if (isWeekday(c)) days.push(fmt(c)); c.setDate(c.getDate()+1); }
  return days;
}

// ─── Main student seeder ──────────────────────────────────────────────────────
async function seedMidYearStudents(tx: SQLiteDatabase) {
  const w   = demoScope.workspaceId;
  const now = new Date().toISOString();
  const allDays = schoolDaysSinceJune();   // all Mon-Fri from June 1 → today

  for (let i = 0; i < indianStudentNames.length; i++) {
    const grade     = Math.floor(i / 8) + 1;
    const archetype = i % 8;
    const id        = `demo-student-${i + 1}`;
    const roll      = String(archetype + 1).padStart(2, '0');

    // Upsert student
    await tx.runAsync(`INSERT INTO students VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,grade=excluded.grade,roll=excluded.roll,updated_at=excluded.updated_at`,
      id, w, indianStudentNames[i], grade, roll, now, now);

    // ── Attendance: every school day from July ────────────────────────────
    const absentRate = ARCHETYPE_ABSENT[archetype];
    for (let d = 0; d < allDays.length; d++) {
      const dateStr = allDays[d];
      // Deterministic pseudo-random: prime-number hash
      const rnd = ((i * 1009 + d * 97) % 1000) / 1000;
      const status = rnd < absentRate ? 'absent' : (rnd < absentRate + 0.04 ? 'late' : 'present');
      await tx.runAsync(
        "INSERT OR IGNORE INTO attendance VALUES(?,?,?,?,?,?,?)",
        `att-${id}-${dateStr}`, w, id, dateStr, status, now, now
      );
    }

    // ── Concept coverage: mid-year partial ───────────────────────────────
    const gradeConcepts  = conceptSeed.filter(c => c[2] === grade);
    const coverageRatio  = archetype <= 1 ? 0.70 : archetype <= 3 ? 0.60 : archetype <= 5 ? 0.50 : 0.42;
    const numCovered     = Math.max(1, Math.round(gradeConcepts.length * coverageRatio));
    const covered        = gradeConcepts.slice(0, numCovered);
    const baseM          = ARCHETYPE_BASE[archetype];
    const numAsmts       = ARCHETYPE_ASMTS[archetype];

    for (let ci = 0; ci < covered.length; ci++) {
      const [conceptId] = covered[ci];

      // Final mastery for this concept (slight recency penalty for later concepts)
      const recencyPenalty = (ci / numCovered) * 0.10;
      const variation      = ((i * 13 + ci * 7) % 11 - 5) / 100;
      const finalMastery   = Math.min(0.97, Math.max(0.06, baseM - recencyPenalty + variation));

      // Day the concept was first introduced
      const introDay = Math.floor(ci * (allDays.length / numCovered));

      // Generate numAsmts assessments spread across allDays[introDay..end]
      // Score trajectory: starts lower, rises toward finalMastery
      for (let j = 0; j < numAsmts; j++) {
        const progress    = j / (numAsmts - 1 || 1);          // 0 → 1
        // Starts at ~60% of final mastery, grows to 100%
        const rawScore    = finalMastery * (0.62 + progress * 0.38);
        const score10     = Math.max(1, Math.min(10, Math.round(rawScore * 10)));

        const dayOffset   = introDay + Math.floor(j * (allDays.length - introDay) / numAsmts) + (i % 3);
        const dateStr     = allDays[Math.min(dayOffset, allDays.length - 1)];
        const asmtId      = `asmts-${id}-${conceptId}-${j}`;

        await tx.runAsync(
          "INSERT OR IGNORE INTO assessments VALUES(?,?,?,?,?,?,?,?,?)",
          asmtId, w, id, conceptId, dateStr, score10, 10, now, now
        );
        const kind = j === 0 ? "diagnostic" : j === numAsmts - 1 ? "assignment" : j % 2 === 0 ? "quiz" : "classwork";
        const title = kind === "assignment" ? `Take-home practice · ${ci + 1}` : kind === "quiz" ? `Quick check · ${ci + 1}` : kind === "diagnostic" ? "Entry diagnostic" : `Guided classwork · ${j}`;
        await tx.runAsync(
          "INSERT OR IGNORE INTO assessment_metadata(workspace_id,assessment_id,kind,title) VALUES(?,?,?,?)",
          w, asmtId, kind, title
        );
      }

      // Competency record (final mastery)
      await tx.runAsync(
        `INSERT OR REPLACE INTO competencies VALUES(?,?,?,?,?,?,?)`,
        `comp-${id}-${conceptId}`, w, id, conceptId, finalMastery, now, now
      );

      // Learner state
      const stateStatus = finalMastery >= 0.70 ? 'likely_ready'
                        : finalMastery >= 0.60 ? 'insufficient' : 'needs_support';
      const sufficiency  = numAsmts >= 5 ? 'sufficient' : numAsmts >= 3 ? 'moderate' : 'limited';
      const lastDay      = allDays[Math.min(introDay + numAsmts * 4, allDays.length - 1)];
      await tx.runAsync(
        `INSERT OR REPLACE INTO learner_concept_states
           (id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,
            estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
         VALUES(?,?,?,?,?,?,?,'score-ratio-v1','1',?,?,?,?)`,
        `lcs-${id}-${conceptId}`, w, id, conceptId,
        finalMastery, numAsmts, lastDay,
        stateStatus, sufficiency, now, now
      );
    }

    // ── Teacher observation ────────────────────────────────────────────────
    const obs = [
      "Consistently grasps new concepts quickly; can explain reasoning to peers. Ready for extension tasks.",
      "Strong performance across assessed concepts; benefits from being a peer tutor for the class.",
      "Shows steady progress; works well independently on familiar topics. Needs encouragement for new ideas.",
      "Generally on track; occasional gaps appear when concepts build on each other. Review prerequisites.",
      "Needs additional time on most concepts; responds well to concrete manipulatives and visual aids.",
      "Some prerequisite gaps identified; benefits from small-group instruction and worked examples.",
      "Requires significant support; struggles to retain concepts across sessions. Prioritise foundational skills.",
      "Foundational gaps in earlier grade concepts affecting current learning. Daily check-ins recommended.",
    ];
    await tx.runAsync("INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?)",
      `obs-${id}`, w, id, obs[archetype], now, now);
  }

  await tx.runAsync("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)", DEMO_V6_MARKER, now);
}

async function clearDemoClassroom(tx: SQLiteDatabase) {
  const w = demoScope.workspaceId;
  await tx.runAsync("DELETE FROM assessment_origins WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM notifications WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM session_outcomes WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM session_attendance_events WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM class_sessions WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM schedules WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM learner_concept_states WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM assessment_metadata WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM assessments WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM competencies WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM attendance WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM observations WHERE workspace_id=?", w);
  await tx.runAsync("DELETE FROM students WHERE workspace_id=?", w);
}

// ─── Prerequisite repair ──────────────────────────────────────────────────────
export async function repairCanonicalPrerequisites(tx: any, workspaceId: string) {
  const ids = canonicalConceptSeed.map(([id]) => id);
  const ph  = ids.map(() => '?').join(',');
  await tx.runAsync(
    `DELETE FROM concept_prerequisites WHERE workspace_id=? AND concept_id IN (${ph}) AND prerequisite_id IN (${ph})`,
    workspaceId, ...ids, ...ids
  );
  const existing = new Set(
    (await tx.getAllAsync("SELECT id FROM concepts WHERE workspace_id=?", workspaceId))
      .map((c: {id:string}) => c.id)
  );
  for (const [conceptId, prerequisiteId] of canonicalPrerequisiteSeed) {
    if (!existing.has(conceptId) || !existing.has(prerequisiteId)) continue;
    await tx.runAsync(
      "INSERT OR IGNORE INTO concept_prerequisites(workspace_id,concept_id,prerequisite_id,relationship_type,confidence) VALUES(?,?,?,?,?)",
      workspaceId, conceptId, prerequisiteId, "PREREQUISITE_OF", "verified"
    );
  }
}
