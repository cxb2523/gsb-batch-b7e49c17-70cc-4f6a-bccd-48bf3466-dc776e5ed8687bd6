"""
The Crows Nest query API against hostile input.

Each test names the specific hole it covers. They are written to fail loudly if
someone reinstates first-word filtering or goes back to editing the SQL string to
apply a row cap, because both looked reasonable and both were bypassable.
"""

import pathlib

import pytest

duckdb = pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402


@pytest.fixture(scope="module", params=["file", "lake"])
def client(tmp_path_factory, request) -> TestClient:
    """
    A Crows Nest wired to a small throwaway warehouse: a .duckdb file, or a lake.

    Every test below runs against both. The lake cannot have its file system
    disabled -- DuckLake reads Parquet through it -- so it is sandboxed with
    allowed_directories instead (see db.py), and has to refuse the same attacks.
    """
    import os

    from datavloot_platform import storage

    workdir = tmp_path_factory.mktemp("crowsnest")
    if request.param == "file":
        db = workdir / "probe.duckdb"
        con = duckdb.connect(str(db))
        env = {"CROWSNEST_DUCKDB_PATH": str(db)}
    else:
        lake = workdir / "lake"
        lake.mkdir()
        con = duckdb.connect()
        con.execute(storage.attach_statement(lake / "catalog.sqlite", lake / "data", "probe"))
        con.execute("USE probe")
        # With the prefix, as the variable used to need it: it is accepted and dropped.
        env = {
            "CROWSNEST_DUCKLAKE_CATALOG_PATH": f"ducklake:sqlite:{lake / 'catalog.sqlite'}",
            "CROWSNEST_DUCKLAKE_ALIAS": "probe",
        }
    con.execute("CREATE SCHEMA probe_business")
    con.execute(
        "CREATE TABLE probe_business.dim_vessel AS "
        "SELECT i AS vessel_key, 'v' || i AS name FROM range(50) t(i)"
    )
    con.close()

    os.environ.update(env)
    os.environ.pop("CROWSNEST_AUTH_TOKEN", None)
    cn_config.reset_config()

    from datavloot_platform.crowsnest.server import create_app
    yield TestClient(create_app())

    for name in env:
        os.environ.pop(name, None)
    cn_config.reset_config()


def run(client: TestClient, sql: str, limit: int = 1000):
    return client.post("/api/query/execute", json={"sql": sql, "limit": limit})


# --------------------------------------------------------------------------
# the query still works
# --------------------------------------------------------------------------

def test_a_plain_select_works(client):
    r = run(client, "SELECT vessel_key, name FROM probe_business.dim_vessel ORDER BY 1")
    assert r.status_code == 200, r.text
    assert r.json()["columns"] == ["vessel_key", "name"]
    assert r.json()["row_count"] == 50


@pytest.mark.parametrize("sql", [
    "SHOW TABLES",
    "DESCRIBE SELECT 1 AS x",
    "WITH t AS (SELECT 1 AS x) SELECT * FROM t",
    "EXPLAIN SELECT 1",
    "EXPLAIN SELECT 'analyze' AS x",
])
def test_read_shapes_are_allowed(client, sql):
    """SHOW/DESCRIBE/CTE/EXPLAIN are reads and must not be refused."""
    assert run(client, sql).status_code == 200, sql


# --------------------------------------------------------------------------
# filesystem escape -- read_only does not stop these; the db.py sandbox does
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    "COPY (SELECT * FROM probe_business.dim_vessel) TO 'leak.csv'",
    "COPY (SELECT 1) TO 'leak.parquet' (FORMAT PARQUET)",
    "ATTACH 'elsewhere.duckdb' AS other",
    "INSTALL httpfs",
    "LOAD httpfs",
])
def test_filesystem_and_extension_access_is_refused(client, sql):
    r = run(client, sql)
    assert r.status_code in (400, 403), f"{sql!r} returned {r.status_code}: {r.text[:200]}"


def test_explain_analyze_cannot_write_into_the_lake(client, tmp_path):
    """
    EXPLAIN ANALYZE runs the statement it explains and still parses as EXPLAIN.

    On a lake the data directory is writable (see db.py), so this overwrote a live
    Parquet file when pointed at one.
    """
    data = cn_config.get_config().ducklake_data_path
    target = (pathlib.Path(data) if data else tmp_path) / "planted.csv"
    r = run(client, f"EXPLAIN ANALYZE COPY (SELECT 42 AS x) TO '{target.as_posix()}' (FORMAT csv)")
    assert r.status_code in (400, 403), r.text
    assert not target.exists()


@pytest.mark.parametrize("sql", [
    "EXPLAIN ANALYZE SELECT 1",
    "EXPLAIN ANALYSE SELECT 1",
    "EXPLAIN (ANALYZE) SELECT 1",
    "EXPLAIN (FORMAT json, ANALYZE) SELECT 1",
    "EXPLAIN /* a comment */ ANALYZE SELECT 1",
    "explain\nanalyze select 1",
])
def test_explain_analyze_is_refused_however_it_is_spelled(client, sql):
    r = run(client, sql)
    assert r.status_code in (400, 403), f"{sql!r} returned {r.status_code}: {r.text[:200]}"


