"""URL normalization and GitHub repository URL helpers.

These helpers are shared by the scraping pipeline (``scripts/update_readme.py``)
and the issue ingestion pipeline (``scripts/process_issues.py``) so that both
decide equality of repository URLs with the exact same rules:

* ``http`` and ``https`` are treated as the same repository (canonical: https)
* host and path are compared case-insensitively
* trailing slashes are ignored
* query strings and fragments are ignored
"""

import re
from urllib.parse import urlsplit

# owner/repo captured from URLs with an http(s) scheme, no scheme, or a
# protocol-relative (//host/path) form
_GITHUB_REPO_RE = re.compile(
    r"^(?:(?:https?:)?//)?github\.com/([^/?#]+)/([^/?#]+)",
    re.IGNORECASE,
)

# Trailing punctuation that is never part of a repository URL
_TRAILING_PUNCTUATION = ".,;:!?)\"'>]"


def normalize_url(url: str) -> str:
    """Normalize a GitHub repository URL for equality comparison.

    Examples:
        >>> normalize_url("HTTP://GitHub.com/Owner/Repo/")
        'https://github.com/owner/repo'
        >>> normalize_url("https://github.com/owner/repo?foo=bar#readme")
        'https://github.com/owner/repo'
    """
    if not url:
        return ""

    url = url.strip().rstrip(_TRAILING_PUNCTUATION)
    parts = urlsplit(url)

    if parts.scheme.lower() in ("http", "https"):
        host = (parts.hostname or "").lower()
        path = parts.path.rstrip("/").lower()
        return f"https://{host}{path}"

    # URL without a scheme (e.g. "github.com/owner/repo/")
    stripped = url.rstrip("/").lower()
    if stripped.startswith("//"):
        stripped = "https:" + stripped
    return stripped


def parse_github_repo(url: str) -> tuple[str, str] | None:
    """Parse a GitHub repository URL into an ``(owner, repo)`` tuple.

    Returns ``None`` when the string is not a GitHub repository URL.
    """
    if not url:
        return None
    match = _GITHUB_REPO_RE.match(url.strip())
    if not match:
        return None
    return match.group(1), match.group(2)


def repo_name_from_url(url: str) -> str:
    """Derive a repository display name from its URL.

    Falls back to the raw URL when it cannot be parsed.
    """
    parsed = parse_github_repo(url)
    if parsed:
        return parsed[1]
    return url
