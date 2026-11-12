"""Reusable client library for the website-crawler-api skill.

Wraps the three Scavio Extract operations described in
``skills/website-crawler-api/SKILL.md``:

- **Map**   -- ``POST /api/v1/extract/map`` (synchronous, 1 credit)
- **Crawl** -- ``POST /api/v1/extract/crawl`` + status polling (202 job)
- **Batch** -- ``POST /api/v1/extract/batch`` + status polling (202 job)

Billing semantics implemented here (mirroring the skill docs):

- A crawl/batch POST that returns ``202`` has only handed back a job id;
  ``credits_used`` is 0 at that point.
- Only ``succeeded`` pages are billed: 1 credit/page on ``normal`` and
  ``advanced``, 2 credits/page on ``ultra``. ``failed`` and ``skipped``
  pages cost 0.
- Progress is polled with ``include_content=false`` (free, lightweight);
  page content is fetched only after the job reaches a terminal status
  (``completed`` / ``failed`` / ``cancelled``).
- ``stopped_reason`` (``max_pages``, ``insufficient_credits``,
  ``time_limit``, ``storage_limit``, ``cancelled``) is exposed verbatim
  and never rewritten as success.
- Batch ``invalid_urls`` were never billed and are reported separately,
  never counted as succeeded pages. If every URL is invalid the POST is
  a 400 and no job exists -- reported as :class:`BatchNotCreated`.
- Every crawl/batch POST carries an ``Idempotency-Key`` (auto-generated
  when the caller does not supply one); the same key within 24 hours
  reuses the original job instead of starting -- and billing -- a new
  one.
- When a job stops with ``insufficient_credits`` the pages already
  fetched are kept and a top-up link (``billing_url``) is surfaced.

This module depends only on the Python standard library.
"""

from __future__ import annotations

import json
import os
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

DEFAULT_BASE_URL = "https://api.scavio.dev"
#: Fallback top-up link when a job stops on insufficient credits and the
#: API response did not carry its own ``billing_url``.
DEFAULT_BILLING_URL = "https://dashboard.scavio.dev/billing"

#: Job statuses after which no further progress will happen.
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})

#: Reasons a job may end early, passed through verbatim in reports.
KNOWN_STOPPED_REASONS = frozenset(
    {"max_pages", "insufficient_credits", "time_limit", "storage_limit", "cancelled"}
)

#: Credits charged per *succeeded* page, by mode.
CREDITS_PER_PAGE = {"normal": 1, "advanced": 1, "ultra": 2}

#: How long the API honours an Idempotency-Key (documented: 24 hours).
IDEMPOTENCY_KEY_TTL_SECONDS = 24 * 3600


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def _find_billing_url(body: Any) -> Optional[str]:
    if not isinstance(body, dict):
        return None
    if isinstance(body.get("billing_url"), str):
        return body["billing_url"]
    err = body.get("error")
    if isinstance(err, dict) and isinstance(err.get("billing_url"), str):
        return err["billing_url"]
    return None


class ScavioError(Exception):
    """A non-2xx response from the API.

    Attributes:
        status: HTTP status code (None for transport-level failures).
        body: Parsed JSON error body, when available.
        billing_url: Top-up link, present on 402 responses and on
            plan-limit 400s.
        retry_after: Value of the ``Retry-After`` header, when present
            (429 responses).
    """

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        body: Any = None,
        retry_after: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body if isinstance(body, dict) else None
        self.billing_url = _find_billing_url(self.body)
        self.retry_after = retry_after


class BatchNotCreated(ScavioError):
    """Every URL in a batch POST was invalid: the API answered 400 and
    **no job was created**. Nothing was billed.

    ``invalid_urls`` lists ``{url, error}`` for each rejected URL.
    """

    def __init__(self, message: str, *, invalid_urls: List[Dict[str, Any]], body: Any = None) -> None:
        super().__init__(message, status=400, body=body)
        self.invalid_urls = list(invalid_urls)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class PageResult:
    """One page inside a crawl/batch job."""

    url: str
    status: str  # "succeeded" | "failed" | "skipped"
    credits: int = 0
    content: Optional[str] = None
    error: Optional[str] = None
    status_code: Optional[int] = None
    skip_reason: Optional[str] = None
    depth: Optional[int] = None
    truncated: bool = False

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"


@dataclass
class PageCounts:
    discovered: int = 0
    queued: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0


