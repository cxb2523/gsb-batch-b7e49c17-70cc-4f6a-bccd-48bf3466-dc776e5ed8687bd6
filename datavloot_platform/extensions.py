"""
DuckDB extensions the platform needs, installed before first use.

DuckDB downloads an extension the first time something loads it. Behind a
corporate proxy or offline that download fails -- after hanging for about nine
seconds -- in the middle of whatever needed it: a Crows Nest request, a pipeline
run. Installing during `datavloot new` moves the download to a moment when the
user is at the keyboard and can act on the message. Once installed, LOAD and
INSTALL never touch the network again (verified against an unreachable
repository).

Extensions are installed per user and per DuckDB version, under
~/.duckdb/extensions/v<version>/<platform>/. After a DuckDB upgrade they are
installed again on first use, through ensure_loaded().

duckdb is imported lazily, so the CLI and the fast test tier work without the
optimist extra.
"""

# What attaching a project's lake loads (see storage.py): DuckLake itself, and
# the SQLite extension for its catalog. `sqlite_scanner` is the canonical name;
# `sqlite` is an alias that duckdb_extensions() does not list.
REQUIRED = ("ducklake", "sqlite_scanner")

# DuckDB's default repository. The CDN rejects Python's default User-Agent, so
# the manual route below goes through a browser or curl, not urllib.
_REPOSITORY = "http://extensions.duckdb.org"


class ExtensionUnavailable(RuntimeError):
    """An extension is not installed and could not be downloaded."""


def is_installed(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT installed FROM duckdb_extensions() WHERE extension_name = ?", [name]
    ).fetchone()
    return bool(row and row[0])


def download_url(conn, name: str) -> str:
    """Where DuckDB itself would fetch `name` from, for this DuckDB build and platform."""
    # An organisation with its own mirror sets custom_extension_repository.
    repository = conn.execute(
        "SELECT current_setting('custom_extension_repository')"
    ).fetchone()[0] or _REPOSITORY
    version = conn.execute("SELECT version()").fetchone()[0]  # e.g. 'v1.5.6'
    platform = conn.execute("PRAGMA platform").fetchone()[0]  # e.g. 'windows_amd64'
    return f"{repository.rstrip('/')}/{version}/{platform}/{name}.duckdb_extension.gz"


def install(conn, names=REQUIRED) -> list[str]:
    """Install each extension not yet installed; return a message per failure."""
    failures = []
    for name in names:
        if is_installed(conn, name):
            continue
        try:
            conn.execute(f"INSTALL {name}")
        except Exception as e:
            failures.append(unavailable_message(conn, name, e))
    return failures


def ensure_loaded(conn, name: str) -> None:
    """Load `name`, installing it first if needed. Raises ExtensionUnavailable."""
    try:
        if not is_installed(conn, name):
            conn.execute(f"INSTALL {name}")
        conn.execute(f"LOAD {name}")
    except Exception as e:
        raise ExtensionUnavailable(unavailable_message(conn, name, e)) from e


def unavailable_message(conn, name: str, error: Exception) -> str:
    reason = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
    return (
        f"DuckDB could not install the '{name}' extension ({reason}).\n"
        "This usually means this machine cannot reach DuckDB's extension "
        "repository: a proxy, a firewall, or no network. Install it by hand once; "
        "after that it works offline. Download\n"
        f"    {download_url(conn, name)}\n"
        "in a browser, then run in Python:\n"
        "    import duckdb\n"
        "    duckdb.execute(\"INSTALL '<path to the downloaded file>'\")"
    )
