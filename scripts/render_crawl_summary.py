#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Render a GitHub Actions job summary from a weekly crawl JSON summary.

Usage:
  python scripts/render_crawl_summary.py docs/x-crawl-candidates/YYYY-MM-DD.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CATEGORY_LABEL = {"i2v": "I2V", "seedance": "Seedance", "kling3": "Kling 3.0"}


def render(data: dict) -> str:
    lines = [f"## Weekly X crawl - {data['date']}", ""]
    lines.append(f"- Mode: **{data['mode']}** (has_token={data['has_token']})")
    lines.append(
        f"- Candidates: **{data['candidate_count']}** "
        f"(I2V={data['i2v_count']}, Seedance={data['seedance_count']}, "
        f"Kling 3.0={data['kling3_count']})"
    )
    lines.append(
        f"- Skipped already-in-repo: **{data['skipped_known']}** "
        f"(I2V={data['i2v_skipped_known']}, "
        f"Seedance={data['seedance_skipped_known']}, "
        f"Kling 3.0={data['kling3_skipped_known']})"
    )
    lines.append(f"- Failed queries: **{data['query_failure_count']}**")

    failures = data.get("query_failures") or []
    if failures:
        lines.append("")
        lines.append("| Category | Error | Reason |")
        lines.append("|---|---|---|")
        for f in failures:
            label = CATEGORY_LABEL.get(f.get("category", ""), f.get("category", ""))
            reason = str(f.get("reason", "")).replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {label} | {f.get('error_type', '')} | {reason} |")

    categories = data.get("categories") or {}
    all_failed = [
        CATEGORY_LABEL.get(k, k)
        for k, c in categories.items()
        if c.get("status") == "all_failed"
    ]
    if all_failed:
        lines.append("")
        lines.append(
            "> Fetch failed for: **" + ", ".join(all_failed) + "**. "
            "Those categories have no data - this is not an empty week."
        )

    if data.get("mode") == "offline-checklist":
        lines.append("")
        lines.append(
            "> No bearer token: **offline checklist mode**. No tweet entries were "
            "fabricated; use the suggested queries in the report to crawl manually."
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: render_crawl_summary.py <summary.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    print(render(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