def test_reading_an_arbitrary_file_is_refused(client, tmp_path):
    secret = tmp_path / "secret.csv"
    secret.write_text("a,b\n1,2\n", encoding="utf-8")
    r = run(client, f"SELECT * FROM read_csv('{secret.as_posix()}')")
    assert r.status_code in (400, 403), r.text
    assert "1" not in str(r.json().get("rows", ""))


# --------------------------------------------------------------------------
# statement filtering -- the first-word blocklist walked past all of these
# --------------------------------------------------------------------------

@pytest.mark.parametrize("sql", [
    "INSERT INTO probe_business.dim_vessel VALUES (999, 'x')",
    "-- a leading comment\nDROP TABLE probe_business.dim_vessel",
    "/* block comment */ DELETE FROM probe_business.dim_vessel",
    "  \n\t CREATE TABLE sneaky AS SELECT 1",
    "UPDATE probe_business.dim_vessel SET name = 'x'",
])
def test_writes_are_refused_however_they_are_dressed(client, sql):
    """A leading comment or whitespace used to defeat sql.split()[0]."""
    r = run(client, sql)
    assert r.status_code in (400, 403), f"{sql!r} returned {r.status_code}: {r.text[:200]}"


def test_a_second_statement_cannot_ride_along(client):
    """`SELECT 1; DROP ...` passed the first-word check on the first statement."""
    r = run(client, "SELECT 1; DROP TABLE probe_business.dim_vessel")
    assert r.status_code == 400
    assert "one statement" in r.json()["detail"].lower()

    # and the table is still there
    assert run(client, "SELECT count(*) FROM probe_business.dim_vessel").status_code == 200


# --------------------------------------------------------------------------
# the row cap -- previously applied by editing the SQL string
# --------------------------------------------------------------------------

def test_a_trailing_semicolon_does_not_break_the_query(client):
    """Appending LIMIT produced `SELECT ...; LIMIT 1000` -- a syntax error."""
    r = run(client, "SELECT * FROM probe_business.dim_vessel;", limit=5)
    assert r.status_code == 200, r.text
    assert r.json()["row_count"] == 5
    assert r.json()["truncated"] is True


def test_the_word_limit_in_a_string_does_not_defeat_the_cap(client):
    """`"LIMIT" not in sql.upper()` is a substring test over the whole query."""
    r = run(client, "SELECT 'LIMIT' AS note, vessel_key FROM probe_business.dim_vessel", limit=3)
    assert r.status_code == 200, r.text
    assert r.json()["row_count"] == 3, "row cap was skipped because the SQL mentions LIMIT"
    assert r.json()["truncated"] is True


def test_a_column_named_limit_does_not_defeat_the_cap(client):
    r = run(client, 'SELECT vessel_key AS "limit" FROM probe_business.dim_vessel', limit=2)
    assert r.status_code == 200, r.text
    assert r.json()["row_count"] == 2


def test_the_cap_is_bounded_by_max_rows(client):
    from datavloot_platform.crowsnest.routes.query import MAX_ROWS
    r = run(client, "SELECT * FROM range(100000)", limit=MAX_ROWS + 5_000)
    assert r.status_code == 200, r.text
    assert r.json()["row_count"] <= MAX_ROWS


def test_truncated_is_false_when_everything_fits(client):
    r = run(client, "SELECT * FROM probe_business.dim_vessel", limit=500)
    assert r.json()["row_count"] == 50
    assert r.json()["truncated"] is False


# --------------------------------------------------------------------------
# injection on the endpoint the statement check never sees
# --------------------------------------------------------------------------

def test_list_columns_is_not_injectable(client):
    """table_name was spliced straight into the WHERE clause."""
    ok = client.get("/api/query/columns/probe_business.dim_vessel")
    assert ok.status_code == 200
    assert {c["name"] for c in ok.json()["columns"]} == {"vessel_key", "name"}

    r = client.get("/api/query/columns/x' OR '1'='1")
    assert r.status_code == 200, r.text
    assert r.json()["columns"] == [], "injected predicate matched rows"


def test_the_schema_lists_tables_and_columns_for_autocomplete(client):
    r = client.get("/api/query/schema")
    assert r.status_code == 200, r.text
    schemas = r.json()["schemas"]
    assert schemas["probe_business"]["dim_vessel"] == [
        {"name": "vessel_key", "type": "BIGINT"},
        {"name": "name", "type": "VARCHAR"},
    ]
    # A lake's own bookkeeping (ducklake_snapshot, ...) is not offered.
    assert not any(t.startswith("ducklake_") for tables in schemas.values() for t in tables)


def test_list_tables_still_works(client):
    r = client.get("/api/query/tables")
    assert r.status_code == 200
    assert any(t["name"] == "dim_vessel" for t in r.json()["tables"])
