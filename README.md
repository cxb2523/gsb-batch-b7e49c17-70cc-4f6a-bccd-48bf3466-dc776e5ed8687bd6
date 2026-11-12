# datavloot-toolkit

A self-hosted data platform for data engineers who want to own their stack rather than be trained on someone else's.

Most data engineering roles today make you proficient in a vendor — Databricks, Snowflake, a managed orchestrator. That knowledge doesn't transfer when the vendor changes or the contract ends. The Optimist gives you a complete, working platform built on open-source tools that you run and understand yourself, so the expertise stays with you.

The stack:

| Component | Tool | Role |
|---|---|---|
| Orchestration | [Dagster](https://dagster.io) | Schedule and monitor your data pipelines |
| Ingestion | [dlt](https://dlthub.com) | Load data from APIs, databases, and files into DuckDB |
| Transformation | [dbt](https://getdbt.com) | Transform, test, and document your data |
| Storage | [DuckDB](https://duckdb.org) + [DuckLake](https://ducklake.select) | Local lakehouse with two-layer architecture |
| Data quality | [Elementary](https://elementary-data.com) | Monitors, alerts, and reports on data quality |
| Exploration | [Marimo](https://marimo.io) | Reactive notebooks for querying and visualising results |
| Dashboard | Crows Nest (built-in) | Unified browser interface for all of the above |

---

## Why this stack

All six tools are Python-native, open source, and run locally without cloud infrastructure. They were chosen because they compose cleanly: dlt loads into DuckDB, dbt transforms it, Dagster orchestrates both, Elementary monitors the output, and Marimo queries the result. Each tool does one job and exposes it through standard interfaces.

The alternatives — Databricks, Fivetran, Airflow on managed infrastructure, a cloud warehouse — are not wrong, but they carry a cost beyond the invoice: you become dependent on the platform, and the platform abstracts away the mechanics you should understand. This stack does not abstract. It uses proven open-source tooling of which the code can be downloaded and reviewed at any time to understand what is under te hood.

The Optimist is a fully functional data platform that runs on your local machine — not a toy or a tutorial environment, but the real thing. The intent is that once you've built and understood it locally, you can scale the same platform up to support an actual business, open source, fully owned, with no black boxes.

---

## Installing

To try Datavloot on your own laptop, one command installs it and opens the Crows Nest on the NOAA demo. It needs no Python, git or admin rights.

**Windows** (PowerShell or Command Prompt):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://datavloot.nl/install.ps1 | iex"
```

**macOS and Linux:**

```bash
curl -LsSf https://datavloot.nl/install.sh | bash
```

The script:

1. Installs [uv](https://docs.astral.sh/uv/) for your user, if it is not there yet.
2. Creates the demo project in `optimist-demo` in your home folder.
3. Gives the project its own Python 3.12 and packages, and installs the dbt packages.
4. Starts Dagster and the Crows Nest, and opens [http://localhost:8080](http://localhost:8080).
5. Starts the first run, which downloads the demo's AIS data (41 MB) and builds the models. Follow it in the Pipelines panel.

Keep the window open: closing it, or pressing Ctrl+C, stops Datavloot. To start it again later, from the project folder, on Windows:

```powershell
.venv\Scripts\datavloot start
```

On macOS and Linux:

```bash
.venv/bin/datavloot start
```

`uv run datavloot start` does the same, but only in a terminal opened after uv was installed. Running the install command again also starts the project.

**Your own project instead of the demo.** Set `DATAVLOOT_PROJECT` to its repository first. The script then installs that project's latest tag with `datavloot new --from` (see [Installing a project on other machines](#installing-a-project-on-other-machines)), asking for a token when the repository is private:

```powershell
$env:DATAVLOOT_PROJECT = 'https://gitlab.com/group/project'
powershell -ExecutionPolicy ByPass -c "irm https://datavloot.nl/install.ps1 | iex"
```

```bash
curl -LsSf https://datavloot.nl/install.sh | DATAVLOOT_PROJECT=https://gitlab.com/group/project bash
```

`DATAVLOOT_REF` picks a tag and `DATAVLOOT_PATH` the project's folder in the repository, when it cannot be found by itself. The project lands in a folder named after the repository in your home folder.

Running the install command again does the same: it finds the project and starts it, and never overwrites it. To install somewhere else, set `DATAVLOOT_DIR` first: `$env:DATAVLOOT_DIR = 'C:\dev\demo'` in PowerShell, or `curl ... | DATAVLOOT_DIR=~/dev/demo bash`. `DATAVLOOT_VERSION` picks a toolkit version (default: the latest).

The script stops with a message when there is no internet connection, when port 8080 or 3000 is already in use (often by a Datavloot that is still running), or when the folder exists but is not a Datavloot project. `-ExecutionPolicy ByPass` in the Windows command applies to that one command only; it changes no setting.

**Upgrading.** A project pins the toolkit to its minor version (`datavloot[optimist]~=0.3.0`). To get the latest patch release, run this in the project folder:

```bash
uv sync --upgrade-package datavloot
```

Moving to a newer minor version is a change to `pyproject.toml` and `packages.yml` (see [#55](https://github.com/datavloot/datavloot-toolkit/issues/55)).

To build a project of your own rather than try the demo, follow the steps below.

---

## Getting started

### Prerequisites

- Python 3.10–3.13 (3.12 recommended; 3.14 is not yet supported by all dependencies)
- Git, to keep your own project in a repository. Installing and running a project does not need it.

No C compiler is needed: every dependency installs from a prebuilt wheel or is pure Python.

> **Intel Macs:** `cryptography` has no Intel wheel from version 49 on. Run `pip install "cryptography<49"` before installing datavloot, or pip will try to build it from source (needs Rust and a C compiler).

> **Where to put a project:** on a local disk, outside OneDrive, Dropbox, Google Drive, iCloud and network drives. DuckDB relies on file locks that sync clients and network file systems do not honour. On Windows, `Documents` and `Desktop` are often synced to OneDrive; a folder like `C:\dev\` is not. Keep the path short on Windows too: unless [long paths are enabled](https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation), a project folder longer than about 100 characters runs into the 260-character limit. `datavloot new`, `demo` and `start` warn when they detect either.

### 1. Create your own repository

Create a new repository on GitHub or GitLab (empty is fine), then clone it and navigate into it.

### 2. Install the toolkit

```bash
pip install datavloot[optimist]
```

The `[optimist]` part installs the full Optimist stack (Dagster, dbt, dlt, DuckDB, Marimo, Elementary). Without it you get only the bare `datavloot` package with no tools.

If `pip` is not recognised (common on Windows), use:

```bash
python -m pip install datavloot[optimist]
```

> **Note:** The first install downloads and installs a large number of packages (Dagster, dbt, dlt, Elementary, and their dependencies). Expect it to take 5–10 minutes. The prompt will return when it is done — let it run.


### 3. Scaffold a new project

```bash
datavloot new <my-project>
cd <my-project>
```

Please substitute 'my-project' here with the desired name of your project. The project name is inferred from the directory — all placeholders in config and code are substituted automatically.

Or try the NOAA worked example first:

```bash
datavloot demo
cd optimist-demo
pip install -e .   # install the demo's Python package
```

### 4. Install dependencies and dbt packages

```bash
pip install -e .   # install your project's Python package
dbt deps           # install the dbt packages (optimist, Elementary) — re-run whenever you upgrade or change packages.yml
dbt parse          # compile the manifest (required before first run)
```

Dagster does not install the dbt packages itself; it only compiles the manifest when it loads the code. After a change to `packages.yml`, run `uv run dbt deps` yourself.

### 5. Start the platform

```bash
datavloot start
```

This starts Dagster and the Crows Nest together and opens the dashboard at [http://localhost:8080](http://localhost:8080). Dagster is available separately at [http://localhost:3000](http://localhost:3000). Press Ctrl+C to stop both.

Dagster keeps its state (run history, which schedules and sensors are on, what a sensor already picked up) in `.dagster/` in the project, so a restart forgets none of it. `datavloot start` copies the project's `dagster.yaml` there on every start; edit the one in the project. If you set `DAGSTER_HOME` yourself, that directory is used instead, and `dagster.yaml` has to be copied into it by you.

If you prefer two terminals, you can start them independently:

```bash
dagster dev          # terminal 1 — Dagster at http://localhost:3000
datavloot launch     # terminal 2 — Crows Nest at http://localhost:8080
```

### Starting at login

For someone who only uses the Crows Nest, run this once from the project directory:

```bash
datavloot autostart on
```

From the next login, Datavloot starts by itself, for this user only, without admin rights and without a terminal window. It also makes a shortcut named after the project (`name` in `branding/branding.yml`, else the folder's name) with the project's icon (`branding/icon.png`, else `branding/logo.png`, else the datavloot mark; an SVG logo cannot be turned into an icon). The shortcut opens the Crows Nest, and starts Datavloot in the background first when it is not running.

| | Windows | macOS |
|---|---|---|
| At login | a shortcut in the Startup folder (`shell:startup`) | a LaunchAgent in `~/Library/LaunchAgents` |
| Shortcut | Start menu and desktop | an app in `~/Applications` |

- **Log.** Everything Datavloot prints goes to `logs/datavloot-start.log` in the project. When the shortcut cannot start the Crows Nest (a port in use, a broken install), it opens that log, with the reason in it.
- **Stopping it.** Started at login or from the shortcut, Datavloot has no window to close: **Shut down**, at the bottom of the Crows Nest's sidebar, stops Dagster, the Crows Nest and the Marimo servers it started, after cancelling a run that is still going. The button is there only when the Crows Nest listens on this machine alone, as on a laptop. A run cut off some other way (a forced stop, a logout, a laptop switching off) would stay "Started" in Dagster; `datavloot start` marks such runs as cancelled once Dagster is up again, and frees the concurrency-pool slots that finished runs still claim, so a cut-off run does not keep every later run Queued. Shut down does the same.
- **Only the shortcut.** `datavloot shortcut on` makes the shortcut without the login entry, for someone who wants to open Datavloot with a click but not have it running from every login. Run after `autostart on`, it takes the login entry away and keeps the shortcut.
- **Switching it off.** `datavloot autostart off` (or `datavloot shortcut off`) removes the login entry and the shortcuts. A Datavloot that is running keeps running until you shut it down or log out. `datavloot autostart status` shows what is installed and whether the Crows Nest answers.
- **Scheduled runs happen only while the machine is on and you are logged in.** Datavloot runs as your user, not as a service. A run whose time passed while the laptop was off or asleep is not made up afterwards; start it by hand in Dagster.
- One project at a time: the Crows Nest and Dagster use ports 8080 and 3000, so autostart for a second project fails at login with "port in use" in its log.
- The macOS half has not yet been tried on a real Mac.

---

## Data layers

This platform uses a two-layer architecture, intentionally kept simple for small teams:

```
source    →    business
 raw &          modelled
 staged         tables
 views
```

Rather than the traditional three-layer medallion (bronze → silver → gold), the **source** layer combines raw data landing and staging into a single step — your source models read directly from ingested data and expose clean, audited views. The **business** layer builds the dimensions, facts, and aggregations your team actually queries.

This keeps things simple: fewer layers, less pipeline complexity, faster setup.

---

## Building your platform with AI

This toolkit is designed to be used alongside an AI assistant. Not as an abstraction that removes the need to understand what you're building, but as a way to move faster while you're learning it.

The **captain and crew** model describes the workflow: you direct the session — you know your data sources, your domain, and what the output should look like. The AI handles implementation within the toolkit's conventions. You review, question, and approve. The understanding has to be yours; the AI accelerates getting there.

A dedicated agent guide lives at [data-instructions.md](https://github.com/datavloot/datavloot-toolkit/blob/main/datavloot_platform/templates/scaffold/data-instructions.md) and inside every project created with `datavloot new`. Hand it to your AI assistant at the start of a session so it knows the toolkit's conventions and can work within them.

This is also where AI genuinely opens doors. If you have strong domain knowledge and data instincts but haven't spent years writing dbt macros or wiring up Dagster assets, an AI assistant can bridge that gap — not by hiding the stack from you, but by letting you engage with it at the right level before all the implementation details are second nature. The [NOAA demo](https://github.com/datavloot/datavloot-toolkit/tree/main/datavloot_platform/templates/demo) demonstrates this: someone with solid data understanding directed an AI through the full workflow, from raw AIS vessel broadcasts to a complete dimensional model. The conversation that produced it is at [conversation.md](https://github.com/datavloot/datavloot-toolkit/blob/main/datavloot_platform/templates/demo/conversation.md).

---

## Starting a new project

Run `datavloot new <path>` to scaffold a new project. The project name is inferred from the directory name you provide — all placeholders are substituted automatically. This copies the following structure:

```
<project-name>/
├── pyproject.toml                    # Python project config; wires Dagster to the platform module
├── .gitignore
├── data-instructions.md              # AI agent workflow guide (captain/crew model)
├── packages.yml                      # the optimist dbt package (dbt-datavloot-optimist) and Elementary
├── dbt_project.yml                   # project config
├── profiles.yml                      # dbt connection: attaches the lake; dev (default) and prod targets
├── dagster.yaml                      # Dagster instance settings: one lake writer at a time
├── lake/                             # the data: catalog.sqlite + Parquet files (git-ignored)
├── notebooks/
│   └── explore.py                    # Marimo notebook for querying results
├── <project_name>_platform/          # Dagster layer (ready to run)
│   ├── __init__.py
│   ├── assets.py                     # dbt assets + commented dlt ingestion pattern
│   ├── lake_maintenance.py           # daily job: merge small files, expire old snapshots
│   └── definitions.py
├── seeds/
│   ├── _seeds.yml
│   ├── how_to.md
│   └── priority_levels.csv
└── models/
    ├── source/
    │   ├── _sources.yml
    │   └── _schema.yml
    └── business/
        ├── dimensions/_dim_configs.yml
        └── facts/_fct_configs.yml
```

Run `dbt deps` after scaffolding, then follow `data-instructions.md`.

### Where the data lives

All data is in `lake/`: a [DuckLake](https://ducklake.select) with its catalog in `lake/catalog.sqlite` and the tables as Parquet files under `lake/data/`. That directory is the whole state of the platform; copy it and you have a backup, move the project and it keeps working. Set `DATAVLOOT_LAKE_DIR` to keep it somewhere else.

dbt, dlt, Dagster, the notebooks and the Crows Nest all attach the same lake, so a notebook can stay open while a pipeline writes, and readers only ever see finished commits. Writes are taken one commit at a time: two processes committing at the same moment means one of them fails with `database is locked` and has to be rerun.

Every write adds files, so Dagster also runs a `lake_maintenance` job daily at 03:00: it merges small files, expires snapshots older than seven days and deletes files nothing refers to any more. See `datavloot_platform/maintenance.py` for the steps and their safety margins. Set `DATAVLOOT_LAKE_MAINTENANCE=off` to switch the schedule off; the job can then still be run by hand.

There is one production path: Dagster. It builds dbt's `prod` target, into `<project>_source`, `<project>_business` and so on, and `dagster.yaml` lets only one writing asset run at a time. dbt by hand uses the default `dev` target and writes to `dev_source`, `dev_business` and so on in the same lake, so you can develop while Dagster runs without touching production. See "Development and production" in the project's `data-instructions.md`.

In your own code, `datavloot_platform.storage` attaches the lake the same way the toolkit does:

```python
from datavloot_platform import storage

con = storage.connect(read_only=True)              # finds the project from the current directory
con.sql("SELECT * FROM <project>_business.dim_date").show()
```

In a Marimo notebook, pass `default=True`: the lake is then attached to DuckDB's default connection, which Marimo's own "DuckDB (in-memory)" SQL engine uses, so SQL cells work on either engine. The notebook templates do this. Not in an app under `marimo run`: there one process serves every viewer.

### Upgrading a project that writes to a single `.duckdb` file

Projects created before the lake write everything to `<project>.duckdb`. To move one over, take `profiles.yml`, the `lake/` directory and the `storage` calls in `<project>_platform/assets.py` and `notebooks/` from a freshly scaffolded project, then either rerun your pipelines from scratch, or copy the existing tables across from the project directory:

```python
from datavloot_platform import storage

con = storage.connect(".")
con.execute("ATTACH '<project>.duckdb' AS old (READ_ONLY)")
for schema, table in con.execute("""
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_catalog = 'old' AND table_type = 'BASE TABLE'
""").fetchall():
    con.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    con.execute(f'CREATE TABLE "{schema}"."{table}" AS FROM old."{schema}"."{table}"')
```

Views are not copied; `dbt run` recreates them.

### Upgrading a project to separate development from production

In older projects `profiles.yml` has one target, `dev`, that writes to the production schemas, and Dagster runs writers side by side. To move one over, take these from a freshly scaffolded project:

- `profiles.yml`: `dev` now writes to `dev_*` schemas and a new `prod` target writes to `<project>_*`, where your data already is. No data has to move.
- `dagster.yaml`, placed in the project directory.
- In `<project>_platform/assets.py`, add `target="prod"` to `DbtProject(...)` and `pool="lake"` to every asset that writes to the lake: the dbt assets, dlt assets and any asset that writes through `storage.connect`.

### Upgrading a project to dagster-dbt 0.29.28 or later

From dagster-dbt 0.29.8, `prepare_if_dev()` runs `dbt deps` each time Dagster loads the code, and `dbt deps` first deletes `dbt_packages/`. When the code server and a run load at the same time, Windows refuses (`PermissionError: [WinError 32]` on a file in `dbt_packages`) and every run fails, dlt assets included. Projects created with datavloot 0.4.0 or later avoid this. In an older project, add `install_deps=False` to `DbtProject(...)` in `<project>_platform/assets.py`:

```python
project_dbt_project = DbtProject(project_dir=PROJECT_DIR, target="prod", install_deps=False)
```

That argument needs dagster-dbt 0.29.28 or later (`uv lock --upgrade-package dagster-dbt`). From then on, run `uv run dbt deps` yourself after a change to `packages.yml`; `datavloot update` and the installers already do.

---

## Installing a project on other machines

When one person maintains a project and others only run it and use the Crows Nest, those machines can install it from a tag of its GitHub or GitLab repository, without git:

```
datavloot new C:\dev\harbor --from https://gitlab.com/<group>/harbor
```

This downloads the latest tag as a zip archive (or the one named with `--ref v1.2.0`), installs the project's files into the new folder, asks for the settings the project needs and writes them to `.env`, then runs `uv sync`, `uv run dbt deps` and `uv run dbt parse` there. Start it afterwards with `uv run datavloot start --run`. The machine needs [uv](https://docs.astral.sh/uv/) and `datavloot[optimist]`, for example through `uvx --from "datavloot[optimist]" datavloot new ...`. The target folder must be new or empty; an existing project is never overwritten.

An installation is a copy of one tag, not a working copy: it is meant to be run, not changed.

### Preparing a project for this

- **A repository** on github.com, gitlab.com or a self-hosted GitLab. The project may sit in a subfolder (`ketenconnect/` next to other files): the folder with both `dbt_project.yml` and `pyproject.toml` is found by itself. Only that folder is installed. If the repository has none or several, name it with `--path <folder>`.
- **A tag per version**, such as `v1.0.0`. The latest tag is the highest by semantic version (a leading `v` is fine); tags that are not versions are ignored, and so are pre-releases such as `v2.0.0-rc.1` unless there is no release at all. Install one on purpose with `--ref`.
- **A `uv.lock`** next to `pyproject.toml`, so every machine gets the versions you tested. `uv sync --locked` stops when it does not match `pyproject.toml`: run `uv lock` before tagging.
- **A `.env.example`** with every setting the project reads, such as where the input files are and credentials for sources, each with a comment above it. The comment is shown when the value is asked for, and the value after `=` is the default. Values of names with `TOKEN`, `PASSWORD`, `SECRET` or `KEY` are asked for without showing them. Keep `.env` itself out of the repository.

  ```
  # Folder with the KetenConnect exports (.xlsx)
  EXPORT_DIR=data

  # Password for the source database
  SOURCE_PASSWORD=
  ```
- **Local state in `.gitignore`**: `.env`, `.venv/`, `lake/`, `target/`, `dbt_packages/`, `logs/`, and data files in `data/`. What is in the repository is what gets installed.

A **private repository** needs a read-only token, asked for when the host refuses without one:

- GitLab: a project access token, or a personal access token, with the `read_api` scope. A deploy token does not work: it cannot use the API for tags and archives.
- GitHub: a fine-grained personal access token with access to the repository and the permission Contents: read.

The token is stored for later updates in the system's credential store (Windows Credential Manager, the macOS Keychain, the Secret Service on Linux), under the repository's host and path. Where there is none, it goes into `tokens.json` in the user's config folder (`%APPDATA%\datavloot` on Windows), readable only by that user, and the command says so. It is never written into the project. To install without a prompt, set `DATAVLOOT_TOKEN`. When a token expires, the next command asks for a new one.

### Rolling out a new version

Tag the new version in the repository, then on each machine, in the project's folder:

```
uv run datavloot update              # to the latest tag
uv run datavloot update --ref v1.1.0 # to a given tag, also an older one
```

`update` downloads and unpacks the tag first; if that fails (no internet, an expired token, an unknown tag) the installation is left as it was. Then it replaces exactly the files the previous tag installed, listed with their hashes in `.datavloot/install.json`: files the new tag no longer has are removed, the others overwritten. Everything else stays: `.env`, `data/`, `lake/`, `.venv`, `logs/`, `target/`, `dbt_packages/` and notebooks someone made. A file of the installation that was changed on the machine is overwritten too, with a warning. It then asks only for settings that `.env.example` gained, and runs `uv sync`, `dbt deps` and `dbt parse` again.

Finally it rebuilds the tables with the new models: when this project's Dagster is running, it reloads the code and starts a run of every asset (leave that out with `--no-run`); when it is not, it says how to start it. Restart Dagster and the Crows Nest afterwards so they run the new version. On Windows, a running Dagster can keep `uv sync` from replacing files in `.venv`; if it fails on that, close Dagster and the Crows Nest and run `uv sync` and the steps after it again.

---

## Example project

The [NOAA demo](https://github.com/datavloot/datavloot-toolkit/tree/main/datavloot_platform/templates/demo) is a complete consuming project built on this toolkit. It uses
publicly available AIS vessel position broadcasts from [NOAA](https://www.noaa.gov/) near Guam
(2025) combined with global port reference data. It demonstrates the full workflow:

- Loading a large raw dataset (3.2 M rows) into DuckDB as a source
- Staging with audit columns and deduplication
- Deriving arrival and departure events from raw position broadcasts using window functions
- Building `dim_vessel`, `dim_port`, and `fct_port_event` with toolkit macros
- Configuring data quality tests at every layer

Run `datavloot demo` to copy it locally, or browse it at [datavloot_platform/templates/demo/](https://github.com/datavloot/datavloot-toolkit/tree/main/datavloot_platform/templates/demo). See the [demo README](https://github.com/datavloot/datavloot-toolkit/blob/main/datavloot_platform/templates/demo/README.md) for details.

---

## Adding your own data

### 1. Ingest raw data

For loading data from APIs, databases, or files, use [dlt](https://dlthub.com) — it handles pagination, schema inference, incremental loading, and writing directly into DuckDB with no boilerplate. Wrap the dlt pipeline in a Dagster asset so it appears in the UI and can be scheduled alongside your dbt models. See [`noaa_platform/assets.py`](https://github.com/datavloot/datavloot-toolkit/blob/main/datavloot_platform/templates/demo/noaa_platform/assets.py) in the demo for a working example of a dlt pipeline asset, and the [dlt docs](https://dlthub.com/docs) for available sources and connectors.

For simpler cases (reading a local file, calling a small API), a plain Dagster asset that opens the lake with `storage.connect()` is enough; see the [ingestion guide](https://github.com/datavloot/datavloot-toolkit/blob/main/docs/ingestion.md).

### 2. Define your sources in dbt

Fill in `models/source/_sources.yml` (scaffolded with every new project) with your source tables.

### 3. Stage with one line

```sql
-- models/source/stg_harbor__vessels.sql
{{ optimist.stage_source('harbor', 'vessels') }}
```

### 4. Build business models

```sql
-- models/business/dimensions/dim_vessel.sql
{{ optimist.build_dimension(
    source_model = 'stg_harbor__vessels',
    natural_key  = 'vessel_id',
    attributes   = ['vessel_name', 'flag', 'vessel_type']
) }}
```

```sql
-- models/business/facts/fct_port_call.sql
{{ optimist.build_fact(
    source_model   = 'stg_harbor__port_calls',
    natural_key    = 'port_call_id',
    dimensions     = [{'model': 'dim_vessel', 'key': 'vessel_id'}],
    measures       = ['duration_hours', 'cargo_tonnes']
) }}
```

---

## Running your pipeline

Once your assets and models are in place, materialise them in Dagster in dependency order:

| Step | What to materialise | What it does |
|---|---|---|
| 1 | Ingestion assets | Loads raw data into DuckDB via dlt or a plain Dagster asset |
| 2 | All dbt assets | Runs `dbt build` — seeds, staging, dimensions, facts, and tests |

Open the **Asset Catalog** at [http://localhost:3000](http://localhost:3000), select the assets, and click **Materialize selected**. Check the **Runs** tab for logs if anything fails.

To re-run only the dbt layer without re-loading raw data, select the dbt assets and materialise those alone.

---

## Exploring the data

Each project includes a `notebooks/` folder with Marimo notebooks that connect directly to your DuckDB database and let you query and visualise results in the browser — no SQL terminal needed.

```bash
marimo edit notebooks/explore.py
```

Open [http://localhost:2718](http://localhost:2718). To share a read-only view, use `marimo run notebooks/explore.py` instead.

The `datavloot new` scaffold includes a template notebook at `notebooks/explore.py` with placeholder cells to fill in for your own schema. See [`explore_noaa.py`](https://github.com/datavloot/datavloot-toolkit/blob/main/datavloot_platform/templates/demo/notebooks/explore_noaa.py) in the demo for a fully worked example.

You can also launch notebooks directly from the Crows Nest — the Notebooks panel lists all `.py` files in the `notebooks/` folder and lets you start them with a single click. The panel shows only a Marimo it started itself: one you start with `marimo edit` stays in its own browser tab, and while it holds port 2718 the panel cannot launch another; the panel's error names the command that stops it.

A notebook that others should read rather than edit becomes an app: move it to an `apps/` folder in the project. The Crows Nest's **Dashboards** panel serves everything in `apps/` with `marimo run`: the output, without the code. Paths in the app such as `css_file` resolve from `apps/`.

---

## The Crows Nest

The **Crows Nest** is a built-in unified dashboard that replaces the need to manage multiple browser tabs. Instead of switching between Dagster on :3000 and Marimo on :2718, you get one URL with everything.

`datavloot start` launches both Dagster and the Crows Nest together. To start the Crows Nest on its own (when Dagster is already running):

```bash
datavloot launch
```

Opens [http://localhost:8080](http://localhost:8080) with six panels:

| Panel | What it shows |
|---|---|
| **Pipelines** | Recent Dagster run history with status, job name, and duration. A run started with **Materialize** in Dagster has no job of its own and shows the assets it built (`Materialize · 25 assets`). Hover over a failed run's label for the part of its error that says what went wrong. **Materialize all** starts a run of every asset. Auto-refreshes every 15 seconds. |
| **Dashboards** | The project's apps: the Marimo notebooks in `apps/`, served with `marimo run` (output only, no code) by one server on :2719 that the Crows Nest starts on first use and stops when it stops. Another server on :2719, such as another project's, is left running; the panel's error names the command that stops it. The first app opens straight away; with several, buttons switch between them. |
| **Data quality** | Elementary test results grouped by model with pass/fail/warn counts and a health bar. Click a model name to drill down into per-test results; click a test name to jump to a filtered view of all individual runs for that test. Includes an anomaly detection tab. |
| **SQL editor** | SQL editor connected directly to your lake. On a laptop it can also change it: delete rows, drop a table, and so on (see [Changing data in the SQL editor](#changing-data-in-the-sql-editor)); on a shared host it is read-only. Autocomplete suggests schemas, tables and columns, also after an alias (`FROM vessels v WHERE v.`). Ctrl+Enter to run. Results paginate in the browser; no data leaves your machine. |
| **Catalog** | Every dbt model with its full column list (sourced from the actual warehouse schema, enriched with descriptions from dbt documentation where available), a last-run timestamp from dbt's model run history, and test results grouped by check. Falls back to `information_schema` for models not tracked by Elementary. |
| **Notebooks** | Lists all Marimo notebooks in your project's `notebooks/` folder. Click **Launch** to start a notebook and embed it directly in the panel. A **Close notebook** button in the panel header stops the Marimo process and returns you to the list. If Marimo stops for any other reason, the panel detects it within a few seconds and returns automatically. |

### Your own name, logo and colours

A project can give the Crows Nest its own look with a `branding/` folder; without one it looks as above.

```
branding/
  branding.yml   # name and colours, every key optional
  logo.svg       # or logo.png; replaces the datavloot mark in the sidebar
```

```yaml
name: KetenConnect
colors:
  accent: "#0070c0"      # buttons, links
  text: "#002060"        # text; the muted shades are derived from it
  background: "#f2f2f2"  # page background; hover and borders are derived from it
  sidebar: "#002060"     # the sidebar; without it, the accent darkened
  highlight: "#00b050"   # the active tab's marker, focus rings, notes
```

You name a few colours; the Crows Nest derives every shade it uses from them. With a logo, the sidebar shows the logo without the name next to it, since a logo usually carries the name already; the name still titles the browser tab. Restart is not needed: the next page load picks up a change.

The **health banner** at the top of every panel shows how things stand now. Pipelines counts jobs by their latest run, so a job that failed and then succeeded counts as ok; hover over "failing" for the errors. Quality counts each test by its latest result. The service dots are green when Dagster, DuckDB and Marimo are reachable and red when not, except Marimo, which is amber until it starts with the first notebook. Panels that depend on a service that is temporarily unavailable (for example, Dagster not running) return a descriptive message rather than an error.

The Crows Nest finds your project's lake (`lake/catalog.sqlite`) when started from the project directory, and infers the Elementary schema from your target schema name. It reads the lake while pipelines write to it. No additional configuration is needed for standard projects. You can override any setting with environment variables:

| Variable | Default |
|---|---|
| `CROWSNEST_DUCKLAKE_CATALOG_PATH` | The project's `lake/catalog.sqlite` |
| `CROWSNEST_DUCKLAKE_DATA_PATH` | `data/` next to the catalog |
| `CROWSNEST_DUCKLAKE_ALIAS` | The dbt project name |
| `CROWSNEST_DUCKDB_PATH` | Read from `profiles.yml`; for a project still on a single `.duckdb` file, and takes precedence over a lake found in the project |
| `CROWSNEST_DAGSTER_URL` | `http://localhost:3000/graphql` |
| `CROWSNEST_MARIMO_URL` | `http://127.0.0.1:2718` |
| `CROWSNEST_APPS_URL` | `http://127.0.0.1:2719` |
| `CROWSNEST_ELEMENTARY_SCHEMA` | Inferred from the `prod` target in `profiles.yml` as `<target_schema>_elementary` (e.g. `noaa_elementary`) |
| `CROWSNEST_AUTH_TOKEN` | Unset — no authentication |
| `CROWSNEST_SQL_WRITE` | Unset — the SQL editor can write when the Crows Nest listens on localhost only, and is read-only otherwise. `1` or `0` decides either way |

Options: `datavloot launch --port 8080 --host 127.0.0.1 --no-open`

### Changing data in the SQL editor

On a laptop the SQL editor works as if you were on the lake with DuckDB yourself:
`DELETE`, `UPDATE`, `INSERT`, `CREATE`, `DROP`, `ALTER` and `MERGE` run, one
statement at a time. Whoever can reach a Crows Nest on localhost can open the lake
with DuckDB anyway. Listening on any other address (`--host 0.0.0.0`, the
Falcon), the editor is read-only unless `CROWSNEST_SQL_WRITE=1` is set. A badge
next to the editor's title says which it is, and `datavloot launch` prints it.

- **The database, not the machine.** Write access stays inside the lake: `COPY`,
  reading files outside it, `ATTACH`, `INSTALL` and `SET` are refused as in the
  read-only editor.
- **A confirmation for whole tables.** `DROP`, `TRUNCATE`, and a `DELETE` or
  `UPDATE` without `WHERE` run only after you confirm.
- **One writer at a time.** The lake takes one writer, and when two commit at
  once the second fails, which may be a pipeline run. So a change is refused while
  a Dagster run is in progress, and a collision with any other writer comes back as
  "the lake is being written to, try again" with nothing changed.
- **Undo with a snapshot.** Every change leaves a snapshot of the lake, recorded
  with the Crows Nest as author and the statement as message
  (`FROM <lake>.snapshots()`). The editor shows the snapshot from before the
  change, say 41, and the lake as it was then can be read back:

  ```sql
  -- rows deleted by mistake
  INSERT INTO noaa_source.stg_noaa__guam_2025
  SELECT * FROM noaa_source.stg_noaa__guam_2025 AT (VERSION => 41) WHERE mmsi = 123456789;

  -- a table dropped by mistake
  CREATE TABLE noaa_source.stg_noaa__guam_2025 AS
  SELECT * FROM noaa_source.stg_noaa__guam_2025 AT (VERSION => 41);
  ```

  Lake maintenance keeps snapshots for about a week. A project still on a single
  `.duckdb` file keeps none, so there a change cannot be undone.
- **dbt and dlt.** dbt rebuilds the business layer on every run, so a change there
  lasts until the next one. A change in the source layer stays, but dlt keeps its
  own record of what it loaded: an incremental source does not load deleted rows,
  or a dropped table, again by itself. To load a source from scratch, reset its
  dlt state (`dlt pipeline <name> drop`, see the
  [dlt docs](https://dlthub.com/docs/reference/command-line-interface)).

### Putting the Crows Nest on a shared host

On a laptop it binds to localhost and needs no password. Anywhere else, set
`CROWSNEST_AUTH_TOKEN` and every request must present it:

```bash
CROWSNEST_AUTH_TOKEN=$(python -c "import secrets; print(secrets.token_urlsafe(32))")   datavloot launch --host 0.0.0.0
```

A browser is prompted for credentials on first visit — enter any username and the
token as the password. Scripts can send `Authorization: Bearer <token>` instead.
`/api/health` stays open so an uptime check does not need the token.

The SQL editor is read-only there, unless `CROWSNEST_SQL_WRITE=1` gives everyone
who can sign in write access to the lake. It enforces what may run by parsing each
statement rather than by inspecting keywords, and the DuckDB connection is
sandboxed, read-only or not, so a query cannot reach files outside the lake's data
directory, attach another database, or load an extension.
Nothing here gives you TLS, so terminate HTTPS at a reverse proxy if the host is
reachable from anywhere untrusted.

---

## Scheduling and automation

By default, assets are materialised manually in the Dagster UI. To run pipelines automatically, Dagster provides three mechanisms:

| Approach | Use when |
|---|---|
| [Schedules](https://docs.dagster.io/guides/automate/schedules) | You want assets to run on a fixed cron interval (e.g. nightly at 02:00) |
| [Sensors](https://docs.dagster.io/guides/automate/sensors) | You want to react to an event — a new file, an API update, a threshold breach |
| [Declarative automation](https://docs.dagster.io/guides/automate/declarative-automation) | You want Dagster to decide when to materialise based on asset freshness and upstream changes |

Schedules and sensors run only while Dagster runs. On a laptop, `datavloot autostart on` starts it at every login (see [Starting at login](#starting-at-login)); runs still happen only while the machine is on and you are logged in.

Schedules and sensors are defined in `definitions.py` alongside the existing assets. See the [Dagster automation docs](https://docs.dagster.io/guides/automate) for full examples, and `dbt_packages/optimist/data-instructions.md` for guidance on choosing the right approach for your sources.

---

## Scaling up

The same tools, on a bigger vessel as your team grows. The pipelines, dbt models, and orchestration logic you build on the Optimist are designed to carry forward unchanged.

| Vessel | For | Runs on | Lake catalog | Status |
|---|---|---|---|---|
| **Optimist** | One person | A laptop | DuckLake with a SQLite catalog | Ready |
| **Falcon** | A small team | Docker Compose on one VM, behind Traefik over HTTPS | The same kind: DuckLake with a SQLite catalog | First version: [deploy/compose](https://github.com/datavloot/datavloot-toolkit/blob/main/deploy/compose/README.md), and a VM on Thalassa Cloud with [deploy/thalassa](https://github.com/datavloot/datavloot-toolkit/blob/main/deploy/thalassa/README.md) |
| **Catamaran** | A larger team | Docker Compose, with the state off the VM and per-user sign-in | Postgres and S3 | Planned |
| **Yacht** | Enterprise | Kubernetes | Quack and S3 | Planned |

From the Optimist to the Falcon the project stays the same: the same code, models and kind of lake, only on a VM. The Falcon starts with an empty lake of its own, and Dagster builds production there from the sources; the laptop's lake, with its development schemas, stays on the laptop. From the Falcon to the Catamaran the lake's catalog moves from SQLite to Postgres, which is a data migration.

The Optimist's individual components are also portable on their own:

| Step | What changes | What stays the same |
|---|---|---|
| **Cloud storage** | Point DuckLake at S3, GCS, or Azure Blob instead of a local file | All dbt models and Dagster assets |
| **Cloud warehouse** | Swap `dbt-duckdb` for `dbt-snowflake`, `dbt-bigquery`, etc. | All models and macros (mostly portable SQL) |

See [datavloot.nl/over](https://datavloot.nl/over) for the full vessel roadmap.

---

## Using the dbt package in an existing project

The macros are the `optimist` dbt package, which has its own repository: [dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist). If you already have a dbt project and only want the standardized macros, install it via `dbt deps`:

```yaml
# packages.yml
packages:
  - tarball: "https://codeload.github.com/datavloot/dbt-datavloot-optimist/tar.gz/refs/tags/0.1.1"   # a release tag of dbt-datavloot-optimist
    name: optimist
```

Then install:

```bash
dbt deps
```

---

## Documentation

- [Getting started](https://github.com/datavloot/datavloot-toolkit/blob/main/docs/getting-started.md)
- [Ingestion layer — loading data with dlt](https://github.com/datavloot/datavloot-toolkit/blob/main/docs/ingestion.md)
- [Source layer — auto-staging and audit columns](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/source-layer.md) (in the dbt package)
- [Business layer — dimensions, facts, and surrogate keys](https://github.com/datavloot/dbt-datavloot-optimist/blob/main/docs/business-layer.md) (in the dbt package)
- [Architecture — Optimist single-node setup (proposed)](https://github.com/datavloot/datavloot-toolkit/blob/main/docs/architecture.md)

---

## Features

The macros of the [`optimist` dbt package](https://github.com/datavloot/dbt-datavloot-optimist):

| Feature | Description |
|---|---|
| `stage_source` | Auto-generate a staging model; introspects source schema, appends audit columns, supports deduplication and incremental loading |
| `add_audit_columns` | Emit `_loaded_at`, `_source_name`, `_source_table` in any SELECT |
| `build_dimension` | Config-driven dimension with surrogate key, optional dedup, and three source options |
| `build_fact` | Config-driven fact with automatic dimension LEFT JOINs and surrogate key |
| `build_dataset` | Flat, documented one-big-table output from a source you have already prepared; no surrogate key, no dimension joins |
| `generate_surrogate_key` | MD5 surrogate key over a list of columns, available standalone |
| `generate_date_key` | Integer `YYYYMMDD` key that matches `dim_date`, for any date or timestamp column |
| `build_dim_date` | Calendar date dimension, called from the project's own `dim_date.sql` (configurable range, default 2015–2035) |
| `build_dim_time` | Time-of-day dimension at minute granularity (1 440 rows), called from `dim_time.sql` |

---

## Stack versions

Versions below are the ones locked in `uv.lock`, which the Falcon image installs. `pip install datavloot[optimist]` picks the newest release within the bounds in `pyproject.toml`; newer patch releases generally work, minor/major upgrades may require changes. DuckDB is held below 2.0 until the lake has been tried on it.

| Package | Locked version |
|---|---|
| Python | ≥3.10, <3.14 |
| dagster | 1.13.7 |
| dagster-dbt | 0.29.7 |
| dbt-core | 1.11.11 |
| dbt-duckdb | 1.10.1 |
| dlt | 1.30.0 |
| duckdb | 1.5.3 |
| elementary-data | 0.25.1 |
| marimo | 0.24.2 |
