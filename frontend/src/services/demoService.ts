import { seedCanonicalCurriculum } from "./curriculumStore";
import { withTransaction, today } from "./database";
import type { SQLiteDatabase } from "expo-sqlite";

import { canonicalConceptSeed,canonicalPrerequisiteSeed } from '../data/curriculum';
import { rebuildWorkspaceStates } from './learnerEstimator';

export const demoScope = { workspaceId: "demo-workspace-v1", teacherId: "demo-teacher-v1" };
export { canonicalConceptSeed,canonicalPrerequisiteSeed } from '../data/curriculum';
export const conceptSeed=canonicalConceptSeed;

export const indianStudentNames = [
  "Aarav Sharma", "Diya Patel", "Vihaan Rao", "Ananya Singh", "Arjun Nair", "Ishita Das", "Kabir Khan", "Meera Iyer",
  "Reyansh Verma", "Aditi Joshi", "Rohan Ali", "Saanvi Reddy", "Dev Shah", "Tara Menon", "Yash Gupta", "Naina Bose",
  "Aditya Kulkarni", "Kavya Thomas", "Krish Mehta", "Siya Sinha", "Neel Kapoor", "Avni Jain", "Ibrahim Ansari", "Riya Sen",
  "Dhruv Malhotra", "Pihu Bhat", "Atharv Kumar", "Sara Fernandes", "Pranav Mishra", "Zoya Ahmed", "Harsh Yadav", "Lakshmi Pillai",
  "Vivaan Desai", "Aanya Krishnan", "Ishaan Chatterjee", "Anvi Saxena", "Shaurya Shetty", "Myra Joseph", "Vedant Bansal", "Suhana Qureshi"
];
const gradeFiveRosterMarker = `demo-roster-grade5-v1:${demoScope.workspaceId}`;
let seeding: Promise<void> | undefined;
export function seedDemo() {
  seeding ??= seed().catch(error => { seeding = undefined; throw error; });
  return seeding;
}
async function seed() {
  await withTransaction(async tx => {
    const existing = await tx.getFirstAsync<{ seeded_at: string | null }>("SELECT seeded_at FROM workspaces WHERE id=?", demoScope.workspaceId);
    if (existing?.seeded_at) {
      for(const [id,title,grade,prerequisite] of conceptSeed)await tx.runAsync("INSERT OR IGNORE INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",id,demoScope.workspaceId,title,grade,prerequisite,new Date().toISOString(),new Date().toISOString());
      await repairCanonicalPrerequisites(tx, demoScope.workspaceId);
      await seedCanonicalCurriculum(tx,demoScope.workspaceId);
      if (!await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?", gradeFiveRosterMarker)) {
        await seedDemoStudents(tx, 32);
      }
      await rebuildWorkspaceStates(tx,demoScope.workspaceId);
      return;
    }
    const w = demoScope.workspaceId;
    const now = new Date().toISOString();
    await tx.runAsync("INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)", w, demoScope.teacherId, "demo", now);
    const profile = { id: demoScope.teacherId, name: "Ananya Rao", schoolName: "Vidya Primary School", experience: 6, grades: [1,2,3,4,5], preferredSubject: "Math" };
    await tx.runAsync("INSERT INTO profiles VALUES(?,?,?,?,?)", profile.id, w, JSON.stringify(profile), now, now);
    for (const [id,title,grade,prerequisite] of conceptSeed) {
      await tx.runAsync(
        "INSERT INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at,learning_objective,coverage_status,is_active,subject_area) VALUES(?,?,?,?,?,?,?,NULL,'verified',1,'Math')",
        id, w, title, grade, prerequisite, now, now);
    }
    await repairCanonicalPrerequisites(tx, w);
    await seedCanonicalCurriculum(tx,w);
    await seedDemoStudents(tx);
    await rebuildWorkspaceStates(tx,w);
    await tx.runAsync("UPDATE workspaces SET seeded_at=? WHERE id=?", now, w);
  });
}

async function seedDemoStudents(tx: SQLiteDatabase, firstStudent = 0) {
  const w = demoScope.workspaceId;
  const now = new Date().toISOString();
  for (let i = firstStudent; i < indianStudentNames.length; i++) {
    const grade = Math.floor(i / 8) + 1;
    const id = `demo-student-${i + 1}`;
    const roll = String(i % 8 + 1).padStart(2,"0");
    if (await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND (id=? OR (grade=? AND roll=?))", w, id, grade, roll)) continue;
    await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)", id, w, indianStudentNames[i], grade, roll, now, now);
    const relevant = conceptSeed.filter(c => c[2] === grade);
    for (const [concept] of relevant) {
      const mastery = [0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][i % 8];
      await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)", `${id}-${concept}`, w, id, concept, mastery, now, now);
      for (let j = 0; j < 2; j++) {
        const date = new Date(); date.setDate(date.getDate() - (j === 0 ? 14 : 3));
        const score = Math.max(1, Math.round(mastery * 10) - (j === 0 ? 1 : 0));
        await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)", `${id}-${concept}-${j}`, w, id, concept, date.toISOString().slice(0,10), score, 10, now, now);
      }
      const stateStatus = mastery >= 0.70 ? "likely_ready" : mastery >= 0.60 ? "insufficient" : "needs_support";
      await tx.runAsync(
        `INSERT OR IGNORE INTO learner_concept_states(id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
         VALUES(?,?,?,?,?,?,?,'score-ratio-v1','1',?,'moderate',?,?)`,
        `lcs-${id}-${concept}`, w, id, concept, mastery, 2, now.slice(0, 10), stateStatus, now, now
      );
    }

    for (let day = 0; day < 5; day++) {
      const date = new Date(); date.setDate(date.getDate() - day);
      const dateString = day === 0 ? today() : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      await tx.runAsync("INSERT INTO attendance VALUES(?,?,?,?,?,?,?)", `${id}-${dateString}`, w, id, dateString, (i + day) % 9 === 0 ? "absent" : "present", now, now);
    }
    await tx.runAsync("INSERT INTO observations VALUES(?,?,?,?,?,?)", `${id}-observation`, w, id,
      i % 8 < 2 ? "Needs concrete objects and a prerequisite recap before independent practice." : "Participates in pair work; explain reasoning before recording answers.", now, now);
  }
  await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?)", gradeFiveRosterMarker, now);
}

export async function repairCanonicalPrerequisites(tx: any, workspaceId: string) {
  const ids = canonicalConceptSeed.map(([id]) => id);
  const placeholders = ids.map(() => "?").join(",");
  await tx.runAsync(
    `DELETE FROM concept_prerequisites WHERE workspace_id=? AND concept_id IN (${placeholders}) AND prerequisite_id IN (${placeholders})`,
    workspaceId, ...ids, ...ids
  );
  const existingIds=new Set((await tx.getAllAsync("SELECT id FROM concepts WHERE workspace_id=?",workspaceId)).map((c:{id:string})=>c.id));
  for (const [conceptId, prerequisiteId] of canonicalPrerequisiteSeed) {
    if(!existingIds.has(conceptId)||!existingIds.has(prerequisiteId))continue;
    await tx.runAsync(
      "INSERT OR IGNORE INTO concept_prerequisites(workspace_id,concept_id,prerequisite_id,relationship_type,confidence) VALUES(?,?,?,?,?)",
      workspaceId, conceptId, prerequisiteId, "PREREQUISITE_OF", "verified"
    );
  }
}
