export const backendFindings={
 framework:'Combined FastAPI account, classroom evidence, planning and RAG service',
 endpoints:['GET /health','POST /chat','POST /planning/general','POST /learner/student-view','POST /learner/prerequisite-analysis','POST /auth/login','GET /admin'],
 runCommands:['python -m src.api --host 0.0.0.0 --port 8000'],
 verifiedContracts:['Version 1 classroom evidence; score-ratio-v1:1; observed-allocation-v1'],
 missingEndpoints:['background classroom synchronization']
} as const;
