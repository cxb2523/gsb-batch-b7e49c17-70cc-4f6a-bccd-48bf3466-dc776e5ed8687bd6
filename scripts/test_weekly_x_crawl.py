#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Offline self-test for scripts/weekly_x_crawl.py.

No network access: urllib.request.urlopen is replaced with a fake that serves
canned payloads for some queries and raises injected failures for others.

Scenarios:
  1. live, mixed: I2V succeeds (with an intra-category duplicate), Seedance
     fails for every query (HTTP error + network error), Kling 3.0 succeeds but
     its only tweet is already in the repo (per-category skipped counter).
  2. live, all succeed: cross-category duplicate collapses to one entry, and
     each category's skipped counter matches the JSON summary.
  3. no token: offline checklist mode, no fabricated tweets.

Run:
  python scripts/test_weekly_x_crawl.py
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import weekly_x_crawl as crawl  # noqa: E402

CANDIDATES_DIR = crawl.CANDIDATES_DIR
LOG_PATH = crawl.LOG_PATH

CATEGORY_TITLES = {
    "kling3": "Kling 3.0 / Omni candidates",
    "i2v": "I2V / Kling candidates",
    "seedance": "Seedance candidates",
}


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc) -> None:
        return None


def tweet(tid: str, username: str, likes: int, text: str) -> dict:
    return {
        "id": tid,
        "text": text,
        "created_at": "2026-11-09T00:00:00.000Z",
        "author_id": "u-" + username,
        "public_metrics": {"like_count": likes},
        "username": username,
        "name": username,
    }


def make_payload(tweets: list[dict]) -> dict:
    users = [{"id": t["author_id"], "username": t["username"], "name": t["name"]} for t in tweets]
    data = [{k: t[k] for k in ("id", "text", "created_at", "author_id", "public_metrics")} for t in tweets]
    return {"data": data, "includes": {"users": users}}


def query_of(req) -> str:
    return urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)["query"][0]


def run_main(argv: list[str]) -> tuple[int, str]:
    old_argv = sys.argv
    sys.argv = ["weekly_x_crawl.py"] + argv
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            code = crawl.main()
    finally:
        sys.argv = old_argv
    return code, out.getvalue()


def section_body(markdown: str, title: str) -> str:
    match = re.search(r"## " + re.escape(title) + r"\n(.*?)(?=\n## |\Z)", markdown, re.S)
    assert match, f"section not found: {title}"
    return match.group(1)


def section_counts(markdown: str, title: str) -> dict[str, int]:
    """Extract the `Queries / Failed / Candidates / Skipped …` numbers of a section."""
    counts = {}
    for label, raw in re.findall(r"([A-Za-z][A-Za-z \-]*?): \*\*(\d+)\*\*", section_body(markdown, title)):
        counts[label.strip().lower()] = int(raw)
    return counts


def pick_known_ids(n: int) -> list[str]:
    known = sorted(crawl.known_status_ids())
    assert len(known) >= n, f"repo has only {len(known)} known status ids"
    return known[:n]


def clean_outputs(date: str) -> None:
    for suffix in (".md", ".json"):
        path = CANDIDATES_DIR / (date + suffix)
        if path.exists():
            path.unlink()


def assert_md_matches_json(markdown: str, summary: dict) -> None:
    """Markdown section numbers must equal the JSON summary numbers."""
    for key, field, skipped_field in (
        ("i2v", "i2v_count", "i2v_skipped_known"),
        ("seedance", "seedance_count", "seedance_skipped_known"),
        ("kling3", "kling3_count", "kling3_skipped_known"),
    ):
        counts = section_counts(markdown, CATEGORY_TITLES[key])
        assert counts["queries"] == summary["categories"][key]["query_count"], key
        assert counts["failed"] == summary["categories"][key]["failed_queries"], key
        assert counts["candidates"] == summary[field], (key, counts, summary[field])
        assert counts["skipped already-in-repo"] == summary[skipped_field], key
    assert f"total **{summary['skipped_known']}**" in markdown


