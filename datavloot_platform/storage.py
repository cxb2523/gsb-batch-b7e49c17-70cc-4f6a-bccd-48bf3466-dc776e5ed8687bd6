"""
Where a project's data lives, and how every component attaches to it.

The lake is DuckLake: a SQLite catalog and Parquet files, both in
<project>/lake/ (or DATAVLOOT_LAKE_DIR). dbt attaches it from profiles.yml;
everything else -- dlt, notebooks, the Crows Nest -- goes through this module,
so the attach options below are written down once.

What the attach relies on, each verified against DuckDB 1.5 with the ducklake
and sqlite extensions:

  - WAL journal mode on the catalog. In SQLite's default mode a reader and a
    writer lock each other out: a notebook stalls for seconds per query during a
    Dagster run. The mode is stored in the catalog file at creation; passing it
    on every attach also repairs a catalog that was created without it.
  - An absolute DATA_PATH with OVERRIDE_DATA_PATH on every attach. A relative
    data path resolves against the current directory, so a notebook and a
    pipeline started from different folders would write to different places.
    The override applies to the session only, and the file paths inside the
    catalog are relative to the data path, so a moved project keeps working.
  - One commit at a time. A second process committing at the same moment fails
    with "database is locked" instead of waiting; neither DuckLake's retries nor
    a SQLite busy timeout change that. Writers have to take turns.
  - The catalog is created by the project's own DuckDB. DuckLake writes its
    catalog format version into the catalog, and refuses a catalog newer than
    it can read; there is no way back. A `datavloot` run through uvx has a
    DuckDB of its own, which with `--prerelease allow` is a development build,
    so `datavloot new` and `demo` do not create the lake: `datavloot start`, a
    notebook or the first pipeline run does, from the project's environment.

duckdb and dlt are imported lazily, so the CLI and the fast test tier work
without the optimist extra.
"""

import contextlib
import os
import pathlib
import re
import time

from datavloot_platform import extensions

LAKE_DIR_ENV = "DATAVLOOT_LAKE_DIR"


def find_project_dir(start: pathlib.Path | None = None) -> pathlib.Path | None:
    """The nearest directory at or above `start` (default: cwd) with a dbt_project.yml."""
    here = pathlib.Path(start or pathlib.Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "dbt_project.yml").is_file():
            return candidate
    return None


def project_name(project_dir: pathlib.Path) -> str:
    """The dbt project name, which is also the catalog name the lake is attached as."""
    text = (pathlib.Path(project_dir) / "dbt_project.yml").read_text(encoding="utf-8")
    match = re.search(r"^name:\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)", text, re.M)
    if not match:
        raise ValueError(f"no project name in {project_dir / 'dbt_project.yml'}")
    return match.group(1)


def lake_dir(project_dir: pathlib.Path) -> pathlib.Path:
    """<project>/lake, or DATAVLOOT_LAKE_DIR (relative to the project) when set."""
    override = os.environ.get(LAKE_DIR_ENV)
    path = pathlib.Path(override) if override else pathlib.Path("lake")
    if not path.is_absolute():
        path = pathlib.Path(project_dir) / path
    return path.resolve()


def catalog_path(project_dir: pathlib.Path) -> pathlib.Path:
    return lake_dir(project_dir) / "catalog.sqlite"


def data_path(project_dir: pathlib.Path) -> pathlib.Path:
    return lake_dir(project_dir) / "data"


def lock_path(project_dir: pathlib.Path) -> pathlib.Path:
    return lake_dir(project_dir) / "files.lock"


