import type { SQLiteDatabase } from 'expo-sqlite';
import { canonicalConceptSeed,canonicalPrerequisiteSeed,canonicalConceptMetadata,curriculumVersion } from '../data/curriculum';

export async function seedCanonicalCurriculum(tx:SQLiteDatabase,w:string){
 const key=`curriculum:${w}`;
 if((await tx.getFirstAsync<{value:string}>('SELECT value FROM app_meta WHERE key=?',key))?.value===curriculumVersion)return;
 const now=new Date().toISOString();
 await tx.execAsync('PRAGMA defer_foreign_keys=ON;');
 for(const [id,title,grade,prerequisite] of canonicalConceptSeed){
  const m=canonicalConceptMetadata[id];
  await tx.runAsync(`INSERT INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at,learning_objective,coverage_status,is_active,subject_area) VALUES(?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(workspace_id,id) DO UPDATE SET title=excluded.title,grade=excluded.grade,prerequisite_id=excluded.prerequisite_id,learning_objective=excluded.learning_objective,coverage_status=excluded.coverage_status,is_active=1,subject_area=excluded.subject_area`,id,w,title,grade,prerequisite,now,now,m.learning_objective,m.coverage_status,m.subject_area);
 }
 const ids=canonicalConceptSeed.map(c=>c[0]),marks=ids.map(()=>'?').join(',');
 await tx.runAsync(`DELETE FROM concept_prerequisites WHERE workspace_id=? AND concept_id IN (${marks}) AND prerequisite_id IN (${marks})`,w,...ids,...ids);
 for(const [concept,prerequisite] of canonicalPrerequisiteSeed)await tx.runAsync('INSERT INTO concept_prerequisites VALUES(?,?,?,?,?)',w,concept,prerequisite,'PREREQUISITE_OF','verified');
 await tx.runAsync('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,curriculumVersion);
}
