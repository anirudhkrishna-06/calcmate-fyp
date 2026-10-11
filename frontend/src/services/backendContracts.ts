export const backendFindings = {
  framework:"FastAPI development bridge in src/rag_api.py; original retrieval and copilot modules are unchanged.",
  endpoints:["GET /health","POST /chat"],
  runCommands:[
    "python -m uvicorn src.rag_api:app --host 0.0.0.0 --port 8000",
    "python src/retrieve.py --test",
    "python src/copilot.py \"What are equivalent fractions?\" --grade 4 --no-llm"
  ],
  verifiedContracts:["answer_question(retriever, question, grade, subject, k, model, stream, use_llm) -> tuple[str, list[RetrievedChunk]]"],
  missingEndpoints:["auth","teacher profile","students","schedule engine","backup/sync"]
} as const;
