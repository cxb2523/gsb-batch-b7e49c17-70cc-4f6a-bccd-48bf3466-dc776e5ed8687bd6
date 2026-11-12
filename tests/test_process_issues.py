"""Tests for issue ingestion: normalization, dedup, multi-link handling.

GitHub HTTP calls are faked in-process; nothing reaches the real API.
"""

import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "process_issues.py"


@pytest.fixture(scope="module")
def issues_module():
    spec = importlib.util.spec_from_file_location("process_issues_script", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    """Minimal stand-in for a requests.Response object."""

    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeGitHub:
    """Records every comment/close call instead of hitting GitHub."""

    def __init__(self, issues):
        self.issues = issues
        self.comments = []  # (issue_number, body)
        self.closed = []
        self.calls = []

    def get(self, url, headers=None, params=None):
        self.calls.append(("GET", url))
        return FakeResponse(self.issues)

    def post(self, url, headers=None, json=None):
        self.calls.append(("POST", url))
        # /repos/owner/repo/issues/N/comments
        number = int(url.split("/issues/")[1].split("/")[0])
        self.comments.append((number, json["body"]))
        return FakeResponse({})

    def patch(self, url, headers=None, json=None):
        self.calls.append(("PATCH", url))
        number = int(url.split("/issues/")[1])
        assert json == {"state": "closed"}
        self.closed.append(number)
        return FakeResponse({})


def _issue(number, title="", body="", author="pawel-krzych"):
    return {
        "number": number,
        "title": title,
        "body": body,
        "user": {"login": author},
    }


# ---------------------------------------------------------------------------
# URL extraction
# ---------------------------------------------------------------------------

def test_extract_add_urls_title_then_body(issues_module):
    issue = _issue(
        1,
        title="add: https://github.com/owner/from-title",
        body="please add: https://github.com/owner/from-body",
    )
    urls = issues_module.extract_add_urls(issue)
    assert urls == [
        "https://github.com/owner/from-title",
        "https://github.com/owner/from-body",
    ]


def test_extract_add_urls_supports_http_and_dedups(issues_module):
    issue = _issue(
        2,
        body=(
            "add: http://github.com/owner/repo\n"
            "add: https://github.com/owner/repo/\n"  # same repo, variant
        ),
    )
    urls = issues_module.extract_add_urls(issue)
    assert urls == ["http://github.com/owner/repo"]


def test_extract_add_urls_none_for_unrelated_issue(issues_module):
    assert issues_module.extract_add_urls(_issue(3, title="question about x")) == []


# ---------------------------------------------------------------------------
# Duplicate detection over case / slash / scheme variants
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "existing_url, submitted_url",
    [
        (
            "https://github.com/owner/repo",
            "https://github.com/OWNER/REPO/",
        ),
        (
            "https://github.com/owner/repo/",
            "http://github.com/owner/repo",
        ),
        (
            "https://github.com/owner/repo",
            "HTTP://GitHub.com/Owner/Repo/",
        ),
    ],
)
def test_variant_submissions_are_duplicates(
    issues_module, existing_url, submitted_url
):
    urls_data = [{"url": existing_url}]
    existing = issues_module.get_existing_urls(urls_data)
    fake = FakeGitHub([])
    issue = _issue(10, body=f"add: {submitted_url}")

    result = issues_module.process_issue(
        issue,
        urls_data,
        existing,
        comment_fn=lambda n, body: fake.post(
            f"https://api.github.com/repos/o/r/issues/{n}/comments", json={"body": body}
        ),
        close_fn=lambda n: fake.patch(
            f"https://api.github.com/repos/o/r/issues/{n}", json={"state": "closed"}
        ),
    )

    assert result == "duplicate"
    # Nothing new is stored
    assert urls_data == [{"url": existing_url}]
    # A comment explains it already exists and the issue is closed
    assert len(fake.comments) == 1 and fake.comments[0][0] == 10
    assert "already in our list" in fake.comments[0][1]
    assert fake.closed == [10]


def test_new_url_is_added_commented_and_closed(issues_module):
    urls_data = [{"url": "https://github.com/owner/existing"}]
    existing = issues_module.get_existing_urls(urls_data)
    fake = FakeGitHub([])
    issue = _issue(11, body="add: https://github.com/owner/new-tool")

    result = issues_module.process_issue(
        issue,
        urls_data,
        existing,
        comment_fn=lambda n, body: fake.post(
            f"https://api.github.com/repos/o/r/issues/{n}/comments", json={"body": body}
        ),
        close_fn=lambda n: fake.patch(
            f"https://api.github.com/repos/o/r/issues/{n}", json={"state": "closed"}
        ),
    )

    assert result == "added"
    assert {"url": "https://github.com/owner/new-tool"} in urls_data
    assert "has been added to the list" in fake.comments[0][1]
    assert fake.closed == [11]


# ---------------------------------------------------------------------------
# One issue, several links: only the first is ingested
# ---------------------------------------------------------------------------

