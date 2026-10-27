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
const ts = require('typescript');

// Compile the actual production module and its pure estimator dependency.
require.extensions['.ts']=(loaded,file)=>loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {buildGeneralSchedule,validateGeneralDraft}=require('../src/services/generalScheduler.ts');

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

