"""
SQL query route — executes read-only queries against DuckDB.

Two rules replace what used to be here:

  * what may run is decided by parsing, not by inspecting the first word
  * how many rows come back is decided when fetching, not by editing the SQL

The old version matched `sql.split()[0].upper()` against a set of forbidden
keywords, which a leading comment, a leading paren, or anything after a semicolon
walks straight past -- and it never saw `COPY ... TO`, which writes files. It also
appended `LIMIT n` to the query text when the string "LIMIT" did not appear
anywhere in it, so `select 'LIMIT'` returned uncapped and a trailing semicolon
produced `select 1; LIMIT 1000`, a syntax error for anyone who types SQL normally.

The filesystem itself is closed off one level down, in db.py.

Write access (CROWSNEST_SQL_WRITE, see config.sql_write_enabled) widens the
statement allowlist to what changes the lake -- INSERT, UPDATE, DELETE, CREATE,
DROP, ALTER, MERGE -- and nothing else: COPY, ATTACH, INSTALL, SET and the rest
stay refused, and the db.py sandbox stays on the read-write connection too.
Write access is to the database, not to the machine.
"""

import time

import duckdb
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from datavloot_platform.crowsnest.config import get_config
from datavloot_platform.crowsnest.httpclient import async_client
from datavloot_platform.crowsnest.db import get_conn, is_lock_error

router = APIRouter()

MAX_ROWS = 10_000

# DuckDB reports `select`, `show`, `describe`, `pragma` and CTE queries all as
# SELECT, which is exactly the read surface a query editor wants. Everything that
# writes, attaches, installs or configures gets its own type and is refused.
# EXPLAIN is allowed as a reading aid, but not EXPLAIN ANALYZE: that runs the
# statement it explains while still parsing as EXPLAIN. A read-only connection
# stops it writing to the database, not to files -- and on a lake the data
# directory is writable (see db.py), so `EXPLAIN ANALYZE COPY ... TO` could
# overwrite a live Parquet file.
_ALLOWED_STATEMENTS = {
    duckdb.StatementType.SELECT,
    duckdb.StatementType.EXPLAIN,
}
# With write access on. TRUNCATE parses as DELETE, CREATE covers tables, views
# and schemas. COPY is not here on purpose: on a lake it could write into the
# data directory the sandbox has to leave open.
_WRITE_STATEMENTS = {
    duckdb.StatementType.INSERT,
    duckdb.StatementType.UPDATE,
    duckdb.StatementType.DELETE,
    duckdb.StatementType.CREATE,
    duckdb.StatementType.DROP,
    duckdb.StatementType.ALTER,
    duckdb.StatementType.MERGE_INTO,
}
_ANALYZE_KEYWORDS = {"analyze", "analyse"}

# Who a write is recorded as in the lake's snapshots (`FROM <lake>.snapshots()`).
_AUTHOR = "Crows Nest SQL editor"
# Dagster run states in which a run may be writing to the lake.
_ACTIVE_RUN_STATUSES = ("STARTING", "STARTED", "CANCELING")


def _keywords(query: str) -> list[str]:
    """
    The keywords of a statement, lowercased, in order.

    From DuckDB's own tokenizer, so a keyword inside a string, a quoted
    identifier or a comment does not count.
    """
    tokens = duckdb.tokenize(query)
    keywords = []
    for i, (start, kind) in enumerate(tokens):
        if kind != duckdb.token_type.keyword:
            continue
        end = tokens[i + 1][0] if i + 1 < len(tokens) else len(query)
        words = query[start:end].split()
        if words:
            keywords.append(words[0].lower())
    return keywords


def _is_explain_analyze(statement) -> bool:
    """True for EXPLAIN ANALYZE in any spelling: ANALYSE, (ANALYZE), (FORMAT json, ANALYZE)."""
    if statement.type != duckdb.StatementType.EXPLAIN:
        return False
    query = statement.query
    # Tokens rather than a regex, so 'analyze' in a string or comment is not a match.
    return any(
        kind == duckdb.token_type.keyword
        and query[start:start + 7].lower() in _ANALYZE_KEYWORDS
        for start, kind in duckdb.tokenize(query)
    )


