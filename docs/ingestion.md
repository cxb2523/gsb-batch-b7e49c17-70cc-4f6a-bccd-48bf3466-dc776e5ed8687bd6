# Ingestion layer — loading data with dlt

The toolkit uses [dlt](https://dlthub.com) as its standard ingestion layer.
dlt handles the mechanics of pulling data from external sources — REST APIs,
databases, file stores — and landing it in the project's lake (a DuckLake under
`lake/`) with the right schema, types, and incremental state. dbt then picks up those tables as sources and
transforms them.

## When to use dlt vs. a plain Dagster asset

| Scenario | Recommended approach |
|---|---|
| REST API, SaaS tool, or database with a connector | **dlt pipeline** via `@dlt_assets` |
| Static flat file loaded once (CSV, Parquet) | **Plain Dagster `@asset`** that opens the lake with `storage.connect()` and loads it with `read_csv` / `read_parquet` (in the `lake` pool) |
| Custom extraction logic not covered by dlt | **Plain Dagster `@asset`** |

The NOAA example project uses a plain asset for its one-time CSV load. For a
live source — a shipping API, an ERP database, a SaaS export — use dlt.

---

## How it fits into the stack

```
External source
      │
      ▼
  dlt pipeline  ──────────────────────►  <project>.source (the lake)
  (@dlt_assets)                                │
                                               ▼
                                         dbt source models
                                         (stg_<source>__<table>.sql)
                                               │
                                               ▼
                                         dims / facts
```

dlt lands tables directly into the `source` dataset in the lake. dbt staging
models then reference those tables via `{{ source(...) }}` exactly as they
would any other source.

---

## Adding a dlt pipeline

### 1. Install dependencies

`datavloot[optimist]` already includes dlt (with its DuckLake destination) and
dagster-dlt. A verified source may need an extra of its own, for example
`dlt[sql_database]`: add it to your project's `pyproject.toml` and run
`pip install -e .` again.

### 2. Write the pipeline asset

In `<project>_platform/assets.py`, add a `@dlt_assets` function for your
source. dlt ships with
[verified sources](https://dlthub.com/docs/dlt-ecosystem/verified-sources/)
for common systems (GitHub, Salesforce, Stripe, SQL databases, REST APIs,
etc.). For anything else, use `rest_api_source` or write a custom source.

```python
import dlt
from dagster import AssetExecutionContext
from dagster_dlt import DagsterDltResource, dlt_assets
from dlt.sources.rest_api import rest_api_source

from datavloot_platform import storage

@dlt_assets(
    dlt_source=rest_api_source(
        {
            "client": {"base_url": "https://api.example.com/v1/"},
            "resources": [
                {
                    "name": "orders",
                    "endpoint": {
                        "path": "orders",
                        "params": {
                            "updated_after": {
                                "type": "incremental",
                                "cursor_path": "updated_at",
                                "initial_value": "2020-01-01T00:00:00Z",
                            }
                        },
                    },
                },
            ],
        }
    ),
    dlt_pipeline=dlt.pipeline(
        pipeline_name="example_api",
        dataset_name="source",          # → the `source` schema in the project's lake
        destination=storage.dlt_destination(PROJECT_DIR),  # PROJECT_DIR: set at the top of assets.py
    ),
    group_name="source",
    pool="lake",                        # it writes to the lake: one writer at a time
)
def example_api_assets(context: AssetExecutionContext, dlt: DagsterDltResource):
    yield from dlt.run(context=context)
```

### 3. Register the dlt resource in definitions.py

Add the resource to the `Definitions` the scaffold already has. Keep its job and
schedule, or the daily lake maintenance stops:

```python
from dagster_dlt import DagsterDltResource

defs = Definitions(
    assets=all_assets,
    jobs=[lake_maintenance],
    schedules=[lake_maintenance_schedule],
    resources={
        "dbt": DbtCliResource(project_dir=<project>_dbt_project),
        "dlt": DagsterDltResource(),
    },
)
```

### 4. Define the dbt source

Add the dlt-loaded table to `models/source/_sources.yml`:

```yaml
sources:
  - name: example_api
    schema: source          # matches dlt dataset_name
    tables:
      - name: orders
```

Then create the staging model:

```sql
-- models/source/stg_example_api__orders.sql
{{ optimist.stage_source('example_api', 'orders', incremental_column='updated_at') }}
```

dlt writes a `_dlt_load_id` and `_dlt_id` column to every table. These are
internal dlt bookkeeping columns — ignore them in staging models; they are not
part of the business data.

---

## Incremental loading

dlt tracks its own cursor state in the pipeline's state store, persisted in
the lake (`_dlt_pipeline_state` in the dataset's schema), so it moves with the
lake. On the first run it performs a full load; on subsequent runs it only
fetches rows newer than the last cursor value. No additional configuration is
needed beyond setting `type: "incremental"` on the relevant endpoint parameter
as shown above.

---

## Verified sources

dlt maintains production-ready connectors for common systems. Install and use
them directly:

```bash
dlt init <source_name> duckdb
```

The generated pipeline writes to a DuckDB file of its own. When you move it
into a Dagster asset, replace its destination with `storage.dlt_destination(PROJECT_DIR)`
and give the asset `pool="lake"`, as in the example above, so it lands in the
project's lake.

Examples: `github`, `salesforce`, `stripe`, `sql_database`, `google_analytics`,
`hubspot`. Full list at [dlthub.com/docs/dlt-ecosystem/verified-sources](https://dlthub.com/docs/dlt-ecosystem/verified-sources/).
