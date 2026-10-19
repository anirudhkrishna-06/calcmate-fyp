import { seedCanonicalCurriculum } from "./curriculumStore";
import { rebuildWorkspaceStates } from "./learnerEstimator";
import { Scope,assertScope,withTransaction, today } from "./database";
import { conceptSeed,canonicalPrerequisiteSeed,indianStudentNames,repairCanonicalPrerequisites,seedDemo,demoScope } from "./demoService";
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
    const marker=`presentation-roster-v2:${scope.workspaceId}`;
    const gradeFiveMarker=`presentation-roster-grade5-v2:${scope.workspaceId}`;
    const existingRoster=await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?",marker);
    if(existingRoster && await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?",gradeFiveMarker))return;
    const w=scope.workspaceId;
    // v1 created evidence for every concept. Clear only generated starter
    // records before installing v2, so no stale full-curriculum state remains.
    if (!existingRoster) {
      await tx.runAsync("DELETE FROM learner_concept_states WHERE workspace_id=? AND student_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM assessment_metadata WHERE workspace_id=? AND assessment_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM assessments WHERE workspace_id=? AND student_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM competencies WHERE workspace_id=? AND student_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM attendance WHERE workspace_id=? AND student_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM observations WHERE workspace_id=? AND student_id LIKE 'starter-student-%'", w);
      await tx.runAsync("DELETE FROM students WHERE workspace_id=? AND id LIKE 'starter-student-%'", w);
    }
    // Each starter learner has reached a different point in the grade
    // sequence. The remaining concepts stay genuinely unobserved and become
    // available to the scheduler as the next portion of work.
    for(let i=0;i<indianStudentNames.length;i++) {
      const grade=Math.floor(i/8)+1;
      const roll=String(i%8+1).padStart(2,"0");
      const id=`starter-student-${i+1}`;
      // Existing enrolments win; a starter roster never replaces teacher records.
      if(await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND (id=? OR (grade=? AND roll=?))",w,id,grade,roll))continue;
      await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)",id,w,indianStudentNames[i],grade,roll,now,now);
      const gradeConcepts=conceptSeed.filter(c=>c[2]===grade);
      const archetype=i%8;
      const coverageRatio=archetype<=1 ? 0.70 : archetype<=3 ? 0.60 : archetype<=5 ? 0.50 : 0.42;
      const coveredConcepts=gradeConcepts.slice(0,Math.max(1,Math.round(gradeConcepts.length*coverageRatio)));
      for(const [concept] of coveredConcepts) {
        const mastery=[0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][archetype];
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

/** Install the complete review classroom into the currently authenticated teacher workspace. */
export async function installReviewClassroom(scope:Scope) {
  await seedDemo();
  return withTransaction(async tx => {
    await assertScope(tx, scope);
    const source = demoScope.workspaceId;
    const target = scope.workspaceId;
    if (source === target) throw new Error("The review classroom is already open.");

    await tx.runAsync("DELETE FROM learner_concept_states WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM assessment_metadata WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM assessments WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM competencies WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM attendance WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM observations WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM students WHERE workspace_id=?", target);
    await tx.runAsync("DELETE FROM schedules WHERE workspace_id=?", target);

    const students = await tx.getAllAsync<{id:string;name:string;grade:number;roll:string;created_at:string;updated_at:string}>("SELECT * FROM students WHERE workspace_id=?", source);
    for (const row of students) await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)", row.id,target,row.name,row.grade,row.roll,row.created_at,row.updated_at);
    const attendance = await tx.getAllAsync<{id:string;student_id:string;date:string;status:string;created_at:string;updated_at:string}>("SELECT * FROM attendance WHERE workspace_id=?", source);
    for (const row of attendance) await tx.runAsync("INSERT INTO attendance VALUES(?,?,?,?,?,?,?)",row.id,target,row.student_id,row.date,row.status,row.created_at,row.updated_at);
    const assessments = await tx.getAllAsync<{id:string;student_id:string;concept_id:string;date:string;score:number;maximum:number;created_at:string;updated_at:string}>("SELECT * FROM assessments WHERE workspace_id=?", source);
    for (const row of assessments) await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)",row.id,target,row.student_id,row.concept_id,row.date,row.score,row.maximum,row.created_at,row.updated_at);
    const metadata = await tx.getAllAsync<{assessment_id:string;kind:string;title:string}>("SELECT assessment_id,kind,title FROM assessment_metadata WHERE workspace_id=?", source);
    for (const row of metadata) await tx.runAsync("INSERT INTO assessment_metadata VALUES(?,?,?,?)",target,row.assessment_id,row.kind,row.title);
    const competencies = await tx.getAllAsync<{id:string;student_id:string;concept_id:string;mastery:number;created_at:string;updated_at:string}>("SELECT * FROM competencies WHERE workspace_id=?", source);
    for (const row of competencies) await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)",row.id,target,row.student_id,row.concept_id,row.mastery,row.created_at,row.updated_at);
    const observations = await tx.getAllAsync<{id:string;student_id:string;note:string;created_at:string;updated_at:string}>("SELECT * FROM observations WHERE workspace_id=?", source);
    for (const row of observations) await tx.runAsync("INSERT INTO observations VALUES(?,?,?,?,?,?)",row.id,target,row.student_id,row.note,row.created_at,row.updated_at);
    const states = await tx.getAllAsync<{id:string;student_id:string;concept_id:string;mastery_estimate:number|null;evidence_count:number;last_evidence_at:string|null;estimator_name:string;estimator_version:string;state_status:string;evidence_sufficiency:string;updated_at:string;created_at:string}>("SELECT * FROM learner_concept_states WHERE workspace_id=?", source);
    for (const row of states) await tx.runAsync("INSERT INTO learner_concept_states VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",row.id,target,row.student_id,row.concept_id,row.mastery_estimate,row.evidence_count,row.last_evidence_at,row.estimator_name,row.estimator_version,row.state_status,row.evidence_sufficiency,row.updated_at,row.created_at);
    await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",`classroom.revision:${target}`,"1");
    return { students: students.length, attendance: attendance.length, assessments: assessments.length, installedAt: today() };
  });
}
