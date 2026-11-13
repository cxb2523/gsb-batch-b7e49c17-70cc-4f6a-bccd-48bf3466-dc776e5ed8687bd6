from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from geofeed_harvester.models import InetnumRef

GEOFEED_URL_RE = re.compile(r"https://[^\s<>\")']+", re.IGNORECASE)


class RateLimitedRdapClient:
    """RDAP fallback client with per-host pacing and persistent response cache."""

    def __init__(
        self,
        cache_dir: Path,
        min_interval_seconds: float = 2.0,
        timeout: float = 20.0,
    ):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.min_interval_seconds = min_interval_seconds
        self.timeout = timeout
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_request_at: dict[str, float] = {}

    async def get_json(self, url: str) -> dict:
        cache_path = self._cache_path(url)
        if cache_path.exists():
            return json.loads(cache_path.read_text(encoding="utf-8"))

        host = urlparse(url).netloc
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            await self._pace(host)
            async with httpx.AsyncClient(follow_redirects=True, timeout=self.timeout) as client:
                response = await client.get(url, headers={"Accept": "application/rdap+json"})
                response.raise_for_status()
                payload = response.json()
            cache_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
            self._last_request_at[host] = time.monotonic()
            return payload

    async def _pace(self, host: str) -> None:
        last = self._last_request_at.get(host)
        if last is None:
            return
        elapsed = time.monotonic() - last
        if elapsed < self.min_interval_seconds:
            await asyncio.sleep(self.min_interval_seconds - elapsed)

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"


async def discover_arin_rdap_refs(
    seed_path: Path,
    cache_dir: Path,
    max_queries: int = 100,
) -> list[InetnumRef]:
    """Discover ARIN geofeed URLs for an explicit seed list of IPs/prefixes.

    This is intentionally not a scanner. The seed file must list addresses or
    prefixes that the operator wants to enrich, one per line.
    """
    if not seed_path.exists():
        return []

    seeds = [
        line.strip()
        for line in seed_path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ][:max_queries]
    client = RateLimitedRdapClient(cache_dir=cache_dir)
    refs: list[InetnumRef] = []
    for seed in seeds:
        network = ipaddress.ip_network(seed, strict=False)
        lookup_ip = network.network_address
        payload = await client.get_json(f"https://rdap.arin.net/registry/ip/{lookup_ip}")
        urls = sorted(set(GEOFEED_URL_RE.findall(json.dumps(payload))))
        cidr = _network_from_rdap(payload) or network
        for url in urls:
            refs.append(InetnumRef(rir="ARIN", inetnum=cidr, url=url.rstrip(".,;"), source="arin-rdap"))
    return refs


def _network_from_rdap(payload: dict) -> ipaddress.IPv4Network | ipaddress.IPv6Network | None:
    start = payload.get("startAddress")
    end = payload.get("endAddress")
    if not start or not end:
        return None
    try:
        networks = list(
            ipaddress.summarize_address_range(ipaddress.ip_address(start), ipaddress.ip_address(end))
        )
    except ValueError:
        return None
    return networks[0] if len(networks) == 1 else None
