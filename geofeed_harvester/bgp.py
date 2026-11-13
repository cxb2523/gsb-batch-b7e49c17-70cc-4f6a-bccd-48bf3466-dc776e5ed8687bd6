from __future__ import annotations

import asyncio
import ipaddress
from dataclasses import dataclass
from typing import Iterable

from geofeed_harvester.logging import log
from geofeed_harvester.models import IPNetwork


@dataclass(frozen=True)
class CymruRoute:
    asn: str
    query_ip: str
    bgp_prefix: IPNetwork | None
    country: str
    registry: str
    allocated: str
    as_name: str


class BgpValidator:
    """Extension point for ASN-Signal-Graph or RouteSentinel prefix checks."""

    async def validate_prefixes(self, prefixes: Iterable[IPNetwork]) -> dict[IPNetwork, bool | None]:
        return {prefix: None for prefix in prefixes}


class CymruBulkBgpValidator(BgpValidator):
    """Bulk BGP announcement checks using Team Cymru IP-to-ASN WHOIS service.

    Team Cymru's public guidance is to use one bulk TCP/43 request for groups of
    addresses instead of many single WHOIS requests. This class batches probe IPs
    and never performs per-prefix network round trips.
    """

    def __init__(
        self,
        host: str = "whois.cymru.com",
        port: int = 43,
        batch_size: int = 500,
        timeout: float = 45.0,
        batch_delay: float = 0.25,
        max_empty_batches: int = 10,
    ):
        self.host = host
        self.port = port
        self.batch_size = batch_size
        self.timeout = timeout
        self.batch_delay = batch_delay
        self.max_empty_batches = max_empty_batches

    async def validate_prefixes(self, prefixes: Iterable[IPNetwork]) -> dict[IPNetwork, bool | None]:
        unique = list(dict.fromkeys(prefixes))
        probes = {_probe_ip(prefix): prefix for prefix in unique}
        routes: dict[str, CymruRoute] = {}
        unknown_probes: set[str] = set()

        batches = list(_chunks(list(probes), self.batch_size))
        log(f"bgp: Team Cymru checking {len(probes)} probe IPs in {len(batches)} batches")
        consecutive_empty_batches = 0
        for index, batch in enumerate(batches, start=1):
            if index == 1 or index % 25 == 0 or index == len(batches):
                log(f"bgp: Team Cymru batch {index}/{len(batches)} size={len(batch)}")
            batch_routes = await self._query_batch(batch)
            if batch_routes is None:
                unknown_probes.update(batch)
                consecutive_empty_batches += 1
                if consecutive_empty_batches <= 3 or consecutive_empty_batches == self.max_empty_batches:
                    log(f"bgp: Team Cymru batch {index}/{len(batches)} returned no usable response")
                if consecutive_empty_batches >= self.max_empty_batches:
                    remaining = [probe for later_batch in batches[index:] for probe in later_batch]
                    unknown_probes.update(remaining)
                    log(
                        "bgp: Team Cymru circuit breaker opened after "
                        f"{consecutive_empty_batches} consecutive empty batches; "
                        f"marking {len(remaining)} remaining probes as unknown"
                    )
                    break
            else:
                consecutive_empty_batches = 0
                routes.update(batch_routes)
            if self.batch_delay:
                await asyncio.sleep(self.batch_delay)
        log(f"bgp: Team Cymru returned {len(routes)} routes")

        verdicts: dict[IPNetwork, bool | None] = {}
        for probe, prefix in probes.items():
            if probe in unknown_probes:
                verdicts[prefix] = None
                continue
            route = routes.get(probe)
            if route is None or route.bgp_prefix is None:
                verdicts[prefix] = False
            else:
                verdicts[prefix] = prefix.subnet_of(route.bgp_prefix) or prefix.overlaps(route.bgp_prefix)
        return verdicts

    async def _query_batch(self, ips: list[str]) -> dict[str, CymruRoute] | None:
        if not ips:
            return {}

        writer = None
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=self.timeout,
            )
            payload = "\n".join(["begin", "verbose", *ips, "end", ""])
            writer.write(payload.encode("ascii"))
            await asyncio.wait_for(writer.drain(), timeout=self.timeout)
            if writer.can_write_eof():
                writer.write_eof()

            data = await asyncio.wait_for(reader.read(), timeout=self.timeout)
            if not data.strip():
                return None
            routes = parse_cymru_response(data.decode("utf-8", errors="replace"))
            return routes or None
        except Exception as exc:  # noqa: BLE001 - BGP confidence must fail open.
            log(f"bgp: Team Cymru request failed: {exc}")
            return None
        finally:
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:  # noqa: BLE001 - transport close errors do not affect parsed response.
                    pass


def parse_cymru_response(text: str) -> dict[str, CymruRoute]:
    routes: dict[str, CymruRoute] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("Bulk mode") or line.startswith("AS |"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 7:
            continue

        asn, query_ip, bgp_prefix, country, registry, allocated = parts[:6]
        as_name = "|".join(parts[6:]).strip()
        try:
            parsed_prefix = ipaddress.ip_network(bgp_prefix, strict=False)
        except ValueError:
            parsed_prefix = None
        routes[query_ip] = CymruRoute(
            asn=asn,
            query_ip=query_ip,
            bgp_prefix=parsed_prefix,
            country=country,
            registry=registry,
            allocated=allocated,
            as_name=as_name,
        )
    return routes


def _probe_ip(prefix: IPNetwork) -> str:
    if prefix.version == 4 and prefix.num_addresses > 2:
        return str(prefix.network_address + 1)
    return str(prefix.network_address)


def _chunks(items: list[str], size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]
