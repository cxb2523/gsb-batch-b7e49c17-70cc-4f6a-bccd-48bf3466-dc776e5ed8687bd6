"""
Write access in the Crows Nest SQL editor (CROWSNEST_SQL_WRITE).

What it must do: change the lake as if you were on it with DuckDB, leave a
snapshot to undo it with, and step aside for a running pipeline. What it must
not do: reach files, extensions or settings, which the read-only editor never
could either. Every test runs against a .duckdb file and a lake.
"""

import pathlib
import sqlite3
import subprocess
import sys
import textwrap

import pytest

duckdb = pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.routes import query as query_route  # noqa: E402

TABLE = "probe_source.vessels"


@pytest.fixture(params=["file", "lake"])
def warehouse(tmp_path, request, monkeypatch):
    """A throwaway warehouse with ten rows in a source table, and the env pointing at it."""
    from datavloot_platform import storage

    if request.param == "file":
        db = tmp_path / "probe.duckdb"
        con = duckdb.connect(str(db))
        monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
        info = {"kind": "file", "path": db}
    else:
        lake = tmp_path / "lake"
        lake.mkdir()
        con = duckdb.connect()
        con.execute(storage.attach_statement(lake / "catalog.sqlite", lake / "data", "probe"))
        con.execute("USE probe")
        monkeypatch.setenv("CROWSNEST_DUCKLAKE_CATALOG_PATH", str(lake / "catalog.sqlite"))
        monkeypatch.setenv("CROWSNEST_DUCKLAKE_ALIAS", "probe")
        info = {"kind": "lake", "catalog": lake / "catalog.sqlite", "data": lake / "data"}
    con.execute("CREATE SCHEMA probe_source")
    con.execute(f"CREATE TABLE {TABLE} AS SELECT i AS k, 'v' || i AS name FROM range(10) t(i)")
    con.close()

    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("CROWSNEST_SQL_WRITE", raising=False)
    # Nothing listens here, so no real Dagster on :3000 can make a test wait for its run.
    monkeypatch.setenv("CROWSNEST_DAGSTER_URL", "http://127.0.0.1:9/graphql")
    cn_config.reset_config()
    yield info
    cn_config.reset_config()


def _client(host: str | None) -> TestClient:
    from datavloot_platform.crowsnest.server import create_app
    return TestClient(create_app(host=host))


async def _no_active_run():
    return None


@pytest.fixture
def writer(warehouse, monkeypatch) -> TestClient:
    """
    The Crows Nest as `datavloot start` runs it on a laptop: on loopback, so it may write.

    No Dagster to ask about runs: a refused connection takes Windows two seconds,
    on every write. test_no_dagster_means_no_run_to_wait_for asks for real.
    """
    monkeypatch.setattr(query_route, "_active_run", _no_active_run)
    return _client("127.0.0.1")


def run(client: TestClient, sql: str, confirm: bool = False):
    return client.post("/api/query/execute", json={"sql": sql, "confirm": confirm})


def count(client: TestClient, table: str = TABLE) -> int:
    r = run(client, f"SELECT count(*) FROM {table}")
    assert r.status_code == 200, r.text
    return r.json()["rows"][0][0]


# --------------------------------------------------------------------------
# when the editor may write
# --------------------------------------------------------------------------

@pytest.mark.parametrize("host, expected", [
    ("127.0.0.1", True),
    ("localhost", True),
    ("::1", True),
    ("[::1]", True),
    ("127.0.0.2", True),
    ("0.0.0.0", False),
    ("::", False),
    ("192.168.1.10", False),
    ("crowsnest.example.org", False),
    (None, False),
])
def test_unset_it_follows_the_address_listened_on(monkeypatch, host, expected):
    monkeypatch.delenv("CROWSNEST_SQL_WRITE", raising=False)
    assert cn_config.sql_write_enabled(host) is expected


@pytest.mark.parametrize("value, host, expected", [
    ("1", "0.0.0.0", True),
    ("true", None, True),
    ("0", "127.0.0.1", False),
    ("off", "localhost", False),
    ("", "127.0.0.1", True),
])
def test_the_setting_overrides_the_address(monkeypatch, value, host, expected):
    monkeypatch.setenv("CROWSNEST_SQL_WRITE", value)
    assert cn_config.sql_write_enabled(host) is expected


def test_a_setting_it_does_not_understand_is_an_error(monkeypatch):
    monkeypatch.setenv("CROWSNEST_SQL_WRITE", "sometimes")
    with pytest.raises(ValueError, match="CROWSNEST_SQL_WRITE"):
        cn_config.sql_write_enabled("127.0.0.1")


