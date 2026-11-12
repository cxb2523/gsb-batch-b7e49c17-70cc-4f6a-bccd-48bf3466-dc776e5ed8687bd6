"""Tests for blacklist filtering and fetch-failure record building."""

import json

from utils.storage import (
    FETCH_FAILED_AT_KEY,
    FETCH_FAILED_KEY,
    build_fetch_failed_entry,
    filter_blacklisted_urls,
    load_blacklist,
    update_urls_json,
)


def _entry(url, name=None):
    item = {"url": url}
    if name is not None:
        item["name"] = name
    return item


def write_blacklist(path, lines):
    path.write_text(
        "\n".join(["# a comment line", *lines]) + "\n", encoding="utf-8"
    )


def test_blacklist_removes_matching_entries_and_reports_urls(tmp_path):
    blacklist_file = tmp_path / "blacklist.txt"
    write_blacklist(
        blacklist_file,
        [
            "https://github.com/banned/repo-one",
            "https://github.com/another/banned",
        ],
    )
    blacklist = load_blacklist(blacklist_file)

    urls_data = [
        _entry("https://github.com/banned/repo-one", name="repo-one"),
        _entry("https://github.com/keep/me", name="keep-me"),
        _entry("https://github.com/another/banned", name="banned-two"),
    ]

    filtered, removed = filter_blacklisted_urls(urls_data, blacklist)

    # Count and concrete URL list are both reported correctly
    assert len(removed) == 2
    removed_urls = [item["url"] for item in removed]
    assert removed_urls == [
        "https://github.com/banned/repo-one",
        "https://github.com/another/banned",
    ]
    assert [item["url"] for item in filtered] == ["https://github.com/keep/me"]


def test_blacklist_matches_case_slash_and_scheme_variants(tmp_path):
    blacklist_file = tmp_path / "blacklist.txt"
    # Blacklist uses the canonical spelling; urls.json uses variants
    write_blacklist(blacklist_file, ["https://github.com/banned/repo"])
    blacklist = load_blacklist(blacklist_file)

    variants = [
        _entry("http://github.com/banned/repo"),  # different scheme
        _entry("https://github.com/BANNED/REPO/"),  # different case + slash
        _entry("https://github.com/banned/repo/"),  # trailing slash
    ]

    filtered, removed = filter_blacklisted_urls(variants, blacklist)

    assert filtered == []
    assert len(removed) == 3


def test_blacklist_empty_keeps_everything():
    urls_data = [_entry("https://github.com/keep/me")]
    filtered, removed = filter_blacklisted_urls(urls_data, set())
    assert filtered is not urls_data  # a copy is returned
    assert filtered == urls_data
    assert removed == []


def test_build_fetch_failed_entry_keeps_url_and_name_without_metrics():
    previous = {
        "name": "old-tool",
        "full_name": "owner/old-tool",
        "url": "https://github.com/owner/old-tool",
        "description": "stale description",
        "stars": 9999,
        "version": "v9.9.9",
        "updated_at": "2020-01-01",
        "topics": ["stale"],
    }

    failed = build_fetch_failed_entry(previous, failed_at="2026-11-12T00:00:00+00:00")

    # Original identity is preserved ...
    assert failed["url"] == "https://github.com/owner/old-tool"
    assert failed["name"] == "old-tool"
    # ... with an explicit failure flag and timestamp ...
    assert failed[FETCH_FAILED_KEY] is True
    assert failed[FETCH_FAILED_AT_KEY] == "2026-11-12T00:00:00+00:00"
    # ... and no stale metric that could be rendered as fresh data
    for stale_key in ("stars", "version", "updated_at", "description", "topics"):
        assert stale_key not in failed


def test_build_fetch_failed_entry_derives_name_from_url_when_missing():
    failed = build_fetch_failed_entry(
        {"url": "https://github.com/owner/no-name-yet/"},
        failed_at="2026-11-12T00:00:00+00:00",
    )
    assert failed["name"] == "no-name-yet"
    assert failed["url"] == "https://github.com/owner/no-name-yet/"
    assert failed[FETCH_FAILED_KEY] is True


def test_failed_entry_round_trips_through_json(tmp_path):
    urls_path = tmp_path / "urls.json"
    failed = build_fetch_failed_entry(
        {"url": "https://github.com/owner/old", "name": "old"},
        failed_at="2026-11-12T00:00:00+00:00",
    )
    update_urls_json([failed], urls_path)

    reloaded = json.loads(urls_path.read_text(encoding="utf-8"))
    assert reloaded == [failed]
    assert reloaded[0][FETCH_FAILED_KEY] is True
