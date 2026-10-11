# Calcmate RAG Development Bridge

`src/rag_api.py` wraps the existing Python implementation. It does not change `copilot.py`, `retrieve.py`, model behavior or knowledge-graph code. No authentication, conversation memory, streaming endpoint or scheduling API is provided.

For the combined development API with separately implemented teacher signup, operator approval and login, run `src.api:app` instead. Follow [account and Android setup](account-and-android-setup.md): account development remains loopback-only and phones require HTTPS. The RAG endpoint itself remains a development corpus service, not authenticated classroom-data access.

## Verified Runtime

- `answer_question(retriever, question, grade, subject="Math", k=3, model="qwen2.5:3b", stream=False, use_llm=True)` returns `(answer_text, retrieved_chunks)`.
- `get_default_retriever()` caches a retriever using `data/vector_store.index`, `data/vector_store_meta.json` and Sentence Transformers `all-MiniLM-L6-v2`.
- Retrieval requires FAISS, NumPy, Sentence Transformers and the embedding model. The embedding model must be downloaded/cached before offline use.
- Generated answers additionally require the `ollama` Python package, running Ollama and the configured model. `use_llm=false` invokes the backend's actual retrieval-only branch.
- Existing retrieval/copilot logging remains enabled in ordinary API use. Integration tests redirect logs to temporary files without changing backend code.
- The original backend can fall back to global retrieval for a missing grade/subject bucket. Each returned chunk reports `used_fallback`; this is not a guarantee of curriculum coverage for Grades 1-4.

## Run From Repository Root

PowerShell with the existing virtual environment:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements-api.txt
# If setting up a new environment, also install requirements.txt.
# For generated answers: python -m pip install ollama; ollama pull qwen2.5:3b

# Optional: choose a model already available in `ollama list`.
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m uvicorn src.rag_api:app --host 0.0.0.0 --port 8000
```

This is an unauthenticated development bridge for a trusted local network. Teacher signup/approval is still unavailable. On a physical device, the computer's firewall must allow the development port on the local network.

## Endpoints

`GET /health` returns `status`, `rag_loaded`, `retrieval_dependencies_available` and `corpus_available`. It is a lightweight liveness/configuration check; it does not load the embedding model or guarantee Ollama readiness.

`POST /chat` accepts:

```json
{"question":"What are equivalent fractions?","grade":4,"subject":"Math","k":3,"use_llm":false}
```

`grade` is 1-4, subject is Maths (`Math`), question is nonempty and at most 2000 characters, `k` is 1-10. `use_llm` defaults to true. The model is configured on the server, not supplied by the phone. Unknown request fields are rejected.

The response is `{ "answer": "...", "chunks": [...] }`. Chunks contain only verified retrieval fields: `chunk_id`, `text`, `grade`, `subject`, `source_pdf`, `chunk_index`, `score`, `used_fallback`. The answer includes any source footer produced by the original backend; the wrapper does not invent citations or a refusal flag. A missing runtime or model generation failure returns a redacted HTTP 503.

Development browser CORS allows `http://localhost:8081` and `http://localhost:8082` by default. Override with a comma-separated `CALCMATE_CORS_ORIGINS` value when needed. Native Expo requests do not use browser CORS.

## Expo Device Address

Set `EXPO_PUBLIC_API_BASE_URL` **before starting Metro**; restart Metro after changing it. This public setting contains only an address, never credentials.

Android Studio emulator:

```powershell
cd frontend
$env:EXPO_PUBLIC_API_BASE_URL='http://10.0.2.2:8000'
npm.cmd start
```

Physical Android device: replace `192.168.1.20` below with the computer's actual Wi-Fi/LAN IPv4 address (`ipconfig`). Phone and computer must be on a reachable network.

```powershell
$env:EXPO_PUBLIC_API_BASE_URL='http://192.168.1.20:8000'
npm.cmd start
```

Do not use `localhost` on the phone: it addresses the phone itself. There is no default/hardcoded API address in the app. When no address is configured, questions save locally. Network failure also preserves the question; no automatic replay or server-side conversation memory is implemented.

## Verification

```powershell
# Lightweight health/schema/CORS/error tests; real tests are opt-in.
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_rag_api.py -v

# Actual backend tests, using cached embeddings and an available Ollama model.
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:CALCMATE_TEST_REAL_RAG='1'
$env:CALCMATE_TEST_LLM='1'
$env:CALCMATE_RAG_MODEL='llama3.2:3b'
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_rag_api.py -v
```

References: [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/), [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/).
