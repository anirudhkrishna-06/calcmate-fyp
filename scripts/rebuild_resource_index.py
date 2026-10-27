"""Rebuild paired retrieval artifacts from existing metadata and reviewed resources."""
from pathlib import Path
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    import faiss
    import numpy as np
    from sentence_transformers import SentenceTransformer
    from src.resource_coverage import write_manifest

    data = ROOT / "data"
    meta = json.loads((data / "vector_store_meta.json").read_text(encoding="utf-8"))
    reviewed = json.loads((data / "foundational_resources.json").read_text(encoding="utf-8"))
    # Stable replacement makes repeated builds idempotent.
    meta = [m for m in meta if m.get("resource_kind") != "source_summary" and m.get("resource_collection") != "foundational-v1"] + reviewed
    for i, row in enumerate(meta):
        row.update(id=i, chunk_index=row.get("chunk_index", 0), char_count=len(row["text"]))
    model = SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
    vectors = model.encode([m["text"] for m in meta], normalize_embeddings=True, show_progress_bar=False)
    index = faiss.IndexIDMap(faiss.IndexFlatIP(vectors.shape[1]))
    index.add_with_ids(np.asarray(vectors, dtype="float32"), np.arange(len(meta), dtype="int64"))
    index_path, meta_path = data / "vector_store.index", data / "vector_store_meta.json"
    faiss.write_index(index, str(index_path) + ".tmp")
    Path(str(meta_path) + ".tmp").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(str(index_path) + ".tmp", index_path)
    os.replace(str(meta_path) + ".tmp", meta_path)
    manifest=write_manifest(index_path,meta_path)
    print(f"Built {len(meta)} vectors; grade coverage: " + ", ".join(f"{g}: {v['chunks']}" for g, v in manifest["grades"].items()))


if __name__ == "__main__":
    main()
