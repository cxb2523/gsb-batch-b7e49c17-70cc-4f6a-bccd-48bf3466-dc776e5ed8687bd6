from __future__ import annotations

import csv
import gzip
from dataclasses import dataclass
from pathlib import Path

import httpx

from geofeed_harvester.logging import log
from geofeed_harvester.models import RawGeofeedRow

USER_AGENT = "GeoFeed-Harvester/0.1 (+https://github.com/)"


@dataclass(frozen=True)
class RpslBulkSource:
    rir: str
    name: str
    url: str


@dataclass(frozen=True)
class DirectGeofeedSource:
    rir: str
    name: str
    url: str


RPSL_BULK_SOURCES = [
    RpslBulkSource("RIPE", "ripe-inetnum", "https://ftp.ripe.net/ripe/dbase/split/ripe.db.inetnum.gz"),
    RpslBulkSource("RIPE", "ripe-inet6num", "https://ftp.ripe.net/ripe/dbase/split/ripe.db.inet6num.gz"),
    RpslBulkSource("APNIC", "apnic-inetnum", "https://ftp.apnic.net/apnic/whois/apnic.db.inetnum.gz"),
    RpslBulkSource("APNIC", "apnic-inet6num", "https://ftp.apnic.net/apnic/whois/apnic.db.inet6num.gz"),
    RpslBulkSource("AFRINIC", "afrinic-db", "https://ftp.afrinic.net/pub/dbase/afrinic.db.gz"),
]

DIRECT_GEOFEED_SOURCES = [
    DirectGeofeedSource("LACNIC", "lacnic-geofeeds", "https://milacnic.lacnic.net/lacnic/geofeeds"),
]


def prepare_inputs(
    raw_dir: Path,
    normalized_rir_path: Path,
    direct_geofeed_dir: Path,
    include_lacnic: bool = True,
) -> dict[str, int]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    normalized_rir_path.parent.mkdir(parents=True, exist_ok=True)
    direct_geofeed_dir.mkdir(parents=True, exist_ok=True)

    records = 0
    with normalized_rir_path.open("w", encoding="utf-8") as output:
        for source in RPSL_BULK_SOURCES:
            log(f"bulk: downloading {source.name} from {source.url}")
            archive_path = raw_dir / f"{source.name}.gz"
            _download(source.url, archive_path)
            log(f"bulk: extracting geofeed records from {source.name}")
            source_records = _write_matching_records(archive_path, output)
            records += source_records
            log(f"bulk: {source.name} yielded {source_records} geofeed records")

    direct_files = 0
    if include_lacnic:
        for source in DIRECT_GEOFEED_SOURCES:
            log(f"direct: downloading {source.name} from {source.url}")
            target = direct_geofeed_dir / f"{source.name}.csv"
            _download(source.url, target)
            direct_files += 1
            log(f"direct: downloaded {source.name}")

    return {
        "bulk_sources": len(RPSL_BULK_SOURCES),
        "normalized_records": records,
        "direct_geofeed_sources": direct_files,
    }


def load_direct_geofeed(path: Path, rir: str, url: str, fetched_at: str) -> list[RawGeofeedRow]:
    import ipaddress

    rows: list[RawGeofeedRow] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if not row or row[0].strip().startswith("#"):
                continue
            padded = [*row, "", "", "", ""]
            prefix_raw, country, region, city, postal_code = [item.strip() for item in padded[:5]]
            try:
                prefix = ipaddress.ip_network(prefix_raw, strict=False)
            except ValueError:
                continue
            rows.append(
                RawGeofeedRow(
                    prefix=prefix,
                    country=country.upper(),
                    region=region,
                    city=city,
                    postal_code=postal_code,
                    url=url,
                    inetnum=prefix,
                    rir=rir,
                )
            )
    return rows


def _download(url: str, target: Path) -> None:
    tmp = target.with_suffix(target.suffix + ".tmp")
    meta = target.with_suffix(target.suffix + ".meta")
    request_headers = {"User-Agent": USER_AGENT}
    if meta.exists() and target.exists():
        for line in meta.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition(":")
            if key == "etag" and value:
                request_headers["If-None-Match"] = value
            elif key == "last-modified" and value:
                request_headers["If-Modified-Since"] = value

    with httpx.stream(
        "GET",
        url,
        follow_redirects=True,
        timeout=120,
        headers=request_headers,
    ) as response:
        if response.status_code == 304:
            return
        response.raise_for_status()
        total = response.headers.get("content-length")
        if total:
            log(f"download: {url} content-length={total} bytes")
        downloaded = 0
        next_report = 50 * 1024 * 1024
        with tmp.open("wb") as fh:
            for chunk in response.iter_bytes():
                fh.write(chunk)
                downloaded += len(chunk)
                if downloaded >= next_report:
                    log(f"download: {url} downloaded={downloaded} bytes")
                    next_report += 50 * 1024 * 1024
    tmp.replace(target)
    log(f"download: saved {target}")
    meta.write_text(
        "\n".join(
            [
                f"etag:{response.headers.get('etag', '')}",
                f"last-modified:{response.headers.get('last-modified', '')}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def _write_matching_records(archive_path: Path, output) -> int:
    count = 0
    record: list[str] = []
    with gzip.open(archive_path, "rt", encoding="utf-8", errors="replace") as fh:
        lines = 0
        for line in fh:
            lines += 1
            if lines % 1_000_000 == 0:
                log(f"bulk: scanned {lines} lines in {archive_path.name}, matches={count}")
            if line.strip():
                record.append(line.rstrip("\n"))
                continue
            if _record_has_geofeed(record):
                output.write("\n".join(record))
                output.write("\n\n")
                count += 1
            record = []
    if _record_has_geofeed(record):
        output.write("\n".join(record))
        output.write("\n\n")
        count += 1
    return count


def _record_has_geofeed(record: list[str]) -> bool:
    text = "\n".join(record).lower()
    return "geofeed" in text and "https://" in text
