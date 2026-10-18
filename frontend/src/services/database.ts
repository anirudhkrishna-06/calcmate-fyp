import * as SQLite from "expo-sqlite";
import { seedCanonicalCurriculum } from "./curriculumStore";
import { rebuildWorkspaceStates } from "./learnerEstimator";

export const migrations = [
  `CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('demo','real')),
    seeded_at TEXT, created_at TEXT NOT NULL, UNIQUE(id, teacher_id));
  CREATE TABLE profiles (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,id));
  CREATE TABLE students (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4), roll TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    UNIQUE(workspace_id,grade,roll));
  CREATE TABLE concepts (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4), prerequisite_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    FOREIGN KEY(workspace_id,prerequisite_id) REFERENCES concepts(workspace_id,id));
  CREATE TABLE attendance (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL, student_id TEXT NOT NULL, date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('present','absent','late')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    UNIQUE(workspace_id,student_id,date),
    FOREIGN KEY(workspace_id,student_id) REFERENCES students(workspace_id,id) ON DELETE CASCADE);
  CREATE TABLE assessments (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL, student_id TEXT NOT NULL, concept_id TEXT NOT NULL,
    date TEXT NOT NULL, score REAL NOT NULL CHECK(score>=0), maximum REAL NOT NULL CHECK(maximum>0 AND score<=maximum),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    FOREIGN KEY(workspace_id,student_id) REFERENCES students(workspace_id,id) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,concept_id) REFERENCES concepts(workspace_id,id));
  CREATE TABLE competencies (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL, student_id TEXT NOT NULL, concept_id TEXT NOT NULL,
    mastery REAL NOT NULL CHECK(mastery BETWEEN 0 AND 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,student_id,concept_id),
    FOREIGN KEY(workspace_id,student_id) REFERENCES students(workspace_id,id) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,concept_id) REFERENCES concepts(workspace_id,id));
  CREATE TABLE observations (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL, student_id TEXT NOT NULL, note TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    FOREIGN KEY(workspace_id,student_id) REFERENCES students(workspace_id,id) ON DELETE CASCADE);
  CREATE TABLE schedules (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,id));
  CREATE TABLE messages (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('teacher','assistant')), text TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id));`,
  `CREATE INDEX students_grade ON students(workspace_id,grade,name);
   CREATE INDEX attendance_date ON attendance(workspace_id,date);
   CREATE INDEX assessments_history ON assessments(workspace_id,student_id,date);
   CREATE INDEX competencies_revision ON competencies(workspace_id,mastery);`,
  `CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);
   CREATE TABLE conversations (
     id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     title TEXT NOT NULL,grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4),
     created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,id));
   CREATE TABLE message_details (
     message_id TEXT NOT NULL,workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
     request_json TEXT CHECK(request_json IS NULL OR json_valid(request_json)),
     sources_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sources_json)),error TEXT,reply_to TEXT,
     PRIMARY KEY(workspace_id,message_id),UNIQUE(workspace_id,reply_to),
     FOREIGN KEY(workspace_id,message_id) REFERENCES messages(workspace_id,id) ON DELETE CASCADE,
     FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id) ON DELETE CASCADE,
     FOREIGN KEY(workspace_id,reply_to) REFERENCES messages(workspace_id,id) ON DELETE CASCADE);
   CREATE INDEX chat_history ON message_details(workspace_id,conversation_id);
   INSERT INTO conversations SELECT 'legacy-'||workspace_id,workspace_id,'Earlier chat',4,MIN(created_at),MAX(updated_at)
     FROM messages GROUP BY workspace_id;
   INSERT INTO message_details(message_id,workspace_id,conversation_id,status)
     SELECT id,workspace_id,'legacy-'||workspace_id,'completed' FROM messages;`,
  `ALTER TABLE concepts ADD COLUMN learning_objective TEXT;
   ALTER TABLE concepts ADD COLUMN coverage_status TEXT NOT NULL DEFAULT 'pending';
   ALTER TABLE concepts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE concepts ADD COLUMN subject_area TEXT NOT NULL DEFAULT 'Math';
   CREATE TABLE IF NOT EXISTS concept_prerequisites (
     workspace_id TEXT NOT NULL,
     concept_id TEXT NOT NULL,
     prerequisite_id TEXT NOT NULL,
     relationship_type TEXT NOT NULL DEFAULT 'PREREQUISITE_OF',
     confidence TEXT NOT NULL DEFAULT 'provisional',
     PRIMARY KEY(workspace_id,concept_id,prerequisite_id),
     FOREIGN KEY(workspace_id,concept_id) REFERENCES concepts(workspace_id,id) ON DELETE CASCADE,
     FOREIGN KEY(workspace_id,prerequisite_id) REFERENCES concepts(workspace_id,id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS concept_prereqs_idx ON concept_prerequisites(workspace_id,concept_id);`,
  `CREATE TABLE IF NOT EXISTS learner_concept_states (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     student_id TEXT NOT NULL,
     concept_id TEXT NOT NULL,
     mastery_estimate REAL,
     evidence_count INTEGER NOT NULL DEFAULT 0,
     last_evidence_at TEXT,
     estimator_name TEXT NOT NULL DEFAULT 'score-ratio-v1',
     estimator_version TEXT NOT NULL DEFAULT '1',
     state_status TEXT NOT NULL DEFAULT 'unknown'
       CHECK(state_status IN ('unknown','insufficient','needs_support','likely_ready')),
     evidence_sufficiency TEXT NOT NULL DEFAULT 'none'
       CHECK(evidence_sufficiency IN ('none','limited','moderate','sufficient')),
     updated_at TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY(workspace_id,id),
     UNIQUE(workspace_id,student_id,concept_id),
     FOREIGN KEY(workspace_id,student_id) REFERENCES students(workspace_id,id) ON DELETE CASCADE,
     FOREIGN KEY(workspace_id,concept_id) REFERENCES concepts(workspace_id,id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS lcs_student ON learner_concept_states(workspace_id,student_id);
   CREATE INDEX IF NOT EXISTS lcs_concept ON learner_concept_states(workspace_id,concept_id);
   CREATE INDEX IF NOT EXISTS lcs_status  ON learner_concept_states(workspace_id,state_status);`,
  `CREATE TABLE IF NOT EXISTS class_sessions (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     schedule_id TEXT,
     grade INTEGER,
     date TEXT NOT NULL,
     started_at TEXT NOT NULL,
     ended_at TEXT,
     status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
     current_block_index INTEGER NOT NULL DEFAULT 0,
     elapsed_seconds INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY(workspace_id, id));
   CREATE INDEX IF NOT EXISTS class_sessions_date ON class_sessions(workspace_id, date);
   CREATE TABLE IF NOT EXISTS session_attendance_events (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     student_id TEXT NOT NULL,
     event_type TEXT NOT NULL CHECK(event_type IN ('arrived','left','returned')),
     recorded_at TEXT NOT NULL,
     PRIMARY KEY(workspace_id, id),
     FOREIGN KEY(workspace_id, session_id) REFERENCES class_sessions(workspace_id, id) ON DELETE CASCADE,
     FOREIGN KEY(workspace_id, student_id) REFERENCES students(workspace_id, id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS sae_session ON session_attendance_events(workspace_id, session_id);
   CREATE TABLE IF NOT EXISTS session_outcomes (
     id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     block_id TEXT NOT NULL,
     delivered INTEGER NOT NULL DEFAULT 1,
     notes TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY(workspace_id, id),
     FOREIGN KEY(workspace_id, session_id) REFERENCES class_sessions(workspace_id, id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS session_outcomes_session ON session_outcomes(workspace_id, session_id);`
];

