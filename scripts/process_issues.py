# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "requests",
# ]
# ///
"""Process GitHub issues to add new URLs to urls.json."""

import json
import os
import re
from pathlib import Path

import requests

# Project root on sys.path so the shared URL utilities can be imported both
# when run as a script (``uv run scripts/process_issues.py``) and in tests.
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.urlutils import normalize_url

GITHUB_API = "https://api.github.com"

# Pattern to match "add:" GitHub repo URLs (http and https both accepted).
GITHUB_URL_PATTERN = re.compile(
    r"add\s*:?\s+(https?://github\.com/[\w.-]+/[\w.-]+)",
    re.IGNORECASE,
)

# Only process issues from this user
ALLOWED_USER = "pawel-krzych"


def build_headers(token: str) -> dict:
    """Build the authenticated GitHub API headers."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def load_urls(urls_path: str | Path = "urls.json") -> list[dict]:
    """Load existing URLs from urls.json."""
    path = Path(urls_path)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def save_urls(urls: list[dict], urls_path: str | Path = "urls.json") -> None:
    """Save URLs to urls.json."""
    Path(urls_path).write_text(
        json.dumps(urls, indent=4) + "\n", encoding="utf-8"
    )


def get_existing_urls(urls_data: list[dict]) -> set[str]:
    """Extract all URLs from the urls data, normalized.

    Normalization ignores case and trailing slashes and treats http/https as
    the same repository, so variants of one URL are recognized as duplicates.
    """
    return {
        normalized
        for item in urls_data
        if (normalized := normalize_url(item.get("url", "")))
    }


def get_open_issues(
    repository: str,
    headers: dict,
    http_get=requests.get,
) -> list[dict]:
    """Fetch all open issues from the repository (PRs excluded)."""
    url = f"{GITHUB_API}/repos/{repository}/issues"
    params = {"state": "open", "per_page": 100}
    response = http_get(url, headers=headers, params=params)
    response.raise_for_status()
    # Filter out pull requests (they also appear in issues endpoint)
    return [issue for issue in response.json() if "pull_request" not in issue]


def extract_add_urls(issue: dict) -> list[str]:
    """Extract every ``add: <github-url>`` link from an issue.

    The issue title is scanned first, then the body. Returned URLs keep their
    original spelling and are de-duplicated while preserving order.
    """
    title = issue.get("title", "") or ""
    body = issue.get("body", "") or ""

    seen = set()
    urls = []
    for text in (title, body):
        for match in GITHUB_URL_PATTERN.findall(text):
            candidate = match.strip()
            # De-duplicate by normalized URL so http/https, casing and
            # trailing-slash variants count as one link (first spelling wins)
            normalized = normalize_url(candidate)
            if normalized and normalized not in seen:
                seen.add(normalized)
                urls.append(candidate)
    return urls


def comment_on_issue(
    repository: str,
    headers: dict,
    issue_number: int,
    comment: str,
    http_post=requests.post,
) -> None:
    """Add a comment to an issue."""
    url = f"{GITHUB_API}/repos/{repository}/issues/{issue_number}/comments"
    response = http_post(url, headers=headers, json={"body": comment})
    response.raise_for_status()


def close_issue(
    repository: str,
    headers: dict,
    issue_number: int,
    http_patch=requests.patch,
) -> None:
    """Close an issue."""
    url = f"{GITHUB_API}/repos/{repository}/issues/{issue_number}"
    response = http_patch(url, headers=headers, json={"state": "closed"})
    response.raise_for_status()


def process_issue(
    issue: dict,
    urls_data: list[dict],
    existing_urls: set[str],
    comment_fn,
    close_fn,
) -> str | None:
    """Process a single issue.

    Only the first ``add:`` link of an issue is ingested; any further links in
    the same issue are left untouched and explicitly mentioned in the closing
    comment. Duplicate links (after normalization) are never added.

    Returns ``"added"`` when a new URL was stored, ``"duplicate"`` when the
    first link already exists, or ``None`` when the issue was skipped (wrong
    author or no recognizable add link).
    """
    issue_number = issue["number"]
    issue_author = issue.get("user", {}).get("login", "")

    if issue_author != ALLOWED_USER:
        # Not from allowed user, skip
        return None

    add_urls = extract_add_urls(issue)
    if not add_urls:
        # Not an "add" issue, skip it
        return None

    github_url = add_urls[0]
    extra_urls = add_urls[1:]
    normalized_url = normalize_url(github_url)

    print(f"Processing issue #{issue_number}: found URL {github_url}")

    extra_note = ""
    if extra_urls:
        listing = "\n".join(f"- {u}" for u in extra_urls)
        extra_note = (
            "\n\nNote: this issue contains several add links. Only the first "
            f"one was processed; the following {len(extra_urls)} link(s) were "
            f"not handled, please open separate issues for them:\n{listing}"
        )

    if normalized_url in existing_urls:
        # Duplicate URL (case / trailing slash / http(s) variants included)
        comment = (
            "Thanks for the suggestion!\n\n"
            f"However, **{github_url}** is already in our list.\n\n"
            "Closing this issue as a duplicate."
            f"{extra_note}"
        )
        comment_fn(issue_number, comment)
        close_fn(issue_number)
        print(f"  -> Duplicate, closed issue #{issue_number}")
        return "duplicate"

    # Add new URL (original spelling preserved; normalization is only for
    # equality checks)
    urls_data.append({"url": github_url})
    existing_urls.add(normalized_url)

    comment = (
        "Thanks for the suggestion!\n\n"
        f"**{github_url}** has been added to the list.\n\n"
        "The README will be updated automatically."
        f"{extra_note}"
    )
    comment_fn(issue_number, comment)
    close_fn(issue_number)
    print(f"  -> Added, closed issue #{issue_number}")
    return "added"


def set_output(name: str, value: str) -> None:
    """Set a GitHub Actions output variable."""
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"{name}={value}\n")


def main(
    urls_path: str | Path = "urls.json",
    *,
    http_get=requests.get,
    http_post=requests.post,
    http_patch=requests.patch,
) -> dict:
    """Main entry point. Returns a summary dict used in tests and CI logs."""
    token = os.environ["GITHUB_TOKEN"]
    repository = os.environ["GITHUB_REPOSITORY"]
    headers = build_headers(token)

    print(f"Processing issues for {repository}")

    urls_data = load_urls(urls_path)
    existing_urls = get_existing_urls(urls_data)

    print(f"Loaded {len(urls_data)} existing URLs")

    issues = get_open_issues(repository, headers, http_get=http_get)
    print(f"Found {len(issues)} open issues")

    added_count = 0
    duplicate_count = 0
    for issue in issues:
        result = process_issue(
            issue,
            urls_data,
            existing_urls,
            comment_fn=lambda number, body: comment_on_issue(
                repository, headers, number, body, http_post=http_post
            ),
            close_fn=lambda number: close_issue(
                repository, headers, number, http_patch=http_patch
            ),
        )
        if result == "added":
            added_count += 1
        elif result == "duplicate":
            duplicate_count += 1

    if added_count > 0:
        save_urls(urls_data, urls_path)
        print(f"\nAdded {added_count} new URL(s) to urls.json")
        set_output("urls_added", "true")
    else:
        print("\nNo new URLs added")
        set_output("urls_added", "false")

    return {
        "added_count": added_count,
        "duplicate_count": duplicate_count,
        "urls": urls_data,
    }


if __name__ == "__main__":
    main()
