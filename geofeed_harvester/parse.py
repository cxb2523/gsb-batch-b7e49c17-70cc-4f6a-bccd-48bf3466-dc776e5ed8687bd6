from __future__ import annotations

import csv
import ipaddress
from dataclasses import dataclass, field
from pathlib import Path

from geofeed_harvester.models import InetnumRef, IPNetwork, RawGeofeedRow

# Characters that some RIR/operator exports put in front of the first cell.
_BOM = "﻿"


@dataclass(frozen=True)
class ParsedGeofeed:
    """Result of parsing one geofeed document.

    ``data_rows`` counts records that looked like geofeed rows (a valid prefix
    plus at least one more populated column). ``malformed_rows`` counts records
    rejected as unreadable. Keeping both counters lets the pipeline distinguish
    an empty geofeed (legitimately no data) from a document that was fetched but
    could not be parsed into anything usable.
    """

    rows: tuple[RawGeofeedRow, ...] = ()
    data_rows: int = 0
    malformed_rows: int = 0
    unmatched_rows: int = 0
    error: str | None = None
    stage: str | None = None
    malformed_samples: tuple[str, ...] = field(default_factory=tuple)


def parse_geofeed(
    text: str,
    *,
    url: str,
    refs: tuple[InetnumRef, ...] | None,
    rir: str | None = None,
) -> ParsedGeofeed:
    """Parse RFC 8805 CSV text for a single geofeed URL.

    ``refs`` are the inetnum records that reference this URL. When ``refs`` is
    ``None`` the feed is treated as self-referencing (direct sources such as the
    LACNIC Geofeeds Service, where every prefix is its own inetnum).

    Rows whose prefix is not inside any referencing inetnum are counted as
    ``unmatched_rows`` and are not emitted; if all rows are unmatched the
    document is reported as a ``validate``-stage failure instead of silently
    yielding zero rows.
    """

    rows: list[RawGeofeedRow] = []
    data_rows = 0
    malformed_rows = 0
    unmatched_rows = 0
    malformed_samples: list[str] = []

    try:
        for record in csv.reader(text.splitlines()):
            if not record:
                continue
            first = record[0].lstrip(_BOM).strip()
            if not first or first.startswith("#"):
                continue

            cells = [item.strip() for item in record]
            prefix_raw = cells[0].lstrip(_BOM).strip()
            try:
                prefix = ipaddress.ip_network(prefix_raw, strict=False)
            except ValueError:
                malformed_rows += 1
                _sample(malformed_samples, cells)
                continue
            if len([cell for cell in cells if cell]) < 2:
                malformed_rows += 1
                _sample(malformed_samples, cells)
                continue

            data_rows += 1
            padded = [*cells, "", "", "", ""]
            country, region, city, postal_code = padded[1:5]
            matched = _rows_for_refs(
                prefix,
                country.upper(),
                region,
                city,
                postal_code,
                url=url,
                refs=refs,
                rir=rir,
            )
            if not matched:
                unmatched_rows += 1
                continue
            rows.extend(matched)
    except (csv.Error, ValueError) as exc:
        return ParsedGeofeed(error=f"csv_parse_error: {exc}", stage="parse")

    if data_rows == 0 and malformed_rows:
        # Every record that looked like data was unreadable: the fetch itself
        # worked, but nothing could be parsed, so this is a parse failure.
        return ParsedGeofeed(
            malformed_rows=malformed_rows,
            error="no_parseable_rows",
            stage="parse",
            malformed_samples=tuple(malformed_samples),
        )

    if data_rows == 0:
        # A genuinely empty feed (blank lines / comments only) is a successful
        # fetch with zero rows: "there is no data", not "the fetch failed".
        return ParsedGeofeed(
            malformed_rows=malformed_rows,
            malformed_samples=tuple(malformed_samples),
        )

    if refs is not None and not rows:
        return ParsedGeofeed(
            data_rows=data_rows,
            malformed_rows=malformed_rows,
            unmatched_rows=unmatched_rows,
            error="no_rows_within_referenced_inetnum",
            stage="validate",
            malformed_samples=tuple(malformed_samples),
        )

    # Partial validity is fine: usable rows are kept and malformed/ unparseable
    # records are only counted, so one bad CSV line cannot fail the whole feed.
    return ParsedGeofeed(
        rows=tuple(rows),
        data_rows=data_rows,
        malformed_rows=malformed_rows,
        unmatched_rows=unmatched_rows,
        malformed_samples=tuple(malformed_samples),
    )


def parse_geofeed_file(path: Path, *, url: str, rir: str) -> ParsedGeofeed:
    return parse_geofeed(
        path.read_text(encoding="utf-8", errors="replace"),
        url=url,
        refs=None,
        rir=rir,
    )


def _rows_for_refs(
    prefix: IPNetwork,
    country: str,
    region: str,
    city: str,
    postal_code: str,
    *,
    url: str,
    refs: tuple[InetnumRef, ...] | None,
    rir: str | None,
) -> list[RawGeofeedRow]:
    if refs is None:
        return [
            RawGeofeedRow(
                prefix=prefix,
                country=country,
                region=region,
                city=city,
                postal_code=postal_code,
                url=url,
                inetnum=prefix,
                rir=rir or "UNKNOWN",
            )
        ]

    return [
        RawGeofeedRow(
            prefix=prefix,
            country=country,
            region=region,
            city=city,
            postal_code=postal_code,
            url=url,
            inetnum=ref.inetnum,
            rir=ref.rir,
        )
        for ref in refs
        if prefix.version == ref.inetnum.version and prefix.subnet_of(ref.inetnum)
    ]


def _sample(samples: list[str], cells: list[str]) -> None:
    if len(samples) < 5:
        samples.append(",".join(cells)[:200])
