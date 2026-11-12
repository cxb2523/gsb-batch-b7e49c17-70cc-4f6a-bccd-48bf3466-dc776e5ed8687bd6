"""Tests for README markdown rendering, especially fetch-failed rows."""

from utils.markdown import (
    DATA_UNAVAILABLE_HINT,
    MISSING_METRIC,
    _format_repo_row,
    generate_category_tables,
    generate_markdown_table,
)
from utils.storage import FETCH_FAILED_KEY


def _ok_repo(name="good-tool", stars=1234, version="v1.2.3", updated="2026-11-01"):
    return {
        "name": name,
        "full_name": f"owner/{name}",
        "url": f"https://github.com/owner/{name}",
        "description": "a useful tool",
        "stars": stars,
        "version": version,
        "updated_at": updated,
        "topics": [],
    }


def _failed_repo(name="dead-tool", url=None, failed_at="2026-11-12T08:30:00+00:00"):
    return {
        "name": name,
        "url": url or f"https://github.com/owner/{name}",
        FETCH_FAILED_KEY: True,
        "fetch_failed_at": failed_at,
    }


def test_failed_row_shows_missing_markers_and_no_fake_metrics():
    row = _format_repo_row(_failed_repo())

    # The repository is still linked so the row remains present
    assert 'href="https://github.com/owner/dead-tool"' in row
    assert "dead-tool" in row
    # A recognizable missing-data hint (with failure date) is shown in place
    # of a version sub-line
    sub_line = row.split("<sub>")[1].split("</sub>")[0]
    assert DATA_UNAVAILABLE_HINT in sub_line
    assert "2026-11-12" in sub_line
    # No release tag (versions look like v1.2.3) appears in the sub-line
    import re

    assert re.search(r"v\d+\.\d+", sub_line) is None
    assert "1,000" not in row
    assert MISSING_METRIC in row
    # Both stars and updated columns carry the missing marker
    assert row.rstrip().endswith(f"| {MISSING_METRIC} | {MISSING_METRIC} |")


def test_failed_row_never_contains_stale_star_count():
    # Build the failed entry from a record that used to carry real metrics;
    # the rendered row must not leak any of them.
    from utils.storage import build_fetch_failed_entry

    stale_record = {
        "name": "dead-tool",
        "url": "https://github.com/owner/dead-tool",
        "stars": 999999,
        "version": "v9.9.9",
        "updated_at": "2019-01-01",
        "description": "ancient",
    }
    failed = build_fetch_failed_entry(
        stale_record, failed_at="2026-11-12T08:30:00+00:00"
    )
    row = _format_repo_row(failed)
    assert "999,999" not in row
    assert "v9.9.9" not in row
    assert "2019-01-01" not in row
    assert "ancient" not in row


def test_successful_row_renders_stars_and_version():
    row = _format_repo_row(_ok_repo())
    assert "1,234" in row  # formatted star count
    assert "v1.2.3" in row  # version sub-line
    assert "2026-11-01" in row
    assert MISSING_METRIC not in row


def test_generate_table_keeps_failed_rows_and_sorts_them_last():
    repos = [
        _failed_repo(name="dead-tool"),
        _ok_repo(name="small-tool", stars=10),
        _ok_repo(name="big-tool", stars=9000),
    ]

    table, category_tables, end_tables = generate_markdown_table(repos, {})

    # Failed row is still rendered ...
    assert "dead-tool" in table
    assert DATA_UNAVAILABLE_HINT in table
    # ... while successful repos keep their real stars
    assert "9,000" in table
    assert "10" in table

    lines = [line for line in table.splitlines() if line.startswith("| <a")]
    names_in_order = [
        line.split(">")[1].split("<")[0] for line in lines
    ]
    assert names_in_order == ["big-tool", "small-tool", "dead-tool"]


def test_bare_url_only_entries_are_not_rendered():
    repos = [
        {"url": "https://github.com/owner/brand-new"},  # never scraped yet
        _ok_repo(name="good-tool"),
    ]
    table, _, _ = generate_markdown_table(repos, {})

    assert "brand-new" not in table
    assert "good-tool" in table


def test_failed_entry_appears_in_its_category_table():
    repos = [_failed_repo(name="categorized-dead")]
    categories = {
        "http_clients": {
            "name": "HTTP Clients & Request Libraries",
            "description": "raw HTTP",
            "repos": [
                {"name": "categorized-dead", "categories": ["http_clients"]}
            ],
        }
    }

    category_tables = generate_category_tables(categories, repos)
    table = category_tables["http_clients"]

    assert "categorized-dead" in table
    assert DATA_UNAVAILABLE_HINT in table
    assert MISSING_METRIC in table
