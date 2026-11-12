"""Storage utilities for managing urls.json and history."""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from utils.urlutils import normalize_url, repo_name_from_url

# Marker written to urls.json entries whose latest fetch failed while an
# older record was kept. README rendering relies on these fields to show a
# recognizable "missing data" hint instead of stale/fabricated metrics.
FETCH_FAILED_FLAG = True
FETCH_FAILED_KEY = "fetch_failed"
FETCH_FAILED_AT_KEY = "fetch_failed_at"


def load_urls_json(urls_path: str | Path = "urls.json") -> list[dict]:
    """Load repository data from urls.json.

    Args:
        urls_path: Path to urls.json file

    Returns:
        List of repository dictionaries
    """
    with open(urls_path, encoding="utf-8") as f:
        return json.load(f)


def backup_urls_json(urls_path: str | Path = "urls.json", history_dir: str | Path = "history") -> Path | None:
    """Move current urls.json to history directory with timestamp suffix.

    Args:
        urls_path: Path to urls.json file
        history_dir: Path to history directory

    Returns:
        Path to backup file or None if no backup was made
    """
    urls_path = Path(urls_path)
    history_dir = Path(history_dir)

    if not urls_path.exists():
        print("No urls.json found to backup")
        return None

    history_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = history_dir / f"urls_{timestamp}.json"

    shutil.move(urls_path, backup_path)
    print(f"Moved urls.json to {backup_path}")
    return backup_path


def update_urls_json(repos: list[dict], urls_path: str | Path = "urls.json") -> None:
    """Write updated repository data to urls.json.

    Args:
        repos: List of repository dictionaries
        urls_path: Path to urls.json file
    """
    urls_path = Path(urls_path)

    with open(urls_path, "w", encoding="utf-8") as f:
        json.dump(repos, f, indent=4)

    print(f"Created new {urls_path} with {len(repos)} repositories")


def build_fetch_failed_entry(item: dict, failed_at: str | None = None) -> dict:
    """Build the urls.json record for an entry whose GitHub fetch failed.

    The old record is retained (the row must still appear in the README), but
    every potentially stale metric (stars, version, updated_at, ...) is
    dropped so it can never be rendered as if it were fresh data. Only the
    original ``url`` and ``name`` are kept, together with explicit failure
    metadata.

    Args:
        item: The previous urls.json entry for this repository
        failed_at: ISO-8601 timestamp of the failure; defaults to now (UTC)

    Returns:
        A new dictionary marked as fetch-failed
    """
    url = item.get("url", "")
    name = item.get("name") or repo_name_from_url(url)
    return {
        "url": url,
        "name": name,
        FETCH_FAILED_KEY: FETCH_FAILED_FLAG,
        FETCH_FAILED_AT_KEY: failed_at or datetime.now(timezone.utc).isoformat(),
    }


def load_blacklist(blacklist_path: str | Path = "blacklist.txt") -> set[str]:
    """Load blacklisted URLs from blacklist.txt.

    Entries are normalized with the same rules as urls.json URLs (case,
    trailing slashes and http/https variants are equivalent).

    Args:
        blacklist_path: Path to blacklist.txt file

    Returns:
        Set of normalized blacklisted URLs
    """
    blacklist_path = Path(blacklist_path)

    if not blacklist_path.exists():
        return set()

    blacklist = set()
    with open(blacklist_path, encoding="utf-8") as f:
        for line in f:
            url = line.strip()
            if url and not url.startswith("#"):
                blacklist.add(normalize_url(url))

    return blacklist


def filter_blacklisted_urls(
    urls_data: list[dict],
    blacklist: set[str],
) -> tuple[list[dict], list[dict]]:
    """Filter out blacklisted URLs from the urls data.

    Comparison uses normalized URLs so case, trailing slash and http/https
    variants of a blacklisted entry are matched as well.

    Args:
        urls_data: List of repository dictionaries
        blacklist: Set of normalized blacklisted URLs

    Returns:
        Tuple of (filtered entries, removed entries). Removed entries are the
        original dictionaries that matched the blacklist, kept so callers can
        report the concrete URLs that were dropped.
    """
    if not blacklist:
        return list(urls_data), []

    filtered = []
    removed = []

    for item in urls_data:
        normalized = normalize_url(item.get("url", ""))
        if normalized in blacklist:
            removed.append(item)
        else:
            filtered.append(item)

    for item in removed:
        print(f"Removing blacklisted URL: {item.get('url', '')}")

    if removed:
        removed_urls = ", ".join(item.get("url", "") for item in removed)
        print(
            f"Removed {len(removed)} blacklisted URL(s) from urls.json: "
            f"[{removed_urls}]"
        )

    return filtered, removed
