"""
Keeping a project's lake from growing without bound.

Every write to the lake adds Parquet files, and every snapshot keeps the files
it saw alive, so without maintenance the file count and the directory size
only grow, and queries slow down as they open more and more small files.
`maintain` runs DuckLake's maintenance functions in this order, each verified
against DuckDB 1.5 with the ducklake extension:

  1. Flush inlined data: small inserts live in the catalog until written out.
  2. Rewrite data files that consist mostly of deleted rows.
  3. Merge adjacent small files into larger ones.
  4. Expire snapshots older than `keep_snapshots`. Their files, and the files
     a merge replaced, are then scheduled for deletion; a reader that started
     on an old snapshot can still finish.
  5. Delete the files scheduled for deletion at least `file_grace` ago.
  6. Delete orphaned files older than `orphan_grace`: files no snapshot
     references, left by a write that failed before its commit. A writer puts
     its files on disk before it commits, so a write in progress looks exactly
     like this; only age tells them apart.

Why the margins are in days. With a SQLite catalog, steps 4 and 5 compare
their cutoff by UTC date, not by time: a cutoff of 00:00:01 UTC also takes what
was scheduled at 23:00 that day. A grace of one hour therefore protects
nothing; two days guarantee at least one. Retention is likewise whole days:
`keep_snapshots` of seven days keeps between six and seven. Step 6 compares
file times instead, which DuckDB on Windows reads shifted by the UTC offset; in
a zone behind UTC a fresh file looks hours older than it is.

Steps 5 and 6 delete files, so they run only while holding the lake's file
lock (see storage.file_lock), which a backup also takes. When the lock is held,
they are skipped and the next run deletes what this one left.

Steps 1-4 commit to the catalog like any other writer, so in Dagster the job
runs in the same pool as the other writers.

A project can switch the daily schedule off with DATAVLOOT_LAKE_MAINTENANCE=off;
see `scheduled`.
"""

import datetime
import os
import pathlib

from datavloot_platform import storage

KEEP_SNAPSHOTS = datetime.timedelta(days=7)
FILE_GRACE = datetime.timedelta(days=2)
ORPHAN_GRACE = datetime.timedelta(days=7)

SCHEDULE_ENV = "DATAVLOOT_LAKE_MAINTENANCE"


def scheduled() -> bool:
    """
    Whether the daily maintenance schedule starts switched on: DATAVLOOT_LAKE_MAINTENANCE
    is `on` (the default when unset or empty) or `off`. Anything else is an error, so a
    typo does not leave maintenance running when it was meant to be off.
    """
    value = (os.environ.get(SCHEDULE_ENV) or "on").strip().lower()
    if value not in ("on", "off"):
        raise ValueError(f"{SCHEDULE_ENV} must be 'on' or 'off', not {value!r}")
    return value == "on"


def maintain(
    project_dir: pathlib.Path | None = None,
    *,
    keep_snapshots: datetime.timedelta = KEEP_SNAPSHOTS,
    file_grace: datetime.timedelta = FILE_GRACE,
    orphan_grace: datetime.timedelta = ORPHAN_GRACE,
) -> dict[str, int]:
    """
    Run the maintenance steps above on the project's lake. Returns what each
    step did, as counts, plus `cleanup_skipped` (1 when the file lock was held).
    """
    project_dir = storage._resolve(project_dir)
    lake = storage.project_name(project_dir)
    conn = storage.connect(project_dir)
    try:
        def call(function: str, *args: str) -> list[tuple]:
            return conn.execute(f"CALL {function}('{lake}'{''.join(', ' + a for a in args)})").fetchall()

        result = {
            "rows_flushed": sum(int(r[2]) for r in call("ducklake_flush_inlined_data")),
            "files_rewritten": sum(r[2] for r in call("ducklake_rewrite_data_files")),
            "files_merged": sum(r[2] for r in call("ducklake_merge_adjacent_files")),
            "snapshots_expired": len(call("ducklake_expire_snapshots", f"older_than => {_ago(keep_snapshots)}")),
            "files_deleted": 0,
            "orphans_deleted": 0,
            "cleanup_skipped": 0,
        }
        try:
            with storage.file_lock(project_dir, timeout=0):
                result["files_deleted"] = len(
                    call("ducklake_cleanup_old_files", f"older_than => {_ago(file_grace)}")
                )
                result["orphans_deleted"] = len(
                    call("ducklake_delete_orphaned_files", f"older_than => {_ago(orphan_grace)}")
                )
        except TimeoutError:
            result["cleanup_skipped"] = 1
        return result
    finally:
        conn.close()


def _ago(delta: datetime.timedelta) -> str:
    """A SQL expression for `delta` before now, in whole seconds."""
    return f"now() - to_seconds({int(delta.total_seconds())})"