def _needs_confirmation(statement) -> str | None:
    """
    Why a write should be confirmed first, or None.

    Only the statements that take a whole table at once: DROP, TRUNCATE, and a
    DELETE or UPDATE without WHERE. A guard against a slip, not a security check.
    """
    keywords = _keywords(statement.query)
    if statement.type == duckdb.StatementType.DROP:
        return "DROP removes the table, view or schema with everything in it."
    if statement.type == duckdb.StatementType.DELETE and keywords[:1] == ["truncate"]:
        return "This removes every row from the table."
    if statement.type == duckdb.StatementType.DELETE and "where" not in keywords:
        return "This DELETE has no WHERE, so it removes every row from the table."
    if statement.type == duckdb.StatementType.UPDATE and "where" not in keywords:
        return "This UPDATE has no WHERE, so it changes every row in the table."
    return None


class QueryRequest(BaseModel):
    sql: str
    limit: int = 1000
    # Set once the user has confirmed a DROP, TRUNCATE, or DELETE/UPDATE without WHERE.
    confirm: bool = False


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list]
    row_count: int
    truncated: bool
    duration_ms: float
    # Writes only. rows_affected is None for statements that report none (DROP, ALTER).
    write: bool = False
    rows_affected: int | None = None
    # The lake's snapshot before and after the write; None on a plain .duckdb file.
    snapshot_before: int | None = None
    snapshot: int | None = None
    # Set instead of running: the statement waits for `confirm`.
    confirmation_required: str | None = None


def _validate(sql: str, allow_write: bool = False):
    """
    Return the single statement to run, or raise.

    Parsing is the check: one statement, and its type must be in the allowlist --
    the read one, plus the write one when the editor may write.
    """
    try:
        statements = duckdb.extract_statements(sql)
    except Exception as e:
        raise HTTPException(400, f"SQL syntax error: {e}")

    if not statements:
        raise HTTPException(400, "Empty query")
    if len(statements) > 1:
        raise HTTPException(
            400,
            f"One statement at a time — got {len(statements)}. "
            "Run them separately.",
        )

    statement = statements[0]
    kind = statement.type.name.replace("_", " ")
    if statement.type in _WRITE_STATEMENTS:
        if not allow_write:
            raise HTTPException(
                403,
                f"{kind} statements are not allowed: the query editor is read-only "
                "on this installation. Set CROWSNEST_SQL_WRITE=1 to let it change "
                "the lake.",
            )
    elif statement.type not in _ALLOWED_STATEMENTS:
        raise HTTPException(
            403,
            f"{kind} statements are not allowed in the query editor"
            + (
                ", also not with write access: it changes the database, not files, "
                "extensions or settings."
                if allow_write
                else ", which is read-only. Use dbt for transformations."
            ),
        )
    if _is_explain_analyze(statement):
        raise HTTPException(
            403,
            "EXPLAIN ANALYZE is not allowed in the query editor: it runs the "
            "statement it explains. Use EXPLAIN without ANALYZE.",
        )
    return statement


def _write_allowed(request: Request) -> bool:
    """Decided once, when the app is built (server.create_app)."""
    return bool(getattr(request.app.state, "sql_write", False))


@router.get("/mode")
async def query_mode(request: Request):
    """Whether the editor may write, and whether writes leave snapshots (a lake)."""
    return {
        "write": _write_allowed(request),
        "snapshots": bool(get_config().ducklake_catalog_path),
    }


@router.post("/execute", response_model=QueryResponse)
async def execute_query(req: QueryRequest, request: Request):
    """Execute one SQL statement: a read, or with write access a change to the lake."""
    statement = _validate(req.sql.strip(), allow_write=_write_allowed(request))
    if statement.type in _WRITE_STATEMENTS:
        return await _execute_write(statement, req.confirm)

    sql = statement.query
    effective_limit = max(1, min(req.limit, MAX_ROWS))

    conn = None
    try:
        conn = get_conn(read_only=True)
        start = time.monotonic()

        result = conn.execute(sql)
        # Cap while fetching rather than by appending LIMIT to the query text.
        # One extra row tells us whether there were more, and no rewriting means
        # no statement shape can slip past the cap.
        rows = result.fetchmany(effective_limit + 1)
        truncated = len(rows) > effective_limit
        rows = rows[:effective_limit]

        columns = [desc[0] for desc in result.description]
        duration = round((time.monotonic() - start) * 1000, 1)

        return QueryResponse(
            columns=columns,
            rows=[[_json_safe(v) for v in row] for row in rows],
            row_count=len(rows),
            truncated=truncated,
            duration_ms=duration,
        )

    except duckdb.ParserException as e:
        raise HTTPException(400, f"SQL syntax error: {e}")
    except duckdb.BinderException as e:
        raise HTTPException(400, f"SQL error: {e}")
    except duckdb.CatalogException as e:
        raise HTTPException(404, f"Table or column not found: {e}")
    except duckdb.PermissionException as e:
        # The db.py sandbox refusing a filesystem or extension access.
        raise HTTPException(403, f"Not permitted: {e}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Query failed: {e}")
    finally:
        if conn is not None:
            conn.close()


