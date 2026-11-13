from __future__ import annotations

import ipaddress
import re
from collections.abc import Iterable

from geofeed_harvester.models import InetnumRef

GEOFEED_URL_RE = re.compile(r"https://[^\s<>\")']+", re.IGNORECASE)
RIR_KEYS = {"source", "rir"}
INETNUM_KEYS = {"inetnum", "inet6num", "netrange", "cidr"}
TEXT_KEYS = {"geofeed", "remarks", "remark", "comment", "comments", "public comments"}


def parse_rir_dump(text: str, default_rir: str = "UNKNOWN", source: str = "bulk") -> list[InetnumRef]:
    refs: list[InetnumRef] = []
    for record in _split_records(text):
        refs.extend(parse_rir_record(record, default_rir=default_rir, source=source))
    return refs


def parse_rir_record(
    lines: Iterable[str], default_rir: str = "UNKNOWN", source: str = "bulk"
) -> list[InetnumRef]:
    values: dict[str, list[str]] = {}
    for line in lines:
        if not line.strip() or line.lstrip().startswith(("#", "%")):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values.setdefault(key.strip().lower(), []).append(value.strip())

    rir = _first(values, RIR_KEYS) or default_rir
    inetnums = [
        network for key in INETNUM_KEYS for v in values.get(key, []) for network in _parse_networks(v)
    ]
    urls = {
        url.rstrip(".,;")
        for key in TEXT_KEYS
        for value in values.get(key, [])
        for url in GEOFEED_URL_RE.findall(value)
    }

    refs: list[InetnumRef] = []
    for inetnum in inetnums:
        for url in urls:
            refs.append(InetnumRef(rir=rir.upper(), inetnum=inetnum, url=url, source=source))
    return refs


def dedupe_refs(refs: Iterable[InetnumRef]) -> list[InetnumRef]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[InetnumRef] = []
    for ref in refs:
        key = (str(ref.inetnum), ref.url, ref.rir)
        if key not in seen:
            seen.add(key)
            unique.append(ref)
    return unique


def _split_records(text: str) -> Iterable[list[str]]:
    record: list[str] = []
    for line in text.splitlines():
        if line.strip():
            record.append(line)
        elif record:
            yield record
            record = []
    if record:
        yield record


def _first(values: dict[str, list[str]], keys: set[str]) -> str | None:
    for key in keys:
        if values.get(key):
            return values[key][0]
    return None


def _parse_networks(value: str):
    value = value.strip()
    if " - " in value:
        start, end = [part.strip() for part in value.split(" - ", 1)]
        return _range_to_network(start, end)
    try:
        return [ipaddress.ip_network(value, strict=False)]
    except ValueError:
        return []


def _range_to_network(start: str, end: str):
    try:
        return list(
            ipaddress.summarize_address_range(ipaddress.ip_address(start), ipaddress.ip_address(end))
        )
    except ValueError:
        return []
