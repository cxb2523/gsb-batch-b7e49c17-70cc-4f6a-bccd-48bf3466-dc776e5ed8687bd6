"""
End-to-end: does a fresh project actually build a warehouse?

This is the test that would have caught the pair of bugs the scaffold shipped
with. They were fixed one at a time, and fixing the first without the second
turned a loud failure (a parse error) into a silent one (a run that reports
tables built and writes nothing to disk).

Marked `slow`: it runs dbt deps/parse/run and takes a few minutes.
"""

import os
import pathlib
import re
import shutil
import subprocess

import pytest

from datavloot_platform import storage

from .conftest import _scaffold, run_dbt

# Imported here rather than at the top so the fast suite can be collected and run
# without the optimist extras installed -- the lint job installs only pytest and
# pyyaml, and a module-level `import duckdb` would fail collection for everyone.
duckdb = pytest.importorskip("duckdb", reason="duckdb is not installed")

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(shutil.which("dbt") is None, reason="dbt is not installed"),
]

# Expected for a project with no sources yet: the source layer config matches no
# resources because the user has not added a model. Anything else is a template bug.
# Matched on the [WARNING] line itself; the "unused configuration paths" detail
# follows on the next line, which the filter below never sees.
EXPECTED_WARNINGS = [
    re.compile(r"Configuration paths exist in your dbt_project\.yml file which do not apply to any resources", re.I),
]


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> pathlib.Path:
    """A scaffolded project taken all the way through `dbt run`."""
    # Installs the dbt package the project pins (dbt-datavloot-optimist, at
    # cli.DBT_PACKAGE_VERSION), so this tests what a user gets.
    project = _scaffold(tmp_path_factory.mktemp("smoke") / "probe", "probe")

    deps = run_dbt("deps", cwd=project)
    assert deps.returncode == 0, f"dbt deps failed:\n{deps.stdout[-3000:]}"

    run = run_dbt("run", cwd=project)
    assert run.returncode == 0, f"dbt run failed:\n{run.stdout[-3000:]}"

    return project


def test_the_lake_is_on_disk(built: pathlib.Path):
    """
    The whole point. `dbt run` must leave data on disk, in the project's lake.

    With `path: ":memory:"` and nothing attached this ran to "Completed
    successfully", reported two tables built, and left nothing behind -- after
    which the Crows Nest showed an empty catalog with no error explaining why.
    """
    catalog = storage.catalog_path(built)
    assert catalog.is_file(), (
        f"no {catalog.relative_to(built)} in {built}; the project persisted nothing. "
        f"Files present: {sorted(p.name for p in built.iterdir())}"
    )
    parquet = list(storage.data_path(built).rglob("*.parquet"))
    assert parquet, "the catalog exists but no data file was written"


def test_the_lake_is_in_wal_mode(built: pathlib.Path):
    """
    Created by dbt's attach, the catalog must still be in WAL mode.

    Without it a notebook and a pipeline lock each other out for seconds per
    query. The mode is set by the attach options, so a profile that drops them
    builds fine and only fails once two processes meet.
    """
    import sqlite3

    con = sqlite3.connect(storage.catalog_path(built))
    try:
        assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        con.close()


def test_the_builtin_dimensions_have_rows(built: pathlib.Path):
    """dim_date and dim_time are built by macros; confirm they materialised."""
    con = storage.connect(built, read_only=True)
    try:
        found = {
            name: schema
            for schema, name in con.execute(
                "SELECT table_schema, table_name FROM information_schema.tables "
                "WHERE table_catalog = current_database()"
            ).fetchall()
        }
        for model in ("dim_date", "dim_time"):
            assert model in found, f"{model} was not built; tables: {sorted(found)}"
            rows = con.execute(f'SELECT count(*) FROM "{found[model]}"."{model}"').fetchone()[0]
            assert rows > 0, f"{model} is empty"
    finally:
        con.close()


def test_no_layer_landed_in_the_bare_catalog_schema(built: pathlib.Path):
    """
    A schema named after the database must never be created.

    DuckDB refuses two-part names when a catalog and a schema share a name:
    `Ambiguous reference to catalog or schema "probe"`. dbt itself is fine, since
    it emits three-part names -- this breaks the query editor and notebooks.
    """
    con = storage.connect(built, read_only=True)
    try:
        schemas = {
            r[0] for r in con.execute(
                "SELECT schema_name FROM information_schema.schemata "
                "WHERE catalog_name = 'probe'"
            ).fetchall()
        }
    finally:
        con.close()

    assert "probe" not in schemas, (
        "a schema named 'probe' exists inside the catalog 'probe', so two-part "
        f"names are ambiguous. Schemas: {sorted(schemas)}"
    )


def _schemas(project: pathlib.Path) -> set[str]:
    con = storage.connect(project, read_only=True)
    try:
        return {
            r[0] for r in con.execute(
                "SELECT schema_name FROM information_schema.schemata "
                "WHERE catalog_name = current_database()"
            ).fetchall()
        }
    finally:
        con.close()


