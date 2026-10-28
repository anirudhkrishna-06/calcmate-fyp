const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE conversations(id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, grade INTEGER, created_at TEXT, updated_at TEXT, student_id TEXT);
CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE message_details(workspace_id TEXT, status TEXT, error TEXT);`);
const scope = { workspaceId: 'workspace' };
const adapter = {
  runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
  getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params),
  getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
};
let counter = 0;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('chatRepository.ts')) {
    if (request === './database') return { assertScope: async () => {}, getDatabase: async () => adapter, newId: () => `chat-${++counter}`, withTransaction: async task => task(adapter) };
    if (request === './authService') return { requireSession: async () => scope };
    if (request === './gradePreference') return { currentGrade: () => 4 };
    if (request === './copilotService') return { buildCopilotRequest: () => ({}) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
async function run() {
  const filename = path.resolve(__dirname, '../src/services/chatRepository.ts');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const chat = mod.exports;
  const student = await chat.getOrCreateStudentConversation('student-1', 'Asha', 4);
  assert.equal((await chat.getOrCreateStudentConversation('student-1', 'Asha', 4)).id, student.id);
  const first = await chat.createConversation(4);
  const second = await chat.createConversation(4);
  assert.notEqual(first.id, second.id);
  const rows = await chat.listConversations();
  assert.equal(rows.find(row => row.id === first.id).student_id, null);
  assert.equal(rows.find(row => row.id === student.id).student_id, 'student-1');
  assert.equal((await chat.restoreConversation()).id, second.id);
  await chat.selectConversation(student.id);
  assert.equal((await chat.restoreConversation()).student_id, 'student-1');
  console.log('PASS: seven-column conversation schema, distinct New Chats, student history preservation and restoration.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; db.close(); });