@dataclass
class MapResult:
    """Result of a synchronous map call (1 credit on normal mode)."""

    url: str
    links: List[Dict[str, Any]]
    total_found: int
    returned: int
    truncated: bool
    sitemaps_read: int
    credits_used: int
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class JobHandle:
    """A started (or idempotently reused) crawl/batch job.

    At this point ``credits_used`` is 0 -- billing happens page by page
    as the job runs.
    """

    kind: str  # "crawl" | "batch"
    job_id: str
    idempotency_key: str
    status_url: str
    mode: str = "normal"
    credits_per_page: int = 1
    urls_count: Optional[int] = None  # batch only
    invalid_urls: List[Dict[str, Any]] = field(default_factory=list)  # batch only
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class JobReport:
    """Terminal, honest summary of a crawl/batch job.

    ``ok`` is True only when the job completed with no ``stopped_reason``
    and no job-level error. A job that ended early (e.g.
    ``insufficient_credits``) keeps its succeeded pages but is *not*
    reported as a success.
    """

    job_id: str
    kind: str
    status: str  # terminal: "completed" | "failed" | "cancelled"
    stopped_reason: Optional[str]
    mode: str
    credits_per_page: int
    pages: PageCounts
    results: List[PageResult]
    invalid_urls: List[Dict[str, Any]]
    credits_used: int  # as reported by the API
    credits_from_pages: int  # summed from the per-page records
    credits_expected: int  # succeeded pages x credits_per_page
    billing_url: Optional[str]
    error: Optional[str]
    status_url: str
    idempotency_key: str
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "completed" and not self.stopped_reason and not self.error

    @property
    def succeeded_pages(self) -> List[PageResult]:
        return [p for p in self.results if p.status == "succeeded"]

    @property
    def failed_pages(self) -> List[PageResult]:
        return [p for p in self.results if p.status == "failed"]

    @property
    def skipped_pages(self) -> List[PageResult]:
        return [p for p in self.results if p.status == "skipped"]

    @property
    def credits_match(self) -> bool:
        """True when the API total, the per-page sum and the expected
        per-page price all agree."""
        return self.credits_used == self.credits_from_pages == self.credits_expected

    def summary(self) -> str:
        """Human-readable, honest one-paragraph summary."""
        parts = [f"{self.kind} {self.job_id}: {self.status}"]
        if self.stopped_reason:
            parts.append(f"stopped early (stopped_reason={self.stopped_reason!r})")
        parts.append(
            f"pages: {self.pages.succeeded} succeeded, {self.pages.failed} failed, "
            f"{self.pages.skipped} skipped of {self.pages.discovered} discovered"
        )
        parts.append(
            f"credits: {self.credits_used} used "
            f"(per-page sum {self.credits_from_pages}, "
            f"expected {self.credits_expected} at {self.credits_per_page}/page)"
        )
        if self.invalid_urls:
            parts.append(f"{len(self.invalid_urls)} invalid URL(s) rejected up front, never billed")
        if self.error:
            parts.append(f"error: {self.error}")
        if self.stopped_reason == "insufficient_credits" and self.billing_url:
            parts.append(f"top up credits at {self.billing_url} to finish the remaining pages")
        return "; ".join(parts)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class WebsiteCrawlerClient:
    """Client for the map / crawl / batch endpoints of the Extract API.

    Args:
        api_key: Scavio API key. Falls back to ``SCAVIO_API_KEY``.
        base_url: API base URL (point at a fake server in tests).
        poll_interval: Seconds between lightweight progress polls.
        request_timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        poll_interval: float = 2.0,
        request_timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("SCAVIO_API_KEY")
        if not self.api_key:
            raise ValueError(
                "no API key: pass api_key= or export SCAVIO_API_KEY "
                "(get one at https://scavio.dev)"
            )
        self.base_url = base_url.rstrip("/")
        self.poll_interval = poll_interval
        self.request_timeout = request_timeout

    # -- HTTP plumbing ------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        url = self.base_url + path
        if query:
            qs = urllib.parse.urlencode(
                {k: v for k, v in query.items() if v is not None}
            )
            if qs:
                url += "?" + qs
        data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.request_timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            try:
                body = json.loads(raw)
            except ValueError:
                body = None
            message = f"{method} {path} -> {exc.code}"
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict) and err.get("message"):
                    message += f": {err['message']}"
                elif isinstance(body.get("message"), str):
                    message += f": {body['message']}"
            raise ScavioError(
                message,
                status=exc.code,
                body=body,
                retry_after=exc.headers.get("Retry-After") if exc.headers else None,
            ) from exc

    # -- Map ----------------------------------------------------------------

    def map(self, url: str, **params: Any) -> MapResult:
        """List a site's URLs. Synchronous; costs 1 credit on normal mode."""
        resp = self._request("POST", "/api/v1/extract/map", json_body={"url": url, **params})
        data = resp.get("data", {})
        return MapResult(
            url=data.get("url", url),
            links=list(data.get("links", [])),
            total_found=data.get("total_found", 0),
            returned=data.get("returned", 0),
            truncated=bool(data.get("truncated", False)),
            sitemaps_read=data.get("sitemaps_read", 0),
            credits_used=resp.get("credits_used", 0),
            raw=resp,
        )

    # -- Job creation ---------------------------------------------------------

    @staticmethod
    def _new_idempotency_key(kind: str) -> str:
        return f"{kind}-{uuid.uuid4()}"

    def start_crawl(
        self,
        url: str,
        *,
        idempotency_key: Optional[str] = None,
        **params: Any,
    ) -> JobHandle:
        """Start a crawl job. Returns a handle; ``credits_used`` is 0 so far.

        An ``Idempotency-Key`` is always sent: pass your own to make a
        retry reuse the original job (24 h window), or let one be
        generated and read it back from ``handle.idempotency_key``.
        """
        key = idempotency_key or self._new_idempotency_key("crawl")
        resp = self._request(
            "POST",
            "/api/v1/extract/crawl",
            json_body={"url": url, **params},
            headers={"Idempotency-Key": key},
        )
        data = resp.get("data", {})
        return JobHandle(
            kind="crawl",
            job_id=data["id"],
            idempotency_key=key,
            status_url=data.get("status_url", ""),
            mode=data.get("mode", params.get("mode", "normal")),
            credits_per_page=data.get(
                "credits_per_page", CREDITS_PER_PAGE.get(params.get("mode", "normal"), 1)
            ),
            raw=resp,
        )

    def start_batch(
        self,
        urls: List[str],
        *,
        idempotency_key: Optional[str] = None,
        **params: Any,
    ) -> JobHandle:
        """Start a batch job over URLs you already have.

        ``handle.invalid_urls`` lists URLs the API rejected up front --
        they were never billed and are not part of the job. If *every*
        URL is invalid the API answers 400 and no job exists; that is
        raised as :class:`BatchNotCreated`.
        """
        key = idempotency_key or self._new_idempotency_key("batch")
        try:
            resp = self._request(
                "POST",
                "/api/v1/extract/batch",
                json_body={"urls": list(urls), **params},
                headers={"Idempotency-Key": key},
            )
        except ScavioError as exc:
            invalid = (exc.body or {}).get("invalid_urls")
            if exc.status == 400 and invalid is not None:
                raise BatchNotCreated(
                    f"batch job was not created: all {len(invalid)} URL(s) are invalid",
                    invalid_urls=invalid,
                    body=exc.body,
                ) from exc
            raise
        data = resp.get("data", {})
        return JobHandle(
            kind="batch",
            job_id=data["id"],
            idempotency_key=key,
            status_url=data.get("status_url", ""),
            mode=data.get("mode", params.get("mode", "normal")),
            credits_per_page=data.get(
                "credits_per_page", CREDITS_PER_PAGE.get(params.get("mode", "normal"), 1)
            ),
            urls_count=data.get("urls_count"),
            invalid_urls=list(data.get("invalid_urls", [])),
            raw=resp,
        )

    # -- Status / cancel ------------------------------------------------------

    def status(
        self,
        job: JobHandle,
        *,
        include_content: bool = False,
        status: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """One status read. Defaults to the lightweight
        ``include_content=false`` progress poll."""
        query: Dict[str, Any] = {
            "include_content": "true" if include_content else "false",
            "status": status,
            "cursor": cursor,
            "limit": limit,
        }
        resp = self._request(
            "GET", f"/api/v1/extract/{job.kind}/{job.job_id}", query=query
        )
        return resp.get("data", {})

    def cancel(self, job: JobHandle) -> Dict[str, Any]:
        """Cancel a running job. Stops billing immediately."""
        resp = self._request("DELETE", f"/api/v1/extract/{job.kind}/{job.job_id}")
        return resp.get("data", {})

    # -- Waiting / collecting ---------------------------------------------------

    def wait(
        self,
        job: JobHandle,
        *,
        poll_interval: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> JobReport:
        """Poll with ``include_content=false`` until the job reaches a
        terminal status, then fetch the page content and return an
        honest :class:`JobReport`."""
        interval = self.poll_interval if poll_interval is None else poll_interval
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            data = self.status(job, include_content=False)
            if data.get("status") in TERMINAL_STATUSES:
                break
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError(
                    f"job {job.job_id} still {data.get('status')!r} after {timeout}s"
                )
            time.sleep(interval)
        results = self._collect_results(job)
        return self._build_report(job, data, results)

    def _collect_results(self, job: JobHandle) -> List[PageResult]:
        """Page through every result (all statuses) with content."""
        results: List[PageResult] = []
        cursor: Optional[str] = None
        while True:
            data = self.status(job, include_content=True, limit=100, cursor=cursor)
            for item in data.get("results", []):
                results.append(
                    PageResult(
                        url=item.get("url", ""),
                        status=item.get("status", ""),
                        credits=item.get("credits", 0) or 0,
                        content=item.get("content"),
                        error=item.get("error"),
                        status_code=item.get("status_code"),
                        skip_reason=item.get("skip_reason"),
                        depth=item.get("depth"),
                        truncated=bool(item.get("truncated", False)),
                    )
                )
            cursor = data.get("next_cursor")
            if not cursor:
                return results

    def _build_report(
        self, job: JobHandle, data: Dict[str, Any], results: List[PageResult]
    ) -> JobReport:
        counts = data.get("pages", {}) or {}
        pages = PageCounts(
            discovered=counts.get("discovered", 0),
            queued=counts.get("queued", 0),
            succeeded=counts.get("succeeded", 0),
            failed=counts.get("failed", 0),
            skipped=counts.get("skipped", 0),
        )
        stopped_reason = data.get("stopped_reason")
        billing_url = data.get("billing_url")
        if not billing_url and stopped_reason == "insufficient_credits":
            billing_url = DEFAULT_BILLING_URL
        return JobReport(
            job_id=job.job_id,
            kind=job.kind,
            status=data.get("status", "unknown"),
            stopped_reason=stopped_reason,
            mode=data.get("mode", job.mode),
            credits_per_page=job.credits_per_page,
            pages=pages,
            results=results,
            invalid_urls=list(job.invalid_urls),
            credits_used=data.get("credits_used", 0),
            credits_from_pages=sum(p.credits for p in results),
            credits_expected=pages.succeeded * job.credits_per_page,
            billing_url=billing_url,
            error=data.get("error"),
            status_url=data.get("status_url", job.status_url),
            idempotency_key=job.idempotency_key,
            raw=data,
        )

    # -- One-call conveniences --------------------------------------------------

    def crawl(
        self,
        url: str,
        *,
        wait: bool = True,
        idempotency_key: Optional[str] = None,
        poll_interval: Optional[float] = None,
        timeout: Optional[float] = None,
        **params: Any,
    ) -> Any:
        """Start a crawl and (by default) wait for the terminal report."""
        handle = self.start_crawl(url, idempotency_key=idempotency_key, **params)
        if not wait:
            return handle
        return self.wait(handle, poll_interval=poll_interval, timeout=timeout)

    def batch(
        self,
        urls: List[str],
        *,
        wait: bool = True,
        idempotency_key: Optional[str] = None,
        poll_interval: Optional[float] = None,
        timeout: Optional[float] = None,
        **params: Any,
    ) -> Any:
        """Start a batch and (by default) wait for the terminal report."""
        handle = self.start_batch(urls, idempotency_key=idempotency_key, **params)
        if not wait:
            return handle
        return self.wait(handle, poll_interval=poll_interval, timeout=timeout)


__all__ = [
    "WebsiteCrawlerClient",
    "MapResult",
    "JobHandle",
    "JobReport",
    "PageResult",
    "PageCounts",
    "ScavioError",
    "BatchNotCreated",
    "DEFAULT_BASE_URL",
    "DEFAULT_BILLING_URL",
    "TERMINAL_STATUSES",
    "KNOWN_STOPPED_REASONS",
    "CREDITS_PER_PAGE",
    "IDEMPOTENCY_KEY_TTL_SECONDS",
]