def _production_schemas(project: pathlib.Path) -> set[str]:
    return {s for s in _schemas(project) if s.startswith("probe_")}


def test_dbt_by_hand_builds_dev(built: pathlib.Path):
    """
    `dbt run` without a target builds the dev schemas. That it leaves production
    alone is checked in the Dagster test, the only point where nothing else has
    written to production yet.
    """
    schemas = _schemas(built)
    assert "dev_business" in schemas, f"dbt run built no dev schemas: {sorted(schemas)}"


def test_parse_emits_no_unexpected_warnings(built: pathlib.Path):
    """
    A fresh project's first output should be clean.

    The source template declared a literal stg_<source_name>__<table_name> with
    tests attached, so dbt registered two tests against a model that does not
    exist and parse emitted three warnings before the user had written anything.
    """
    parse = run_dbt("parse", cwd=built)
    assert parse.returncode == 0, f"dbt parse failed:\n{parse.stdout[-3000:]}"

    warnings = [
        line.strip() for line in parse.stdout.splitlines()
        if "[WARNING]" in line or "Did not find matching node" in line
    ]
    unexpected = [
        w for w in warnings if not any(p.search(w) for p in EXPECTED_WARNINGS)
    ]

    assert unexpected == [], (
        "unexpected warnings from a fresh scaffold:\n  " + "\n  ".join(unexpected)
    )


def _dagster(
    built: pathlib.Path, dagster_home: pathlib.Path, *args: str, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    """
    Run the dagster CLI against the scaffold's platform module, as `dagster dev` would load it.

    A throwaway instance, so the run never touches a real ~/.dagster, with the
    scaffold's own instance settings, so a dagster.yaml Dagster rejects fails here.
    """
    # Read from the scaffold rather than hard-coded: the template directory is
    # renamed per project.
    module = re.search(
        r'^module_name\s*=\s*"([^"]+)"', (built / "pyproject.toml").read_text(), re.M
    ).group(1)
    shutil.copy(built / "dagster.yaml", dagster_home / "dagster.yaml")
    full_env = {
        **os.environ,
        "DBT_PROFILES_DIR": str(built),
        "DAGSTER_HOME": str(dagster_home),
        "NO_COLOR": "1",
        **(env or {}),
    }
    return subprocess.run(
        [shutil.which("dagster"), *args, "-m", module, "--working-directory", str(built)],
        cwd=built,
        env=full_env,
        capture_output=True,
        text=True,
        timeout=900,
    )


@pytest.mark.skipif(shutil.which("dagster") is None, reason="dagster is not installed")
def test_dagster_materializes_the_scaffold(built: pathlib.Path, tmp_path: pathlib.Path):
    """
    The first pipeline run a user does: Dagster loads the project and builds every asset.

    dbt alone passing says nothing about the platform layer -- the definitions
    module has to import, find the manifest and drive dbt through dagster-dbt.
    This is what `dagster dev` does behind the UI, so it is the step that breaks
    when a Dagster release or a platform quirk (paths, process spawning on
    Windows) does not agree with the template.
    """
    # Only `dbt run` by hand has run so far, and that is dev's: the scaffold's
    # single target used to write here, overwriting what Dagster had built.
    assert _production_schemas(built) == set(), (
        f"dbt by hand wrote to production: {sorted(_production_schemas(built))}"
    )

    # Not a bare `*`: on Windows click expands that against the files in the
    # working directory before Dagster sees it.
    result = _dagster(built, tmp_path, "asset", "materialize", "--select", 'key:"*"')
    assert result.returncode == 0, (
        f"dagster asset materialize failed:\n{(result.stdout + result.stderr)[-3000:]}"
    )
    assert "probe_business" in _production_schemas(built), (
        f"Dagster did not build production; schemas: {sorted(_schemas(built))}"
    )


@pytest.mark.skipif(shutil.which("dagster") is None, reason="dagster is not installed")
def test_dagster_maintains_the_lake(built: pathlib.Path, tmp_path: pathlib.Path):
    """The scheduled maintenance job loads with the scaffold and runs against its lake."""
    result = _dagster(built, tmp_path, "job", "execute", "-j", "lake_maintenance")
    assert result.returncode == 0, (
        f"dagster job execute failed:\n{(result.stdout + result.stderr)[-3000:]}"
    )


@pytest.mark.skipif(shutil.which("dagster") is None, reason="dagster is not installed")
@pytest.mark.parametrize("switch, state", [("on", "--running"), ("off", "--stopped")])
def test_the_maintenance_schedule_can_be_switched_off(
    built: pathlib.Path, tmp_path: pathlib.Path, switch: str, state: str
):
    """DATAVLOOT_LAKE_MAINTENANCE decides whether the daily schedule starts running."""
    result = _dagster(
        built, tmp_path, "schedule", "list", state, "--name",
        env={"DATAVLOOT_LAKE_MAINTENANCE": switch},
    )
    assert result.returncode == 0, (
        f"dagster schedule list failed:\n{(result.stdout + result.stderr)[-3000:]}"
    )
    assert "lake_maintenance_schedule" in result.stdout