@pytest.mark.parametrize("host", [None, "0.0.0.0"])
def test_read_only_the_editor_refuses_writes_as_before(warehouse, host):
    client = _client(host)
    assert client.get("/api/query/mode").json()["write"] is False
    r = run(client, f"DELETE FROM {TABLE} WHERE k = 1")
    assert r.status_code == 403
    assert "CROWSNEST_SQL_WRITE" in r.json()["detail"]
    assert count(client) == 10


def test_mode_says_whether_writes_leave_snapshots(writer, warehouse):
    assert writer.get("/api/query/mode").json() == {
        "write": True,
        "snapshots": warehouse["kind"] == "lake",
    }


# --------------------------------------------------------------------------
# writing
# --------------------------------------------------------------------------

def test_a_delete_reports_the_rows_it_removed(writer, warehouse):
    r = run(writer, f"DELETE FROM {TABLE} WHERE k < 3")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["write"] is True
    assert body["rows_affected"] == 3
    assert body["confirmation_required"] is None
    assert count(writer) == 7

    if warehouse["kind"] == "lake":
        assert body["snapshot"] > body["snapshot_before"]
    else:
        assert body["snapshot"] is None and body["snapshot_before"] is None


@pytest.mark.parametrize("sql, rows_affected", [
    (f"INSERT INTO {TABLE} VALUES (99, 'new')", 1),
    (f"UPDATE {TABLE} SET name = 'renamed' WHERE k = 4", 1),
    ("CREATE TABLE probe_source.extra AS SELECT 1 AS x UNION ALL SELECT 2", 2),
    ("CREATE SCHEMA probe_scratch", None),
    (f"CREATE VIEW probe_source.v AS SELECT * FROM {TABLE}", None),
    (f"ALTER TABLE {TABLE} ADD COLUMN note VARCHAR", None),
    (f"ALTER TABLE {TABLE} RENAME TO vessels_old", None),
])
def test_statements_that_change_the_lake_run(writer, sql, rows_affected):
    r = run(writer, sql)
    assert r.status_code == 200, r.text
    assert r.json()["rows_affected"] == rows_affected


def test_a_select_still_takes_the_read_path(writer):
    r = run(writer, f"SELECT * FROM {TABLE} ORDER BY k")
    assert r.status_code == 200, r.text
    assert r.json()["write"] is False
    assert r.json()["row_count"] == 10


def test_the_lake_records_who_wrote_and_what(writer, warehouse):
    if warehouse["kind"] != "lake":
        pytest.skip("only a lake keeps snapshots")
    sql = f"DELETE FROM {TABLE} WHERE k = 7"
    snapshot = run(writer, sql).json()["snapshot"]
    r = run(
        writer,
        f"SELECT author, commit_message FROM probe.snapshots() WHERE snapshot_id = {snapshot}",
    )
    assert r.json()["rows"] == [["Crows Nest SQL editor", sql]]


# --------------------------------------------------------------------------
# confirmation for statements that take a whole table
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql, after", [
    (f"DROP TABLE {TABLE}", None),
    (f"TRUNCATE {TABLE}", 0),
    (f"DELETE FROM {TABLE}", 0),
    (f"DELETE FROM {TABLE} -- WHERE k = 1", 0),
    (f"UPDATE {TABLE} SET name = 'where'", 10),
])
def test_whole_table_statements_wait_for_confirmation(writer, sql, after):
    first = run(writer, sql)
    assert first.status_code == 200, first.text
    assert first.json()["confirmation_required"]
    assert count(writer) == 10, "ran before it was confirmed"

    confirmed = run(writer, sql, confirm=True)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["confirmation_required"] is None
    if after is None:
        assert run(writer, f"SELECT 1 FROM {TABLE}").status_code == 404
    else:
        assert count(writer) == after


@pytest.mark.parametrize("sql", [
    f"DELETE FROM {TABLE} WHERE k = 1",
    f"UPDATE {TABLE} SET name = 'x' WHERE k = 1",
    f"INSERT INTO {TABLE} VALUES (50, 'x')",
])
def test_targeted_writes_need_no_confirmation(writer, sql):
    r = run(writer, sql)
    assert r.json()["confirmation_required"] is None


# --------------------------------------------------------------------------
# undo with a snapshot
# --------------------------------------------------------------------------

def test_deleted_rows_come_back_from_the_snapshot_before(writer, warehouse):
    if warehouse["kind"] != "lake":
        pytest.skip("only a lake keeps snapshots")
    before = run(writer, f"DELETE FROM {TABLE} WHERE k < 4").json()["snapshot_before"]
    r = run(writer, f"INSERT INTO {TABLE} SELECT * FROM {TABLE} AT (VERSION => {before}) WHERE k < 4")
    assert r.json()["rows_affected"] == 4
    assert count(writer) == 10


