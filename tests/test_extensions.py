"""
DuckDB extensions are installed at `datavloot new`, and a failed download
explains how to install by hand instead of surfacing a bare download error later.

Most tests use a stand-in connection, so they run in the fast tier without the
optimist extra. The last two use real DuckDB and are skipped without it.
"""

import argparse
import os
import sys
import types

import pytest

from datavloot_platform import cli, extensions


class FakeConn:
    """Answers the handful of queries extensions.py makes, like DuckDB 1.5.6 on Windows."""

    def __init__(self, installed=(), fail_install=False, repository=""):
        self.installed = set(installed)
        self.fail_install = fail_install
        self.repository = repository
        self.statements = []
        self._result = None

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "duckdb_extensions()" in sql:
            self._result = (params[0] in self.installed,)
        elif "custom_extension_repository" in sql:
            self._result = (self.repository,)
        elif sql == "SELECT version()":
            self._result = ("v1.5.6",)
        elif sql == "PRAGMA platform":
            self._result = ("windows_amd64",)
        elif sql.startswith("INSTALL "):
            if self.fail_install:
                raise OSError('IO Error: Failed to download extension "ducklake"\nmore detail')
            self.installed.add(sql.split()[1])
        return self

    def fetchone(self):
        return self._result

    def close(self):
        pass


URL = "http://extensions.duckdb.org/v1.5.6/windows_amd64/ducklake.duckdb_extension.gz"


def test_an_installed_extension_is_not_downloaded_again():
    conn = FakeConn(installed=set(extensions.REQUIRED))
    assert extensions.install(conn) == []
    assert not any(s.startswith("INSTALL") for s in conn.statements)


def test_a_missing_extension_is_installed():
    conn = FakeConn()
    assert extensions.install(conn) == []
    assert "INSTALL ducklake" in conn.statements


def test_a_failed_download_explains_the_manual_route():
    [message] = extensions.install(FakeConn(fail_install=True), names=("ducklake",))
    assert URL in message, "the message must name the exact file for this DuckDB and platform"
    assert "INSTALL '<path to the downloaded file>'" in message
    assert "Failed to download extension" in message, "keep DuckDB's own reason"
    assert "more detail" not in message, "only the first line of DuckDB's error"


def test_the_manual_route_follows_a_configured_mirror():
    conn = FakeConn(fail_install=True, repository="https://mirror.example.com/duckdb/")
    [message] = extensions.install(conn, names=("ducklake",))
    assert "https://mirror.example.com/duckdb/v1.5.6/windows_amd64/ducklake.duckdb_extension.gz" in message


def test_ensure_loaded_installs_then_loads():
    conn = FakeConn()
    extensions.ensure_loaded(conn, "ducklake")
    assert conn.statements[-2:] == ["INSTALL ducklake", "LOAD ducklake"]


def test_ensure_loaded_raises_with_the_manual_route():
    with pytest.raises(extensions.ExtensionUnavailable, match="INSTALL '<path"):
        extensions.ensure_loaded(FakeConn(fail_install=True), "ducklake")


# --- the CLI ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def no_location_warnings(monkeypatch):
    """`new` also warns about where the project lives; a deep or synced temp dir
    on the test machine must not show up as an extension warning."""
    monkeypatch.setattr(cli, "_warn_about_location", lambda *args: None)


@pytest.fixture
def fake_duckdb(monkeypatch):
    """Put a stand-in duckdb module in place; returns the connection it hands out."""
    def install(conn):
        module = types.ModuleType("duckdb")
        module.connect = lambda *a, **k: conn
        monkeypatch.setitem(sys.modules, "duckdb", module)
        return conn
    return install


def test_new_preinstalls_the_extensions(tmp_path, fake_duckdb):
    conn = fake_duckdb(FakeConn())
    cli.cmd_new(argparse.Namespace(path=str(tmp_path / "sales")))
    assert "INSTALL ducklake" in conn.statements


def test_new_still_creates_the_project_when_the_download_fails(tmp_path, capsys, fake_duckdb):
    fake_duckdb(FakeConn(fail_install=True))
    dest = tmp_path / "sales"

    cli.cmd_new(argparse.Namespace(path=str(dest)))

    assert URL in capsys.readouterr().err
    assert (dest / "dbt_project.yml").is_file(), "a failed download must never stop the scaffold"


def test_new_without_duckdb_installs_nothing(tmp_path, capsys, monkeypatch):
    """The base install has no duckdb; that must not be an error."""
    monkeypatch.setitem(sys.modules, "duckdb", None)  # makes `import duckdb` raise ImportError
    cli.cmd_new(argparse.Namespace(path=str(tmp_path / "sales")))
    out = capsys.readouterr()
    assert "Installing DuckDB extensions" not in out.out
    assert "Warning" not in out.err


# --- real DuckDB --------------------------------------------------------------

def test_the_url_matches_this_duckdb_build():
    duckdb = pytest.importorskip("duckdb")
    url = extensions.download_url(duckdb.connect(), "ducklake")
    assert url.startswith(f"http://extensions.duckdb.org/v{duckdb.__version__}/")
    assert url.endswith("/ducklake.duckdb_extension.gz")


def test_an_unreachable_repository_gives_the_manual_route(tmp_path):
    """
    Real DuckDB, real failure: an empty extension directory and a repository
    nothing listens on. Takes about nine seconds -- DuckDB's own connect timeout.
    """
    duckdb = pytest.importorskip("duckdb")
    # realpath: under a Windows 8.3 short name (C:\Users\STANVE~1\...) DuckDB
    # failed to open its files; the long form of the same path works.
    conn = duckdb.connect(config={"extension_directory": os.path.realpath(tmp_path)})
    conn.execute("SET custom_extension_repository='http://127.0.0.1:9'")

    [message] = extensions.install(conn, names=("ducklake",))

    assert "http://127.0.0.1:9/v" in message and "ducklake.duckdb_extension.gz" in message
    assert not extensions.is_installed(conn, "ducklake")