def _is_metadata_table(schema: str, name: str, elementary_schema: str) -> bool:
    """
    A table that keeps the platform going rather than holding the business's
    data: DuckLake's own catalog, Elementary's results, dlt's bookkeeping and
    the staging schemas dlt loads through.
    """
    return (
        schema == elementary_schema
        or name.startswith("ducklake_")
        or name.startswith("_dlt_")
        or schema.endswith("_staging")
    )


# --------------------------------------------------------------------------
# writes
# --------------------------------------------------------------------------

_LOCKED = (
    "The lake is being written to by something else, probably a pipeline run. "
    "Nothing was changed: try again in a moment."
)

_ACTIVE_RUNS_QUERY = """
query ActiveRuns($statuses: [RunStatus!]) {
  runsOrError(filter: {statuses: $statuses}, limit: 1) {
    __typename
    ... on Runs {
      results { runId jobName assetSelection { path } }
    }
  }
}
"""


def _is_lock_error(message: str) -> bool:
    # Plus a DuckLake commit that lost to a concurrent one ("Transaction conflict").
    return is_lock_error(message) or "conflict" in message.lower()


async def _active_run() -> str | None:
    """
    A Dagster run that may be writing to the lake right now, as a label, or None.

    The lake takes one writer at a time, and whichever commits second fails --
    which may be the run rather than the editor. So a write waits until no run
    is active. Dagster not answering means no run to protect.
    """
    from datavloot_platform.crowsnest.routes.pipelines import _job_label

    try:
        async with async_client(2.0) as client:
            resp = await client.post(
                get_config().dagster_graphql_url,
                json={
                    "query": _ACTIVE_RUNS_QUERY,
                    "variables": {"statuses": list(_ACTIVE_RUN_STATUSES)},
                },
            )
        runs = resp.json()["data"]["runsOrError"]["results"]
    except Exception:
        return None
    if not runs:
        return None
    run = runs[0]
    return _job_label(run.get("jobName") or "", run.get("assetSelection"))


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _current_snapshot(conn, lake: str | None) -> int | None:
    if lake is None:
        return None
    return conn.execute(f"SELECT id FROM {_quote(lake)}.current_snapshot()").fetchone()[0]


async def _execute_write(statement, confirmed: bool) -> QueryResponse:
    """
    Run one write on a read-write connection of its own, closed straight after.

    The connection is sandboxed like every other (db.py): write access reaches
    the database, not files or the network. On a lake the write is committed
    with the editor as author and the statement as message, so it can be found
    in `FROM <lake>.snapshots()`, and the snapshots before and after are
    returned for undoing it (`AT (VERSION => snapshot_before)`).
    """
    reason = _needs_confirmation(statement)
    if reason and not confirmed:
        return QueryResponse(
            columns=[], rows=[], row_count=0, truncated=False, duration_ms=0,
            write=True, confirmation_required=reason,
        )

    run = await _active_run()
    if run:
        raise HTTPException(
            409,
            f"A pipeline run is in progress ({run}). Wait until it has finished: "
            "two writers at once make one of them fail, and that may be the run. "
            "Nothing was changed.",
        )

    config = get_config()
    lake = config.ducklake_alias if config.ducklake_catalog_path else None
    conn = None
    try:
        try:
            conn = get_conn(read_only=False)
        except HTTPException as e:
            if _is_lock_error(str(e.detail)):
                raise HTTPException(409, _LOCKED)
            raise

        start = time.monotonic()
        before = _current_snapshot(conn, lake)
        conn.execute("BEGIN")
        if lake:
            conn.execute(
                f"CALL {_quote(lake)}.set_commit_message(?, ?)",
                [_AUTHOR, statement.query.strip()[:2000]],
            )
        result = conn.execute(statement.query)
        columns = [desc[0] for desc in result.description] if result.description else []
        rows = result.fetchall() if columns else []
        conn.execute("COMMIT")
        after = _current_snapshot(conn, lake)
        duration = round((time.monotonic() - start) * 1000, 1)

        # DML and CREATE TABLE AS report one row, `Count`; DROP and ALTER report none.
        affected = rows[0][0] if columns == ["Count"] and rows else None
        return QueryResponse(
            columns=columns,
            rows=[[_json_safe(v) for v in row] for row in rows],
            row_count=len(rows),
            truncated=False,
            duration_ms=duration,
            write=True,
            rows_affected=affected,
            snapshot_before=before,
            snapshot=after if after != before else None,
        )

    except duckdb.ParserException as e:
        raise HTTPException(400, f"SQL syntax error: {e}")
    except duckdb.BinderException as e:
        raise HTTPException(400, f"SQL error: {e}")
    except duckdb.CatalogException as e:
        raise HTTPException(404, f"Table or column not found: {e}")
    except duckdb.ConstraintException as e:
        raise HTTPException(400, f"Constraint violated: {e}")
    except duckdb.PermissionException as e:
        raise HTTPException(403, f"Not permitted: {e}")
    except HTTPException:
        raise
    except Exception as e:
        if _is_lock_error(str(e)):
            raise HTTPException(409, _LOCKED)
        raise HTTPException(500, f"Statement failed: {e}")
    finally:
        # Closing without COMMIT rolls back whatever a failed statement left open.
        if conn is not None:
            conn.close()


