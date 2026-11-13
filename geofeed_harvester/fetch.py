from __future__ import annotations

import asyncio
import csv
import hashlib
import ipaddress
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from geofeed_harvester.logging import log
from geofeed_harvester.models import InetnumRef, RawGeofeedRow


@dataclass(frozen=True)
class FetchResult:
    url: str
    refs: tuple[InetnumRef, ...]
    rows: tuple[RawGeofeedRow, ...]
    fetched_at: str
    status: str
    error: str | None = None


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
            if key == "etag":
                headers["If-None-Match"] = value
            elif key == "last-modified":
                headers["If-Modified-Since"] = value
        return headers

    def body_for(self, url: str) -> str | None:
        body = self._body_path(url)
        if not body.exists():
            return None
        return body.read_text(encoding="utf-8", errors="replace")

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
) -> list[FetchResult]:
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    semaphore = asyncio.Semaphore(concurrency)
    headers = {"User-Agent": "GeoFeed-Harvester/0.1 (+https://github.com/)"}
    refs_by_url: dict[str, list[InetnumRef]] = defaultdict(list)
    for ref in refs:
        refs_by_url[ref.url].append(ref)

    async with httpx.AsyncClient(
        http2=True,
        follow_redirects=True,
        limits=limits,
        headers=headers,
    ) as client:
        groups = [(url, tuple(group_refs)) for url, group_refs in refs_by_url.items()]
        ref_count = sum(len(group_refs) for _, group_refs in groups)
        log(f"fetch: starting {len(groups)} unique geofeed URL fetches for {ref_count} inetnum refs")
        tasks = [_fetch_one(client, cache, url, group_refs, semaphore, timeout) for url, group_refs in groups]
        results: list[FetchResult] = []
        for index, task in enumerate(asyncio.as_completed(tasks), start=1):
            result = await task
            results.append(result)
            if index % 100 == 0 or index == len(tasks):
                failed = sum(1 for item in results if item.status == "failed")
                rows = sum(len(item.rows) for item in results)
                log(f"fetch: completed={index}/{len(tasks)} failed={failed} rows={rows}")
        return results


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
        return FetchResult(url, refs, (), fetched_at, "failed", "non_https_url")

    async with semaphore:
        try:
            response = await client.get(url, headers=cache.headers_for(url), timeout=timeout)
            if response.status_code == 304:
                cached = cache.body_for(url)
                if cached is None:
                    return FetchResult(url, refs, (), fetched_at, "failed", "not_modified_without_cache")
                return FetchResult(url, refs, tuple(_parse_csv(refs, url, cached)), fetched_at, "not_modified")
            response.raise_for_status()
            cache.store(url, response)
            return FetchResult(url, refs, tuple(_parse_csv(refs, url, response.text)), fetched_at, "fetched")
        except Exception as exc:  # noqa: BLE001 - provenance should retain fetch failure detail.
            return FetchResult(url, refs, (), fetched_at, "failed", str(exc))


def _parse_csv(refs: tuple[InetnumRef, ...], url: str, text: str) -> list[RawGeofeedRow]:
    rows: list[RawGeofeedRow] = []
    reader = csv.reader(text.splitlines())
    for row in reader:
        if not row or row[0].strip().startswith("#"):
            continue
        padded = [*row, "", "", "", ""]
        prefix_raw, country, region, city, postal_code = [item.strip() for item in padded[:5]]
        try:
            prefix = ipaddress.ip_network(prefix_raw, strict=False)
        except ValueError:
            continue
        for ref in refs:
            if prefix.version != ref.inetnum.version or not prefix.subnet_of(ref.inetnum):
                continue
            rows.append(
                RawGeofeedRow(
                    prefix=prefix,
                    country=country.upper(),
                    region=region,
                    city=city,
                    postal_code=postal_code,
                    url=url,
                    inetnum=ref.inetnum,
                    rir=ref.rir,
                )
            )
    return rows


def _url_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()
