"""Tests for shared URL normalization and GitHub URL parsing."""

import pytest

from utils.urlutils import normalize_url, parse_github_repo, repo_name_from_url


@pytest.mark.parametrize(
    "raw, expected",
    [
        # trailing slash is ignored
        ("https://github.com/owner/repo/", "https://github.com/owner/repo"),
        ("https://github.com/owner/repo///", "https://github.com/owner/repo"),
        # case is ignored
        ("https://github.com/OWNER/Repo", "https://github.com/owner/repo"),
        ("HTTPS://GITHUB.COM/Owner/Repo", "https://github.com/owner/repo"),
        # http and https are the same repository
        ("http://github.com/owner/repo", "https://github.com/owner/repo"),
        ("HTTP://github.com/Owner/Repo/", "https://github.com/owner/repo"),
        # query strings and fragments are irrelevant
        (
            "https://github.com/owner/repo?tab=readme#installation",
            "https://github.com/owner/repo",
        ),
        # surrounding whitespace and trailing punctuation tolerated
        ("  https://github.com/owner/repo, ", "https://github.com/owner/repo"),
    ],
)
def test_normalize_url_variants_collapse(raw, expected):
    assert normalize_url(raw) == expected


@pytest.mark.parametrize(
    "a, b",
    [
        # case + trailing slash variants of the same repository are duplicates
        ("https://github.com/Owner/Repo", "https://github.com/owner/repo/"),
        ("HTTP://github.com/Owner/Repo/", "https://github.com/owner/repo"),
        ("http://github.com/owner/repo", "https://GITHUB.com/OWNER/REPO/"),
    ],
)
def test_normalized_urls_are_judged_duplicate(a, b):
    assert normalize_url(a) == normalize_url(b)


def test_different_repos_are_not_duplicates():
    assert (
        normalize_url("https://github.com/owner/repo-a")
        != normalize_url("https://github.com/owner/repo-b")
    )


def test_normalize_empty_url():
    assert normalize_url("") == ""


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://github.com/owner/repo", ("owner", "repo")),
        ("http://github.com/Owner/Repo/", ("Owner", "Repo")),
        ("github.com/owner/repo", ("owner", "repo")),
        ("//github.com/owner/repo", ("owner", "repo")),
        ("https://github.com/owner/repo/issues/1", ("owner", "repo")),
    ],
)
def test_parse_github_repo(url, expected):
    assert parse_github_repo(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://gitlab.com/owner/repo",
        "not a url",
        "",
    ],
)
def test_parse_github_repo_invalid(url):
    assert parse_github_repo(url) is None


def test_repo_name_from_url():
    assert repo_name_from_url("https://github.com/Owner/My-Tool/") == "My-Tool"
    assert repo_name_from_url("not-a-url") == "not-a-url"