@router.get("/schema")
async def get_schema():
    """
    Every schema, table and column with its type, in one request: what the
    editor's autocomplete suggests from.

    Only the database queries run against (the lake, or the .duckdb file), not
    every attached catalog: a lake's own metadata catalog
    (`__ducklake_metadata_<lake>`) holds DuckLake's bookkeeping, which is no
    table to suggest -- and with write access, no table to change by accident.
    """
    conn = None
    try:
        conn = get_conn(read_only=True)
        rows = conn.execute(
            """
            SELECT table_schema, table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_catalog = current_database()
              AND table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name, ordinal_position
            """
        ).fetchall()

        schemas: dict[str, dict[str, list[dict]]] = {}
        for schema, table, column, dtype in rows:
            schemas.setdefault(schema, {}).setdefault(table, []).append(
                {"name": column, "type": dtype}
            )
        return {"schemas": schemas}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Cannot read the schema: {e}")
    finally:
        if conn is not None:
            conn.close()


@router.get("/tables")
async def list_tables():
    """List all tables available for querying."""
    conn = None
    try:
        conn = get_conn(read_only=True)
        result = conn.execute(
            """
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name
            """
        ).fetchall()

        elementary_schema = get_config().elementary_schema
        tables = [
            {
                "schema": schema,
                "name": name,
                "full_name": f"{schema}.{name}" if schema != "main" else name,
                "type": ttype.lower(),
                "metadata": _is_metadata_table(schema, name, elementary_schema),
            }
            for schema, name, ttype in result
        ]
        # The business tables first; the frontend folds the metadata away.
        tables.sort(key=lambda t: t["metadata"])
        return {"tables": tables}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Cannot list tables: {e}")
    finally:
        if conn is not None:
            conn.close()


@router.get("/columns/{table_name}")
async def list_columns(table_name: str):
    """
    List columns for a table.

    table_name arrives from the URL and is bound as a parameter, never
    interpolated: it used to be spliced into the WHERE clause, so
    `/api/query/columns/x' OR '1'='1` was an injection on an endpoint the
    statement check never saw.
    """
    conn = None
    try:
        conn = get_conn(read_only=True)
        if "." in table_name:
            schema, table = table_name.split(".", 1)
            where, params = "table_schema = ? AND table_name = ?", [schema, table]
        else:
            where, params = "table_name = ?", [table_name]

        result = conn.execute(
            f"""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE {where}
            ORDER BY ordinal_position
            """,
            params,
        ).fetchall()

        columns = [
            {"name": name, "type": dtype, "nullable": nullable == "YES"}
            for name, dtype, nullable in result
        ]
        return {"table": table_name, "columns": columns}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Cannot list columns: {e}")
    finally:
        if conn is not None:
            conn.close()


def _json_safe(value):
    if value is None:
        return None
    if isinstance(value, (int, float, str, bool)):
        return value
    if isinstance(value, bytes):
        return value.hex()
    return str(value)
