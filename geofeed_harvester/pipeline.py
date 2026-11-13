from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json

import httpx

from geofeed_harvester.bgp import BgpValidator, CymruBulkBgpValidator
from geofeed_harvester.discovery import dedupe_refs, parse_rir_dump
from geofeed_harvester.errors import HarvestError
from geofeed_harvester.export import write_outputs
from geofeed_harvester.fetch import HttpCache, fetch_all
from geofeed_harvester.logging import log
from geofeed_harvester.models import FailureRecord, FetchResult, FetchStatusRecord
from geofeed_harvester.parse import parse_geofeed_file
from geofeed_harvester.sources import PreparedInputs
from geofeed_harvester.validate import validate_rows


async def run_harvest(
    rir_dump_paths: list[Path],
    out_dir: Path,
    cache_dir: Path,
    concurrency: int = 32,
    bgp_validator: str = "none",
    direct_geofeed_paths: list[tuple[str, str, Path]] | None = None,
    previous_jsonl: Path | None = None,
    signature_verdicts_path: Path | None = None,
    prepared_inputs: PreparedInputs | None = None,
    fetch_client: httpx.AsyncClient | None = None,
) -> dict[str, object]:
    """Fetch, validate and export one harvest run.

    Every input that can fail is recorded rather than raised: bulk source
    failures, geofeed download failures, parse failures and validation failures
    all end up in ``failed-geofeeds.csv`` and ``manifest.json``. The only hard
    error is a run that would publish nothing at all because *all* bulk sources
    failed and no row survived validation — publishing an empty dataset in that
    case would be indistinguishable from "there is no data".
    """

    rir_dumps = list(rir_dump_paths)
    direct_inputs = list(direct_geofeed_paths or [])
    if prepared_inputs is not None:
        if prepared_inputs.normalized_rir_path is not None:
            rir_dumps.append(prepared_inputs.normalized_rir_path)
        direct_inputs.extend(prepared_inputs.direct_geofeed_paths)
    direct_inputs = _dedupe_direct_inputs(direct_inputs)

    refs = []
    for path in rir_dumps:
        log(f"pipeline: parsing RIR references from {path}")
        if not path.exists():
            log(f"pipeline: missing RIR dump {path}, skipping")
            continue
        refs.extend(
            parse_rir_dump(
                path.read_text(encoding="utf-8", errors="replace"), source=str(path)
            )
        )
    refs = dedupe_refs(refs)
    log(f"pipeline: discovered {len(refs)} unique inetnum -> geofeed references")

    results = await fetch_all(
        refs,
        HttpCache(cache_dir),
        concurrency=concurrency,
        client=fetch_client,
    )
    raw_rows = [row for result in results for row in result.rows]
    fetched_at_by_url = {result.url: result.fetched_at for result in results}

    direct_rows = []
    direct_failures: list[FailureRecord] = []
    for rir, url, path in direct_inputs:
        log(f"pipeline: loading direct geofeed {rir} from {path}")
        fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
        if not path.exists():
            direct_failures.append(
                FailureRecord(
                    url=url,
                    rir=rir,
                    refs=(),
                    error="missing_local_file",
                    stage="download",
                    fetched_at=fetched_at,
                )
            )
            continue
        parsed = parse_geofeed_file(path, url=url, rir=rir)
        if parsed.error is not None:
            direct_failures.append(
                FailureRecord(
                    url=url,
                    rir=rir,
                    refs=(),
                    error=parsed.error,
                    stage=parsed.stage or "parse",  # type: ignore[arg-type]
                    fetched_at=fetched_at,
                )
            )
            continue
        direct_rows.extend(parsed.rows)
        fetched_at_by_url[url] = fetched_at
    raw_rows.extend(direct_rows)
    log(f"pipeline: raw rows after direct feeds={len(raw_rows)} direct_rows={len(direct_rows)}")

    validator: BgpValidator | None
    if bgp_validator == "cymru":
        validator = CymruBulkBgpValidator()
    else:
        validator = None
    bgp_verdicts = {}
    if validator is not None:
        bgp_verdicts = await validator.validate_prefixes(row.prefix for row in raw_rows)

    log("pipeline: validating rows")
    signature_verdicts = _load_signature_verdicts(signature_verdicts_path)
    validated = validate_rows(
        raw_rows,
        fetched_at_by_url,
        bgp_verdicts=bgp_verdicts,
        signature_verdicts=signature_verdicts,
    )
    log(f"pipeline: validated rows={len(validated)}")

    failures = _collect_failures(results, direct_failures)
    status_records = _collect_status_records(results, direct_failures)
    final_stats = _build_stats(
        refs_count=len(refs),
        results=results,
        raw_row_count=len(raw_rows),
        direct_row_count=len(direct_rows),
        validated_count=len(validated),
        bgp_checked=len(bgp_verdicts),
        signature_checked=len(signature_verdicts),
        prepared_inputs=prepared_inputs,
    )

    _guard_against_empty_dataset(
        prepared_inputs=prepared_inputs,
        validated_count=len(validated),
        failure_count=len(failures),
    )

    log(f"pipeline: writing outputs to {out_dir}")
    write_outputs(
        validated,
        out_dir,
        stats=final_stats,
        failures=failures,
        previous_jsonl=previous_jsonl,
        source_details=prepared_inputs.source_details() if prepared_inputs is not None else (),
        status_records=status_records,
    )

    return final_stats


