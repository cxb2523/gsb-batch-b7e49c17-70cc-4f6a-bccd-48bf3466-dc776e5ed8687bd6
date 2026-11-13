from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from geofeed_harvester.errors import HarvestError
from geofeed_harvester.pipeline import run_harvest


GOOD_DIRECT_CSV = """\
# LACNIC geofeeds sample
200.1.0.0/24, BR, BR-SP, Sao Paulo, 01000-000
not-a-prefix, BR, BR-SP, Nowhere, 01000-000
"""

BULK_DUMP = """\
inetnum: 198.51.100.0/24
geofeed: https://example.net/geofeed.csv
source: RIPE

inetnum: 192.0.2.0/24
geofeed: https://broken.example.net/geofeed.csv
source: RIPE
"""

GOOD_GEOFEED = "198.51.100.0/25, US, US-CA, Los Angeles, 90001\nnot-a-prefix, US, US-NY, New York, 10001\n"


def _async_client(handler_map: dict[str, object]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        value = handler_map.get(str(request.url), httpx.Response(404))
        if isinstance(value, Exception):
            raise value
        return value

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


def _dump(tmp_path: Path) -> Path:
    path = tmp_path / "rir.txt"
    path.write_text(BULK_DUMP, encoding="utf-8")
    return path


async def test_run_records_per_url_status_and_failure_stage(tmp_path: Path) -> None:
    direct_path = tmp_path / "lacnic.csv"
    direct_path.write_text(GOOD_DIRECT_CSV, encoding="utf-8")
    client = _async_client(
        {
            "https://example.net/geofeed.csv": httpx.Response(200, text=GOOD_GEOFEED),
            "https://broken.example.net/geofeed.csv": httpx.ConnectError("unreachable"),
        }
    )

    stats = await run_harvest(
        rir_dump_paths=[_dump(tmp_path)],
        out_dir=tmp_path / "dist",
        cache_dir=tmp_path / "cache",
        direct_geofeed_paths=[("LACNIC", "https://lacnic.example/geofeeds", direct_path)],
        fetch_client=client,
    )
    await client.aclose()

    out = tmp_path / "dist"
    failed_csv = (out / "failed-geofeeds.csv").read_text(encoding="utf-8").splitlines()
    header = failed_csv[0].split(",")
    assert header == ["url", "rir", "inetnum_refs", "error", "fetched_at", "stage"]
    assert len(failed_csv) == 2  # one broken geofeed; direct file parsed fine
    assert "https://broken.example.net/geofeed.csv" in failed_csv[1]
    assert failed_csv[1].endswith("download")

    assert stats["fetches"] == 2
    assert stats["fetched_urls"] == 1
    assert stats["failed_fetches"] == 1
    assert stats["failed_downloads"] == 1
    assert stats["valid_rows"] == 2  # one from geofeed + one from LACNIC

    status_csv = (out / "fetch-status.csv").read_text(encoding="utf-8").splitlines()
    assert status_csv[0].split(",")[:3] == ["url", "rir", "status"]
    assert len(status_csv) == 3  # header + 2 URLs
    statuses = {line.split(",")[0]: line.split(",")[2] for line in status_csv[1:]}
    assert statuses == {
        "https://example.net/geofeed.csv": "fetched",
        "https://broken.example.net/geofeed.csv": "failed",
    }


async def test_duplicate_url_failure_listed_once_with_all_refs(tmp_path: Path) -> None:
    dump = tmp_path / "rir.txt"
    dump.write_text(
        """\
inetnum: 192.0.2.0/24
geofeed: https://broken.example.net/geofeed.csv
source: RIPE

inetnum: 192.0.2.0/25
geofeed: https://broken.example.net/geofeed.csv
source: RIPE
""",
        encoding="utf-8",
    )
    client = _async_client(
        {"https://broken.example.net/geofeed.csv": httpx.ConnectError("unreachable")}
    )

    stats = await run_harvest(
        rir_dump_paths=[dump],
        out_dir=tmp_path / "dist",
        cache_dir=tmp_path / "cache",
        fetch_client=client,
    )
    await client.aclose()

    rows = (tmp_path / "dist" / "failed-geofeeds.csv").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 2  # header + exactly one failure record for the URL
    assert "192.0.2.0/24;192.0.2.0/25" in rows[1]
    assert stats["refs"] == 2
    assert stats["failed_fetches"] == 1


async def test_all_bulk_sources_failed_raises_without_writing_dataset(tmp_path: Path) -> None:
    from geofeed_harvester.sources import PreparedInputs, SourceResult

    failed_sources = tuple(
        SourceResult(
            name=f"bulk-{index}",
            kind="bulk",
            rir="RIPE",
            url=f"https://bulk.example/{index}",
            status="failed",
            fetched_at="2026-01-01T00:00:00+00:00",
            error="connect_error",
            stage="download",
        )
        for index in range(2)
    )
    prepared = PreparedInputs(
        sources=failed_sources,
        normalized_rir_path=tmp_path / "normalized.txt",
    )
    (tmp_path / "normalized.txt").write_text("", encoding="utf-8")

    with pytest.raises(HarvestError, match="all bulk RIR sources failed"):
        await run_harvest(
            rir_dump_paths=[],
            out_dir=tmp_path / "dist",
            cache_dir=tmp_path / "cache",
            prepared_inputs=prepared,
        )

    assert not (tmp_path / "dist" / "geofeed.csv").exists()
    assert not (tmp_path / "dist" / "manifest.json").exists()


async def test_partial_bulk_failure_still_produces_dataset(tmp_path: Path) -> None:
    from geofeed_harvester.sources import PreparedInputs, SourceResult

    dump = _dump(tmp_path)
    sources = (
        SourceResult(
            name="bulk-failed",
            kind="bulk",
            rir="APNIC",
            url="https://bulk.example/failed",
            status="failed",
            fetched_at="2026-01-01T00:00:00+00:00",
            error="connect_error",
            stage="download",
        ),
        SourceResult(
            name="bulk-ok",
            kind="bulk",
            rir="RIPE",
            url="https://bulk.example/ok",
            status="downloaded",
            fetched_at="2026-01-01T00:00:00+00:00",
            records=2,
        ),
    )
    prepared = PreparedInputs(sources=sources, normalized_rir_path=dump)
    client = _async_client({"https://example.net/geofeed.csv": httpx.Response(200, text=GOOD_GEOFEED)})

    stats = await run_harvest(
        rir_dump_paths=[],
        out_dir=tmp_path / "dist",
        cache_dir=tmp_path / "cache",
        prepared_inputs=prepared,
        fetch_client=client,
    )
    await client.aclose()

    assert (tmp_path / "dist" / "manifest.json").exists()
    assert stats["bulk_sources"] == 2
    assert stats["bulk_sources_failed"] == 1
    assert stats["bulk_sources_ok"] == 1
    assert stats["valid_rows"] == 1


async def test_manifest_contains_per_source_counts(tmp_path: Path) -> None:
    import json

    from geofeed_harvester.sources import PreparedInputs, SourceResult

    dump = _dump(tmp_path)
    sources = (
        SourceResult(
            name="ripe-inetnum",
            kind="bulk",
            rir="RIPE",
            url="https://bulk.example/a",
            status="not_modified",
            fetched_at="2026-01-01T00:00:00+00:00",
            records=1,
        ),
        SourceResult(
            name="afrinic-db",
            kind="bulk",
            rir="AFRINIC",
            url="https://bulk.example/b",
            status="failed",
            fetched_at="2026-01-01T00:00:00+00:00",
            error="timeout",
            stage="download",
        ),
    )
    prepared = PreparedInputs(sources=sources, normalized_rir_path=dump)
    client = _async_client({"https://example.net/geofeed.csv": httpx.Response(200, text=GOOD_GEOFEED)})
    await run_harvest(
        rir_dump_paths=[],
        out_dir=tmp_path / "dist",
        cache_dir=tmp_path / "cache",
        prepared_inputs=prepared,
        fetch_client=client,
    )
    await client.aclose()

    manifest = json.loads((tmp_path / "dist" / "manifest.json").read_text(encoding="utf-8"))
    stats = manifest["stats"]
    assert stats["bulk_sources"] == 2
    assert stats["bulk_sources_ok"] == 1
    assert stats["bulk_sources_failed"] == 1
    assert stats["bulk_sources_not_modified"] == 1
    assert stats["failures_by_stage"] == {"download": 1, "parse": 0, "validate": 0}
    # Per-source diagnostics are kept in the manifest alongside the counts.
    assert [source["name"] for source in manifest["sources"]] == ["ripe-inetnum", "afrinic-db"]
    failed_source = manifest["sources"][1]
    assert failed_source["status"] == "failed"
    assert failed_source["stage"] == "download"
    assert failed_source["error"] == "timeout"
