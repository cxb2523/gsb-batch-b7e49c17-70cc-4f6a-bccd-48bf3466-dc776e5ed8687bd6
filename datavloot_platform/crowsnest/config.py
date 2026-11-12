"""
Auto-discovers configuration from the project directory where `datavloot launch`
is invoked, with environment variable overrides.

Discovery order:
  1. The project's lake → <project>/lake/catalog.sqlite (see storage.py), when it exists
  2. profiles.yml       → DuckDB file path (outputs.dev.path) and target schema, for
                          projects still on a single .duckdb file
  3. Defaults           → Dagster on localhost:3000, Marimo on localhost:2718,
                          apps (marimo run) on localhost:2719
  4. Env vars           → CROWSNEST_* overrides

Elementary schema:
  dbt's default generate_schema_name produces <target_schema>_<custom_schema>, so a
  project with schema: noaa and `models: elementary: +schema: elementary` writes
  Elementary tables to noaa_elementary.  We infer this automatically from profiles.yml
  so no manual configuration is needed.  Override with CROWSNEST_ELEMENTARY_SCHEMA.
"""

import pathlib
from typing import Optional

try:
    import yaml
    _HAS_YAML = True
except ImportError:
    _HAS_YAML = False


_config: Optional["CrowsnestConfig"] = None


class CrowsnestConfig:
    def __init__(
        self,
        duckdb_path: str,
        dagster_graphql_url: str,
        elementary_schema: str,
        marimo_url: str,
        ducklake_catalog_path: Optional[str],
        ducklake_alias: str,
        ducklake_data_path: Optional[str] = None,
        dagster_public_url: str = "http://localhost:3000",
        marimo_public_url: Optional[str] = None,
        apps_url: str = "http://127.0.0.1:2719",
        apps_public_url: Optional[str] = None,
    ):
        self.duckdb_path = duckdb_path
        self.dagster_graphql_url = dagster_graphql_url
        self.elementary_schema = elementary_schema
        self.marimo_url = marimo_url
        self.ducklake_catalog_path = ducklake_catalog_path
        self.ducklake_alias = ducklake_alias
        self.ducklake_data_path = ducklake_data_path
        # Where the browser reaches Dagster and Marimo. On a laptop that is
        # localhost; behind a proxy (the Falcon) the server-side URLs above are
        # internal names, and these are the public ones.
        self.dagster_public_url = dagster_public_url
        # Set means Marimo runs as its own service: the Crows Nest links to it
        # instead of starting a Marimo process itself.
        self.marimo_public_url = marimo_public_url
        # The apps server (`marimo run apps`, routes/apps.py), the same way:
        # set public URL means a service of its own, linked to, not started.
        self.apps_url = apps_url
        self.apps_public_url = apps_public_url

    @classmethod
    def discover(cls) -> "CrowsnestConfig":
        import os

        duckdb_path = (
            os.environ.get("CROWSNEST_DUCKDB_PATH")
            or _read_duckdb_path_from_profiles()
            or ":memory:"
        )
        dagster_graphql_url = (
            os.environ.get("CROWSNEST_DAGSTER_URL")
            or "http://localhost:3000/graphql"
        )
        # Infer <target_schema>_elementary from profiles.yml; falls back to "elementary"
        elementary_schema = (
            os.environ.get("CROWSNEST_ELEMENTARY_SCHEMA")
            or _infer_elementary_schema()
            or "elementary"
        )
        marimo_url = os.environ.get("CROWSNEST_MARIMO_URL") or "http://127.0.0.1:2718"
        dagster_public_url = (
            os.environ.get("CROWSNEST_DAGSTER_PUBLIC_URL") or "http://localhost:3000"
        ).rstrip("/")
        marimo_public_url = (os.environ.get("CROWSNEST_MARIMO_PUBLIC_URL") or "").rstrip("/") or None
        apps_url = (os.environ.get("CROWSNEST_APPS_URL") or "http://127.0.0.1:2719").rstrip("/")
        apps_public_url = (os.environ.get("CROWSNEST_APPS_PUBLIC_URL") or "").rstrip("/") or None
        catalog, data, alias = _discover_lake()

        return cls(
            duckdb_path=duckdb_path,
            dagster_graphql_url=dagster_graphql_url,
            elementary_schema=elementary_schema,
            marimo_url=marimo_url,
            ducklake_catalog_path=catalog,
            ducklake_alias=alias,
            ducklake_data_path=data,
            dagster_public_url=dagster_public_url,
            marimo_public_url=marimo_public_url,
            apps_url=apps_url,
            apps_public_url=apps_public_url,
        )


