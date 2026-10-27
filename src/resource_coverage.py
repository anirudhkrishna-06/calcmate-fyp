"""Coverage is derived from shipped index metadata without loading an embedding model."""
import json
from pathlib import Path
from functools import lru_cache


@lru_cache(maxsize=1)
def coverage():
    path = Path(__file__).resolve().parents[1] / "data" / "vector_store_meta.json"
    rows = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else []
    return {str(g): {"chunks": sum(r["grade"] == g for r in rows),
                     "concept_ids": sorted({cid for r in rows if r["grade"] == g for cid in r["concept_ids"]}),
                     "source_summaries": sum(r["grade"] == g and r.get("resource_kind") == "source_summary" for r in rows)} for g in range(1, 6)}


def write_manifest(index_path,meta_path,model_name='all-MiniLM-L6-v2'):
    import hashlib
    from src.classroom_contracts import curriculum_version
    index_path,meta_path=Path(index_path),Path(meta_path)
    rows=json.loads(meta_path.read_text(encoding='utf-8'))
    manifest={'curriculum_version':curriculum_version(),'embedding_model':model_name,'vectors':len(rows),'index_sha256':hashlib.sha256(index_path.read_bytes()).hexdigest(),'metadata_sha256':hashlib.sha256(meta_path.read_bytes()).hexdigest(),
      'grades':{str(g):{'chunks':sum(r['grade']==g for r in rows),'concept_ids':sorted({cid for r in rows if r['grade']==g for cid in r['concept_ids']})} for g in range(1,6)}}
    (meta_path.parent/'corpus_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    coverage.cache_clear()
    return manifest
