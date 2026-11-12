from dagster import Definitions, in_process_executor, load_assets_from_modules
from dagster_dbt import DbtCliResource
from dagster_dlt import DagsterDltResource
from . import assets
from .assets import noaa_dbt_project
from .lake_maintenance import lake_maintenance, lake_maintenance_schedule

all_assets = load_assets_from_modules([assets])

defs = Definitions(
    assets=all_assets,
    jobs=[lake_maintenance],
    schedules=[lake_maintenance_schedule],
    executor=in_process_executor,
    resources={
        "dbt": DbtCliResource(project_dir=noaa_dbt_project),
        "dlt": DagsterDltResource(),
    },
)
