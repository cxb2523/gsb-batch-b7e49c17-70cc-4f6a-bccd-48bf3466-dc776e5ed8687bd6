from __future__ import annotations

import hashlib
import json
from pathlib import Path

RELEASE_FILES = [
    "geofeed.csv.gz",
    "geofeed.jsonl.gz",
    "geofeed.parquet",
    "failed-geofeeds.csv",
    "diff.json",
    "manifest.json",
    "changelog.md",
]


def main() -> None:
    dist = Path("dist")
    manifest_path = dist / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        name: {
            "bytes": (dist / name).stat().st_size,
            "sha256": _sha256(dist / name),
        }
        for name in RELEASE_FILES
        if name != "manifest.json" and (dist / name).exists()
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    manifest["files"]["manifest.json"] = {
        "bytes": manifest_path.stat().st_size,
        "sha256": _sha256(manifest_path),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