def test_multi_link_issue_only_first_link_is_ingested(issues_module):
    urls_data = []
    existing = issues_module.get_existing_urls(urls_data)
    fake = FakeGitHub([])
    issue = _issue(
        20,
        body=(
            "add: https://github.com/owner/first\n"
            "add: https://github.com/owner/second\n"
            "add: https://github.com/owner/third\n"
        ),
    )

    result = issues_module.process_issue(
        issue,
        urls_data,
        existing,
        comment_fn=lambda n, body: fake.post(
            f"https://api.github.com/repos/o/r/issues/{n}/comments", json={"body": body}
        ),
        close_fn=lambda n: fake.patch(
            f"https://api.github.com/repos/o/r/issues/{n}", json={"state": "closed"}
        ),
    )

    assert result == "added"
    # Only the first link landed in urls.json
    assert urls_data == [{"url": "https://github.com/owner/first"}]
    # The comment names the unprocessed links
    comment = fake.comments[0][1]
    assert "https://github.com/owner/second" in comment
    assert "https://github.com/owner/third" in comment
    assert "only the first" in comment.lower()
    assert "2 link(s)" in comment
    assert fake.closed == [20]


def test_multi_link_issue_duplicate_first_still_lists_extras(issues_module):
    urls_data = [{"url": "https://github.com/owner/first"}]
    existing = issues_module.get_existing_urls(urls_data)
    fake = FakeGitHub([])
    issue = _issue(
        21,
        body=(
            "add: https://github.com/owner/first/\n"  # duplicate (slash variant)
            "add: https://github.com/owner/second\n"
        ),
    )

    result = issues_module.process_issue(
        issue,
        urls_data,
        existing,
        comment_fn=lambda n, body: fake.post(
            f"https://api.github.com/repos/o/r/issues/{n}/comments", json={"body": body}
        ),
        close_fn=lambda n: fake.patch(
            f"https://api.github.com/repos/o/r/issues/{n}", json={"state": "closed"}
        ),
    )

    assert result == "duplicate"
    assert urls_data == [{"url": "https://github.com/owner/first"}]
    comment = fake.comments[0][1]
    assert "already in our list" in comment
    assert "https://github.com/owner/second" in comment


def test_issues_from_other_users_are_skipped(issues_module):
    urls_data = []
    existing = set()
    fake = FakeGitHub([])
    issue = _issue(
        30, body="add: https://github.com/owner/x", author="some-random-user"
    )

    result = issues_module.process_issue(
        issue, urls_data, existing,
        comment_fn=lambda n, body: None,
        close_fn=lambda n: None,
    )
    assert result is None
    assert urls_data == []
    assert fake.comments == [] and fake.closed == []


# ---------------------------------------------------------------------------
# main() end-to-end with faked HTTP and a local urls.json
# ---------------------------------------------------------------------------

def test_main_persists_only_first_link_and_skips_pull_requests(
    issues_module, tmp_path, monkeypatch
):
    urls_path = tmp_path / "urls.json"
    urls_path.write_text(
        json.dumps([{"url": "https://github.com/owner/existing"}]),
        encoding="utf-8",
    )
    issues = [
        # pull request must be filtered out
        {"number": 1, "title": "add: https://github.com/owner/pr", "body": "",
         "user": {"login": "pawel-krzych"}, "pull_request": {"url": "x"}},
        # multi-link issue: only first stored
        _issue(2, body=(
            "add: https://github.com/owner/first\n"
            "add: https://github.com/owner/second\n"
        )),
        # duplicate with casing/slash/scheme variant
        _issue(3, body="add: http://github.com/OWNER/Existing/"),
        # brand new repo
        _issue(4, body="add: https://github.com/owner/another"),
    ]
    fake = FakeGitHub(issues)

    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")

    summary = issues_module.main(
        urls_path,
        http_get=fake.get,
        http_post=fake.post,
        http_patch=fake.patch,
    )

    assert summary["added_count"] == 2
    assert summary["duplicate_count"] == 1

    stored = json.loads(urls_path.read_text(encoding="utf-8"))
    stored_urls = [item["url"] for item in stored]
    assert stored_urls == [
        "https://github.com/owner/existing",
        "https://github.com/owner/first",
        "https://github.com/owner/another",
    ]
    # second link of issue #2 never persisted
    assert "https://github.com/owner/second" not in stored_urls

    # Every processed issue got exactly one comment and was closed
    comment_numbers = sorted(n for n, _ in fake.comments)
    assert comment_numbers == [2, 3, 4]
    assert sorted(fake.closed) == [2, 3, 4]

    # Multi-link warning present on issue #2
    issue2_comment = next(body for n, body in fake.comments if n == 2)
    assert "only the first" in issue2_comment.lower()
    assert "https://github.com/owner/second" in issue2_comment

    # Duplicate explanation on issue #3
    issue3_comment = next(body for n, body in fake.comments if n == 3)
    assert "already in our list" in issue3_comment
