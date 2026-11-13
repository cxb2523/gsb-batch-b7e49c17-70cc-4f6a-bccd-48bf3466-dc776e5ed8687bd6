from __future__ import annotations

import ipaddress
from pathlib import Path

import httpx

from geofeed_harvester.fetch import HttpCache, fetch_all
from geofeed_harvester.models import InetnumRef

URL = "https://example.net/geofeed.csv"

GOOD_CSV = """\
# RFC 8805 sample
198.51.100.0/25, US, US-CA, Los Angeles, 90001
203.0.113.128/25, RU, RU-MOW, Moscow, 101000
not-a-prefix, US, US-NY, New York, 10001
"""


def _ref(inetnum: str, url: str = URL, rir: str = "RIPE") -> InetnumRef:
    return InetnumRef(
        rir=rir,
        inetnum=ipaddress.ip_network(inetnum),
        url=url,
        source="test",
    )


def _client(handler_map: dict[str, object]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        value = handler_map.get(str(request.url), httpx.Response(404))
        if isinstance(value, Exception):
            raise value
        return value

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


async def test_successful_fetch_parses_rows_and_skips_bad_csv_line(tmp_path: Path) -> None:
    client = _client({URL: httpx.Response(200, text=GOOD_CSV, headers={"etag": '"v1"'})})

    results = await fetch_all(
        [_ref("198.51.100.0/24"), _ref("203.0.113.0/24")],
        HttpCache(tmp_path / "cache"),
        client=client,
    )
    await client.aclose()

    assert len(results) == 1
    result = results[0]
    assert result.status == "fetched"
    assert result.error is None
    assert result.data_rows == 2
    assert result.malformed_rows == 1
    assert {str(row.prefix) for row in result.rows} == {
        "198.51.100.0/25",
        "203.0.113.128/25",
    }
    # Every referencing inetnum is retained on the result.
    assert len(result.refs) == 2
    # The body was cached for future conditional requests.
    assert (tmp_path / "cache").exists()


async def test_304_reuses_cached_body(tmp_path: Path) -> None:
    cache = HttpCache(tmp_path / "cache")
    refs = [_ref("198.51.100.0/24")]

    first_client = _client({URL: httpx.Response(200, text=GOOD_CSV, headers={"etag": '"v1"'})})
    first = await fetch_all(refs, cache, client=first_client)
    await first_client.aclose()
    assert first[0].status == "fetched"

    second_client = _client(
        {URL: httpx.Response(304, headers={"etag": '"v1"'})}
    )
    second = await fetch_all(refs, cache, client=second_client)
    await second_client.aclose()

    assert second[0].status == "not_modified"
    assert second[0].error is None
    assert len(second[0].rows) == 1
    assert second[0].data_rows == 2


async def test_304_without_cached_body_is_failure(tmp_path: Path) -> None:
    client = _client({URL: httpx.Response(304)})
    results = await fetch_all(
        [_ref("198.51.100.0/24")],
        HttpCache(tmp_path / "empty-cache"),
        client=client,
    )
    await client.aclose()

    assert results[0].status == "failed"
    assert results[0].error == "not_modified_without_cache"
    assert results[0].stage == "download"
    assert results[0].rows == ()


async def test_one_url_fails_while_others_succeed(tmp_path: Path) -> None:
    bad_url = "https://broken.example.net/geofeed.csv"
    refs = [
        # Same failing URL referenced by two inetnums: one failure, both refs kept.
        _ref("192.0.2.0/24", url=bad_url),
        _ref("192.0.2.0/25", url=bad_url),
        _ref("198.51.100.0/24", url=URL),
    ]
    client = _client(
        {
            bad_url: httpx.ConnectError("connection refused"),
            URL: httpx.Response(200, text=GOOD_CSV),
        }
    )

    results = await fetch_all(refs, HttpCache(tmp_path / "cache"), client=client)
    await client.aclose()

    assert len(results) == 2
    by_url = {result.url: result for result in results}
    failed = by_url[bad_url]
    assert failed.status == "failed"
    assert failed.stage == "download"
    assert "connection refused" in (failed.error or "")
    assert len(failed.refs) == 2
    assert len(by_url[URL].rows) == 1


async def test_http_error_status_is_download_failure(tmp_path: Path) -> None:
    client = _client({URL: httpx.Response(503)})
    results = await fetch_all(
        [_ref("198.51.100.0/24")],
        HttpCache(tmp_path / "cache"),
        client=client,
    )
    await client.aclose()

    assert results[0].status == "failed"
    assert results[0].stage == "download"
    assert results[0].error is not None and "503" in results[0].error


async def test_all_rows_outside_inetnum_is_validate_failure(tmp_path: Path) -> None:
    client = _client({URL: httpx.Response(200, text="198.51.100.0/24, US, US-CA, X, 90001\n")})
    results = await fetch_all(
        [_ref("203.0.113.0/24")],
        HttpCache(tmp_path / "cache"),
        client=client,
    )
    await client.aclose()

    assert results[0].status == "failed"
    assert results[0].stage == "validate"
    assert results[0].error == "no_rows_within_referenced_inetnum"


async def test_unparseable_document_is_parse_failure(tmp_path: Path) -> None:
    client = _client({URL: httpx.Response(200, text="garbage line without a prefix\n")})
    results = await fetch_all(
        [_ref("198.51.100.0/24")],
        HttpCache(tmp_path / "cache"),
        client=client,
    )
    await client.aclose()

    assert results[0].status == "failed"
    assert results[0].stage == "parse"
    assert results[0].error == "no_parseable_rows"