migrations.push(`CREATE TABLE students_v5 (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 5), roll TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
    UNIQUE(workspace_id,grade,roll));
INSERT INTO students_v5 SELECT * FROM students;
DROP TABLE students;
ALTER TABLE students_v5 RENAME TO students;
CREATE TABLE concepts_v5 (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 5), prerequisite_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    learning_objective TEXT,coverage_status TEXT NOT NULL DEFAULT 'pending',is_active INTEGER NOT NULL DEFAULT 1,subject_area TEXT NOT NULL DEFAULT 'Math',PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,prerequisite_id) REFERENCES concepts(workspace_id,id));
INSERT INTO concepts_v5 SELECT * FROM concepts;
DROP TABLE concepts;
ALTER TABLE concepts_v5 RENAME TO concepts;
CREATE TABLE conversations_v5 (
     id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     title TEXT NOT NULL,grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 5),
     created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,id));
INSERT INTO conversations_v5 SELECT * FROM conversations;
DROP TABLE conversations;
ALTER TABLE conversations_v5 RENAME TO conversations;
CREATE INDEX students_grade ON students(workspace_id,grade,name);
CREATE TABLE assessment_origins(workspace_id TEXT NOT NULL,assessment_id TEXT NOT NULL,session_id TEXT NOT NULL,block_id TEXT NOT NULL,PRIMARY KEY(workspace_id,assessment_id),FOREIGN KEY(workspace_id,assessment_id) REFERENCES assessments(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(workspace_id,session_id) REFERENCES class_sessions(workspace_id,id) ON DELETE CASCADE);`);