def test_a_dropped_table_comes_back_from_the_snapshot_before(writer, warehouse):
    if warehouse["kind"] != "lake":
        pytest.skip("only a lake keeps snapshots")
    before = run(writer, f"DROP TABLE {TABLE}", confirm=True).json()["snapshot_before"]
    r = run(writer, f"CREATE TABLE {TABLE} AS SELECT * FROM {TABLE} AT (VERSION => {before})")
    assert r.status_code == 200, r.text
    assert count(writer) == 10


# --------------------------------------------------------------------------
# write access is to the database, not the machine
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    "COPY (SELECT 1) TO 'leak.csv'",
    f"COPY {TABLE} TO 'leak.parquet' (FORMAT PARQUET)",
    "ATTACH 'elsewhere.duckdb' AS other",
    "INSTALL httpfs",
    "LOAD httpfs",
    "SET enable_external_access = true",
    "CHECKPOINT",
    "VACUUM",
    f"EXPLAIN ANALYZE DELETE FROM {TABLE}",
    f"DELETE FROM {TABLE} WHERE k = 1; DROP TABLE {TABLE}",
])
def test_write_access_does_not_widen_to_everything(writer, sql):
    r = run(writer, sql, confirm=True)
    assert r.status_code in (400, 403), f"{sql!r} returned {r.status_code}: {r.text[:200]}"
    assert count(writer) == 10


def test_copy_cannot_write_into_the_lake_data(writer, warehouse, tmp_path):
    target = warehouse.get("data", tmp_path) / "planted.csv"
    r = run(writer, f"COPY (SELECT 42 AS x) TO '{target.as_posix()}' (FORMAT csv)", confirm=True)
    assert r.status_code in (400, 403), r.text
    assert not target.exists()


def test_files_outside_the_lake_stay_closed_to_a_write(writer, tmp_path):
    secret = tmp_path / "secret.csv"
    secret.write_text("k,name\n1,x\n", encoding="utf-8")
    r = run(writer, f"INSERT INTO {TABLE} SELECT * FROM read_csv('{secret.as_posix()}')")
    assert r.status_code in (400, 403), r.text
    assert count(writer) == 10


# --------------------------------------------------------------------------
# one writer at a time
# --------------------------------------------------------------------------

def test_a_running_pipeline_is_not_written_across(writer, monkeypatch):
    async def active_run():
        return "Materialize: vessels"

    monkeypatch.setattr(query_route, "_active_run", active_run)
    r = run(writer, f"DELETE FROM {TABLE} WHERE k = 1")
    assert r.status_code == 409
    assert "pipeline run is in progress" in r.json()["detail"]
    assert "Materialize: vessels" in r.json()["detail"]
    assert count(writer) == 10


def test_no_dagster_means_no_run_to_wait_for(warehouse):
    """CROWSNEST_DAGSTER_URL points at a closed port (the warehouse fixture)."""
    client = _client("127.0.0.1")
    assert run(client, f"DELETE FROM {TABLE} WHERE k = 1").status_code == 200


def test_an_active_run_is_found_in_dagster(monkeypatch):
    """The GraphQL shape _active_run reads, against a stand-in for Dagster."""
    import asyncio

    import httpx

    seen = {}

    def dagster(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"data": {"runsOrError": {
            "__typename": "Runs",
            "results": [{"runId": "abc", "jobName": "__ASSET_JOB",
                         "assetSelection": [{"path": ["vessels"]}]}],
        }}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(dagster), **kw),
    )
    assert asyncio.run(query_route._active_run()) == "Materialize: vessels"
    assert set(seen["variables"]["statuses"]) == {"STARTING", "STARTED", "CANCELING"}


def test_a_lake_held_by_another_writer_gives_a_clear_message(writer, warehouse):
    if warehouse["kind"] != "lake":
        pytest.skip("covered for a .duckdb file below")
    # What a pipeline does to the lake's catalog while it commits.
    lock = sqlite3.connect(warehouse["catalog"], timeout=0)
    try:
        lock.execute("BEGIN EXCLUSIVE")
        r = run(writer, f"DELETE FROM {TABLE} WHERE k = 1")
    finally:
        lock.rollback()
        lock.close()
    assert r.status_code == 409, r.text
    assert "being written to" in r.json()["detail"]
    assert count(writer) == 10


def test_a_duckdb_file_held_by_another_process_gives_a_clear_message(writer, warehouse):
    if warehouse["kind"] != "file":
        pytest.skip("covered for a lake above")
    holder = subprocess.Popen(
        [sys.executable, "-c", textwrap.dedent(f"""
            import duckdb, sys
            con = duckdb.connect(r'{warehouse["path"]}')
            print('ready', flush=True)
            sys.stdin.read()
        """)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )
    try:
        assert holder.stdout.readline().strip() == "ready"
        r = run(writer, f"DELETE FROM {TABLE} WHERE k = 1")
    finally:
        holder.stdin.close()
        holder.wait(timeout=30)
    assert r.status_code == 409, r.text
    assert "being written to" in r.json()["detail"]
    assert count(writer) == 10
