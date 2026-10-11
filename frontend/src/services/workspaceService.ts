import { Scope,assertScope,withTransaction } from "./database";
import { conceptSeed,indianStudentNames } from "./demoService";
import { Teacher } from "@/types/domain";
export async function initializeTeacherWorkspace(scope:Scope,profile:Teacher,presentationRoster=false) {
  const now=new Date().toISOString();
  await withTransaction(async tx => {
    await tx.runAsync("INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)",scope.workspaceId,scope.teacherId,"real",now);
    await assertScope(tx,scope);
    await tx.runAsync("INSERT OR IGNORE INTO profiles VALUES(?,?,?,?,?)",scope.teacherId,scope.workspaceId,JSON.stringify({...profile,id:scope.teacherId}),now,now);
    for(const [id,title,grade,prerequisite] of conceptSeed)await tx.runAsync("INSERT OR IGNORE INTO concepts VALUES(?,?,?,?,?,?,?)",id,scope.workspaceId,title,grade,prerequisite,now,now);
    if(!presentationRoster)return;
    const marker=`presentation-roster-v1:${scope.workspaceId}`;
    if(await tx.getFirstAsync("SELECT key FROM app_meta WHERE key=?",marker))return;
    const w=scope.workspaceId;
    for(let i=0;i<indianStudentNames.length;i++) {
      const grade=Math.floor(i/8)+1;
      const roll=String(i%8+1).padStart(2,"0");
      // Existing enrolments win; a starter roster never replaces teacher records.
      if(await tx.getFirstAsync("SELECT id FROM students WHERE workspace_id=? AND grade=? AND roll=?",w,grade,roll))continue;
      const id=`starter-student-${i+1}`;
      await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)",id,w,indianStudentNames[i],grade,roll,now,now);
      for(const [concept] of conceptSeed.filter(c=>c[2]===grade)) {
        const mastery=[0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][i%8];
        await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)",`${id}-${concept}`,w,id,concept,mastery,now,now);
        await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)",`${id}-${concept}-starter`,w,id,concept,now.slice(0,10),Math.round(mastery*10),10,now,now);
      }
    }
    await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?)",marker,now);
  });
}