def _dedupe_direct_inputs(
    inputs: list[tuple[str, str, Path]],
) -> list[tuple[str, str, Path]]:
    """Avoid processing the same direct geofeed file twice.

    The CLI passes both the explicit path and the path carried by
    ``PreparedInputs`` for a successful direct source; only one load is needed.
    """
    seen: set[tuple[str, str]] = set()
    unique: list[tuple[str, str, Path]] = []
    for item in inputs:
        key = (item[1], str(item[2]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _collect_failures(
    results: list[FetchResult], direct_failures: list[FailureRecord]
) -> list[FailureRecord]:
    """One failure record per failed URL, retaining all of its references."""
    failures = [
        FailureRecord(
            url=result.url,
            rir=";".join(sorted({ref.rir for ref in result.refs})),
            refs=result.refs,
            error=result.error or "unknown_failure",
            stage=result.stage or "download",  # type: ignore[arg-type]
            fetched_at=result.fetched_at,
        )
        for result in results
        if result.status == "failed"
    ]
    return failures + direct_failures


def _collect_status_records(
    results: list[FetchResult], direct_failures: list[FailureRecord]
) -> list[FetchStatusRecord]:
    """Every attempted URL with its final conclusion (success, 304 or failure)."""
    records = [
        FetchStatusRecord(
            url=result.url,
            rir=";".join(sorted({ref.rir for ref in result.refs})),
            status=result.status,
            stage=result.stage,
            error=result.error,
            refs=len(result.refs),
            rows=len(result.rows),
            malformed_rows=result.malformed_rows,
            unmatched_rows=result.unmatched_rows,
            fetched_at=result.fetched_at,
        )
        for result in results
    ]
    records.extend(
        FetchStatusRecord(
            url=failure.url,
            rir=failure.rir,
            status="failed",
            stage=failure.stage,
            error=failure.error,
            refs=len(failure.refs),
            rows=0,
            malformed_rows=0,
            unmatched_rows=0,
            fetched_at=failure.fetched_at,
        )
        for failure in direct_failures
    )
    return sorted(records, key=lambda record: record.url)


def _build_stats(
    *,
    refs_count: int,
    results: list[FetchResult],
    raw_row_count: int,
    direct_row_count: int,
    validated_count: int,
    bgp_checked: int,
    signature_checked: int,
    prepared_inputs: PreparedInputs | None,
) -> dict[str, object]:
    fetched = sum(1 for result in results if result.status == "fetched")
    not_modified = sum(1 for result in results if result.status == "not_modified")
    failed = sum(1 for result in results if result.status == "failed")
    malformed_rows = sum(result.malformed_rows for result in results)
    unmatched_rows = sum(result.unmatched_rows for result in results)
    stats: dict[str, object] = {
        "refs": refs_count,
        "fetches": len(results),
        "fetched_urls": fetched,
        "not_modified_urls": not_modified,
        "failed_fetches": failed,
        "failed_downloads": sum(1 for r in results if r.status == "failed" and r.stage == "download"),
        "failed_parses": sum(1 for r in results if r.status == "failed" and r.stage == "parse"),
        "failed_validations": sum(1 for r in results if r.status == "failed" and r.stage == "validate"),
        "raw_rows": raw_row_count,
        "direct_rows": direct_row_count,
        "valid_rows": validated_count,
        "bgp_checked": bgp_checked,
        "signature_checked_urls": signature_checked,
        "malformed_geofeed_rows": malformed_rows,
        "unmatched_geofeed_rows": unmatched_rows,
    }
    if prepared_inputs is not None:
        stats.update(prepared_inputs.source_stats())
    return stats


def _guard_against_empty_dataset(
    *,
    prepared_inputs: PreparedInputs | None,
    validated_count: int,
    failure_count: int,
) -> None:
    if prepared_inputs is None or not prepared_inputs.all_bulk_failed or validated_count:
        return
    raise HarvestError(
        "all bulk RIR sources failed ("
        + ", ".join(source.name for source in prepared_inputs.bulk)
        + f") and no row survived validation ({failure_count} recorded failures); "
        "refusing to publish an empty dataset"
    )


def _load_signature_verdicts(path: Path | None) -> dict[str, bool]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    verdicts: dict[str, bool] = {}
    for url, value in payload.items():
        if isinstance(value, bool):
            verdicts[url] = value
        elif isinstance(value, dict):
            verdicts[url] = bool(value.get("signature_valid", value.get("valid", False)))
    return verdicts
