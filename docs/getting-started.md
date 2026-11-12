# Getting started

A project created with `datavloot new` is a dbt project with a Dagster layer around it. Its
models use the `optimist` dbt package, which provides standardized macros, conventions, and
model templates; the package has its own repository,
[dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist).

---

## Installation

`datavloot new` writes the package into the project's `packages.yml`, pinned to the release this
toolkit was tested with, together with Elementary, which the Crows Nest's Data quality and
Catalog panels read:

```yaml
packages:
  - tarball: "https://codeload.github.com/datavloot/dbt-datavloot-optimist/tar.gz/refs/tags/0.1.1"
    name: optimist
  - package: elementary-data/elementary
    version: [">=0.25.0", "<0.26.0"]
```

Then install them:

```bash
dbt deps
```

---

## Project structure

```
your-project/
└── models/
    ├── source/           # thin staging wrappers over raw sources
    │   ├── _sources.yml  # source definitions (scaffolded by datavloot new)
    │   ├── _schema.yml   # model docs and tests (scaffolded by datavloot new)
    │   └── stg_<source>__<table>.sql
    └── business/         # transformed, business-oriented models
```

`datavloot new` scaffolds the blank config templates for the `source/` layer,
`models/source/_sources.yml` and `models/source/_schema.yml`.

---

## Available features

| Feature | Description | Docs |
|---|---|---|
| `stage_source` | Auto-generate a source staging model with audit columns | [Source layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/source-layer.md) |
| `add_audit_columns` | Emit standard audit columns in any SELECT | [Source layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/source-layer.md) |
| `build_dimension` | Generate a dimension from a staged model, seed, or inline CTE | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `build_fact` | Generate a fact with dim joins and measures from config | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `build_dataset` | Flat, documented one-big-table output from a source you have already prepared (no surrogate key, no dimension joins) | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `generate_surrogate_key` | MD5 surrogate key over a list of columns | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `generate_date_key` | Integer `YYYYMMDD` key for joining to `dim_date` | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `build_dim_date` | Date dimension, called from the project's own `dim_date.sql` (2015–2035 by default, configurable) | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |
| `build_dim_time` | Time-of-day dimension at minute granularity, called from `dim_time.sql` | [Business layer](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) |

---

## Running the pipeline

The toolkit uses [Dagster](https://dagster.io) to orchestrate assets.

Activate the project's virtual environment first so `dbt` and `dagster` are on your PATH
(`source .venv/bin/activate` on Linux and macOS, `.venv\Scripts\activate` on Windows).

Then generate a compiled dbt manifest (Dagster needs this to discover your models) and start the
platform:

```bash
dbt parse
datavloot start      # Dagster and the Crows Nest; or `dagster dev` for Dagster alone
```

Open [http://localhost:3000](http://localhost:3000) for Dagster, or the Crows Nest at
[http://localhost:8080](http://localhost:8080). The **Asset Catalog** lists every asset in
your pipeline — ingestion assets (dlt pipelines or plain Dagster assets) alongside all dbt source
and business models.

Materialise assets in dependency order: raw ingestion first, then dbt. To re-run only the dbt
transformation layer without re-loading source data, select the dbt assets and click
**Materialize selected**.

The **Runs** tab shows logs for every execution. dbt test failures and Elementary data quality
alerts surface here as asset check failures alongside the asset metadata.

### Windows asks whether Python may use public and private networks

The first time a notebook opens (from the Crows Nest or with `marimo edit`), Windows Defender
Firewall can ask whether Python may access public and private networks. **Choose Cancel**, or
leave both boxes unticked. Dagster, the Crows Nest and Marimo listen on `localhost` only, which
the firewall does not block, so everything keeps working.

The question comes from Marimo, not from anything the toolkit opens: in edit mode it looks for
free ports for its language servers on all network interfaces, which is enough for Windows to
ask. Windows asks once per `python.exe`, so it can come back after installing a new Python
version.

Do not allow **public networks**. The rule would cover that `python.exe` on every port, for good:
anything it runs later on a network address is then reachable from any Wi-Fi you join. That
includes `marimo edit --no-token` with another `--host` (a Python shell for anyone on that
network) and `datavloot launch --host 0.0.0.0`, whose sign-in is off on a laptop. If you
allowed it, switch the rule off under *Windows Security → Firewall & network protection →
Allow an app through firewall*, or in an administrator PowerShell:

```powershell
Get-NetFirewallApplicationFilter | Where-Object Program -match 'python' | Get-NetFirewallRule |
  Where-Object { $_.Action -eq 'Allow' -and $_.Profile -match 'Public' } | Disable-NetFirewallRule
```

To show the Crows Nest to someone on your own network, open one port on the private profile for
the occasion instead, start the Crows Nest on all interfaces with a sign-in token
(`CROWSNEST_AUTH_TOKEN`, see the README), and remove the rule afterwards:

```powershell
New-NetFirewallRule -DisplayName "Crows Nest demo" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
$env:CROWSNEST_AUTH_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
datavloot launch --host 0.0.0.0
# afterwards:
Remove-NetFirewallRule -DisplayName "Crows Nest demo"
```

---

## Querying results

All data is in a DuckLake under `lake/`: the catalog in `lake/catalog.sqlite`, the tables as
Parquet files under `lake/data/`. The Crows Nest's SQL editor and the notebooks open it for you;
from Python, `datavloot_platform.storage.connect(read_only=True)` does the same (see "Where the
data lives" in the README).

### Install the DuckDB CLI

Use the same version as the `duckdb` package in your environment, not the latest release: the
toolkit holds DuckDB below 2.0 (`duckdb<2` in its own `pyproject.toml`, not your project's) until
the lake has been tried on it, and the latest CLI is 2.0.

```bash
V=$(python -c "import duckdb; print(duckdb.__version__)")   # a 1.x, e.g. 1.5.6
curl -fLo /tmp/duckdb.zip https://github.com/duckdb/duckdb/releases/download/v$V/duckdb_cli-linux-amd64.zip
unzip /tmp/duckdb.zip -d ~/.local/bin/
chmod +x ~/.local/bin/duckdb
```

On macOS use `duckdb_cli-osx-universal.zip`, on Windows `duckdb_cli-windows-amd64.zip`.

### Open the lake

From the project directory, read-only, so it can stay open while a pipeline runs:

```bash
duckdb -cmd "ATTACH 'ducklake:sqlite:lake/catalog.sqlite' AS <project> (DATA_PATH 'lake/data/', OVERRIDE_DATA_PATH true, READ_ONLY); USE <project>;"
```

### Useful shell commands

```sql
-- List all tables across all schemas
SHOW ALL TABLES;

-- Inspect a table's columns
DESCRIBE <project>_business.dim_<entity>;

-- Count rows in a fact table
SELECT COUNT(*) FROM <project>_business.fct_<event>;
```

Type `.quit` to exit.

### Schema layout

Production (what Dagster builds, dbt's `prod` target) and development (dbt by hand, the default
`dev` target) live side by side in the same lake:

| Schema | Contents |
|---|---|
| The schema your ingestion writes to (dlt's `dataset_name`, e.g. `source`) | Raw tables loaded by ingestion assets |
| `<project>_source`, `<project>_business` | Staging, dimension and fact tables built by Dagster |
| `<project>_seeds` | Seeds |
| `<project>_elementary` | Elementary data quality metadata |
| `dev_source`, `dev_business`, … | The same, from dbt runs by hand |
