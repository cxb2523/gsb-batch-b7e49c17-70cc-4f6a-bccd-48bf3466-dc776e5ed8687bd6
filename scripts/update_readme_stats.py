from __future__ import annotations

import json
from pathlib import Path

START = "<!-- GEOFEED_STATS_START -->"
END = "<!-- GEOFEED_STATS_END -->"


def main() -> None:
    readme = Path("README.md")
    manifest_path = Path("dist/manifest.json")
    if not manifest_path.exists():
        print("dist/manifest.json not found; README stats unchanged")
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stats = manifest["stats"]
    diff = manifest["diff"]
    generated_at = manifest["generated_at"]
    files = manifest["files"]

    block = "\n".join(
        [
            START,
            "## Latest Run",
            "",
            f"- Generated at: `{generated_at}`",
            f"- Valid rows: `{stats.get('valid_rows', 0):,}`",
            f"- Raw rows: `{stats.get('raw_rows', 0):,}`",
            f"- Unique prefixes: `{stats.get('unique_prefixes', 0):,}`",
            f"- Unique geofeed URLs: `{stats.get('unique_geofeed_urls', 0):,}`",
            f"- Countries: `{stats.get('countries', 0):,}`",
            f"- Failed geofeed fetches: `{stats.get('failed_geofeed_fetches', 0):,}`",
            f"- Added / removed / changed prefixes: `{diff.get('added_count', 0):,}` / "
            f"`{diff.get('removed_count', 0):,}` / `{diff.get('changed_count', 0):,}`",
            f"- CSV gzip size: `{_fmt_bytes(files.get('geofeed.csv.gz', {}).get('bytes', 0))}`",
            f"- JSONL gzip size: `{_fmt_bytes(files.get('geofeed.jsonl.gz', {}).get('bytes', 0))}`",
            f"- Parquet size: `{_fmt_bytes(files.get('geofeed.parquet', {}).get('bytes', 0))}`",
            "",
            END,
        ]
    )

    text = readme.read_text(encoding="utf-8")
    if START not in text or END not in text:
        insert_after = "repackaging opaque commercial GeoIP databases.\n"
        text = text.replace(insert_after, insert_after + "\n" + block + "\n")
    else:
        before, rest = text.split(START, 1)
        _, after = rest.split(END, 1)
        text = before + block + after
    readme.write_text(text, encoding="utf-8")


def _fmt_bytes(value: int) -> str:
    size = float(value)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} GB"


if __name__ == "__main__":
    main()
