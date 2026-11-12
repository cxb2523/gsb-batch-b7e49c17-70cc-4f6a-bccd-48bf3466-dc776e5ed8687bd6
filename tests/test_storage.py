"""
Where a project's lake lives, and the attach every component uses.

The first block needs nothing installed. The second uses real DuckDB and checks
the behaviour storage.py's attach options exist for; each of those was found in
a prototype, not assumed. The dlt test is in the slow tier: it needs the full
optimist extra.
"""

import pathlib
import shutil

import pytest

from datavloot_platform import storage


@pytest.fixture
def project(tmp_path, monkeypatch) -> pathlib.Path:
    """A directory that looks like a project to storage.py: a dbt_project.yml with a name."""
    monkeypatch.delenv(storage.LAKE_DIR_ENV, raising=False)
    root = tmp_path / "sales"
    root.mkdir()
    (root / "dbt_project.yml").write_text("name: 'sales'\nversion: '1.0.0'\n", encoding="utf-8")
    return root


# --- paths --------------------------------------------------------------------

def test_the_project_is_found_from_a_subdirectory(project):
    (project / "notebooks").mkdir()
    assert storage.find_project_dir(project / "notebooks") == project.resolve()


def test_no_project_outside_one(tmp_path):
    assert storage.find_project_dir(tmp_path) is None


@pytest.mark.parametrize("line", ["name: 'sales'", 'name: "sales"', "name: sales"])
def test_the_catalog_is_named_after_the_dbt_project(project, line):
    (project / "dbt_project.yml").write_text(f"{line}\nversion: '1.0.0'\n", encoding="utf-8")
    assert storage.project_name(project) == "sales"


def test_the_lake_lives_in_the_project_by_default(project):
    assert storage.catalog_path(project) == (project / "lake" / "catalog.sqlite").resolve()
    assert storage.data_path(project) == (project / "lake" / "data").resolve()


def test_the_lake_directory_can_be_moved_by_environment(project, tmp_path, monkeypatch):
    monkeypatch.setenv(storage.LAKE_DIR_ENV, str(tmp_path / "volume"))
    assert storage.lake_dir(project) == (tmp_path / "volume").resolve()
    monkeypatch.setenv(storage.LAKE_DIR_ENV, "relative/lake")
    assert storage.lake_dir(project) == (project / "relative" / "lake").resolve(), (
        "a relative override is relative to the project, not to the current directory"
    )


def test_every_attach_carries_the_options_the_lake_needs(project):
    sql = storage.attach_statement(storage.catalog_path(project), storage.data_path(project), "sales")
    data = storage.data_path(project).as_posix()
    assert f"DATA_PATH '{data}/'" in sql, "the data path must be absolute"
    assert "OVERRIDE_DATA_PATH true" in sql
    assert "META_JOURNAL_MODE 'WAL'" in sql
    assert "READ_ONLY" not in sql
    assert "READ_ONLY" in storage.attach_statement(
        storage.catalog_path(project), storage.data_path(project), "sales", read_only=True
    )


# --- real DuckDB --------------------------------------------------------------

def _write(project, rows):
    con = storage.connect(project)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        con.execute("CREATE TABLE IF NOT EXISTS raw.t (i BIGINT)")
        con.execute(f"INSERT INTO raw.t SELECT range FROM range({rows})")
    finally:
        con.close()


def _count(project):
    con = storage.connect(project, read_only=True)
    try:
        return con.execute("SELECT count(*) FROM raw.t").fetchone()[0]
    finally:
        con.close()


def test_a_notebook_connection_serves_marimos_own_sql_engine(project):
    """
    Marimo's built-in "DuckDB (in-memory)" engine runs SQL cells on DuckDB's
    default connection; a notebook's own connection left it an empty database.
    """
    duckdb = pytest.importorskip("duckdb")

    _write(project, 3)
    con = storage.connect(project, read_only=True, default=True)
    try:
        assert con is duckdb.default_connection()
        assert duckdb.sql("SELECT count(*) FROM raw.t").fetchone()[0] == 3
        # A notebook reruns its first cell: attaching again must not fail.
        storage.connect(project, read_only=True, default=True)
    finally:
        # The default connection outlives the test; leave it as it was.
        con.execute("USE memory")
        con.execute("DETACH sales")


def test_a_created_lake_is_in_wal_mode(project):
    """In SQLite's default mode a reader and a writer lock each other out."""
    pytest.importorskip("duckdb")
    import sqlite3

    storage.create(project)
    con = sqlite3.connect(storage.catalog_path(project))
    try:
        assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        con.close()


def test_the_current_directory_does_not_decide_where_data_goes(project, tmp_path, monkeypatch):
    """
    A relative data path follows the current directory, so a notebook and a
    pipeline started from different folders used to write to different places.
    """
    pytest.importorskip("duckdb")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    _write(project, 100)

    assert _count(project) == 100
    assert list(storage.data_path(project).rglob("*.parquet")), "no data file in the lake"
    assert not list(elsewhere.rglob("*.parquet")), "data was written next to the current directory"


