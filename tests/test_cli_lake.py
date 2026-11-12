"""
Who creates a project's lake: the project's own DuckDB, not the CLI's.

`uvx --prerelease allow --from "datavloot[optimist]==..." datavloot new` ran
the CLI with a development build of DuckDB, and `new` created the catalog with
it: DuckLake catalog version 1.1-dev1, which the project's DuckDB 1.5 with
DuckLake 1.0 refused on the first load, with no way to migrate back. Now `new`
and `demo` only install extensions, and `start` creates the lake -- or stops
with what to do when it cannot read the one there is.
"""

import argparse
import sqlite3

import pytest

from datavloot_platform import cli, extensions, storage


@pytest.fixture
def no_download(monkeypatch):
    """Extensions count as installed, so nothing goes to the network."""
    pytest.importorskip("duckdb")
    calls = []
    monkeypatch.setattr(extensions, "install", lambda conn, names=extensions.REQUIRED: calls.append(names) or [])
    return calls


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.delenv(storage.LAKE_DIR_ENV, raising=False)
    root = tmp_path / "sales"
    root.mkdir()
    (root / "dbt_project.yml").write_text("name: 'sales'\nversion: '1.0.0'\n", encoding="utf-8")
    return root


def test_new_installs_extensions_but_leaves_the_lake_to_the_project(tmp_path, no_download):
    dest = tmp_path / "sales"
    cli.cmd_new(argparse.Namespace(path=str(dest)))
    assert no_download, "new should still install the extensions up front"
    assert not storage.catalog_path(dest).exists(), "the CLI's DuckDB created the catalog"


def test_demo_leaves_the_lake_to_the_project(tmp_path, no_download, monkeypatch):
    monkeypatch.setenv("DATAVLOOT_INSTALLER", "1")  # skip the next steps
    dest = tmp_path / "demo"
    cli.cmd_demo(argparse.Namespace(path=str(dest)))
    assert not storage.catalog_path(dest).exists()


def test_start_creates_a_missing_lake(project):
    pytest.importorskip("duckdb")
    cli._check_lake(project)
    assert storage.catalog_path(project).is_file()


def test_start_stops_on_a_catalog_from_a_newer_ducklake(project):
    pytest.importorskip("duckdb")
    storage.create(project)
    con = sqlite3.connect(storage.catalog_path(project))
    con.execute("UPDATE ducklake_metadata SET value = '1.1-dev1' WHERE key = 'version'")
    con.commit()
    con.close()
    with pytest.raises(SystemExit, match="cannot be migrated back") as raised:
        cli._check_lake(project)
    assert "holds no tables" in str(raised.value.code)


def test_start_goes_on_when_the_lake_cannot_be_opened_otherwise(project, monkeypatch, capsys):
    """No network for the extensions, say: the Crows Nest and the runs say so again."""
    def offline(*args, **kwargs):
        raise extensions.ExtensionUnavailable("DuckDB could not install the 'ducklake' extension")

    monkeypatch.setattr(storage, "connect", offline)
    cli._check_lake(project)
    assert "Warning: could not open the lake" in capsys.readouterr().err


def test_start_outside_a_project_leaves_the_lake_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "connect", lambda *a, **k: pytest.fail("attached outside a project"))
    cli._check_lake(tmp_path)
