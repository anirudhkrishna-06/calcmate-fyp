"""Single source of truth for the local Ollama model used by CALCMATE."""
from __future__ import annotations

import os

# The repository ModelFile is built with: ollama create calcmate -f ModelFile
# An explicit environment override is supported for deployment and tests.
DEFAULT_MODEL = os.getenv("CALCMATE_RAG_MODEL", "calcmate:latest").strip() or "calcmate:latest"

def configured_model() -> str:
    return os.getenv("CALCMATE_RAG_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