_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def sql_write_enabled(host: Optional[str]) -> bool:
    """
    Whether the SQL editor may change the lake (CROWSNEST_SQL_WRITE).

    Set, it decides. Unset, it follows where the Crows Nest listens: on loopback
    only (the laptop, `datavloot start`) whoever reaches the editor can open the
    lake with DuckDB anyway, so it may write; on any other address (a VM, the
    Falcon's `--host 0.0.0.0`) it stays read-only until someone turns it on.
    No host known -- an app built without the CLI -- counts as not loopback.
    """
    import os

    setting = (os.environ.get("CROWSNEST_SQL_WRITE") or "").strip().lower()
    if setting in _TRUE:
        return True
    if setting in _FALSE:
        return False
    if setting:
        raise ValueError(
            f"CROWSNEST_SQL_WRITE={setting!r} is not understood: use 1 to let the "
            "SQL editor write, 0 to keep it read-only, or leave it unset."
        )
    return is_loopback(host)


def is_loopback(host: Optional[str]) -> bool:
    """
    Whether the Crows Nest listens on this machine only: the laptop, where
    whoever reaches it already has the project in hand. No host known -- an app
    built without the CLI -- counts as not loopback.
    """
    import ipaddress

    if not host:
        return False
    host = host.strip().strip("[]")
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def get_config() -> CrowsnestConfig:
    global _config
    # No lake yet: look again, so the lake the first run creates shows up
    # without a restart (#93). Once found, it is kept.
    if _config is None or (
        _config.ducklake_catalog_path is None and _discover_lake()[0] is not None
    ):
        _config = CrowsnestConfig.discover()
    return _config


def reset_config() -> None:
    """Force re-discovery on next get_config() call (useful for testing)."""
    global _config
    _config = None


def _discover_lake() -> tuple[Optional[str], Optional[str], str]:
    """
    (catalog, data directory, alias) of the lake to serve, or (None, None, alias).

    CROWSNEST_DUCKLAKE_CATALOG_PATH points at a SQLite catalog file; a
    `ducklake:sqlite:` or `sqlite:` prefix is accepted and dropped, since the
    attach adds its own. Its data directory defaults to `data/` next to the
    catalog, as storage.py lays it out. Without the variable, the lake of the
    project in the current directory is used once it exists.
    """
    import os

    from datavloot_platform import storage

    alias = os.environ.get("CROWSNEST_DUCKLAKE_ALIAS")
    configured = os.environ.get("CROWSNEST_DUCKLAKE_CATALOG_PATH")
    if configured:
        for prefix in ("ducklake:", "sqlite:"):
            if configured.startswith(prefix):
                configured = configured[len(prefix):]
        catalog = pathlib.Path(configured).resolve()
        data = os.environ.get("CROWSNEST_DUCKLAKE_DATA_PATH") or str(catalog.parent / "data")
        return str(catalog), str(pathlib.Path(data).resolve()), alias or "lakehouse"

    # An explicit .duckdb file wins over a lake found by looking around.
    if os.environ.get("CROWSNEST_DUCKDB_PATH"):
        return None, None, alias or "lakehouse"

    project = storage.find_project_dir()
    if project is not None and storage.catalog_path(project).is_file():
        return (
            str(storage.catalog_path(project)),
            str(storage.data_path(project)),
            alias or storage.project_name(project),
        )
    return None, None, alias or "lakehouse"


def _read_profiles() -> Optional[dict]:
    if not _HAS_YAML:
        return None
    profiles_path = pathlib.Path.cwd() / "profiles.yml"
    if not profiles_path.exists():
        return None
    try:
        with open(profiles_path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def _read_duckdb_path_from_profiles() -> Optional[str]:
    profiles = _read_profiles()
    if not isinstance(profiles, dict):
        return None
    for profile_data in profiles.values():
        if not isinstance(profile_data, dict):
            continue
        outputs = profile_data.get("outputs", {})
        if not isinstance(outputs, dict):
            continue
        for output_config in outputs.values():
            if not isinstance(output_config, dict):
                continue
            if output_config.get("type") == "duckdb":
                path = output_config.get("path")
                if path and path != ":memory:":
                    p = pathlib.Path(path)
                    if not p.is_absolute():
                        p = pathlib.Path.cwd() / p
                    return str(p)
    return None


def _infer_elementary_schema() -> Optional[str]:
    """
    Infer the Elementary schema using dbt's default generate_schema_name logic:
    <target_schema>_elementary.

    A project with `schema: noaa` in profiles.yml and `models: elementary: +schema: elementary`
    in dbt_project.yml will have Elementary tables in `noaa_elementary`.

    The prod output wins: it is what Dagster builds, while the default dev output
    writes to dev_elementary. Projects without one use their first duckdb output.
    """
    profiles = _read_profiles()
    if not isinstance(profiles, dict):
        return None
    for profile_data in profiles.values():
        if not isinstance(profile_data, dict):
            continue
        outputs = profile_data.get("outputs", {})
        if not isinstance(outputs, dict):
            continue
        candidates = [outputs.get("prod"), *outputs.values()]
        for output_config in candidates:
            if not isinstance(output_config, dict):
                continue
            if output_config.get("type") == "duckdb":
                schema = output_config.get("schema")
                if schema:
                    return f"{schema}_elementary"
    return None
