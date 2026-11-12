"""
DuckDB connection helper for the Crows Nest.

Supports two modes:
  DuckLake:  in-memory connection with the project's lake attached, the default
             once the project has one (see config.py and storage.py)
  Standard:  plain DuckDB file connection, for projects still on a .duckdb file

Every connection is sandboxed before it is handed out -- see _harden().
"""

import pathlib
import time

import duckdb
from fastapi import HTTPException

from datavloot_platform import extensions, storage
from datavloot_platform.crowsnest.config import get_config


# Applied to every connection, immediately before it is returned.
#
# `read_only=True` on a DuckDB connection stops writes to the *database*. It does
# not stop writes to the *filesystem*, so `COPY (SELECT ...) TO '/tmp/x.csv'`
# happily exfiltrates a table, and `read_csv('/etc/passwd')` reads back anything
# the server process can. Statement-level filtering in a route cannot fix that
# reliably, and only protects the one route that remembers to do it.
#
# These three settings close it at the connection instead, so every route --
# including ones not written yet -- gets the same guarantee:
#
#   enable_external_access  no attaching databases, installing extensions, or
#                           reaching the network
#   disabled_filesystems    no local file reads or writes through SQL
#   lock_configuration      neither of the above can be turned back on by a query
#
# lock_configuration must come last, since it freezes the others.
#
# A DuckLake reads its Parquet files through the local file system, so there the
# file system cannot be disabled: every query would fail. Instead,
# allowed_directories opens exactly the lake's data directory, and
# enable_external_access keeps everything else shut (checked: reading or writing
# outside it, re-enabling access and installing extensions all stay blocked).
# What this gives up: a COPY ... TO into the data directory itself would be
# allowed. No route lets one through -- the query route accepts only SELECT and
# EXPLAIN, and refuses EXPLAIN ANALYZE, which would run a COPY it explains -- so
# only this second line of defence is narrower.
_HARDENING = (
    "SET enable_external_access=false",
    "SET disabled_filesystems='LocalFileSystem'",
    "SET lock_configuration=true",
)


def _harden(
    conn: duckdb.DuckDBPyConnection,
    lake_data: str | None = None,
    db_file: str | None = None,
) -> duckdb.DuckDBPyConnection:
    """
    Lock a connection down to reading what is already attached.

    Applied after any ATTACH, which must happen while external access is still
    permitted. With `lake_data`, the file system stays open for that directory
    only, as a DuckLake needs. With `db_file` -- a read-write connection to a
    .duckdb file -- it stays open for that file, its write-ahead log and its
    spill directory only, which committing a write needs.
    """
    statements = _HARDENING
    if lake_data:
        allowed = pathlib.Path(lake_data).as_posix().rstrip("/") + "/"
        statements = (
            f"SET allowed_directories=['{allowed}']",
            "SET enable_external_access=false",
            "SET lock_configuration=true",
        )
    elif db_file:
        path = pathlib.Path(db_file).as_posix()
        statements = (
            f"SET allowed_paths=['{path}', '{path}.wal']",
            f"SET allowed_directories=['{path}.tmp/']",
            "SET enable_external_access=false",
            "SET lock_configuration=true",
        )
    for statement in statements:
        conn.execute(statement)
    return conn


# How DuckDB says another process holds the database. The OS part of the message
# is in the OS's language ("being used by another process" is "door een ander
# proces wordt gebruikt" on a Dutch Windows), so match DuckDB's own words too.
_LOCK_MARKERS = (
    "already open in",      # DuckDB, a .duckdb file opened by another process
    "conflicting lock",     # DuckDB on Linux and macOS
    "could not set lock",
    "another process",      # English Windows
    "database is locked",   # a lake's SQLite catalog held by another writer
)


def is_lock_error(message: str) -> bool:
    """True when `message` says another process holds the database."""
    message = message.lower()
    return any(marker in message for marker in _LOCK_MARKERS)


def get_conn(read_only: bool = True) -> duckdb.DuckDBPyConnection:
    config = get_config()
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            if config.ducklake_catalog_path:
                conn = duckdb.connect()
                # Not a bare INSTALL: offline, that fails with only a download
                # error. This says how to install it by hand.
                for name in extensions.REQUIRED:
                    extensions.ensure_loaded(conn, name)
                conn.execute(
                    storage.attach_statement(
                        pathlib.Path(config.ducklake_catalog_path),
                        pathlib.Path(config.ducklake_data_path),
                        config.ducklake_alias,
                        read_only=read_only,
                    )
                )
                conn.execute(f"USE {config.ducklake_alias}")
                return _harden(conn, lake_data=config.ducklake_data_path)
            else:
                return _harden(
                    duckdb.connect(config.duckdb_path, read_only=read_only),
                    db_file=None if read_only else config.duckdb_path,
                )
        except Exception as e:
            last_exc = e
            if attempt < 2 and is_lock_error(str(e)):
                time.sleep(0.15 * (attempt + 1))
                continue
            break
    raise HTTPException(503, f"Cannot connect to database: {last_exc}")
