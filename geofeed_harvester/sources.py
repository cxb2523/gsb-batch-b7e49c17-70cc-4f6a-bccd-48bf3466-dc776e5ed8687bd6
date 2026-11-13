from __future__ import annotations

import gzip
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import httpx

from geofeed_harvester.logging import log
from geofeed_harvester.models import SourceKind, SourceResult

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


@dataclass(frozen=True)
class DownloadOutcome:
    status: Literal["downloaded", "not_modified", "failed"]
    error: str | None = None


@dataclass(frozen=True)
class PreparedInputs:
    """Outcome of the bulk/direct discovery input stage.

    Every source is attempted independently. A failed bulk download is recorded
    in ``sources`` and the remaining sources are still processed, so one broken
    host cannot abort the whole run.
    """

    sources: tuple[SourceResult, ...] = ()
    normalized_rir_path: Path | None = None
    direct_geofeed_paths: tuple[tuple[str, str, Path], ...] = ()

    @property
    def bulk(self) -> tuple[SourceResult, ...]:
        return tuple(source for source in self.sources if source.kind == "bulk")

    @property
    def direct(self) -> tuple[SourceResult, ...]:
        return tuple(source for source in self.sources if source.kind == "direct")

    @property
    def failed(self) -> tuple[SourceResult, ...]:
        return tuple(source for source in self.sources if source.status == "failed")

    @property
    def bulk_attempted(self) -> int:
        return len(self.bulk)

    @property
    def bulk_failed(self) -> int:
        return sum(1 for source in self.bulk if source.status == "failed")

    @property
    def bulk_succeeded(self) -> int:
        return sum(1 for source in self.bulk if source.status != "failed")

    @property
    def bulk_not_modified(self) -> int:
        return sum(1 for source in self.bulk if source.status == "not_modified")

    @property
    def direct_failed(self) -> int:
        return sum(1 for source in self.direct if source.status == "failed")

    @property
    def direct_succeeded(self) -> int:
        return sum(1 for source in self.direct if source.status != "failed")

    @property
    def all_bulk_failed(self) -> bool:
        return self.bulk_attempted > 0 and self.bulk_failed == self.bulk_attempted

    @property
    def normalized_records(self) -> int:
        return sum(source.records for source in self.bulk if source.status != "failed")

    def source_stats(self) -> dict[str, int]:
        """Per-source success/failure counts (all values are integers)."""
        return {
            "bulk_sources": self.bulk_attempted,
            "bulk_sources_ok": self.bulk_succeeded,
            "bulk_sources_failed": self.bulk_failed,
            "bulk_sources_not_modified": self.bulk_not_modified,
            "direct_geofeed_sources": len(self.direct),
            "direct_geofeed_sources_ok": self.direct_succeeded,
            "direct_geofeed_sources_failed": self.direct_failed,
            "normalized_records": self.normalized_records,
        }

    def source_details(self) -> list[dict[str, object]]:
        """One entry per input source for the manifest's diagnostics section."""
        return [
            {
                "name": source.name,
                "kind": source.kind,
                "rir": source.rir,
                "url": source.url,
                "status": source.status,
                "stage": source.stage,
                "error": source.error,
                "records": source.records,
                "fetched_at": source.fetched_at,
            }
            for source in self.sources
        ]


