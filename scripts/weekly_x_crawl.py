#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Weekly X (Twitter) prompt crawl for awesome-kling.

- Requires TWITTER_BEARER_TOKEN (or X_BEARER_TOKEN) for live search.
- Without a token, writes an explicit offline-checklist report so the workflow
  still produces output (no tweet entries are fabricated).
- Every query failure (HTTP status or network/parse error) is recorded per
  category and surfaced in the report instead of looking like an empty week.
- Does NOT auto-merge into curated packs; writes candidates under
  docs/x-crawl-candidates/ for human/agent review (newest-first rule when
  promoting to prompts/*).

Usage:
  python scripts/weekly_x_crawl.py
  python scripts/weekly_x_crawl.py --days 7 --max-results 20
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES_DIR = ROOT / "docs" / "x-crawl-candidates"
LOG_PATH = ROOT / "docs" / "x-crawl-log.md"

# Twitter recent-search queries (API v2; no min_faves operator — filter client-side)
QUERIES = {
    "i2v": [
        '(Kling OR 可灵 OR "Kling AI") ("image to video" OR I2V OR 图生视频) (prompt OR Prompt OR 提示词) -is:retweet lang:en',
        '(Kling OR 可灵) (prompt OR 提示词) ("image to video" OR 图生) -is:retweet',
    ],
    "seedance": [
        'Seedance (prompt OR Prompt OR 提示词 OR "Scene 1" OR "SHOT 1") -is:retweet',
        '("Seedance 2" OR "Seedance 2.0" OR "Seedance 2.5") (prompt OR Prompt) -is:retweet',
    ],
    "kling3": [
        '("Kling 3" OR "Kling 3.0" OR "Kling Omni" OR "Kling 3.0 Pro" OR 可灵3 OR "可灵 3.0") (prompt OR Prompt OR 提示词 OR STORYBOARD OR CAMERA) -is:retweet',
    ],
}

# key, human title, report order (Kling 3.0 first, as in curated docs)
CATEGORY_ORDER = [
    ("kling3", "Kling 3.0 / Omni candidates"),
    ("i2v", "I2V / Kling candidates"),
    ("seedance", "Seedance candidates"),
]

STATUS_RE = re.compile(r"status/(\d+)")

PROMPTISH = re.compile(
    r"(prompt|提示词|scene\s*\d|shot\s*\d|\[0[-–]\d|duration:|camera:|negative)",
    re.I,
)


@dataclass
class QueryResult:
    category: str
    query: str
    tweets: list[dict] = field(default_factory=list)
    ok: bool = True
    error_type: str = ""
    error_summary: str = ""


@dataclass
class CategoryState:
    key: str
    title: str
    query_count: int
    results: list[QueryResult] = field(default_factory=list)
    items: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)

    @property
    def failure_count(self) -> int:
        return sum(1 for r in self.results if not r.ok)

    @property
    def failures(self) -> list[QueryResult]:
        return [r for r in self.results if not r.ok]

    def status(self, has_token: bool) -> str:
        if not has_token:
            return "offline"
        if self.query_count and self.failure_count >= self.query_count:
            return "all_failed"
        if self.failure_count:
            return "partial"
        return "ok"


def bearer_token() -> str | None:
    return os.environ.get("TWITTER_BEARER_TOKEN") or os.environ.get("X_BEARER_TOKEN")


def _body_detail(body: str) -> str:
    """Prefer a concise API message from a JSON error body over a raw dump."""
    compact = re.sub(r"\s+", " ", body or "").strip()
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return compact[:300]
    if not isinstance(payload, dict):
        return compact[:300]
    detail = payload.get("detail") or payload.get("title")
    errors = payload.get("errors")
    if not detail and isinstance(errors, list) and errors:
        first = errors[0]
        if isinstance(first, dict):
            detail = first.get("message") or first.get("detail") or first.get("title")
    return str(detail)[:300] if detail else compact[:300]


def _describe_http_error(err: urllib.error.HTTPError) -> str:
    body = ""
    try:
        body = err.read().decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    reason = f"HTTP {err.code}"
    phrase = str(getattr(err, "msg", "") or "").strip()
    if not phrase:
        phrase = str(getattr(err, "reason", "") or "").strip()
    if phrase and "http error" not in phrase.lower():
        reason += f" {phrase}"
    detail = _body_detail(body)
    if detail and detail.lower() not in reason.lower():
        reason += f" — {detail}"
    return reason[:400]


def _describe_network_error(err: Exception) -> str:
    if isinstance(err, urllib.error.URLError) and getattr(err, "reason", None):
        return f"URLError: {err.reason}"[:300]
    return f"{type(err).__name__}: {err}"[:300]


def _api_error_summary(errors: list) -> str:
    first = errors[0] if errors else None
    if isinstance(first, dict):
        msg = first.get("message") or first.get("detail") or first.get("title")
        if msg:
            return f"API error: {str(msg)[:300]}"
    return "API error reported with no data"


def search_recent(
    query: str, max_results: int = 20, token: str | None = None
) -> tuple[list[dict], dict | None]:
    """Run one recent-search query.

    Returns (tweets, failure). ``failure`` is None on success; a successful
    request that legitimately returned no posts is ``([], None)``. Failures are
    ``{"type": "http"|"network"|"parse"|"api"|"request", "summary": ...}``.
    """
    token = token or bearer_token()
    if not token:
        return [], {"type": "no_token", "summary": "No bearer token configured"}

    params = {
        "query": query,
        "max_results": str(min(max(10, max_results), 100)),
        "tweet.fields": "created_at,public_metrics,author_id,lang,entities",
        "expansions": "author_id",
        "user.fields": "username,name",
    }
    url = "https://api.twitter.com/2/tweets/search/recent?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "awesome-kling-weekly-crawl/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw)
    except urllib.error.HTTPError as e:
        summary = _describe_http_error(e)
        print(f"[warn] HTTP failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "http", "summary": summary}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        summary = _describe_network_error(e)
        print(f"[warn] network failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "network", "summary": summary}
    except json.JSONDecodeError as e:
        summary = f"Invalid JSON response: {e}"[:300]
        print(f"[warn] parse failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "parse", "summary": summary}
    except Exception as e:  # noqa: BLE001
        summary = _describe_network_error(e)
        print(f"[warn] request failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "request", "summary": summary}

    if not isinstance(payload, dict):
        summary = "Unexpected response shape (not a JSON object)"
        print(f"[warn] parse failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "parse", "summary": summary}

    data = payload.get("data") or []
    if not isinstance(data, list):
        summary = "Unexpected response shape (`data` is not a list)"
        print(f"[warn] parse failure for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "parse", "summary": summary}

    errors = payload.get("errors")
    if not data and isinstance(errors, list) and errors:
        summary = _api_error_summary(errors)
        print(f"[warn] API error for query={query!r}: {summary}", file=sys.stderr)
        return [], {"type": "api", "summary": summary}

    users = {
        u["id"]: u for u in (payload.get("includes") or {}).get("users", [])
    }
    out = []
    for tw in data:
        if not isinstance(tw, dict) or not tw.get("id"):
            continue
        uid = tw.get("author_id")
        user = users.get(uid, {})
        metrics = tw.get("public_metrics") or {}
        likes = int(metrics.get("like_count") or 0)
        out.append(
            {
                "id": str(tw["id"]),
                "text": tw.get("text") or "",
                "created_at": tw.get("created_at"),
                "username": user.get("username") or "unknown",
                "name": user.get("name") or "",
                "likes": likes,
                "url": f"https://x.com/{user.get('username', 'i')}/status/{tw['id']}",
            }
        )
    return out, None


def score_tweet(t: dict) -> float:
    text = t.get("text") or ""
    score = float(t.get("likes") or 0)
    if PROMPTISH.search(text):
        score += 25
    if len(text) > 280:
        score += 10
    if "```" in text or "Scene" in text or "SHOT" in text:
        score += 15
    return score


def dedupe(tweets: list[dict]) -> list[dict]:
    """Keep one copy per tweet id, preferring the highest-scoring occurrence."""
    seen = set()
    out = []
    for t in sorted(tweets, key=score_tweet, reverse=True):
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        out.append(t)
    return out


def dedupe_across_categories(states: dict[str, CategoryState]) -> None:
    """Dedupe tweets matched by several queries/categories, highest score wins.

    Applies to both fresh candidates and already-in-repo skips, so a tweet is
    counted once overall and lands in exactly one category.
    """
    order = {key: idx for idx, (key, _title) in enumerate(CATEGORY_ORDER)}

    def collapse(attr: str) -> None:
        bucket: list[tuple[float, int, str, dict]] = []
        for key, state in states.items():
            for t in getattr(state, attr):
                bucket.append((score_tweet(t), order.get(key, len(order)), key, t))
        bucket.sort(key=lambda entry: (-entry[0], entry[1]))

        seen: set[str] = set()
        kept: dict[str, list[dict]] = {key: [] for key in states}
        for _score, _order, key, t in bucket:
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            kept[key].append(t)
        for key, state in states.items():
            setattr(state, attr, kept[key])

    collapse("items")
    collapse("skipped")


def known_status_ids() -> set[str]:
    ids: set[str] = set()
    for pattern in ("README.md", "README-en.md", "prompts/**/*.md", "docs/**/*.md"):
        for path in ROOT.glob(pattern):
            if not path.is_file() or "x-crawl-candidates" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            ids.update(STATUS_RE.findall(text))
    return ids


def filter_known(tweets: list[dict], known: set[str]) -> tuple[list[dict], list[dict]]:
    fresh, skipped = [], []
    for t in tweets:
        if t["id"] in known:
            skipped.append(t)
        else:
            fresh.append(t)
    return fresh, skipped


def render_report(
    date: str, states: dict[str, CategoryState], has_token: bool
) -> str:
    skipped_total = sum(len(s.skipped) for s in states.values())
    failure_total = sum(s.failure_count for s in states.values())
    skipped_parts = ", ".join(
        f"{label}={len(states[key].skipped)}"
        for key, label in (
            ("i2v", "I2V"),
            ("seedance", "Seedance"),
            ("kling3", "Kling 3.0"),
        )
    )
    failure_parts = ", ".join(
        f"{label}={states[key].failure_count}/{states[key].query_count}"
        for key, label in (
            ("i2v", "I2V"),
            ("seedance", "Seedance"),
            ("kling3", "Kling 3.0"),
        )
    )

    if has_token:
        mode_line = (
            "Live API: **yes**. Mode: **live crawl** "
            "(Twitter API v2 recent search)."
        )
        failure_line = (
            f"> Query failures: **{failure_total}** ({failure_parts})."
        )
    else:
        mode_line = (
            "Live API: **no**. Mode: **offline checklist** — no bearer token "
            "(`TWITTER_BEARER_TOKEN` / `X_BEARER_TOKEN`); no live search was "
            "attempted and no tweet entries are fabricated."
        )
        failure_line = "> Query failures: **0** (live search not attempted)."

    lines = [
        f"# X crawl candidates — {date}",
        "",
        f"> Generated by `scripts/weekly_x_crawl.py` (UTC). {mode_line}",
        f"> Skipped already-in-repo URLs (after cross-query dedupe): **{skipped_parts}** "
        f"(total **{skipped_total}**).",
        failure_line,
        "",
        "## Review checklist",
        "",
        "- [ ] Open high-signal posts; extract full prompts (follow threads if needed)",
        "- [ ] Run `python scripts/dedupe_candidates.py docs/x-crawl-candidates/"
        + date
        + ".md`",
        "- [ ] Insert **at the top** (newest first):",
        "  - I2V → `prompts/i2v-from-x.md`",
        "  - Seedance → `prompts/seedance-from-x.md`",
        "  - Kling 3.0 → `prompts/kling-3-omni.md`",
        "- [ ] Mirror highlights into `README.md` + `README-en.md`",
        "- [ ] Follow [docs/PROMOTE_CHECKLIST.md](../PROMOTE_CHECKLIST.md)",
        "- [ ] Credit Source: `@handle` + post URL",
        "",
        "## Suggested queries",
        "",
        "```",
        '(Kling OR 可灵) ("image to video" OR I2V OR 图生视频) (prompt OR 提示词)',
        '("Kling 3" OR "Kling Omni" OR 可灵3) (prompt OR STORYBOARD OR CAMERA)',
        'Seedance (Prompt OR 提示词 OR "Scene 1" OR "SHOT 1")',
        "from:MayorKingAI Kling",
        "```",
        "",
    ]

    def section(state: CategoryState) -> None:
        status = state.status(has_token)
        lines.append(f"## {state.title}")
        lines.append("")
        if has_token:
            lines.append(
                f"Queries: **{state.query_count}** · Failed: **{state.failure_count}** · "
                f"Candidates: **{len(state.items)}** · "
                f"Skipped already-in-repo: **{len(state.skipped)}**"
            )
        else:
            lines.append(
                f"Queries: **{state.query_count}** (not attempted) · Failed: **0** · "
                "Candidates: **0** · Skipped already-in-repo: **0**"
            )
        lines.append("")

        if state.failures:
            lines.append("**Failed queries:**")
            lines.append("")
            for r in state.failures:
                label = "" if r.error_type == "http" else f"{r.error_type}: "
                lines.append(f"- `{r.query}` — {label}{r.error_summary}")
            lines.append("")

        if status == "offline":
            lines.append(
                "_Offline checklist mode: no live data was fetched for this category, "
                "so this is not a \"no tweets\" result. Use the suggested queries above "
                "and add findings manually._"
            )
            lines.append("")
            return

        if status == "all_failed":
            all_q = "the only query" if state.query_count == 1 else f"all {state.query_count} queries"
            lines.append(
                f"_**Fetch failed for {all_q} in this category — "
                "this is NOT reported as \"no tweets this week\".** Fix the API/network "
                "errors above and re-run._"
            )
            lines.append("")
            return

        if not state.items:
            if status == "partial":
                ok_count = state.query_count - state.failure_count
                ok_phrase = "the only query that succeeded" if ok_count == 1 else f"the {ok_count} queries that succeeded"
                lines.append(
                    f"_No tweets from {ok_phrase}; {state.failure_count} of "
                    f"{state.query_count} failed._"
                )
            elif state.skipped:
                lines.append(
                    f"_All {len(state.skipped)} returned tweet(s) are already in the repo "
                    f"(skipped); all {state.query_count} queries succeeded, so there is "
                    "no fresh candidate from this category this week._"
                )
            else:
                lines.append(
                    f"_No tweets returned this week (all {state.query_count} queries succeeded)._"
                )
            lines.append("")
            return

        for i, t in enumerate(state.items, 1):
            preview = (t["text"] or "").replace("\n", " ").strip()
            if len(preview) > 400:
                preview = preview[:400] + "…"
            lines.append(f"### {i}. @{t['username']} · {t['likes']} likes")
            lines.append("")
            lines.append(f"- URL: {t['url']}")
            lines.append(f"- Created: {t.get('created_at')}")
            lines.append(f"- Score: {score_tweet(t):.0f}")
            lines.append("")
            lines.append("```text")
            lines.append(preview)
            lines.append("```")
            lines.append("")

    for key, _title in CATEGORY_ORDER:
        section(states[key])

    lines.extend(
        [
            "## Promote template",
            "",
            "```markdown",
            "### X.Y. Title",
            "*One-line description.*",
            "",
            "**Prompt:**",
            "```text",
            "...",
            "```",
            "",
            "*Source: Name ([@handle](https://x.com/handle)) — [Post](url)*",
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def append_log_row(
    date: str, i2v_n: int, seed_n: int, k3_n: int, mode: str
) -> None:
    if not LOG_PATH.exists():
        return
    text = LOG_PATH.read_text(encoding="utf-8")
    row = (
        f"| {date} | weekly auto | {mode} | "
        f"`docs/x-crawl-candidates/{date}.md` | I2V={i2v_n}, Seedance={seed_n}, K3={k3_n} |"
    )
    marker = "## 爬取批次\n\n"
    if marker not in text:
        return
    # Insert after table header block: find first data row or end of header
    table_header = (
        "| 日期 | 主题 | 工具/查询 | 入库文件 | 条数 |\n"
        "|------|------|-----------|----------|------|\n"
    )
    if table_header in text and row not in text:
        text = text.replace(table_header, table_header + row + "\n", 1)
        LOG_PATH.write_text(text, encoding="utf-8", newline="\n")


def build_summary(
    date: str, states: dict[str, CategoryState], has_token: bool, out_path: Path
) -> dict:
    categories: dict[str, dict] = {}
    query_failures: list[dict] = []
    for key in ("i2v", "seedance", "kling3"):
        state = states[key]
        categories[key] = {
            "status": state.status(has_token),
            "query_count": state.query_count,
            "failed_queries": state.failure_count,
            "candidate_count": len(state.items),
            "skipped_known": len(state.skipped),
            "errors": [
                {
                    "query": r.query,
                    "error_type": r.error_type,
                    "reason": r.error_summary,
                }
                for r in state.failures
            ],
        }
        for r in state.failures:
            query_failures.append(
                {
                    "category": key,
                    "query": r.query,
                    "error_type": r.error_type,
                    "reason": r.error_summary,
                }
            )

    return {
        "date": date,
        "has_token": has_token,
        "mode": "live" if has_token else "offline-checklist",
        "i2v_count": len(states["i2v"].items),
        "seedance_count": len(states["seedance"].items),
        "kling3_count": len(states["kling3"].items),
        "candidate_count": sum(len(s.items) for s in states.values()),
        "skipped_known": sum(len(s.skipped) for s in states.values()),
        "i2v_skipped_known": len(states["i2v"].skipped),
        "seedance_skipped_known": len(states["seedance"].skipped),
        "kling3_skipped_known": len(states["kling3"].skipped),
        "query_failure_count": len(query_failures),
        "query_failures": query_failures,
        "categories": categories,
        "path": str(out_path.relative_to(ROOT)).replace("\\", "/"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--min-likes", type=int, default=0)
    parser.add_argument("--date", default=None, help="UTC date stamp YYYY-MM-DD")
    args = parser.parse_args()

    date = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    token = bearer_token()
    has_token = bool(token)

    states: dict[str, CategoryState] = {}
    for key, title in CATEGORY_ORDER:
        state = CategoryState(key, title, query_count=len(QUERIES[key]))
        if has_token:
            for query in QUERIES[key]:
                tweets, failure = search_recent(query, args.max_results, token)
                state.results.append(
                    QueryResult(
                        category=key,
                        query=query,
                        tweets=tweets,
                        ok=failure is None,
                        error_type=(failure or {}).get("type", ""),
                        error_summary=(failure or {}).get("summary", ""),
                    )
                )
        states[key] = state

    if not has_token:
        print("[info] No TWITTER_BEARER_TOKEN / X_BEARER_TOKEN — offline checklist mode.")
    else:
        failed = sum(s.failure_count for s in states.values())
        if failed:
            print(f"[warn] {failed} query/queries failed; details are recorded in the report.")

    # Per-category dedupe first, then split fresh vs already-in-repo so each
    # category's skipped counter reflects what that category's queries matched.
    # Cross-category dedupe then runs on both lists: a tweet matched by several
    # queries is counted once overall, kept in the highest-scoring category.
    known = known_status_ids()
    for state in states.values():
        items = dedupe([t for r in state.results if r.ok for t in r.tweets])
        if args.min_likes:
            items = [t for t in items if t["likes"] >= args.min_likes]
        state.items, state.skipped = filter_known(items, known)
    dedupe_across_categories(states)
    for state in states.values():
        state.items = state.items[:30]

    CANDIDATES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CANDIDATES_DIR / f"{date}.md"
    report = render_report(date, states, has_token)
    out_path.write_text(report, encoding="utf-8", newline="\n")

    summary = build_summary(date, states, has_token, out_path)
    summary_path = CANDIDATES_DIR / f"{date}.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(
        f"[ok] wrote {out_path.relative_to(ROOT)} "
        f"(i2v={summary['i2v_count']}, seedance={summary['seedance_count']}, "
        f"k3={summary['kling3_count']}, skipped={summary['skipped_known']}, "
        f"query_failures={summary['query_failure_count']})"
    )

    if has_token:
        mode = "Twitter API v2 recent search"
        if summary["query_failure_count"]:
            mode += f"; {summary['query_failure_count']} query failure(s)"
    else:
        mode = "offline checklist (no token)"
    append_log_row(
        date,
        summary["i2v_count"],
        summary["seedance_count"],
        summary["kling3_count"],
        mode,
    )

    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
