"""End-to-end tests for the scrape/write-back pipeline with faked fetches.

No real GitHub API access happens: ``fetch_repo_data`` is replaced by a local
fake and every file lives under a pytest temporary directory.
"""

import importlib.util
import json
from pathlib import Path

import pytest

from utils.storage import (
    FETCH_FAILED_AT_KEY,
    FETCH_FAILED_KEY,
    build_fetch_failed_entry,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "update_readme.py"


def _load_update_readme_module():
    spec = importlib.util.spec_from_file_location("update_readme_script", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def update_readme_module():
    return _load_update_readme_module()


def _write(path: Path, data) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _full_repo(owner, repo):
    """Shape of a successful fetch_repo_data result."""
    return {
        "name": repo,
        "full_name": f"{owner}/{repo}",
        "url": f"https://github.com/{owner}/{repo}",
        "description": "fetched description",
        "stars": 4242,
        "version": "v2.0.0",
        "updated_at": "2026-11-10",
        "topics": ["scraping"],
    }


@pytest.fixture
def workspace(tmp_path):
    """Build a local urls.json / blacklist / categories workspace."""
    urls = [
        {
            "name": "alive",
            "full_name": "owner/alive",
            "url": "https://github.com/owner/alive",
            "description": "old description",
            "stars": 1,
            "version": "v0.0.1",
            "updated_at": "2020-01-01",
            "topics": [],
        },
        {
            "name": "flaky",
            "full_name": "owner/flaky",
            "url": "https://github.com/owner/flaky",
            "description": "old flaky description",
            "stars": 555,
            "version": "v1.0.0",
            "updated_at": "2021-05-05",
            "topics": [],
        },
        {
            "name": "banned",
            "full_name": "evil/banned",
            "url": "https://github.com/evil/banned",
            "description": "should be removed",
            "stars": 99,
            "version": "v0.1.0",
            "updated_at": "2022-02-02",
            "topics": [],
        },
    ]
    _write(tmp_path / "urls.json", urls)
    (tmp_path / "blacklist.txt").write_text(
        "https://github.com/evil/banned\n", encoding="utf-8"
    )
    _write(tmp_path / "categories.json", {})
    return tmp_path


def test_pipeline_marks_failures_removes_blacklist_and_reports(
    update_readme_module, workspace, capsys
):
    failed_at = "2026-11-12T10:15:00+00:00"

    def fake_fetcher(owner, repo, token=None):
        if repo == "flaky":
            return None  # simulated GitHub fetch failure
        return _full_repo(owner, repo)

    # Deterministic failure timestamps
    def fake_failure_builder(item):
        return build_fetch_failed_entry(item, failed_at=failed_at)

    summary = update_readme_module.run_pipeline(
        urls_path=str(workspace / "urls.json"),
        blacklist_path=str(workspace / "blacklist.txt"),
        readme_path=str(workspace / "README.md"),
        categories_path=str(workspace / "categories.json"),
        history_dir=str(workspace / "history"),
        token=None,
        fetcher=fake_fetcher,
        failure_builder=fake_failure_builder,
    )

    # --- Blacklist reporting -------------------------------------------------
    assert summary["removed_count"] == 1
    assert summary["removed_urls"] == ["https://github.com/evil/banned"]
    captured = capsys.readouterr()
    assert "Removed 1 blacklisted URL(s)" in captured.out
    assert "https://github.com/evil/banned" in captured.out

    # --- urls.json write-back ------------------------------------------------
    written = json.loads((workspace / "urls.json").read_text(encoding="utf-8"))
    assert len(written) == 2  # blacklisted entry never made it through

    by_name = {item["name"]: item for item in written}

    # Successful fetch: complete fresh fields
    alive = by_name["alive"]
    assert alive["stars"] == 4242
    assert alive["version"] == "v2.0.0"
    assert alive["updated_at"] == "2026-11-10"
    assert FETCH_FAILED_KEY not in alive

    # Failed fetch: keeps identity, drops stale metrics, carries failure marker
    flaky = by_name["flaky"]
    assert flaky["url"] == "https://github.com/owner/flaky"
    assert flaky["name"] == "flaky"
    assert flaky[FETCH_FAILED_KEY] is True
    assert flaky[FETCH_FAILED_AT_KEY] == failed_at
    for stale_key in ("stars", "version", "updated_at", "description"):
        assert stale_key not in flaky

    assert summary["failed_count"] == 1

    # --- README rendering ----------------------------------------------------
    readme = (workspace / "README.md").read_text(encoding="utf-8")
    assert "alive" in readme
    assert "4,242" in readme  # real, fresh stars
    # Failed row remains visible but shows missing markers, not stale metrics
    assert "flaky" in readme
    assert "555" not in readme  # stale star count must not leak
    assert "v1.0.0" not in readme  # stale version must not leak
    assert "data unavailable" in readme
    # Blacklisted entry is gone entirely
    assert "banned" not in readme

    # --- History backup was created -----------------------------------------
    backups = list((workspace / "history").glob("urls_*.json"))
    assert len(backups) == 1


def test_scrape_repos_failure_keeps_url_and_name(update_readme_module):
    previous = [
        {
            "name": "only-name",
            "url": "https://github.com/owner/only-name",
            "stars": 7,
            "version": "v7.7.7",
        }
    ]

    def always_fails(owner, repo, token=None):
        return None

    result = update_readme_module.scrape_repos(
        previous,
        token=None,
        fetcher=always_fails,
        failure_builder=lambda item: build_fetch_failed_entry(
            item, failed_at="2026-11-12T00:00:00+00:00"
        ),
    )

    assert len(result) == 1
    entry = result[0]
    assert entry["url"] == "https://github.com/owner/only-name"
    assert entry["name"] == "only-name"
    assert entry[FETCH_FAILED_KEY] is True
    assert "stars" not in entry and "version" not in entry