def prepare_inputs(
    raw_dir: Path,
    normalized_rir_path: Path,
    direct_geofeed_dir: Path,
    include_lacnic: bool = True,
    client: httpx.Client | None = None,
) -> PreparedInputs:
    """Download bulk RIR dumps and direct geofeed sources without crashing.

    Failures are captured per source in the returned :class:`PreparedInputs`.
    The caller decides whether the surviving inputs are enough to produce a
    dataset.
    """

    raw_dir.mkdir(parents=True, exist_ok=True)
    normalized_rir_path.parent.mkdir(parents=True, exist_ok=True)
    direct_geofeed_dir.mkdir(parents=True, exist_ok=True)

    sources: list[SourceResult] = []
    direct_paths: list[tuple[str, str, Path]] = []
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            follow_redirects=True,
            timeout=120,
            headers={"User-Agent": USER_AGENT},
        )

    try:
        with normalized_rir_path.open("w", encoding="utf-8") as output:
            for source in RPSL_BULK_SOURCES:
                log(f"bulk: downloading {source.name} from {source.url}")
                archive_path = raw_dir / f"{source.name}.gz"
                outcome = _download(client, source.url, archive_path)
                if outcome.status == "failed":
                    log(f"bulk: FAILED {source.name}: {outcome.error}")
                    sources.append(_source_result(source, "bulk", outcome))
                    continue
                if outcome.status == "not_modified":
                    log(f"bulk: cache reuse for {source.name}")

                log(f"bulk: extracting geofeed records from {source.name}")
                staged = raw_dir / f"{source.name}.records.tmp"
                try:
                    source_records = _write_matching_records(archive_path, staged)
                except Exception as exc:  # noqa: BLE001 - corrupt archive etc.
                    staged.unlink(missing_ok=True)
                    log(f"bulk: FAILED parsing {source.name}: {exc}")
                    sources.append(
                        _source_result(
                            source,
                            "bulk",
                            DownloadOutcome("failed", _describe_error(exc)),
                            stage="parse",
                        )
                    )
                    continue
                # Commit the source's records only after it parsed cleanly, so a
                # corrupt archive cannot leave a half-source in the dump.
                with staged.open("r", encoding="utf-8") as fh:
                    output.write(fh.read())
                staged.unlink(missing_ok=True)
                log(f"bulk: {source.name} yielded {source_records} geofeed records")
                sources.append(
                    _source_result(source, "bulk", outcome, records=source_records)
                )

        if include_lacnic:
            for source in DIRECT_GEOFEED_SOURCES:
                log(f"direct: downloading {source.name} from {source.url}")
                target = direct_geofeed_dir / f"{source.name}.csv"
                outcome = _download(client, source.url, target)
                if outcome.status == "failed":
                    log(f"direct: FAILED {source.name}: {outcome.error}")
                    sources.append(_source_result(source, "direct", outcome))
                    continue
                direct_paths.append((source.rir, source.url, target))
                sources.append(_source_result(source, "direct", outcome))
                log(f"direct: downloaded {source.name}")
    finally:
        if owns_client:
            client.close()

    return PreparedInputs(
        sources=tuple(sources),
        normalized_rir_path=normalized_rir_path,
        direct_geofeed_paths=tuple(direct_paths),
    )


def _download(client: httpx.Client, url: str, target: Path) -> DownloadOutcome:
    """Download ``url`` into ``target``.

    Returns a :class:`DownloadOutcome`. A 304 response with no local body is a
    failure rather than a silent success: there is nothing to serve downstream.
    """

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

    try:
        with client.stream("GET", url, headers=request_headers) as response:
            if response.status_code == 304:
                if not target.exists():
                    return DownloadOutcome("failed", "not_modified_without_cache")
                return DownloadOutcome("not_modified")
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
        if tmp.exists():
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
        return DownloadOutcome("downloaded")
    except Exception as exc:  # noqa: BLE001 - one source must not abort the run
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return DownloadOutcome("failed", _describe_error(exc))


def _source_result(
    source: RpslBulkSource | DirectGeofeedSource,
    kind: SourceKind,
    outcome: DownloadOutcome,
    *,
    records: int = 0,
    stage: str | None = None,
) -> SourceResult:
    return SourceResult(
        name=source.name,
        kind=kind,
        rir=source.rir,
        url=source.url,
        status=outcome.status,
        fetched_at=_now(),
        error=outcome.error,
        stage=(stage or ("download" if outcome.status == "failed" else None)),  # type: ignore[arg-type]
        records=records,
    )


def _describe_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"http_{exc.response.status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.HTTPError):
        return f"http_error: {exc}"
    if isinstance(exc, (gzip.BadGzipFile, EOFError, OSError)):
        return f"archive_error: {exc}"
    return f"{type(exc).__name__}: {exc}"


def _write_matching_records(archive_path: Path, target: Path) -> int:
    count = 0
    record: list[str] = []
    with (
        gzip.open(archive_path, "rt", encoding="utf-8", errors="replace") as fh,
        target.open("w", encoding="utf-8") as output,
    ):
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


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
