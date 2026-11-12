"""
Lake maintenance and the file lock, against a real DuckDB.

What maintenance.py promises: the lake stops growing, no data is lost, a write
in progress is never mistaken for an orphan, and nothing is deleted while
someone else holds the file lock.
"""

import datetime
import pathlib
import shutil

import pytest

from datavloot_platform import maintenance, storage

duckdb = pytest.importorskip("duckdb", reason="duckdb is not installed")

# Delete everything that may be deleted, so a test sees the effect in one run.
AT_ONCE = dict(keep_snapshots=datetime.timedelta(0), file_grace=datetime.timedelta(0))


@pytest.fixture
def project(tmp_path, monkeypatch) -> pathlib.Path:
    monkeypatch.delenv(storage.LAKE_DIR_ENV, raising=False)
    root = tmp_path / "sales"
    root.mkdir()
    (root / "dbt_project.yml").write_text("name: 'sales'\nversion: '1.0.0'\n", encoding="utf-8")
    return root


def _round_of_writes(project):
    """
    What a pipeline run does, without adding data: rebuild one table, reload
    another in small batches after deleting its rows. The data stays the same,
    so anything the lake keeps growing by is what maintenance has to remove.
    """
    con = storage.connect(project)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        con.execute("CREATE OR REPLACE TABLE raw.rebuilt AS SELECT range AS i FROM range(5000)")
        con.execute("CREATE TABLE IF NOT EXISTS raw.appended (i BIGINT)")
        con.execute("DELETE FROM raw.appended")
        for batch in range(10):
            con.execute(f"INSERT INTO raw.appended SELECT range + {batch * 3000} FROM range(3000)")
    finally:
        con.close()


def _files(project) -> list[pathlib.Path]:
    return list(storage.data_path(project).rglob("*.parquet"))


def _rows(project) -> dict[str, int]:
    con = storage.connect(project, read_only=True)
    try:
        return {
            table: con.execute(f"SELECT count(*) FROM raw.{table}").fetchone()[0]
            for table in ("rebuilt", "appended")
        }
    finally:
        con.close()


def test_the_lake_stops_growing(project):
    """Repeated runs leave the file count and the directory size where they were."""
    sizes = []
    for _ in range(4):
        _round_of_writes(project)
        maintenance.maintain(project, **AT_ONCE)
        files = _files(project)
        sizes.append((len(files), sum(f.stat().st_size for f in files)))

    assert sizes[1] == sizes[2] == sizes[3], f"(files, bytes) per run: {sizes}"


def test_no_data_is_lost(project):
    _round_of_writes(project)
    _round_of_writes(project)
    before = _rows(project)

    maintenance.maintain(project, **AT_ONCE)

    assert _rows(project) == before == {"rebuilt": 5000, "appended": 30000}


def test_nothing_recent_is_deleted_by_default(project):
    """
    Fresh snapshots stay, and files replaced by today's merge stay too, so a
    reader that is still on them can finish.

    With a grace of one hour this deleted the merged-away files at once: the
    SQLite catalog compares cleanup cutoffs by date (see maintenance.py).
    """
    _round_of_writes(project)
    result = maintenance.maintain(project)

    assert result["snapshots_expired"] == 0
    assert result["files_deleted"] == 0


def test_a_write_in_progress_is_not_taken_for_an_orphan(project):
    """
    A writer puts its Parquet file on disk before it commits; until then the
    catalog does not know the file. With the default grace it must survive.
    """
    _round_of_writes(project)
    in_flight = _files(project)[0].with_name("ducklake-in-flight.parquet")
    shutil.copy(_files(project)[0], in_flight)

    maintenance.maintain(project, keep_snapshots=datetime.timedelta(0), file_grace=datetime.timedelta(0))

    assert in_flight.exists()


def test_nothing_is_deleted_while_the_file_lock_is_held(project):
    """A backup holds the lock; cleanup then skips, and the next run catches up."""
    _round_of_writes(project)
    with storage.file_lock(project):
        held = maintenance.maintain(project, **AT_ONCE)
        files_while_held = len(_files(project))

    assert held["cleanup_skipped"] == 1 and held["files_deleted"] == 0
    after = maintenance.maintain(project, **AT_ONCE)
    assert after["cleanup_skipped"] == 0 and after["files_deleted"] > 0
    assert len(_files(project)) < files_while_held


def test_the_file_lock_excludes_a_second_holder(project):
    with storage.file_lock(project):
        with pytest.raises(TimeoutError):
            with storage.file_lock(project, timeout=0.5):
                pass
    with storage.file_lock(project, timeout=0):
        pass
