"""
Structured rejection semantics for /api/query/execute.

A refusal used to arrive as a bare 403 with only a human sentence in `detail`.
The frontend could not tell a disallowed statement type from a multi-statement
request or a syntax error, and a read-only connection could still be talked
into reading arbitrary files through table functions such as read_csv --
read_only guards the database, not the file system.

Every test here builds its own throwaway .duckdb file (and, in the parametrized
runs, a DuckLake) in a temporary directory. The assertions pin both halves of
the contract:

  * the HTTP status code conventions (403 for what the editor never does,
    400 for the shape of the request)
  * the machine-readable `reason` next to the unchanged human `detail`

and, for the file-reading cases, that no byte of the target file is echoed
back and nothing lands on disk.
"""

import pathlib

import pytest

duckdb = pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.routes import query as query_route  # noqa: E402

TABLE = "probe_business.dim_vessel"


@pytest.fixture(params=["file", "lake"])
def warehouse(tmp_path, request, monkeypatch):
    """
    A throwaway warehouse in a temporary directory: a .duckdb file, or a lake.

    Returns paths the tests plant secrets next to -- including, for the lake,
    its open data directory, which the connection sandbox has to leave writable.
    """
    from datavloot_platform import storage

    if request.param == "file":
        db = tmp_path / "probe.duckdb"
        con = duckdb.connect(str(db))
        monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
        info = {"kind": "file", "db": db, "outside": tmp_path / "outside",
                "data_dir": None}
    else:
        lake = tmp_path / "lake"
        lake.mkdir()
        con = duckdb.connect()
        con.execute(storage.attach_statement(lake / "catalog.sqlite", lake / "data", "probe"))
        con.execute("USE probe")
        monkeypatch.setenv("CROWSNEST_DUCKLAKE_CATALOG_PATH", str(lake / "catalog.sqlite"))
        monkeypatch.setenv("CROWSNEST_DUCKLAKE_ALIAS", "probe")
        info = {"kind": "lake", "db": lake / "catalog.sqlite",
                "outside": tmp_path / "outside", "data_dir": lake / "data"}

    con.execute("CREATE SCHEMA probe_business")
    con.execute(
        f"CREATE TABLE {TABLE} AS "
        "SELECT i AS vessel_key, 'v' || i AS name FROM range(20) t(i)"
    )
    con.close()

    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("CROWSNEST_SQL_WRITE", raising=False)
    # Nothing listens here, so no real Dagster can make a write wait to run.
    monkeypatch.setenv("CROWSNEST_DAGSTER_URL", "http://127.0.0.1:9/graphql")
    cn_config.reset_config()
    yield info
    cn_config.reset_config()


@pytest.fixture
def reader(warehouse) -> TestClient:
    """The editor read-only: built without a host, so sql_write is off."""
    from datavloot_platform.crowsnest.server import create_app
    return TestClient(create_app())


@pytest.fixture
def writer(warehouse, monkeypatch) -> TestClient:
    """The editor on loopback, so write access is on; no Dagster run to wait on."""
    async def _no_active_run():
        return None

    monkeypatch.setattr(query_route, "_active_run", _no_active_run)
    from datavloot_platform.crowsnest.server import create_app
    return TestClient(create_app(host="127.0.0.1"))


def run(client: TestClient, sql: str, confirm: bool = False):
    return client.post(
        "/api/query/execute", json={"sql": sql, "confirm": confirm}
    )


def _plant_secret(directory: pathlib.Path, name: str = "secret.csv") -> pathlib.Path:
    directory.mkdir(parents=True, exist_ok=True)
    secret = directory / name
    # Values chosen so a leak would be obvious in any echoed row.
    secret.write_text("token,value\nTOPSECRET,4242\n", encoding="utf-8")
    return secret


# --------------------------------------------------------------------------
# the read surface still works
# --------------------------------------------------------------------------

def test_a_plain_select_returns_rows(reader, warehouse):
    r = run(reader, f"SELECT vessel_key, name FROM {TABLE} ORDER BY 1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["vessel_key", "name"]
    assert body["row_count"] == 20
    assert "reason" not in body


@pytest.mark.parametrize("sql", [
    "SHOW TABLES",
    "DESCRIBE SELECT 1 AS x",
    "WITH t AS (SELECT 1 AS x) SELECT * FROM t",
    "EXPLAIN SELECT 1",
    # 'analyze' inside a string is not EXPLAIN ANALYZE.
    "EXPLAIN SELECT 'analyze' AS x",
])
def test_read_shapes_are_allowed(reader, sql):
    assert run(reader, sql).status_code == 200, sql


# --------------------------------------------------------------------------
# reason: syntax_error (HTTP 400)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    "SELECT FROM WHERE",
    "this is not sql at all",
    "SELECT (",
])
def test_a_syntax_error_is_400_with_reason(reader, sql):
    r = run(reader, sql)
    assert r.status_code == 400, r.text
    body = r.json()
    assert body["reason"] == "syntax_error"
    assert body["detail"].startswith("SQL syntax error")


