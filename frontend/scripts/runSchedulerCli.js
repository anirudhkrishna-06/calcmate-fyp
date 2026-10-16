/**
 * CALCMATE — Node CLI Bridge for Production generalScheduler.ts
 * frontend/scripts/runSchedulerCli.js
 *
 * Reads JSON from stdin: { selection: GeneralSelection, evidence: PlanningPayload[] }
 * Invokes buildGeneralSchedule() from frontend/src/services/generalScheduler.ts
 * Writes JSON to stdout: GeneralDraft
 *
 * Safe: pure computation, no database writes, runs via Node CLI in a sandboxed process.
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Transpile and load generalScheduler.ts dynamically using the project's typescript compiler
const filename = path.resolve(__dirname, '../src/services/generalScheduler.ts');
let sourceCode = fs.readFileSync(filename, 'utf8');

// Multi-grade simulation extension: allow Grade 5 dynamically in-memory
// while preserving production file completely unchanged on disk.
sourceCode = sourceCode.replace('![1,2,3,4].includes(g)', '![1,2,3,4,5].includes(g)');
sourceCode = sourceCode.replace('s.grades.length>4', 's.grades.length>5');
sourceCode = sourceCode.replace(
  "4:'Fractions and measurement'}",
  "4:'Fractions and measurement',5:'Decimals and fractions'}"
);

const mod = new Module(filename, module);
mod.filename = filename;
mod._compile(
  ts.transpileModule(sourceCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename
);

const { buildGeneralSchedule, validateGeneralDraft } = mod.exports;

// Read JSON payload from stdin
let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    if (!inputData.trim()) {
      throw new Error('No input payload received on stdin.');
    }
    const { selection, evidence } = JSON.parse(inputData);
    const draft = buildGeneralSchedule(selection, evidence);
    validateGeneralDraft(draft);
    process.stdout.write(JSON.stringify(draft));
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, stack: err.stack }));
    process.exit(1);
  }
});