def test_a_moved_project_keeps_its_data(project, tmp_path):
    """
    The catalog stores the data path it was created with; the override on every
    attach is what lets the same lake be read and written from a new location.
    """
    pytest.importorskip("duckdb")
    _write(project, 100)

    moved = tmp_path / "moved" / "sales"
    moved.parent.mkdir()
    shutil.move(str(project), str(moved))

    assert _count(moved) == 100
    _write(moved, 50)
    assert _count(moved) == 150


def test_a_reader_does_not_need_write_access_to_open_the_lake(project):
    """Notebooks and the Crows Nest attach read-only; WAL must not make that a write."""
    pytest.importorskip("duckdb")
    _write(project, 10)
    con = storage.connect(project, read_only=True)
    try:
        with pytest.raises(Exception):
            con.execute("INSERT INTO raw.t VALUES (1)")
    finally:
        con.close()


def test_a_reader_before_the_first_run_finds_an_empty_lake(project):
    """`new` no longer creates the lake, so a notebook opened first creates it."""
    pytest.importorskip("duckdb")
    con = storage.connect(project, read_only=True)
    con.close()
    assert storage.catalog_path(project).is_file()


# --- a catalog from a newer DuckLake -------------------------------------------

_DUCKLAKE_SAYS = (
    "Invalid Input Error: DuckLake catalog version mismatch: catalog version is "
    "1.1-dev1, but the extension requires version 1.0. To automatically migrate, "
    "set AUTOMATIC_MIGRATION to TRUE when attaching."
)


def _age(project, version="1.1-dev1"):
    """Mark the project's catalog as written by another DuckLake, as a dev build of DuckDB did."""
    import sqlite3

    con = sqlite3.connect(storage.catalog_path(project))
    try:
        con.execute("UPDATE ducklake_metadata SET value = ? WHERE key = 'version'", [version])
        con.commit()
    finally:
        con.close()


@pytest.mark.parametrize(
    "message",
    [
        "something else went wrong",
        # Older than the extension: DuckLake's AUTOMATIC_MIGRATION advice is right.
        _DUCKLAKE_SAYS.replace("1.1-dev1", "0.3"),
        _DUCKLAKE_SAYS.replace("1.1-dev1", "1.0-dev1"),
    ],
)
def test_only_a_newer_catalog_gets_its_own_message(tmp_path, message):
    assert storage.catalog_too_new(tmp_path / "catalog.sqlite", Exception(message)) is None


def test_an_empty_catalog_from_a_newer_ducklake_may_be_deleted(project):
    """
    `uvx --prerelease allow datavloot new` once created the catalog with a
    development DuckDB; the project's DuckDB then refused it on the first load.
    """
    pytest.importorskip("duckdb")
    storage.create(project)
    _age(project)
    with pytest.raises(storage.CatalogTooNew) as raised:
        storage.connect(project, read_only=True)
    message = str(raised.value)
    assert "catalog version 1.1-dev1" in message and "reads version 1.0" in message
    assert "cannot be migrated back" in message
    assert "holds no tables" in message and "catalog.sqlite-wal" in message


def test_a_catalog_with_tables_from_a_newer_ducklake_is_not_called_disposable(project):
    pytest.importorskip("duckdb")
    _write(project, 3)
    _age(project)
    with pytest.raises(storage.CatalogTooNew) as raised:
        storage.connect(project)
    assert "holds 1 table(s)" in str(raised.value)
    assert "holds no tables" not in str(raised.value)


def test_the_message_matches_what_ducklake_says():
    """The pattern is DuckLake's wording, as DuckDB 1.5 with DuckLake 1.0 gives it."""
    found = storage.catalog_too_new(pathlib.Path("missing.sqlite"), Exception(_DUCKLAKE_SAYS))
    assert found is not None and "It holds tables." in str(found)


@pytest.mark.slow
def test_dlt_loads_into_the_lake_and_still_does_after_a_move(project, tmp_path):
    """
    dlt passes the data path but not the override, so without
    override_data_path a moved project failed with "DATA_PATH ... does not match".
    """
    dlt = pytest.importorskip("dlt")
    pytest.importorskip("pyarrow", reason="dlt's ducklake destination needs dlt[ducklake]")

    def load(root, n):
        pipeline = dlt.pipeline(
            pipeline_name=f"t{n}",
            destination=storage.dlt_destination(root),
            dataset_name="raw",
            pipelines_dir=str(tmp_path / "pipelines"),
        )
        pipeline.run([{"i": i} for i in range(n)], table_name="t")

    load(project, 100)
    assert _count(project) == 100

    moved = tmp_path / "moved" / "sales"
    moved.parent.mkdir()
    shutil.move(str(project), str(moved))
    load(moved, 50)
    assert _count(moved) == 150
