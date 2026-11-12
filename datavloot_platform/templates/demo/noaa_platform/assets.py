from pathlib import Path
from datetime import date
import dlt
from dlt.sources.helpers import requests as dlt_requests
from dagster import AssetExecutionContext, AssetKey, asset
from dagster_dbt import DbtProject, DbtCliResource, DagsterDbtTranslator, dbt_assets
from dagster_dlt import DagsterDltResource, DagsterDltTranslator, dlt_assets

from datavloot_platform import storage

from . import ais

PROJECT_DIR = Path(__file__).parent.parent  # noaa/
CSV_PATH = PROJECT_DIR / "data" / "guam_2025.csv"

# Every asset that writes to the lake runs in this pool. dagster.yaml limits each
# pool to one at a time, because the lake takes one commit at a time.
LAKE_POOL = "lake"

# Dagster is the only production writer: it builds the prod target, while a
# plain `dbt run` builds dev (see profiles.yml). The dbt resource inherits it.
# install_deps=False: under `datavloot start`, prepare_if_dev would otherwise run
# `dbt deps` on every code load, which first deletes dbt_packages/. When the code
# server and a run load at once, that fails on Windows (WinError 32) and every
# run fails with it. `datavloot new --from`, `update` and the installers run
# `dbt deps` themselves; after changing packages.yml, run `uv run dbt deps`.
noaa_dbt_project = DbtProject(project_dir=PROJECT_DIR, target="prod", install_deps=False)
noaa_dbt_project.prepare_if_dev()


class LayerGroupTranslator(DagsterDbtTranslator):
    """Groups dbt assets by their folder layer (source / business); a package's assets by package."""

    def get_group_name(self, dbt_resource_props: dict) -> str:
        # By folder, Elementary's models would land in one group per subfolder.
        package = dbt_resource_props.get("package_name")
        if package and package != noaa_dbt_project.name:
            return package
        fqn = dbt_resource_props.get("fqn", [])
        if len(fqn) >= 2:
            return fqn[-2]
        return "default"


class OpenMeteoDltTranslator(DagsterDltTranslator):
    # Prefix keys with "open_meteo" to match the dbt source translation and wire the dependency edge.
    def get_asset_key(self, resource) -> AssetKey:
        return AssetKey(["open_meteo", resource.name])


# ---------------------------------------------------------------------------
# AIS ingestion — static historical CSV
# ---------------------------------------------------------------------------

@asset(
    key=AssetKey(["noaa", "guam_2025"]),
    group_name="noaa_ingest",
    pool=LAKE_POOL,
)
def noaa_guam_2025_raw(context: AssetExecutionContext) -> None:
    """Load Guam 2025 AIS CSV into the lake as raw.guam_2025, downloading it on the first run."""
    ais.ensure_csv(CSV_PATH, context.log, get=dlt_requests.get)

    con = storage.connect(PROJECT_DIR)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        context.log.info(f"Loading {CSV_PATH.name} → raw.guam_2025 (may take a minute)...")
        con.execute(f"""
            CREATE OR REPLACE TABLE raw.guam_2025 AS
            SELECT * FROM read_csv('{CSV_PATH}', header = true)
        """)
        count = con.execute("SELECT COUNT(*) FROM raw.guam_2025").fetchone()[0]
        context.log.info(f"Loaded {count:,} rows into raw.guam_2025.")
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Atmospheric weather ingestion — Open-Meteo ERA5 archive (free, no API key)
# ---------------------------------------------------------------------------

GUAM_LAT = 13.4406
GUAM_LON = 144.7937


@dlt.resource(
    name="guam_atmo_hourly",
    write_disposition="merge",
    primary_key="timestamp",
)
def guam_atmo_hourly(
    updated_at: dlt.sources.incremental[str] = dlt.sources.incremental(
        "timestamp",
        initial_value="2025-01-01T00:00",
    ),
):
    """Hourly atmospheric wind conditions near Guam from Open-Meteo archive API.

    On first run: backfills from 2025-01-01.
    On subsequent runs: fetches only new hours from the last loaded timestamp.
    """
    start_date = (updated_at.last_value or "2025-01-01T00:00")[:10]
    end_date = str(date.today())
    if start_date >= end_date:
        return

    response = dlt_requests.get(
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": GUAM_LAT,
            "longitude": GUAM_LON,
            "hourly": ",".join([
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
            ]),
            "wind_speed_unit": "kn",
            "start_date": start_date,
            "end_date": end_date,
            "timezone": "UTC",
        },
    )
    response.raise_for_status()
    hourly = response.json()["hourly"]
    times = hourly["time"]
    n = len(times)

    for i, ts in enumerate(times):
        yield {
            "timestamp":              ts,
            "wind_speed_10m_kn":      hourly.get("wind_speed_10m",    [None] * n)[i],
            "wind_direction_10m_deg": hourly.get("wind_direction_10m", [None] * n)[i],
            "wind_gusts_10m_kn":      hourly.get("wind_gusts_10m",    [None] * n)[i],
        }


@dlt.source(name="open_meteo")
def open_meteo_source():
    return guam_atmo_hourly()


@dlt_assets(
    dlt_source=open_meteo_source(),
    dlt_pipeline=dlt.pipeline(
        pipeline_name="open_meteo_marine",
        dataset_name="source",
        destination=storage.dlt_destination(PROJECT_DIR),
    ),
    group_name="noaa_ingest",
    name="open_meteo",
    dagster_dlt_translator=OpenMeteoDltTranslator(),
    pool=LAKE_POOL,
)
def open_meteo_assets(context: AssetExecutionContext, dlt: DagsterDltResource):
    yield from dlt.run(context=context)


# ---------------------------------------------------------------------------
# dbt — transforms all ingested sources into dims and facts
# ---------------------------------------------------------------------------

@dbt_assets(
    manifest=noaa_dbt_project.manifest_path,
    dagster_dbt_translator=LayerGroupTranslator(),
    pool=LAKE_POOL,
)
def noaa_dbt_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()