@contextlib.contextmanager
def file_lock(project_dir: pathlib.Path, *, timeout: float | None = None):
    """
    Hold the lake's file lock: whoever holds it may delete files from the lake,
    or rely on none being deleted.

    Cleanup deletes files the catalog no longer references; a backup copies the
    catalog first and its files after, so a cleanup in between deletes a file
    the copied catalog still needs. Both take this lock, whether they run from
    Dagster or the command line. It is an operating-system lock on a file, so
    it is released when the holder exits, crashes included.

    `timeout`: seconds to wait, None to wait as long as it takes, 0 not to wait.
    Raises TimeoutError when the lock is still held after that.
    """
    path = lock_path(project_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = None if timeout is None else time.monotonic() + timeout
    with open(path, "a+b") as handle:
        while not _try_lock(handle):
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError(f"{path} is held by another process")
            time.sleep(0.2)
        try:
            yield
        finally:
            _unlock(handle)


if os.name == "nt":
    import msvcrt

    def _try_lock(handle) -> bool:
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    def _unlock(handle) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def _try_lock(handle) -> bool:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        return True

    def _unlock(handle) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def attach_statement(
    catalog: pathlib.Path,
    data: pathlib.Path,
    alias: str,
    *,
    read_only: bool = False,
    if_not_exists: bool = False,
) -> str:
    """The ATTACH for a lake, with the options every attach needs (see the module docstring)."""
    options = [
        f"DATA_PATH '{pathlib.Path(data).as_posix()}/'",
        "OVERRIDE_DATA_PATH true",
        "META_JOURNAL_MODE 'WAL'",
    ]
    if read_only:
        options.append("READ_ONLY")
    attach = "ATTACH IF NOT EXISTS" if if_not_exists else "ATTACH"
    return (
        f"{attach} 'ducklake:sqlite:{pathlib.Path(catalog).as_posix()}' AS {alias} "
        f"({', '.join(options)})"
    )


def connect(
    project_dir: pathlib.Path | None = None, *, read_only: bool = False, default: bool = False
):
    """
    A DuckDB connection with the project's lake attached and selected.

    Queries can then name tables as `schema.table`, as they did against the
    project's .duckdb file.

    default=True attaches the lake to DuckDB's default connection instead of a
    new one, and returns that. It is the connection duckdb.sql() uses, and so
    Marimo's own "DuckDB (in-memory)" SQL engine: a notebook's SQL cells then
    find the lake whichever engine they are set to, where a new connection
    leaves the built-in engine with an empty database. Running it again is
    harmless. For notebooks only: the default connection is shared by the whole
    process, and an app under `marimo run` serves every viewer from one.

    A read-only connection to a project without a lake creates the lake first,
    so a notebook opened before the first run finds an empty one.

    Raises CatalogTooNew when the catalog was written by a newer DuckLake.
    """
    import duckdb

    project_dir = _resolve(project_dir)
    alias = project_name(project_dir)
    if read_only and not catalog_path(project_dir).is_file():
        create(project_dir)
    conn = duckdb.default_connection() if default else duckdb.connect()
    for name in extensions.REQUIRED:
        extensions.ensure_loaded(conn, name)
    if not read_only:
        lake_dir(project_dir).mkdir(parents=True, exist_ok=True)
    try:
        conn.execute(
            attach_statement(
                catalog_path(project_dir), data_path(project_dir), alias,
                read_only=read_only, if_not_exists=default,
            )
        )
    except Exception as e:
        too_new = catalog_too_new(catalog_path(project_dir), e)
        if too_new is None:
            raise
        if not default:
            conn.close()
        raise too_new from e
    conn.execute(f"USE {alias}")
    return conn


def create(project_dir: pathlib.Path) -> None:
    """Create the project's lake if it does not exist yet, so readers find one before the first run."""
    connect(project_dir).close()


class CatalogTooNew(RuntimeError):
    """The lake's catalog was written by a newer DuckLake than this DuckDB has."""


_MISMATCH = re.compile(
    r"catalog version mismatch: catalog version is (\S+?),? but the extension requires version (\S+?)\.?(?:\s|$)",
    re.I,
)


def _release(version: str) -> tuple[int, ...]:
    """'1.1-dev1' -> (1, 1): the release a (pre-release) catalog version belongs to."""
    return tuple(int(part) for part in re.findall(r"\d+", version.split("-")[0]))


def catalog_too_new(catalog: pathlib.Path, error: Exception) -> CatalogTooNew | None:
    """
    A CatalogTooNew explaining `error`, when it is DuckLake refusing a catalog
    of a later release than it reads; None for any other error.

    DuckLake's own message suggests AUTOMATIC_MIGRATION, which only migrates
    forward. A newer catalog cannot be read by this DuckDB at all, so the
    message says what can be done instead, and whether the catalog holds any
    tables: an empty one can simply be deleted.
    """
    match = _MISMATCH.search(str(error))
    if not match:
        return None
    found, supported = match.groups()
    if _release(found) <= _release(supported):
        return None
    tables = _table_count(catalog)
    if tables == 0:
        remedy = (
            "It holds no tables, so nothing is lost by deleting it: remove "
            f"{catalog.name} (and any {catalog.name}-wal and {catalog.name}-shm "
            "next to it) and the lake is created again, by the project's own "
            "DuckDB, on the next start or run."
        )
    else:
        what = "tables" if tables is None else f"{tables} table(s)"
        remedy = (
            f"It holds {what}. Run the project with a DuckDB whose DuckLake reads "
            f"catalog version {found} (the one that wrote it, see `created_by` in "
            "its ducklake_metadata table), or rebuild the lake: move the lake "
            "folder aside and rerun the pipelines."
        )
    return CatalogTooNew(
        f"The lake's catalog {catalog} has DuckLake catalog version {found}, but this "
        f"project's DuckDB reads version {supported}. It was written by a newer DuckDB, "
        "usually a development build, for example one that `uvx --prerelease allow` "
        "installed. A catalog cannot be migrated back to an older version.\n" + remedy
    )


def _table_count(catalog: pathlib.Path) -> int | None:
    """How many tables a DuckLake catalog has ever had; None when it cannot be read."""
    import sqlite3

    try:
        con = sqlite3.connect(f"{pathlib.Path(catalog).resolve().as_uri()}?mode=ro", uri=True)
        try:
            return con.execute("SELECT count(*) FROM ducklake_table").fetchone()[0]
        finally:
            con.close()
    except sqlite3.Error:
        return None


def dlt_destination(project_dir: pathlib.Path | None = None):
    """A dlt destination that loads into the project's lake."""
    from dlt.destinations import ducklake
    from dlt.destinations.impl.ducklake.configuration import DuckLakeCredentials

    project_dir = _resolve(project_dir)
    data = data_path(project_dir)
    data.mkdir(parents=True, exist_ok=True)
    return ducklake(
        credentials=DuckLakeCredentials(
            ducklake_name=project_name(project_dir),
            catalog=f"sqlite:///{catalog_path(project_dir).as_posix()}",
            storage=data.as_posix(),
        ),
        # dlt passes the data path but not the override; without it a moved
        # project fails with "DATA_PATH ... does not match".
        override_data_path=True,
    )


def _resolve(project_dir: pathlib.Path | None) -> pathlib.Path:
    if project_dir is not None:
        return pathlib.Path(project_dir).resolve()
    found = find_project_dir()
    if found is None:
        raise FileNotFoundError(
            "No dbt_project.yml in this directory or above it; pass the project directory."
        )
    return found