migrations.push(`CREATE TRIGGER evidence_students_insert AFTER INSERT ON students BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_students_update AFTER UPDATE ON students BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_students_delete AFTER DELETE ON students BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||OLD.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_assessments_insert AFTER INSERT ON assessments BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_assessments_update AFTER UPDATE ON assessments BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_assessments_delete AFTER DELETE ON assessments BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||OLD.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_attendance_insert AFTER INSERT ON attendance BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_attendance_update AFTER UPDATE ON attendance BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_attendance_delete AFTER DELETE ON attendance BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||OLD.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_session_outcomes_insert AFTER INSERT ON session_outcomes BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_session_outcomes_update AFTER UPDATE ON session_outcomes BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||NEW.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
CREATE TRIGGER evidence_session_outcomes_delete AFTER DELETE ON session_outcomes BEGIN INSERT INTO app_meta(key,value) VALUES('classroom.revision:'||OLD.workspace_id,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;`);

let opening: Promise<SQLite.SQLiteDatabase> | undefined;
export function getDatabase() {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync("calcmate.db");
    await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    await transactionConnection(async tx => {
      const version = await tx.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
      if ((version?.user_version ?? 0) > migrations.length) throw new Error("Database requires a newer Calcmate version.");
      for (let i = version?.user_version ?? 0; i < migrations.length; i++) {
        await tx.execAsync(migrations[i]);
        await tx.execAsync(`PRAGMA user_version=${i + 1}`);
      }
      for(const w of await tx.getAllAsync<{id:string}>("SELECT id FROM workspaces")){await seedCanonicalCurriculum(tx,w.id);await rebuildWorkspaceStates(tx,w.id);}
    }, true);
    return db;
  })().catch(error => { opening = undefined; throw error; });
  return opening;
}

let writes: Promise<unknown> = Promise.resolve();
function transactionConnection<T>(task: (tx: SQLite.SQLiteDatabase) => Promise<T>, schemaMigration = false): Promise<T> {
  const result = writes.then(async () => {
    const tx = await SQLite.openDatabaseAsync("calcmate.db", { useNewConnection: true });
    try {
      // Foreign keys are connection-local and must be enabled BEFORE beginning a transaction.
      await tx.execAsync(`PRAGMA foreign_keys=${schemaMigration ? "OFF" : "ON"}; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;`);
      try { const value = await task(tx); if(schemaMigration && (await tx.getAllAsync("PRAGMA foreign_key_check")).length)throw new Error("Database migration has invalid references."); await tx.execAsync("COMMIT"); return value; }
      catch (error) { await tx.execAsync("ROLLBACK"); throw error; }
    } finally { await tx.closeAsync(); }
  });
  writes = result.catch(() => undefined);
  return result;
}
export async function withTransaction<T>(task: (tx: SQLite.SQLiteDatabase) => Promise<T>) {
  await getDatabase();
  return transactionConnection(task);
}

export type BaseRecord = { id: string; workspace_id: string; created_at: string; updated_at: string };
export type StudentRecord = BaseRecord & { name: string; grade: number; roll: string };
export type ConceptRecord = BaseRecord & {
  title: string;
  grade: number;
  prerequisite_id: string | null;
  prerequisite_ids?: string[];
  learning_objective?: string | null;
  coverage_status?: string | null;
  is_active?: number | null;
  subject_area?: string | null;
};
export type AttendanceRecord = BaseRecord & { student_id: string; date: string; status: "present" | "absent" | "late" };
export type AssessmentRecord = BaseRecord & { student_id: string; concept_id: string; date: string; score: number; maximum: number };
export type CompetencyRecord = BaseRecord & { student_id: string; concept_id: string; mastery: number };
export type LearnerConceptStateRecord = {
  id: string;
  workspace_id: string;
  student_id: string;
  concept_id: string;
  mastery_estimate: number | null;
  evidence_count: number;
  last_evidence_at: string | null;
  estimator_name: string;
  estimator_version: string;
  state_status: "unknown" | "insufficient" | "needs_support" | "likely_ready";
  evidence_sufficiency: "none" | "limited" | "moderate" | "sufficient";
  updated_at: string;
  created_at: string;
};