def main() -> int:
    original_urlopen = urllib.request.urlopen
    log_backup = LOG_PATH.read_bytes() if LOG_PATH.exists() else None
    created: list[Path] = []
    try:
        # ------------------------------------------------ A: live, mixed
        known = pick_known_ids(4)
        dup_fresh = "1900000000000000001"
        dup_text = "Scene 1: neon alley, camera slowly pushes in. prompt below"
        i2v_fresh = "1900000000000000002"

        def handler_mixed(req, timeout=60):
            query = query_of(req)
            if "Seedance" in query:
                if "Seedance 2" in query:
                    raise urllib.error.URLError("timed out contacting api.twitter.com")
                raise urllib.error.HTTPError(
                    req.full_url, 429, "Too Many Requests", {}, None
                )
            if "Kling 3" in query:
                return FakeResponse(
                    make_payload([tweet(known[0], "olduser", 400, "already in repo")])
                )
            # both I2V queries return the same top tweet with different like counts
            likes = 120 if "lang:en" in query else 77
            return FakeResponse(
                make_payload(
                    [
                        tweet(dup_fresh, "alice", likes, dup_text),
                        tweet(i2v_fresh, "bob", 5, "small experiment, no full prompt"),
                    ]
                )
            )

        os.environ["TWITTER_BEARER_TOKEN"] = "fake-token"
        os.environ.pop("X_BEARER_TOKEN", None)
        urllib.request.urlopen = handler_mixed
        date_a = "2099-01-05"
        clean_outputs(date_a)
        code_a, stdout_a = run_main(["--date", date_a])
        created += [CANDIDATES_DIR / f"{date_a}.md", CANDIDATES_DIR / f"{date_a}.json"]

        assert code_a == 0, f"exit code {code_a} for mixed scenario"
        md_a = (CANDIDATES_DIR / f"{date_a}.md").read_text(encoding="utf-8")
        js_a = json.loads((CANDIDATES_DIR / f"{date_a}.json").read_text(encoding="utf-8"))

        assert js_a["categories"]["i2v"]["status"] == "ok"
        assert js_a["categories"]["seedance"]["status"] == "all_failed"
        assert js_a["categories"]["kling3"]["status"] == "ok"
        assert js_a["categories"]["seedance"]["failed_queries"] == 2
        assert js_a["query_failure_count"] == 2
        assert {f["error_type"] for f in js_a["query_failures"]} == {"http", "network"}

        # all-failed must not read as an empty week
        seed_body = section_body(md_a, CATEGORY_TITLES["seedance"])
        assert "Fetch failed for all 2 queries" in seed_body
        assert "No tweets returned this week" not in seed_body
        assert "HTTP 429 Too Many Requests" in seed_body
        assert "URLError" in seed_body and "timed out" in seed_body
        assert "queries succeeded" not in seed_body

        # same tweet from two queries collapses to one entry, keeping the
        # highest-scoring occurrence (120 likes beats the 77-like copy)
        assert js_a["i2v_count"] == 2, js_a["i2v_count"]
        assert md_a.count(f"status/{dup_fresh}") == 1
        assert "@alice · 120 likes" in md_a
        assert "@alice · 77 likes" not in md_a
        assert md_a.count(f"status/{i2v_fresh}") == 1

        # per-category skipped counters
        assert js_a["kling3_skipped_known"] == 1
        assert js_a["i2v_skipped_known"] == 0
        assert js_a["seedance_skipped_known"] == 0
        assert js_a["skipped_known"] == 1
        assert_md_matches_json(md_a, js_a)

        # ------------------------------------------------ B: live, all succeed
        k_ids = pick_known_ids(4)
        fresh_seed = "1900000000000000099"
        shared = "1900000000000000003"
        shared_text = "SHOT 1: waterfall; Kling 3.0 Omni prompt in reply"

        def handler_all_ok(req, timeout=60):
            query = query_of(req)
            if "Seedance" in query:
                return FakeResponse(
                    make_payload(
                        [
                            tweet(fresh_seed, "seeduser", 80, "Seedance prompt: sunset timelapse"),
                            tweet(k_ids[1], "seedold", 500, "already promoted seedance"),
                        ]
                    )
                )
            if "Kling 3" in query:
                return FakeResponse(
                    make_payload(
                        [
                            tweet(shared, "omni", 900, shared_text),
                            tweet(k_ids[2], "omniold", 700, "already promoted omni"),
                        ]
                    )
                )
            return FakeResponse(
                make_payload(
                    [
                        tweet(shared, "i2vuser", 42, shared_text),
                        tweet(k_ids[3], "i2vold", 300, "already promoted i2v"),
                    ]
                )
            )

        urllib.request.urlopen = handler_all_ok
        date_b = "2099-01-06"
        clean_outputs(date_b)
        code_b, _ = run_main(["--date", date_b])
        created += [CANDIDATES_DIR / f"{date_b}.md", CANDIDATES_DIR / f"{date_b}.json"]
        assert code_b == 0
        md_b = (CANDIDATES_DIR / f"{date_b}.md").read_text(encoding="utf-8")
        js_b = json.loads((CANDIDATES_DIR / f"{date_b}.json").read_text(encoding="utf-8"))

        # shared tweet appears exactly once and lands in its highest-scoring category
        assert md_b.count(f"status/{shared}") == 1
        assert js_b["kling3_count"] == 1 and js_b["i2v_count"] == 0
        assert js_b["seedance_count"] == 1
        # all-skipped i2v is described as "already in repo", not as an empty week
        i2v_body = section_body(md_b, CATEGORY_TITLES["i2v"])
        assert js_b["i2v_skipped_known"] == 1
        assert "already in the repo" in i2v_body
        assert "No tweets returned this week" not in i2v_body

        assert js_b["i2v_skipped_known"] == 1
        assert js_b["seedance_skipped_known"] == 1
        assert js_b["kling3_skipped_known"] == 1
        assert js_b["skipped_known"] == 3
        assert js_b["query_failure_count"] == 0
        assert_md_matches_json(md_b, js_b)

        # log row added once, with per-category counts
        log_text = LOG_PATH.read_text(encoding="utf-8")
        assert f"| {date_b} | weekly auto |" in log_text

        # ------------------------------------------------ C: no token
        os.environ.pop("TWITTER_BEARER_TOKEN", None)
        os.environ.pop("X_BEARER_TOKEN", None)
        date_c = "2099-01-04"
        clean_outputs(date_c)

        def handler_should_not_be_called(req, timeout=60):
            raise AssertionError("urlopen must not be called without a token")

        urllib.request.urlopen = handler_should_not_be_called
        code_c, _ = run_main(["--date", date_c])
        created += [CANDIDATES_DIR / f"{date_c}.md", CANDIDATES_DIR / f"{date_c}.json"]
        assert code_c == 0
        md_c = (CANDIDATES_DIR / f"{date_c}.md").read_text(encoding="utf-8")
        js_c = json.loads((CANDIDATES_DIR / f"{date_c}.json").read_text(encoding="utf-8"))

        assert js_c["has_token"] is False
        assert js_c["mode"] == "offline-checklist"
        assert js_c["candidate_count"] == 0
        assert js_c["skipped_known"] == 0
        assert js_c["query_failure_count"] == 0
        assert all(c["status"] == "offline" for c in js_c["categories"].values())
        assert "offline checklist" in md_c
        assert "no tweet entries are fabricated" in md_c
        assert "## Suggested queries" in md_c
        assert "### 1. @" not in md_c  # no fabricated entries
        assert "No tweets returned this week" not in md_c
        assert_md_matches_json(md_c, js_c)
        for key, title in CATEGORY_TITLES.items():
            assert f"## {title}" in md_c
            assert section_counts(md_c, title)["candidates"] == 0

        print("PASS: 3 scenarios (mixed live / all-live / no-token), exit code 0 in each")
        return 0
    finally:
        urllib.request.urlopen = original_urlopen
        for p in created:
            try:
                p.unlink()
            except OSError:
                pass
        if log_backup is not None:
            LOG_PATH.write_bytes(log_backup)


if __name__ == "__main__":
    raise SystemExit(main())
