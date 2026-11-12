from pathlib import Path
from dagster import AssetExecutionContext
from dagster_dbt import DbtProject, DbtCliResource, DagsterDbtTranslator, dbt_assets

PROJECT_DIR = Path(__file__).parent.parent

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
project_dbt_project = DbtProject(project_dir=PROJECT_DIR, target="prod", install_deps=False)
project_dbt_project.prepare_if_dev()


class LayerGroupTranslator(DagsterDbtTranslator):
    """Groups dbt assets by their folder layer (source / business); a package's assets by package."""

    def get_group_name(self, dbt_resource_props: dict) -> str:
        # By folder, Elementary's models would land in one group per subfolder.
        package = dbt_resource_props.get("package_name")
        if package and package != project_dbt_project.name:
            return package
        fqn = dbt_resource_props.get("fqn", [])
        if len(fqn) >= 2:
            return fqn[-2]
        return "default"


@dbt_assets(
    manifest=project_dbt_project.manifest_path,
    dagster_dbt_translator=LayerGroupTranslator(),
    pool=LAKE_POOL,
)
def project_dbt_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()


# ---------------------------------------------------------------------------
# Ingestion — add dlt pipelines here
# ---------------------------------------------------------------------------
# See the NOAA demo for a complete worked example: datavloot demo
#
# Pattern:
#
#   import dlt
#   from dagster_dlt import DagsterDltResource, dlt_assets
#   from datavloot_platform import storage
#
#   @dlt_assets(
#       dlt_source=my_source(),
#       dlt_pipeline=dlt.pipeline(
#           pipeline_name="my_pipeline",
#           dataset_name="source",
#           destination=storage.dlt_destination(PROJECT_DIR),  # the project's lake
#       ),
#       group_name="source",
#       pool=LAKE_POOL,                  # it writes to the lake
#   )
#   def my_source_assets(context: AssetExecutionContext, dlt: DagsterDltResource):
#       yield from dlt.run(context=context)
#
# Add DagsterDltResource to definitions.py resources when wiring this up.