def test_an_empty_query_is_a_syntax_error_reason(reader):
    r = run(reader, "   ")
    assert r.status_code == 400
    body = r.json()
    assert body["reason"] == "syntax_error"
    assert body["detail"]


# --------------------------------------------------------------------------
# reason: multiple_statements (HTTP 400)
# --------------------------------------------------------------------------

def test_two_statements_are_400_with_reason_and_run_nothing(reader):
    r = run(reader, f"SELECT 1; DROP TABLE {TABLE}")
    assert r.status_code == 400, r.text
    body = r.json()
    assert body["reason"] == "multiple_statements"
    # The human wording is kept.
    assert "one statement" in body["detail"].lower()

    # The riding-along DROP did not run: the table is intact and still full.
    follow = run(reader, f"SELECT count(*) FROM {TABLE}")
    assert follow.status_code == 200
    assert follow.json()["rows"][0][0] == 20


# --------------------------------------------------------------------------
# reason: statement_not_allowed (HTTP 403)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    # A leading comment used to defeat the old first-word blocklist.
    "-- a leading comment\nDROP TABLE probe_business.dim_vessel",
    "/* block comment */ DELETE FROM probe_business.dim_vessel",
    "  \n\t CREATE TABLE probe_business.sneaky AS SELECT 1",
    "INSERT INTO probe_business.dim_vessel VALUES (999, 'x')",
    "UPDATE probe_business.dim_vessel SET name = 'x'",
    # Never allowed, in either mode.
    "COPY (SELECT 1) TO 'leak.csv'",
    "ATTACH 'elsewhere.duckdb' AS other",
    "INSTALL httpfs",
    "LOAD httpfs",
    "SET enable_external_access = true",
    "CHECKPOINT",
    "VACUUM",
])
def test_disallowed_statements_are_403_with_reason(reader, sql):
    r = run(reader, sql)
    assert r.status_code == 403, f"{sql!r} -> {r.status_code}: {r.text}"
    body = r.json()
    assert body["reason"] == "statement_not_allowed"
    assert body["detail"]


def test_a_write_in_read_only_mode_does_not_touch_the_database(reader):
    before = run(reader, f"SELECT count(*) FROM {TABLE}").json()["rows"][0][0]
    r = run(reader, f"DELETE FROM {TABLE} WHERE vessel_key = 1")
    assert r.status_code == 403
    assert r.json()["reason"] == "statement_not_allowed"
    after = run(reader, f"SELECT count(*) FROM {TABLE}").json()["rows"][0][0]
    assert before == after == 20


def test_write_mode_still_refuses_files_extensions_and_settings(writer):
    for sql in [
        "COPY (SELECT 1) TO 'leak.csv'",
        "ATTACH 'elsewhere.duckdb' AS other",
        "INSTALL httpfs",
        "LOAD httpfs",
        "SET enable_external_access = true",
        "CHECKPOINT",
        "VACUUM",
    ]:
        r = run(writer, sql, confirm=True)
        assert r.status_code == 403, f"{sql!r} -> {r.status_code}: {r.text}"
        assert r.json()["reason"] == "statement_not_allowed", sql

    # And no file was produced by the refused COPY.
    assert not pathlib.Path("leak.csv").exists()


# --------------------------------------------------------------------------
# reason: explain_analyze_forbidden (HTTP 403), every spelling
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    "EXPLAIN ANALYZE SELECT 1",
    "EXPLAIN ANALYSE SELECT 1",
    "EXPLAIN (ANALYZE) SELECT 1",
    "EXPLAIN (FORMAT json, ANALYZE) SELECT 1",
    "EXPLAIN /* a comment */ ANALYZE SELECT 1",
    "explain\nanalyze select 1",
])
def test_explain_analyze_is_refused_however_spelled(reader, sql):
    r = run(reader, sql)
    assert r.status_code == 403, f"{sql!r} -> {r.status_code}: {r.text}"
    body = r.json()
    assert body["reason"] == "explain_analyze_forbidden"
    assert "EXPLAIN ANALYZE" in body["detail"]


