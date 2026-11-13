from __future__ import annotations

import asyncio
import hashlib
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import httpx

from geofeed_harvester.logging import log
from geofeed_harvester.models import FetchResult, InetnumRef
from geofeed_harvester.parse import parse_geofeed

DEFAULT_USER_AGENT = "GeoFeed-Harvester/0.1 (+https://github.com/)"


class HttpCache:
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def headers_for(self, url: str) -> dict[str, str]:
        meta = self._meta_path(url)
        if not meta.exists():
            return {}
        headers: dict[str, str] = {}
        for line in meta.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition(":")
            if key == "etag" and value:
                headers["If-None-Match"] = value
            elif key == "last-modified" and value:
                headers["If-Modified-Since"] = value
        return headers

    def body_for(self, url: str) -> str | None:
        body = self._body_path(url)
        if not body.exists():
            return None
        return body.read_text(encoding="utf-8", errors="replace")

    def body_fetched_at(self, url: str) -> str | None:
        """When the cached body was originally written (provenance for 304s)."""
        body = self._body_path(url)
        if not body.exists():
            return None
        return datetime.fromtimestamp(body.stat().st_mtime, UTC).isoformat(timespec="seconds")

    def store(self, url: str, response: httpx.Response) -> None:
        self._body_path(url).write_bytes(response.content)
        etag = response.headers.get("etag", "")
        last_modified = response.headers.get("last-modified", "")
        self._meta_path(url).write_text(
            f"etag:{etag}\nlast-modified:{last_modified}\n",
            encoding="utf-8",
        )

    def _body_path(self, url: str) -> Path:
        return self.cache_dir / f"{_url_key(url)}.csv"

    def _meta_path(self, url: str) -> Path:
        return self.cache_dir / f"{_url_key(url)}.meta"


async def fetch_all(
    refs: Iterable[InetnumRef],
    cache: HttpCache,
    concurrency: int = 32,
    timeout: float = 20.0,
    client: httpx.AsyncClient | None = None,
) -> list[FetchResult]:
    """Fetch every unique geofeed URL referenced by ``refs`` exactly once.

    Each referenced URL produces one :class:`FetchResult` carrying all of its
    referencing inetnum records; a failure therefore yields a single failure
    record that still lists every reference. An optional pre-built ``client``
    lets tests (and callers) inject a transport without touching the network.
    """

    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    semaphore = asyncio.Semaphore(concurrency)
    headers = {"User-Agent": DEFAULT_USER_AGENT}

    refs_by_url: dict[str, list[InetnumRef]] = defaultdict(list)
    for ref in refs:
        refs_by_url[ref.url].append(ref)

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            http2=True,
            follow_redirects=True,
            limits=limits,
            headers=headers,
        )

    try:
        groups = [(url, tuple(group_refs)) for url, group_refs in refs_by_url.items()]
        ref_count = sum(len(group_refs) for _, group_refs in groups)
        log(f"fetch: starting {len(groups)} unique geofeed URL fetches for {ref_count} inetnum refs")
        tasks = [
            _fetch_one(client, cache, url, group_refs, semaphore, timeout)
            for url, group_refs in groups
        ]
        results: list[FetchResult] = []
        for index, task in enumerate(asyncio.as_completed(tasks), start=1):
            result = await task
            results.append(result)
            if index % 100 == 0 or index == len(tasks):
                failed = sum(1 for item in results if item.status == "failed")
                reused = sum(1 for item in results if item.status == "not_modified")
                rows = sum(len(item.rows) for item in results)
                log(
                    f"fetch: completed={index}/{len(tasks)} failed={failed} "
                    f"not_modified={reused} rows={rows}"
                )
        return results
    finally:
        if owns_client:
            await client.aclose()


async def _fetch_one(
    client: httpx.AsyncClient,
    cache: HttpCache,
    url: str,
    refs: tuple[InetnumRef, ...],
    semaphore: asyncio.Semaphore,
    timeout: float,
) -> FetchResult:
    fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
    if not url.lower().startswith("https://"):
        return FetchResult(
            url, refs, (), fetched_at, "failed", "non_https_url", stage="download"
        )

    async with semaphore:
        try:
            response = await client.get(url, headers=cache.headers_for(url), timeout=timeout)
        except Exception as exc:  # noqa: BLE001 - provenance keeps the failure detail
            return _failed(url, refs, fetched_at, exc, stage="download")

        if response.status_code == 304:
            return _reuse_cached(url, refs, fetched_at, cache)

        try:
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 - HTTP error status
            return _failed(url, refs, fetched_at, exc, stage="download")

        try:
            cache.store(url, response)
        except OSError as exc:
            log(f"fetch: cache write failed for {url}: {exc}")

    return _build_result(url, refs, fetched_at, response.text, "fetched")


def _reuse_cached(
    url: str, refs: tuple[InetnumRef, ...], fetched_at: str, cache: HttpCache
) -> FetchResult:
    cached = cache.body_for(url)
    if cached is None:
        # 304 says "unchanged", but there is no stored body to serve. That is a
        # failure, not an empty result: never emit a bogus "zero rows" success.
        return FetchResult(
            url,
            refs,
            (),
            fetched_at,
            "failed",
            "not_modified_without_cache",
            stage="download",
        )
    return _build_result(url, refs, fetched_at, cached, "not_modified", cache=cache)


def _build_result(
    url: str,
    refs: tuple[InetnumRef, ...],
    fetched_at: str,
    text: str,
    status: str,
    *,
    cache: HttpCache | None = None,
) -> FetchResult:
    if cache is not None:
        # For a 304 the body is older than this request; report when it was
        # originally stored so rows do not claim a misleading fetch time.
        body_time = cache.body_fetched_at(url)
        if body_time is not None:
            fetched_at = body_time
    parsed = parse_geofeed(text, url=url, refs=refs)
    if parsed.error is not None:
        return FetchResult(
            url,
            refs,
            parsed.rows,
            fetched_at,
            "failed",
            parsed.error,
            stage=parsed.stage or "parse",
            data_rows=parsed.data_rows,
            malformed_rows=parsed.malformed_rows,
            unmatched_rows=parsed.unmatched_rows,
        )
    return FetchResult(
        url,
        refs,
        parsed.rows,
        fetched_at,
        status,
        data_rows=parsed.data_rows,
        malformed_rows=parsed.malformed_rows,
        unmatched_rows=parsed.unmatched_rows,
    )


def _failed(
    url: str,
    refs: tuple[InetnumRef, ...],
    fetched_at: str,
    exc: Exception,
    *,
    stage: str,
) -> FetchResult:
    return FetchResult(
        url,
        refs,
        (),
        fetched_at,
        "failed",
        _describe_error(exc, stage),
        stage=stage,
    )


def _describe_error(exc: Exception, stage: str) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"http_{exc.response.status_code}: {exc}"
    if isinstance(exc, httpx.TimeoutException):
        return f"timeout: {exc}"
    if isinstance(exc, httpx.HTTPError):
        return f"http_error: {exc}"
    if isinstance(exc, OSError):
        return f"io_error: {exc}"
    return f"{stage}_error: {exc}"


def _url_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()
