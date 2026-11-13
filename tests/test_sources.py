from __future__ import annotations

import gzip
from pathlib import Path

import httpx

from geofeed_harvester.sources import RPSL_BULK_SOURCES, prepare_inputs

SAMPLE_RECORD = """\
inetnum: 203.0.113.0/24
geofeed: https://example.net/geofeed.csv
source: RIPE
"""


def _gzip_bytes(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"))


def _bulk_client(handler_map: dict[str, object]) -> httpx.Client:
    """Build a sync client whose per-URL behaviour comes from ``handler_map``.

    Values may be ``bytes`` (200 response) or an ``httpx.Response`` / exception.
    URLs absent from the map return a valid gzip dump so the default scenario is
    "every source succeeds".
    """

    default_body = _gzip_bytes(SAMPLE_RECORD)

    def handler(request: httpx.Request) -> httpx.Response:
        value = handler_map.get(str(request.url), default_body)
        if isinstance(value, Exception):
            raise value
        if isinstance(value, httpx.Response):
            return value
        return httpx.Response(200, content=value)

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def test_bulk_source_failure_does_not_abort_run(tmp_path: Path) -> None:
    bulk_url = RPSL_BULK_SOURCES[0].url
    ok_url = RPSL_BULK_SOURCES[1].url
    client = _bulk_client(
        {
            bulk_url: httpx.ConnectError("bulk host unreachable"),
            ok_url: _gzip_bytes(SAMPLE_RECORD),
        }
    )

    prepared = prepare_inputs(
        raw_dir=tmp_path / "bulk",
        normalized_rir_path=tmp_path / "normalized.txt",
        direct_geofeed_dir=tmp_path / "direct",
        include_lacnic=False,
        client=client,
    )
    client.close()

    states = {source.name: source for source in prepared.sources}
    assert states["ripe-inetnum"].status == "failed"
    assert states["ripe-inetnum"].stage == "download"
    assert "bulk host unreachable" in (states["ripe-inetnum"].error or "")
    # The later source was still processed and contributed records.
    assert states["ripe-inet6num"].status == "downloaded"
    assert states["ripe-inet6num"].records == 1
    assert prepared.normalized_records == 4
    assert prepared.bulk_attempted == len(RPSL_BULK_SOURCES)
    assert prepared.bulk_succeeded == len(RPSL_BULK_SOURCES) - 1
    assert prepared.bulk_failed == 1
    assert prepared.all_bulk_failed is False


def test_direct_source_failure_is_recorded(tmp_path: Path) -> None:
    from geofeed_harvester.sources import DIRECT_GEOFEED_SOURCES

    client = _bulk_client(
        {DIRECT_GEOFEED_SOURCES[0].url: httpx.ConnectError("lacnic down")}
    )

    prepared = prepare_inputs(
        raw_dir=tmp_path / "bulk",
        normalized_rir_path=tmp_path / "normalized.txt",
        direct_geofeed_dir=tmp_path / "direct",
        include_lacnic=True,
        client=client,
    )
    client.close()

    direct = {source.name: source for source in prepared.direct}
    assert direct["lacnic-geofeeds"].status == "failed"
    assert prepared.direct_failed == 1
    assert prepared.direct_geofeed_paths == ()


def test_all_bulk_sources_failed(tmp_path: Path) -> None:
    client = _bulk_client(
        {source.url: httpx.ConnectError("down") for source in RPSL_BULK_SOURCES}
    )

    prepared = prepare_inputs(
        raw_dir=tmp_path / "bulk",
        normalized_rir_path=tmp_path / "normalized.txt",
        direct_geofeed_dir=tmp_path / "direct",
        include_lacnic=False,
        client=client,
    )
    client.close()

    assert prepared.bulk_attempted == len(RPSL_BULK_SOURCES)
    assert prepared.bulk_failed == len(RPSL_BULK_SOURCES)
    assert prepared.bulk_succeeded == 0
    assert prepared.all_bulk_failed is True
    stats = prepared.source_stats()
    assert stats["bulk_sources"] == len(RPSL_BULK_SOURCES)
    assert stats["bulk_sources_failed"] == len(RPSL_BULK_SOURCES)
    assert stats["bulk_sources_ok"] == 0
    assert all(source.stage == "download" for source in prepared.failed)


def test_bulk_304_without_cached_body_is_failure(tmp_path: Path) -> None:
    client = _bulk_client(
        {RPSL_BULK_SOURCES[0].url: httpx.Response(304)}
    )

    prepared = prepare_inputs(
        raw_dir=tmp_path / "bulk",
        normalized_rir_path=tmp_path / "normalized.txt",
        direct_geofeed_dir=tmp_path / "direct",
        include_lacnic=False,
        client=client,
    )
    client.close()

    first = prepared.sources[0]
    assert first.status == "failed"
    assert first.error == "not_modified_without_cache"
    # No partial archive should be left behind.
    assert not (tmp_path / "bulk" / "ripe-inetnum.gz").exists()


def test_corrupt_bulk_archive_records_parse_failure_and_keeps_other_sources(
    tmp_path: Path,
) -> None:
    client = _bulk_client({RPSL_BULK_SOURCES[0].url: b"this is not gzip data"})

    prepared = prepare_inputs(
        raw_dir=tmp_path / "bulk",
        normalized_rir_path=tmp_path / "normalized.txt",
        direct_geofeed_dir=tmp_path / "direct",
        include_lacnic=False,
        client=client,
    )
    client.close()

    states = {source.name: source for source in prepared.sources}
    assert states["ripe-inetnum"].status == "failed"
    assert states["ripe-inetnum"].stage == "parse"
    # The corrupt source contributed no records; the rest still did.
    assert prepared.normalized_records == 4 * 1
    assert (
        (tmp_path / "normalized.txt").read_text(encoding="utf-8").count("geofeed:")
        == 4
    )
    assert not (tmp_path / "bulk" / "ripe-inetnum.records.tmp").exists()
