from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def merge_catalogs(inputs: list[Path]) -> dict:
    documents = [json.loads(path.read_text("utf-8")) for path in inputs]
    scenes: list[dict] = []
    seen_ids: set[str] = set()
    seen_signatures: set[str] = set()
    source_roots: list[str] = []

    for path, document in zip(inputs, documents):
        source = document.get("source_root") or path.stem
        if source not in source_roots:
            source_roots.append(source)
        for scene in document.get("scenes", []):
            scene_id = scene.get("id")
            signature = scene.get("signature")
            if scene_id and scene_id in seen_ids:
                continue
            if signature and signature in seen_signatures:
                continue
            scenes.append(scene)
            if scene_id:
                seen_ids.add(scene_id)
            if signature:
                seen_signatures.add(signature)

    signatures: dict[str, list[str]] = {}
    for scene in scenes:
        if scene.get("signature") and scene.get("id"):
            signatures.setdefault(scene["signature"], []).append(scene["id"])
    duplicate_groups = [ids for ids in signatures.values() if len(ids) > 1]
    return {
        "schema_version": "1.0.0",
        "build_status": "complete",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_root": "Merged catalog",
        "source_roots": source_roots,
        "summary": {
            "scene_count": len(scenes),
            "folder_count": len({scene.get("folder", "") for scene in scenes}),
            "duplicate_group_count": len(duplicate_groups),
        },
        "duplicate_groups": duplicate_groups,
        "scenes": scenes,
    }


def write_atomic(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(document, indent=2), "utf-8")
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge satellite catalogs without duplicating scenes")
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    document = merge_catalogs(args.inputs)
    write_atomic(args.output, document)
    print(f"Merged {len(args.inputs)} catalogs into {document['summary']['scene_count']} scenes.")


if __name__ == "__main__":
    main()
