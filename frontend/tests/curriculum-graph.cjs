const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const source = path.resolve(__dirname, '../src/services/curriculumGraphService.ts');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './database') return { getDatabase: () => {}, ConceptRecord: {} };
  if (request === './authService') return { requireSession: async () => ({ workspaceId: 'test', teacherId: 'teacher' }) };
  if (request === './learnerStateService') return {
    getStudentKnowledgeView: async () => ({ concepts: [] }),
    StateStatus: {}, EvidenceSufficiency: {}, MASTERY_THRESHOLD: 0.70, NEEDS_SUPPORT_THRESHOLD: 0.60
  };
  return originalLoad.call(this, request, parent, isMain);
};
const mod = new Module(source, module);
mod.filename = source;
mod._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, source);
Module._load = originalLoad;

const { normalizeGraphRelationships } = mod.exports;
const concepts = [
  { id: 'M101', prerequisite_id: null },
  { id: 'M102', prerequisite_id: 'M101' },
  { id: 'M201', prerequisite_id: 'M102' }
];
const graph = normalizeGraphRelationships(concepts, [
  { concept_id: 'M102', prerequisite_id: 'M101' },
  { concept_id: 'M201', prerequisite_id: 'M404' }, // stale edge is ignored
  { concept_id: 'M201', prerequisite_id: 'M201' } // self-edge is ignored
]);
assert.deepEqual(graph.pairs, [
  { concept_id: 'M102', prerequisite_id: 'M101' },
  { concept_id: 'M201', prerequisite_id: 'M102' }
]);
assert.deepEqual(graph.prerequisites.get('M201'), ['M102']);
assert.deepEqual(graph.dependents.get('M101'), ['M102']);
assert.equal(graph.dependents.get('M201'), undefined);
console.log('PASS: canonical graph direction, fallback prerequisite, duplicate, stale and self-edge handling.');
