# noaa

A dbt project built on the [datavloot toolkit](https://github.com/datavloot/datavloot-toolkit).

This project is an **example** of how a project is set up with the optimist toolkit. It uses
publicly available data from the [National Oceanic and Atmospheric Administration (NOAA)](https://www.noaa.gov/)
to demonstrate how to go from raw source data to a clean, tested, analytics-ready dbt project.

The data covers AIS vessel position broadcasts near Guam for 2025, combined with global port
reference data. The output answers questions like:
- How many vessels arrived at Apra Harbor in a given month?
- What is the busiest departure hour of the day?
- Which vessel types arrive most frequently?

---

## What this project demonstrates

- Scaffolding a new consuming project from the datavloot toolkit's template
- Loading a large raw dataset (3.2M rows) into DuckDB as a source — not a seed
- Loading small reference data (ports) as a dbt seed
- Staging source tables with audit columns and deduplication
- Deriving arrival/departure events from raw position broadcasts using window functions
- Building dimension and fact models using toolkit macros
- Configuring data quality tests at every layer

---

## Project structure

```
apps/
└── vessel_traffic.py         # dashboard for the Crows Nest's Dashboards tab (marimo run, no code)
data/
└── guam_2025.csv             # AIS position broadcasts, downloaded on the first run (see Getting started)
noaa_platform/                # Dagster platform layer (assets, definitions, the AIS download)
seeds/
├── ports.csv                 # global port reference data (3,804 rows)
├── sea_state_categories.csv  # Beaufort wind scale thresholds
└── _seeds.yml                # seed descriptions and tests
models/
├── source/
│   ├── ais/
│   │   ├── _sources.yml      # AIS source definition (raw.guam_2025)
│   │   ├── _schema.yml       # staging model docs and tests
│   │   └── stg_noaa__guam_2025.sql
│   └── open_meteo/
│       ├── _sources.yml      # Open-Meteo source definition
│       ├── _schema.yml
│       └── stg_open_meteo__guam_atmo_hourly.sql
└── business/
    ├── dimensions/
    │   ├── _dim_configs.yml  # dim_vessel, dim_port, dim_sea_state
    │   ├── dim_vessel.sql
    │   ├── dim_port.sql
    │   └── dim_sea_state.sql
    └── facts/
        ├── _fct_configs.yml  # fct_port_event
        └── fct_port_event.sql
tests/
├── assert_fct_port_event_not_in_future.sql
└── assert_stg_noaa_sog_in_range.sql
pyproject.toml                # Python package config; points Dagster at noaa_platform.definitions
```

---

## Getting started

All commands run from the project root. You'll need **Python 3.10–3.13** (3.12 recommended) and **git**.

This demo is part of the [datavloot toolkit](https://github.com/datavloot/datavloot-toolkit). If you haven't already, install the toolkit and copy the demo locally:

```bash
pip install datavloot[optimist]
datavloot demo
cd optimist-demo
```

### 1. Install the demo's Python package

```bash
pip install -e .
```

### 2. Install the dbt packages (optimist and Elementary)

```bash
dbt deps
```

Dagster does not do this for you; run it again after a change to `packages.yml`.

### 3. The AIS data

Nothing to do: the first run of `noaa/guam_2025` downloads NOAA's Guam 2025 AIS zone file
(41 MB, 366 MB unpacked), checks it against the file the demo was built on, and saves it as
`data/guam_2025.csv`. Later runs use that file.

Behind a proxy or offline, the run fails with the manual route: download
[guam-2025.zip](https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/data/ais/guam/guam-2025.zip)
from [NOAA's index](https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/data/ais/guam/index-guam.html),
unzip it, and save `guam_2025.csv` in `data/`.

### 4. Generate the dbt manifest

Dagster needs a compiled manifest before it can start:

```bash
dbt parse
```

### 5. Start the platform

```bash
datavloot start
```

This starts Dagster and the Crows Nest together and opens the Crows Nest at [http://localhost:8080](http://localhost:8080). Dagster is at [http://localhost:3000](http://localhost:3000). (`dagster dev` starts Dagster alone.)

In Dagster's **Asset Catalog**, click **Materialize all** — Dagster knows the dependency order and runs ingestion before dbt automatically.

To re-run only the dbt models without re-loading raw data, select the dbt assets and click **Materialize selected**.

Check the **Runs** tab for logs if a build fails; the Crows Nest's Pipelines panel shows the same runs.

---

## Exploring the data

### Interactive notebook (recommended)

`explore_noaa.py` is a [Marimo](https://marimo.io) reactive notebook that opens the project's lake read-only (so it can stay open while a pipeline runs) and provides charts and tables for all the key questions this project answers.

```bash
marimo edit notebooks/explore_noaa.py
```

Open [http://localhost:2718](http://localhost:2718). The Crows Nest's Notebooks panel starts it with one click as well.

### Dashboard

`apps/vessel_traffic.py` is the same data for someone who reads rather than explores: vessel traffic per month, the hours vessels arrive, port events per vessel category and per sea state, and the most frequent visitors, with filters for port, category and months. Notebooks in `apps/` open in the Crows Nest's **Dashboards** tab, run with `marimo run`: their output, without their code. To open it on its own:

```bash
marimo run apps/vessel_traffic.py
```

Build in `notebooks/`, then move what others should read to `apps/`.

On Windows, the first notebook can make Windows Defender Firewall ask whether Python may access public and private networks. Choose **Cancel**: everything runs on `localhost`, which the firewall does not block. Do not allow public networks; [getting-started](https://github.com/datavloot/datavloot-toolkit/blob/main/docs/getting-started.md#windows-asks-whether-python-may-use-public-and-private-networks) explains why and how to undo it.

---

## Querying the results

The data is a [DuckLake](https://ducklake.select) in `lake/`: the catalog in `lake/catalog.sqlite`, the tables as Parquet files under `lake/data/`. It is attached under the project name, `noaa`, and all business-layer tables land in the `noaa_business` schema.

### Install the DuckDB CLI

Use the same version as the `duckdb` package in your environment, not the latest release: the toolkit holds DuckDB below 2.0 (`duckdb<2` in its own `pyproject.toml`, not this project's) until the lake has been tried on it, and the latest CLI is 2.0.

```bash
# Download the standalone CLI binary (Linux x86-64)
V=$(python -c "import duckdb; print(duckdb.__version__)")   # a 1.x, e.g. 1.5.6
curl -fLo /tmp/duckdb.zip https://github.com/duckdb/duckdb/releases/download/v$V/duckdb_cli-linux-amd64.zip
unzip /tmp/duckdb.zip -d ~/.local/bin/
chmod +x ~/.local/bin/duckdb
```

On macOS use `duckdb_cli-osx-universal.zip`, on Windows `duckdb_cli-windows-amd64.zip`.

### Open the lake

From the project root:

```bash
duckdb -cmd "ATTACH 'ducklake:sqlite:lake/catalog.sqlite' AS noaa (DATA_PATH 'lake/data/', OVERRIDE_DATA_PATH true, READ_ONLY); USE noaa;"
```

### Useful queries

```sql
-- List all tables
SELECT table_schema, table_name FROM information_schema.tables WHERE table_catalog = 'noaa';

-- Total port events
SELECT COUNT(*) FROM noaa_business.fct_port_event;

-- Arrivals per month (is_departure = false means arrival)
SELECT
    DATE_TRUNC('month', event_time) AS month,
    COUNT(*) AS arrivals
FROM noaa_business.fct_port_event
WHERE NOT is_departure
GROUP BY 1
ORDER BY 1;

-- Busiest hour of day for departures
SELECT
    HOUR(event_time) AS hour_of_day,
    COUNT(*) AS departures
FROM noaa_business.fct_port_event
WHERE is_departure
GROUP BY 1
ORDER BY 2 DESC;

-- Vessel types with most port events
SELECT
    v.vessel_type,
    COUNT(*) AS port_events
FROM noaa_business.fct_port_event f
LEFT JOIN noaa_business.dim_vessel v ON f.vessel_key = v.vessel_key
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

Type `.quit` to exit the DuckDB shell.

---

## Data lineage

```
seeds/ports.csv                    →  dim_port
seeds/sea_state_categories.csv     →  dim_sea_state
raw.guam_2025 (DuckDB)             →  stg_noaa__guam_2025         →  dim_vessel
Open-Meteo archive API (dlt)       →  stg_open_meteo__guam_atmo_hourly  ↘
                                                                      fct_port_event  →  dim_vessel    (FK)
                                                                                      →  dim_port      (FK)
                                                                                      →  dim_date      (FK)
                                                                                      →  dim_time      (FK)
                                                                                      →  dim_sea_state (FK)
```
