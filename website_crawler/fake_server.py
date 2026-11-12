"""A local fake of the Scavio Extract map/crawl/batch API.

Built for testing :mod:`website_crawler.client` without a real
``SCAVIO_API_KEY``. It simulates:

- ``202`` job creation for crawl/batch with ``credits_used: 0``
- status transitions ``queued -> running -> completed|failed|cancelled``
  (jobs advance one page per status poll by default)
- mixed ``succeeded`` / ``failed`` / ``skipped`` page results
- per-page billing: succeeded pages cost ``credits_per_page``
  (normal/advanced 1, ultra 2), failed and skipped cost 0
- batch ``invalid_urls`` in the ``202``, and a ``400`` with no job when
  every URL is invalid
- ``Idempotency-Key`` reuse within 24 hours (same key returns the
  original job instead of creating a second one)
- early stop with ``stopped_reason: "insufficient_credits"`` when the
  fake balance runs out, keeping already-fetched pages and exposing a
  ``billing_url``
- cancellation via ``DELETE`` (``409`` when the job already finished)
- ``401`` for a missing/wrong bearer token, ``404`` for unknown job ids

Usage::

    from website_crawler.fake_server import FakeScavioServer

    with FakeScavioServer(api_key="test-key", credits=100) as server:
        client = WebsiteCrawlerClient(api_key="test-key", base_url=server.base_url)
        ...

Test hooks:

- ``add_crawl_plan(start_url, pages)`` -- pages is a list of dicts like
  ``{"url": ..., "outcome": "succeeded"|"failed"|"skipped", ...}``.
- ``set_page_outcome(url, outcome, **extra)`` -- per-URL outcome for
  batch (and crawl) pages.
- ``credits`` -- mutable fake balance; when it drops below the job's
  per-page price the job stops with ``insufficient_credits``.
- ``jobs`` / ``request_log`` / ``idempotent_replays`` -- inspection.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

CREDITS_PER_PAGE = {"normal": 1, "advanced": 1, "ultra": 2}
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
IDEMPOTENCY_KEY_TTL_SECONDS = 24 * 3600


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _valid_url(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    parts = urllib.parse.urlparse(url)
    return parts.scheme in ("http", "https") and bool(parts.netloc)


class FakeScavioServer:
    def __init__(
        self,
        *,
        api_key: str = "sk_test_fake",
        credits: int = 1_000_000,
        pages_per_poll: int = 1,
        billing_url: str = "https://dashboard.scavio.dev/billing",
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        self.api_key = api_key
        self.credits = credits
        self.pages_per_poll = pages_per_poll
        self.billing_url = billing_url
        self.host = host
        self.port = port

        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.crawl_plans: Dict[str, List[Dict[str, Any]]] = {}
        self.map_plans: Dict[str, List[str]] = {}
        self.page_outcomes: Dict[str, Dict[str, Any]] = {}
        self.request_log: List[Dict[str, Any]] = []
        self.idempotent_replays = 0

        self._idempotency: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self.base_url: str = ""

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> str:
        handler = _make_handler(self)
        self._httpd = ThreadingHTTPServer((self.host, self.port), handler)
        self._httpd.daemon_threads = True
        self.port = self._httpd.server_address[1]
        self.base_url = f"http://{self.host}:{self.port}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self.base_url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> "FakeScavioServer":
        self.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop()

    # -- test hooks ----------------------------------------------------------

    def add_crawl_plan(self, start_url: str, pages: List[Dict[str, Any]]) -> None:
        """Pages a crawl of ``start_url`` will discover, in order."""
        self.crawl_plans[start_url] = list(pages)

    def add_map_plan(self, url: str, links: List[str]) -> None:
        self.map_plans[url] = list(links)

    def set_page_outcome(self, url: str, outcome: str, **extra: Any) -> None:
        self.page_outcomes[url] = {"outcome": outcome, **extra}

    # -- request dispatch ----------------------------------------------------

    def handle(
        self,
        method: str,
        path: str,
        query: Dict[str, List[str]],
        headers: Dict[str, str],
        body: Optional[Dict[str, Any]],
    ) -> Tuple[int, Dict[str, Any]]:
        with self._lock:
            self.request_log.append(
                {
                    "method": method,
                    "path": path,
                    "query": {k: list(v) for k, v in query.items()},
                    "idempotency_key": headers.get("idempotency-key"),
                    "body": body,
                }
            )
            if headers.get("authorization") != f"Bearer {self.api_key}":
                return 401, {"error": {"code": "unauthorized", "message": "Invalid or missing API key."}}

            parts = [p for p in path.split("/") if p]
            # /api/v1/extract/...
            if parts[:3] != ["api", "v1", "extract"]:
                return 404, {"error": {"code": "not_found", "message": f"Unknown path {path}"}}
            rest = parts[3:]

            if method == "POST" and rest == ["map"]:
                return self._post_map(body or {})
            if method == "POST" and rest == ["crawl"]:
                return self._post_job("crawl", body or {}, headers)
            if method == "POST" and rest == ["batch"]:
                return self._post_job("batch", body or {}, headers)
            if len(rest) == 2 and rest[0] in ("crawl", "batch"):
                kind, job_id = rest
                if method == "GET":
                    return self._get_status(kind, job_id, query)
                if method == "DELETE":
                    return self._delete_job(kind, job_id)
            return 404, {"error": {"code": "not_found", "message": f"Unknown path {path}"}}

    # -- map -----------------------------------------------------------------

    def _post_map(self, body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        if self.credits < 1:
            return 402, {
                "error": {
                    "code": "insufficient_credits",
                    "message": "Your balance is below the cost of one map (1 credit).",
                    "billing_url": self.billing_url,
                }
            }
        url = body.get("url", "")
        planned = self.map_plans.get(url)
        if planned is None:
            planned = [f"{url.rstrip('/')}/docs/page-{i}" for i in range(1, 4)]
        search = body.get("search")
        if search:
            words = search.lower().split()
            planned = [u for u in planned if all(w in u.lower() for w in words)]
        limit = int(body.get("limit", 1000))
        total = len(planned)
        links = [
            {"url": u, "source": "sitemap", "lastmod": "2026-11-01"}
            for u in planned[:limit]
        ]
        self.credits -= 1
        return 200, {
            "data": {
                "url": url,
                "links": links,
                "total_found": total,
                "returned": len(links),
                "truncated": len(links) < total,
                "sitemaps_read": 1,
            },
            "credits_used": 1,
        }

    # -- job creation ----------------------------------------------------------

    def _post_job(
        self, kind: str, body: Dict[str, Any], headers: Dict[str, str]
    ) -> Tuple[int, Dict[str, Any]]:
        key = headers.get("idempotency-key")
        if key:
            entry = self._idempotency.get(key)
            if entry and time.time() - entry["created_at"] < IDEMPOTENCY_KEY_TTL_SECONDS:
                self.idempotent_replays += 1
                return 202, json.loads(json.dumps(entry["response"]))

        mode = body.get("mode", "normal")
        credits_per_page = CREDITS_PER_PAGE.get(mode, 1)
        if self.credits < credits_per_page:
            return 402, {
                "error": {
                    "code": "insufficient_credits",
                    "message": "Your balance is below the cost of one page.",
                    "billing_url": self.billing_url,
                }
            }

        if kind == "crawl":
            start_url = body.get("url")
            if not _valid_url(start_url):
                return 400, {
                    "error": {"code": "validation", "message": "url must be a public http(s) URL."}
                }
            max_pages = int(body.get("max_pages", 100))
            plan = self.crawl_plans.get(start_url)
            if plan is None:
                plan = [
                    {"url": f"{start_url.rstrip('/')}/page-{i}"} for i in range(1, 4)
                ]
            pages = [self._make_page(p, depth=i) for i, p in enumerate(plan)]
            extra: Dict[str, Any] = {"url": start_url, "max_pages": max_pages, "max_depth": body.get("max_depth", 3)}
        else:  # batch
            raw_urls = body.get("urls") or []
            seen, deduped = set(), []
            for u in raw_urls:
                if u not in seen:
                    seen.add(u)
                    deduped.append(u)
            invalid = [
                {"url": u, "error": "URL must be a public http(s) URL."}
                for u in deduped
                if not _valid_url(u)
            ]
            valid = [u for u in deduped if _valid_url(u)]
            if not valid:
                return 400, {
                    "error": {
                        "code": "all_urls_invalid",
                        "message": "Every URL in this batch is invalid; no job was created.",
                    },
                    "invalid_urls": invalid,
                }
            pages = [self._make_page({"url": u}, depth=0) for u in valid]
            extra = {"urls_count": len(valid), "invalid_urls": invalid}
            max_pages = len(valid)

        job_id = f"{kind}_{uuid.uuid4()}"
        job: Dict[str, Any] = {
            "id": job_id,
            "type": kind,
            "status": "queued",
            "stopped_reason": None,
            "error": None,
            "format": body.get("format", "markdown"),
            "mode": mode,
            "credits_per_page": credits_per_page,
            "pages": pages,
            "max_pages": max_pages,
            "credits_used": 0,
            "created_at": time.time(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat().replace("+00:00", "Z"),
            "webhook": None,
            "status_url": f"{self.base_url}/api/v1/extract/{kind}/{job_id}",
            "billing_url": None,
            **extra,
        }
        self.jobs[job_id] = job

        response_data = {
            "id": job_id,
            "type": kind,
            "status": "queued",
            "format": job["format"],
            "mode": mode,
            "credits_per_page": credits_per_page,
            "status_url": job["status_url"],
            **extra,
        }
        response = {"data": response_data, "credits_used": 0}
        if key:
            self._idempotency[key] = {
                "created_at": time.time(),
                "response": json.loads(json.dumps(response)),
            }
        return 202, response

    def _make_page(self, spec: Dict[str, Any], depth: int) -> Dict[str, Any]:
        url = spec["url"]
        outcome_spec = self.page_outcomes.get(url, {})
        return {
            "url": url,
            "depth": spec.get("depth", depth),
            "status": "pending",
            "outcome": spec.get("outcome", outcome_spec.get("outcome", "succeeded")),
            "outcome_extra": {k: v for k, v in {**outcome_spec, **spec}.items() if k not in ("url", "depth", "outcome")},
            "status_code": None,
            "content": None,
            "error": None,
            "skip_reason": None,
            "credits": 0,
        }

    # -- job progression -------------------------------------------------------

    def _process_page(self, job: Dict[str, Any], page: Dict[str, Any]) -> None:
        cpp = job["credits_per_page"]
        outcome = page["outcome"]
        extra = page["outcome_extra"]
        if outcome == "succeeded":
            page["status"] = "succeeded"
            page["status_code"] = extra.get("status_code", 200)
            page["content"] = extra.get(
                "content", f"# {page['url']}\n\nFake markdown content for {page['url']}."
            )
            page["credits"] = cpp
            job["credits_used"] += cpp
            self.credits -= cpp
        elif outcome == "failed":
            page["status"] = "failed"
            page["status_code"] = extra.get("status_code", 500)
            page["error"] = extra.get("error", "HTTP 500 from origin")
        else:
            page["status"] = "skipped"
            page["skip_reason"] = extra.get("skip_reason", "robots")

    def _advance(self, job: Dict[str, Any]) -> None:
        if job["status"] in TERMINAL_STATUSES:
            return
        if job["status"] == "queued":
            job["status"] = "running"
        processable = job["pages"][: job["max_pages"]]
        for _ in range(self.pages_per_poll):
            pending = [p for p in processable if p["status"] == "pending"]
            if not pending:
                break
            if self.credits < job["credits_per_page"]:
                job["stopped_reason"] = "insufficient_credits"
                job["billing_url"] = self.billing_url
                break
            self._process_page(job, pending[0])
        done = all(p["status"] != "pending" for p in processable)
        if done or job["stopped_reason"]:
            job["status"] = "completed"
            if not job["stopped_reason"] and len(job["pages"]) > job["max_pages"]:
                job["stopped_reason"] = "max_pages"

    # -- status / cancel ---------------------------------------------------------

    def _get_status(
        self, kind: str, job_id: str, query: Dict[str, List[str]]
    ) -> Tuple[int, Dict[str, Any]]:
        job = self.jobs.get(job_id)
        if job is None or job["type"] != kind:
            return 404, {"error": {"code": "not_found", "message": f"Unknown {kind} job {job_id}."}}
        self._advance(job)

        include_content = query.get("include_content", ["true"])[0].lower() != "false"
        limit = int(query.get("limit", ["25"])[0])
        cursor = query.get("cursor", [None])[0]
        status_filter = query.get("status", [None])[0]

        processed = [p for p in job["pages"] if p["status"] in ("succeeded", "failed", "skipped")]
        if status_filter:
            processed = [p for p in processed if p["status"] == status_filter]
        offset = int(cursor) if cursor else 0
        chunk = processed[offset : offset + limit]
        results = []
        for p in chunk:
            item: Dict[str, Any] = {
                "url": p["url"],
                "depth": p["depth"],
                "status": p["status"],
                "status_code": p["status_code"],
                "truncated": False,
                "error": p["error"],
                "skip_reason": p["skip_reason"],
                "credits": p["credits"],
            }
            if p["status"] == "succeeded":
                item["content_length"] = len(p["content"] or "")
                if include_content:
                    item["content"] = p["content"]
            results.append(item)
        next_cursor = str(offset + limit) if offset + limit < len(processed) else None

        processable = job["pages"][: job["max_pages"]]
        counts = {
            "discovered": len(job["pages"]),
            "queued": sum(1 for p in processable if p["status"] == "pending"),
            "succeeded": sum(1 for p in processable if p["status"] == "succeeded"),
            "failed": sum(1 for p in processable if p["status"] == "failed"),
            "skipped": sum(1 for p in processable if p["status"] == "skipped"),
        }
        data: Dict[str, Any] = {
            "id": job["id"],
            "type": job["type"],
            "status": job["status"],
            "stopped_reason": job["stopped_reason"],
            "error": job["error"],
            "format": job["format"],
            "mode": job["mode"],
            "pages": counts,
            "credits_used": job["credits_used"],
            "expires_at": job["expires_at"],
            "webhook": job["webhook"],
            "status_url": job["status_url"],
            "results": results,
            "next_cursor": next_cursor,
        }
        if job["type"] == "crawl":
            data["url"] = job["url"]
            data["max_pages"] = job["max_pages"]
        else:
            data["urls_count"] = job["urls_count"]
            data["invalid_urls"] = job["invalid_urls"]
        if job["stopped_reason"] == "insufficient_credits":
            data["billing_url"] = job["billing_url"]
        return 200, {"data": data}

    def _delete_job(self, kind: str, job_id: str) -> Tuple[int, Dict[str, Any]]:
        job = self.jobs.get(job_id)
        if job is None or job["type"] != kind:
            return 404, {"error": {"code": "not_found", "message": f"Unknown {kind} job {job_id}."}}
        if job["status"] in TERMINAL_STATUSES:
            return 409, {
                "error": {"code": "conflict", "message": f"Job {job_id} already finished."}
            }
        job["status"] = "cancelled"
        job["stopped_reason"] = "cancelled"
        return 200, {
            "data": {
                "id": job["id"],
                "type": job["type"],
                "status": "cancelled",
                "stopped_reason": "cancelled",
                "credits_used": job["credits_used"],
                "status_url": job["status_url"],
            }
        }


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------


def _make_handler(app: FakeScavioServer):
    class Handler(BaseHTTPRequestHandler):
        server_version = "FakeScavio/1.0"
        protocol_version = "HTTP/1.1"

        def log_message(self, *args: Any) -> None:  # keep test output quiet
            pass

        def _dispatch(self, method: str) -> None:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            length = int(self.headers.get("Content-Length") or 0)
            body = None
            if length:
                raw = self.rfile.read(length)
                try:
                    body = json.loads(raw.decode("utf-8"))
                except ValueError:
                    body = None
            headers = {k.lower(): v for k, v in self.headers.items()}
            status, payload = app.handle(method, parsed.path, query, headers, body)
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._dispatch("GET")

        def do_POST(self) -> None:
            self._dispatch("POST")

        def do_DELETE(self) -> None:
            self._dispatch("DELETE")

    return Handler


__all__ = ["FakeScavioServer"]
