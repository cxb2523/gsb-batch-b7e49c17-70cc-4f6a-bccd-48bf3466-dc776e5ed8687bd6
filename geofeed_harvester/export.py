from __future__ import annotations

import csv
import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from geofeed_harvester.models import FailureRecord, FetchStatusRecord, ValidatedGeofeedRow

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


FAILED_CSV_HEADER = ["url", "rir", "inetnum_refs", "error", "fetched_at", "stage"]
STATUS_CSV_HEADER = [
    "url",
    "rir",
    "status",
    "stage",
    "error",
    "inetnum_refs",
    "rows",
    "malformed_rows",
    "unmatched_rows",
    "fetched_at",
]


def write_outputs(
    rows: Iterable[ValidatedGeofeedRow],
    out_dir: Path,
    stats: dict[str, object] | None = None,
    failures: Iterable[FailureRecord] | None = None,
    previous_jsonl: Path | None = None,
    source_details: Iterable[dict[str, object]] | None = None,
    status_records: Iterable[FetchStatusRecord] | None = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    materialized = list(rows)
    csv_path = out_dir / "geofeed.csv"
    jsonl_path = out_dir / "geofeed.jsonl"
    parquet_path = out_dir / "geofeed.parquet"
    failed_path = out_dir / "failed-geofeeds.csv"
    status_path = out_dir / "fetch-status.csv"
    diff_path = out_dir / "diff.json"
    manifest_path = out_dir / "manifest.json"

    _write_csv(materialized, csv_path)
    _write_jsonl(materialized, jsonl_path)
    parquet_written = _write_parquet(materialized, parquet_path)
    failures_materialized = list(failures or [])
    _write_failures(failures_materialized, failed_path)
    _write_fetch_status(list(status_records or []), status_path)
    diff = _build_diff(materialized, previous_jsonl)
    diff_path.write_text(json.dumps(diff, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _write_changelog(materialized, out_dir / "changelog.md", diff, failures_materialized)
    _write_manifest(
        rows=materialized,
        out_dir=out_dir,
        stats=stats or {},
        diff=diff,
        failures=failures_materialized,
        parquet_written=parquet_written,
        path=manifest_path,
        source_details=list(source_details or []),
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


def _write_failures(failures: Iterable[FailureRecord], path: Path) -> None:
    materialized = list(failures)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(FAILED_CSV_HEADER)
        for failure in materialized:
            inetnums = ";".join(str(ref.inetnum) for ref in failure.refs[:25])
            if len(failure.refs) > 25:
                inetnums += f";...+{len(failure.refs) - 25}"
            writer.writerow(
                [
                    failure.url,
                    failure.rir,
                    inetnums,
                    failure.error,
                    failure.fetched_at,
                    failure.stage,
                ]
            )


def _write_fetch_status(records: Iterable[FetchStatusRecord], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(STATUS_CSV_HEADER)
        for record in records:
            writer.writerow(
                [
                    record.url,
                    record.rir,
                    record.status,
                    record.stage or "",
                    record.error or "",
                    record.refs,
                    record.rows,
                    record.malformed_rows,
                    record.unmatched_rows,
                    record.fetched_at,
                ]
            )


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
    failures: list[FailureRecord],
) -> None:
    by_rir: dict[str, int] = {}
    flagged = 0
    for row in rows:
        by_rir[row.rir] = by_rir.get(row.rir, 0) + 1
        if row.flags:
            flagged += 1
    by_stage = _count_stages(failures)

    lines = [
        "# GeoFeed Harvester Changelog",
        "",
        f"- Valid rows: {len(rows)}",
        f"- Rows with flags: {flagged}",
        f"- Failed geofeed fetches: {len(failures)}",
        f"- Failures by stage: download={by_stage.get('download', 0)}, "
        f"parse={by_stage.get('parse', 0)}, validate={by_stage.get('validate', 0)}",
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
    stats: dict[str, object],
    diff: dict[str, object],
    failures: list[FailureRecord],
    parquet_written: bool,
    path: Path,
    source_details: list[dict[str, object]] | None = None,
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
        "schema_version": 2,
        "stats": {
            **stats,
            "valid_rows": len(rows),
            "unique_prefixes": len({str(row.prefix) for row in rows}),
            "unique_geofeed_urls": len(urls),
            "countries": len(countries),
            "failed_geofeed_fetches": len(failures),
            "failures_by_stage": _count_stages(failures),
            "parquet_written": parquet_written,
        },
        "diff": {
            "previous_loaded": diff["previous_loaded"],
            "added_count": diff["added_count"],
            "removed_count": diff["removed_count"],
            "changed_count": diff["changed_count"],
        },
        "countries": countries,
        "sources": source_details or [],
        "files": files,
    }
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _count_stages(failures: list[FailureRecord]) -> dict[str, int]:
    counts = {"download": 0, "parse": 0, "validate": 0}
    for failure in failures:
        stage = failure.stage or "download"
        counts[stage] = counts.get(stage, 0) + 1
    return counts


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
