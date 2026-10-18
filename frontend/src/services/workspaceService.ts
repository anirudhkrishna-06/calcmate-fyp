import { seedCanonicalCurriculum } from "./curriculumStore";
import { rebuildWorkspaceStates } from "./learnerEstimator";
import { Scope,assertScope,withTransaction } from "./database";
import { conceptSeed,canonicalPrerequisiteSeed,indianStudentNames,repairCanonicalPrerequisites } from "./demoService";
import { Teacher } from "@/types/domain";
export async function initializeTeacherWorkspace(scope:Scope,profile:Teacher,presentationRoster=false) {
  const now=new Date().toISOString();
  await withTransaction(async tx => {
    await tx.runAsync("INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)",scope.workspaceId,scope.teacherId,"real",now);
    await assertScope(tx,scope);
    await tx.runAsync("INSERT OR IGNORE INTO profiles VALUES(?,?,?,?,?)",scope.teacherId,scope.workspaceId,JSON.stringify({...profile,id:scope.teacherId}),now,now);
    for (const [id, title, grade, prerequisite] of conceptSeed)
      await tx.runAsync(
        "INSERT OR IGNORE INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at,learning_objective,coverage_status,is_active,subject_area) VALUES(?,?,?,?,?,?,?,NULL,'verified',1,'Math')",
        id, scope.workspaceId, title, grade, prerequisite, now, now);
    // Seed prerequisite edges into concept_prerequisites junction table
    for (const [id, prerequisite] of canonicalPrerequisiteSeed) {
      await tx.runAsync(
        "INSERT OR IGNORE INTO concept_prerequisites(workspace_id,concept_id,prerequisite_id,relationship_type,confidence) VALUES(?,?,?,?,?)",
        scope.workspaceId, id, prerequisite, 'PREREQUISITE_OF', 'verified');
    }
    await repairCanonicalPrerequisites(tx, scope.workspaceId);
    await seedCanonicalCurriculum(tx,scope.workspaceId);
    await rebuildWorkspaceStates(tx,scope.workspaceId);
    if(!presentationRoster)return;
    const marker=`presentation-roster-v1:${scope.workspaceId}`;
    const gradeFiveMarker=`presentation-roster-grade5-v1:${scope.workspaceId}`;
    const existingRoster=await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?",marker);
    if(existingRoster && await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?",gradeFiveMarker))return;
    const w=scope.workspaceId;
    // Upgrade only the new grade; earlier roster edits and deletions stay intact.
    for(let i=existingRoster?32:0;i<indianStudentNames.length;i++) {
      const grade=Math.floor(i/8)+1;
      const roll=String(i%8+1).padStart(2,"0");
      const id=`starter-student-${i+1}`;
      // Existing enrolments win; a starter roster never replaces teacher records.
      if(await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND (id=? OR (grade=? AND roll=?))",w,id,grade,roll))continue;
      await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)",id,w,indianStudentNames[i],grade,roll,now,now);
      for(const [concept] of conceptSeed.filter(c=>c[2]===grade)) {
        const mastery=[0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][i%8];
        await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)",`${id}-${concept}`,w,id,concept,mastery,now,now);
        await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)",`${id}-${concept}-starter`,w,id,concept,now.slice(0,10),Math.round(mastery*10),10,now,now);
        const stateStatus = mastery >= 0.70 ? "likely_ready" : mastery >= 0.60 ? "insufficient" : "needs_support";
        await tx.runAsync(
          `INSERT OR IGNORE INTO learner_concept_states(id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
           VALUES(?,?,?,?,?,?,?,'score-ratio-v1','1',?,'limited',?,?)`,
          `lcs-${id}-${concept}`, w, id, concept, mastery, 1, now.slice(0, 10), stateStatus, now, now
        );
      }

    }
    await rebuildWorkspaceStates(tx,w);
    await tx.runAsync("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)",marker,now);
    await tx.runAsync("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)",gradeFiveMarker,now);
  });
}
