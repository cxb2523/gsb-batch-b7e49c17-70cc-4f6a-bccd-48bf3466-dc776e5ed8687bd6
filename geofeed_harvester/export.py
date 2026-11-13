from __future__ import annotations

import csv
import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from geofeed_harvester.fetch import FetchResult
from geofeed_harvester.models import ValidatedGeofeedRow

CSV_HEADER = [
    "prefix",
    "country",
    "region",
    "city",
    "postal_code",
    "rir",
    "inetnum",
    "url",
    "fetched_at",
    "signed",
    "signature_valid",
    "bgp_valid",
    "confidence",
    "flags",
]


def write_outputs(
    rows: Iterable[ValidatedGeofeedRow],
    out_dir: Path,
    stats: dict[str, int] | None = None,
    fetch_results: Iterable[FetchResult] | None = None,
    previous_jsonl: Path | None = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    materialized = list(rows)
    csv_path = out_dir / "geofeed.csv"
    jsonl_path = out_dir / "geofeed.jsonl"
    parquet_path = out_dir / "geofeed.parquet"
    failed_path = out_dir / "failed-geofeeds.csv"
    diff_path = out_dir / "diff.json"
    manifest_path = out_dir / "manifest.json"

    _write_csv(materialized, csv_path)
    _write_jsonl(materialized, jsonl_path)
    parquet_written = _write_parquet(materialized, parquet_path)
    failed_count = _write_failed_fetches(fetch_results or [], failed_path)
    diff = _build_diff(materialized, previous_jsonl)
    diff_path.write_text(json.dumps(diff, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _write_changelog(materialized, out_dir / "changelog.md", diff, failed_count)
    _write_manifest(
        rows=materialized,
        out_dir=out_dir,
        stats=stats or {},
        diff=diff,
        failed_count=failed_count,
        parquet_written=parquet_written,
        path=manifest_path,
    )


def _write_csv(rows: list[ValidatedGeofeedRow], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        writer.writerows(row.csv_fields() for row in rows)


def _write_jsonl(rows: list[ValidatedGeofeedRow], path: Path) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row.json_dict(), ensure_ascii=False, sort_keys=True))
            fh.write("\n")


def _write_parquet(rows: list[ValidatedGeofeedRow], path: Path) -> bool:
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        return False

    table = pa.Table.from_pylist([row.json_dict() for row in rows])
    pq.write_table(table, path, compression="zstd")
    return True


def _write_failed_fetches(fetch_results: Iterable[FetchResult], path: Path) -> int:
    failed = [result for result in fetch_results if result.status == "failed"]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["url", "rir", "inetnum_refs", "error", "fetched_at"])
        for result in failed:
            rirs = ";".join(sorted({ref.rir for ref in result.refs}))
            inetnums = ";".join(str(ref.inetnum) for ref in result.refs[:25])
            if len(result.refs) > 25:
                inetnums += f";...+{len(result.refs) - 25}"
            writer.writerow([result.url, rirs, inetnums, result.error or "", result.fetched_at])
    return len(failed)


def _build_diff(rows: list[ValidatedGeofeedRow], previous_jsonl: Path | None) -> dict[str, object]:
    current = {_row_key(row): _row_value(row) for row in rows}
    previous: dict[str, dict[str, object]] = {}
    if previous_jsonl is not None and previous_jsonl.exists():
        with previous_jsonl.open("r", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                item = json.loads(line)
                previous[str(item["prefix"])] = {
                    "country": item.get("country", ""),
                    "region": item.get("region", ""),
                    "city": item.get("city", ""),
                    "postal_code": item.get("postal_code", ""),
                    "rir": item.get("rir", ""),
                    "url": item.get("url", ""),
                    "flags": item.get("flags", []),
                }

    added = sorted(set(current) - set(previous))
    removed = sorted(set(previous) - set(current))
    changed = sorted(key for key in set(current) & set(previous) if current[key] != previous[key])
    return {
        "previous_loaded": bool(previous),
        "added_count": len(added),
        "removed_count": len(removed),
        "changed_count": len(changed),
        "added_sample": added[:100],
        "removed_sample": removed[:100],
        "changed_sample": [
            {"prefix": key, "before": previous[key], "after": current[key]} for key in changed[:100]
        ],
    }


def _write_changelog(
    rows: list[ValidatedGeofeedRow],
    path: Path,
    diff: dict[str, object],
    failed_count: int,
) -> None:
    by_rir: dict[str, int] = {}
    flagged = 0
    for row in rows:
        by_rir[row.rir] = by_rir.get(row.rir, 0) + 1
        if row.flags:
            flagged += 1

    lines = [
        "# GeoFeed Harvester Changelog",
        "",
        f"- Valid rows: {len(rows)}",
        f"- Rows with flags: {flagged}",
        f"- Failed geofeed fetches: {failed_count}",
        f"- Added prefixes: {diff['added_count']}",
        f"- Removed prefixes: {diff['removed_count']}",
        f"- Changed prefixes: {diff['changed_count']}",
        "",
        "## By RIR",
        "",
    ]
    for rir, count in sorted(by_rir.items()):
        lines.append(f"- {rir}: {count}")
    lines.extend(["", "## Diff Samples", ""])
    for label, key in [
        ("Added", "added_sample"),
        ("Removed", "removed_sample"),
    ]:
        lines.append(f"### {label}")
        lines.append("")
        for prefix in diff[key][:25]:
            lines.append(f"- {prefix}")
        if not diff[key]:
            lines.append("- none")
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_manifest(
    rows: list[ValidatedGeofeedRow],
    out_dir: Path,
    stats: dict[str, int],
    diff: dict[str, object],
    failed_count: int,
    parquet_written: bool,
    path: Path,
) -> None:
    files = {}
    for item in sorted(out_dir.iterdir()):
        if item.is_file() and item.name != path.name:
            files[item.name] = {
                "bytes": item.stat().st_size,
                "sha256": _sha256(item),
            }
    countries = sorted({row.country for row in rows if row.country})
    urls = {row.url for row in rows}
    manifest = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "schema_version": 1,
        "stats": {
            **stats,
            "valid_rows": len(rows),
            "unique_prefixes": len({str(row.prefix) for row in rows}),
            "unique_geofeed_urls": len(urls),
            "countries": len(countries),
            "failed_geofeed_fetches": failed_count,
            "parquet_written": parquet_written,
        },
        "diff": {
            "previous_loaded": diff["previous_loaded"],
            "added_count": diff["added_count"],
            "removed_count": diff["removed_count"],
            "changed_count": diff["changed_count"],
        },
        "countries": countries,
        "files": files,
    }
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _row_key(row: ValidatedGeofeedRow) -> str:
    return str(row.prefix)


def _row_value(row: ValidatedGeofeedRow) -> dict[str, object]:
    return {
        "country": row.country,
        "region": row.region,
        "city": row.city,
        "postal_code": row.postal_code,
        "rir": row.rir,
        "url": row.url,
        "flags": list(row.flags),
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