export type ClassSessionRecord = {
  id: string;
  workspace_id: string;
  schedule_id: string | null;
  grade: number | null;
  date: string;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'paused' | 'completed';
  current_block_index: number;
  elapsed_seconds: number;
  created_at: string;
  updated_at: string;
};

export type SessionAttendanceEventRecord = {
  id: string;
  workspace_id: string;
  session_id: string;
  student_id: string;
  event_type: 'arrived' | 'left' | 'returned';
  recorded_at: string;
};

export type SessionOutcomeRecord = {
  id: string;
  workspace_id: string;
  session_id: string;
  block_id: string;
  delivered: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ObservationRecord = BaseRecord & { student_id: string; note: string };
export type JsonRecord = BaseRecord & { data: string };
export type MessageRecord = BaseRecord & { role: "teacher" | "assistant"; text: string };
export type Records = {
  profiles: JsonRecord; students: StudentRecord; concepts: ConceptRecord; attendance: AttendanceRecord;
  assessments: AssessmentRecord; competencies: CompetencyRecord; observations: ObservationRecord;
  schedules: JsonRecord; messages: MessageRecord;
};
const columns: Record<keyof Records, string[]> = {
  profiles: ["data"], students: ["name", "grade", "roll"], concepts: ["title", "grade", "prerequisite_id"],
  attendance: ["student_id", "date", "status"], assessments: ["student_id", "concept_id", "date", "score", "maximum"],
  competencies: ["student_id", "concept_id", "mastery"], observations: ["student_id", "note"],
  schedules: ["data"], messages: ["role", "text"]
};
export type Input<K extends keyof Records> = Omit<Records[K], keyof BaseRecord>;
export type Scope = { workspaceId: string; teacherId: string };
export function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export async function assertScope(db: SQLite.SQLiteDatabase, scope: Scope) {
  const owner = await db.getFirstAsync("SELECT id FROM workspaces WHERE id=? AND teacher_id=?", scope.workspaceId, scope.teacherId);
  if (!owner) throw new Error("This teacher cannot access the workspace.");
}

export function repository<K extends keyof Records>(table: K, scope: Scope) {
  async function database() { const db = await getDatabase(); await assertScope(db, scope); return db; }
  return {
    async list(): Promise<Records[K][]> {
      return (await database()).getAllAsync<Records[K]>(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY created_at,id`, scope.workspaceId);
    },
    async get(id: string): Promise<Records[K] | null> {
      return (await database()).getFirstAsync<Records[K]>(`SELECT * FROM ${table} WHERE workspace_id=? AND id=?`, scope.workspaceId, id);
    },
    async save(input: Input<K>, id = newId()): Promise<string> {
      await database();
      const fields = columns[table];
      validateRecord(table, input as Record<string, unknown>);
      if (!id.trim()) throw new Error("Record ID is required.");
      const now = new Date().toISOString();
      const values = fields.map(key => (input as Record<string, SQLite.SQLiteBindValue>)[key]);
      await withTransaction(async tx => {
        await tx.runAsync(`INSERT INTO ${table}(id,workspace_id,created_at,updated_at,${fields.join(",")})
          VALUES(?,?,?, ?,${fields.map(() => "?").join(",")})
          ON CONFLICT(workspace_id,id) DO UPDATE SET updated_at=excluded.updated_at,${fields.map(f => `${f}=excluded.${f}`).join(",")}`,
          id, scope.workspaceId, now, now, ...values);
      });
      return id;
    },
    async remove(id: string) {
      await database();
      await withTransaction(async tx => { await tx.runAsync(`DELETE FROM ${table} WHERE workspace_id=? AND id=?`, scope.workspaceId, id); });
    }
  };
}

function validateRecord(table: keyof Records, input: Record<string, unknown>) {
  for (const key of columns[table]) {
    const value = input[key];
    if (key === "prerequisite_id" && value === null) continue;
    if (typeof value === "string" && !value.trim()) throw new Error(`${key} cannot be empty.`);
    if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`Invalid ${key}.`);
  }
  if (table === "students" && (String(input.name).length > 100 || String(input.roll).length > 12)) throw new Error("Student name or roll number is too long.");
  if ("grade" in input && ![1,2,3,4,5].includes(Number(input.grade))) throw new Error("Invalid grade.");
  if ("date" in input && (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date)) || !Number.isFinite(Date.parse(String(input.date))) || new Date(String(input.date)).toISOString().slice(0,10) !== input.date || String(input.date) > today())) throw new Error("Invalid date.");
  if ("data" in input) { try { JSON.parse(String(input.data)); } catch { throw new Error("Invalid record data."); } }
}
