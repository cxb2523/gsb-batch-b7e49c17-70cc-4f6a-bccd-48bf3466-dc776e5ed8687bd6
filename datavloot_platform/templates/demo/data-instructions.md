# noaa

A dbt project built on the [datavloot toolkit](https://github.com/datavloot/datavloot-toolkit),
demonstrating AIS vessel tracking enriched with marine weather data for the port of Guam.

See `dbt_packages/optimist/data-instructions.md` for the full workflow, naming conventions, modelling
conventions, and captain/crew guide. Run `dbt deps` if the file is not yet present.

---

## Project context

- **Sources**: NOAA AIS broadcasts (CSV → DuckDB via Dagster asset) and Open-Meteo atmospheric hourly
  (dlt pipeline — incremental by date cursor)
- **Warehouse**: DuckLake in `lake/` (SQLite catalog, Parquet files), attached as `noaa`
- **Orchestration**: Dagster via `noaa_platform/`; run `dagster dev` from the project root. Dagster
  is the only production writer (`prod` target, `noaa_*` schemas); dbt by hand builds `dev_*`
  (see "Development and production" below)
- **Source subfolders**: `source/ais/` (incremental) and `source/open_meteo/` (ephemeral) —
  materializations set by folder in `dbt_project.yml`

---

## Development and production

Production has one writer: Dagster. Everything else develops alongside it without touching
production data.

| | Who | dbt target | Lands in |
|---|---|---|---|
| Production | Dagster, from the UI, a schedule or a sensor | `prod` | `noaa_source`, `noaa_business`, … |
| Development | You or the crew, running `dbt run`, `dbt build`, `dbt seed` by hand | `dev` (the default) | `dev_source`, `dev_business`, … |

Both targets attach the same lake (see `profiles.yml`). Sources are read from the same raw
schemas in both, so a dev build works on production input but writes only to `dev_*`.

Rules:

- **Never pass `--target prod` by hand.** To get a change into production, materialise the
  assets in Dagster. A manual prod run bypasses the concurrency limit below and can collide with
  a running pipeline.
- **Every Dagster asset or op that writes to the lake sets `pool=LAKE_POOL`** (`assets.py`):
  dbt assets, dlt assets, lake maintenance and any asset that writes through `storage.connect`.
  `dagster.yaml` limits the pool to one at a time, because the lake accepts one commit at a time;
  without the pool, two writers committing together fail with `database is locked`. Dagster reads
  that file from its home: `datavloot start` uses `.dagster/` in the project and copies
  `dagster.yaml` there on every start, so edit the one in the project. If you set `DAGSTER_HOME`
  yourself, copy `dagster.yaml` into that directory.
- Readers (notebooks, the Crows Nest) open the lake read-only and can run at any time.

A dev build can still collide with a Dagster commit at the same moment. dbt retries the statement
(`retries` in `profiles.yml`). If a model still fails on a lock, rerun it.

### Lake maintenance

Every write adds Parquet files, and old snapshots keep old files alive. The `lake_maintenance`
job (`lake_maintenance.py`) runs daily at 03:00 while Dagster runs: it merges small files, expires
snapshots older than seven days (`keep_snapshots_days` in the job's config) and deletes files
nothing refers to any more. Files are deleted only after a margin of days, so a reader on an old
snapshot can finish; the reasons are in `datavloot_platform/maintenance.py`.

Deleting files waits for the lake's file lock (`lake/files.lock`), which a backup also holds. If
the lock is taken, the job skips deleting and the next run catches up.

To switch the schedule off, set `DATAVLOOT_LAKE_MAINTENANCE=off` in a `.env` file in the project
directory (or in the environment) and restart Dagster. The job then runs only when you start it in
Dagster; `on`, the default, switches it back. Dagster remembers a schedule you switched on or off
in its UI (in `.dagster/`, kept between starts), and that wins over the variable.