def test_explain_analyze_cannot_copy_into_the_lake_data(reader, warehouse, tmp_path):
    """EXPLAIN ANALYZE runs the statement it explains; it must never get that far."""
    data = warehouse["data_dir"]
    target = (pathlib.Path(data) if data else tmp_path) / "planted.csv"
    sql = (
        f"EXPLAIN ANALYZE COPY (SELECT 42 AS x) TO "
        f"'{target.as_posix()}' (FORMAT csv)"
    )
    r = run(reader, sql)
    assert r.status_code == 403
    assert r.json()["reason"] == "explain_analyze_forbidden"
    assert not target.exists()


# --------------------------------------------------------------------------
# reason: file_access_forbidden (HTTP 403) -- the read_csv hole, both modes
# --------------------------------------------------------------------------

@pytest.mark.parametrize("function", [
    "read_csv",
    "read_csv_auto",
    "read_parquet",
    "parquet_scan",
    "read_json",
    "read_text",
    "read_blob",
    "glob",
])
def test_file_reading_functions_are_refused_before_any_byte_is_read(
    reader, warehouse, function
):
    secret = _plant_secret(warehouse["outside"])
    if function in ("read_parquet", "parquet_scan"):
        target = secret.with_suffix(".parquet")
        # A real parquet file, so only the guard stands between it and the rows.
        duckdb.connect().execute(
            f"COPY (SELECT 1 AS x) TO '{target.as_posix()}' (FORMAT PARQUET)"
        )
        argument = target.as_posix()
    elif function == "glob":
        argument = warehouse["outside"].as_posix() + "/*"
    else:
        argument = secret.as_posix()

    r = run(reader, f"SELECT * FROM {function}('{argument}')")
    assert r.status_code == 403, r.text
    body = r.json()
    assert body["reason"] == "file_access_forbidden"
    assert body["detail"]
    # The file's contents never come back in any field.
    assert "TOPSECRET" not in r.text
    assert "4242" not in r.text


def test_read_csv_on_an_outside_file_is_refused_in_read_only_mode(reader, warehouse):
    """The hole named in the issue: read_csv pointed at a temp-dir secret.csv."""
    secret = _plant_secret(warehouse["outside"])
    r = run(reader, f"SELECT * FROM read_csv('{secret.as_posix()}')")
    assert r.status_code == 403
    assert r.json()["reason"] == "file_access_forbidden"
    assert "TOPSECRET" not in r.text


def test_read_csv_is_refused_in_write_mode_and_inserts_nothing(writer, warehouse):
    secret = _plant_secret(warehouse["outside"])
    before = run(writer, f"SELECT count(*) FROM {TABLE}").json()["rows"][0][0]

    r = run(
        writer,
        f"INSERT INTO {TABLE} SELECT 1, x FROM read_csv('{secret.as_posix()}')",
        confirm=True,
    )
    assert r.status_code == 403
    assert r.json()["reason"] == "file_access_forbidden"
    assert "TOPSECRET" not in r.text

    after = run(writer, f"SELECT count(*) FROM {TABLE}").json()["rows"][0][0]
    assert after == before


def test_a_file_inside_the_open_lake_data_directory_is_still_refused(reader, warehouse):
    """
    The lake's connection sandbox has to leave its data directory open, so a
    file planted there used to be readable through read_csv with a 200. The
    statement-level check must close that regardless of the sandbox.
    """
    if warehouse["kind"] != "lake":
        pytest.skip("only a lake keeps an open data directory")
    secret = _plant_secret(warehouse["data_dir"], name="planted.csv")
    r = run(reader, f"SELECT * FROM read_csv('{secret.as_posix()}')")
    assert r.status_code == 403
    assert r.json()["reason"] == "file_access_forbidden"
    assert "TOPSECRET" not in r.text


def test_a_string_table_replacement_scan_is_refused(reader, warehouse):
    """`FROM 'x.csv'` opens the file without any function name to block."""
    secret = _plant_secret(warehouse["outside"])
    r = run(reader, f"SELECT * FROM '{secret.as_posix()}'")
    assert r.status_code == 403
    assert r.json()["reason"] == "file_access_forbidden"
    assert "TOPSECRET" not in r.text


def test_a_file_reading_name_that_is_not_a_call_is_allowed(reader):
    """The word read_csv in a string, a comment or a column is not file access."""
    assert run(reader, "SELECT 'read_csv' AS note").status_code == 200
    assert run(
        reader, f"SELECT * FROM {TABLE} WHERE 1 = 0 -- read_csv('x')"
    ).status_code == 200


def test_a_blocked_file_read_cannot_ride_along_on_a_second_statement(reader, warehouse):
    """The multi-statement guard fires first and still runs nothing."""
    secret = _plant_secret(warehouse["outside"])
    r = run(reader, f"SELECT 1; SELECT * FROM read_csv('{secret.as_posix()}')")
    assert r.status_code == 400
    assert r.json()["reason"] == "multiple_statements"
    assert "TOPSECRET" not in r.text
