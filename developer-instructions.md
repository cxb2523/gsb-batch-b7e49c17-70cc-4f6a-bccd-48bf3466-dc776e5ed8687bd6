# datavloot-toolkit

This repo ships the `datavloot` Python package: the CLI, the lake storage, the Crows Nest and the
project templates, plus the Falcon's deployment. Designed to be used by AI agents (crew)
following instructions from a human user (captain).

The `optimist` dbt package (the macros and the modelling conventions) has its own repository,
[dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist). New projects
install it with `dbt deps`, pinned to `DBT_PACKAGE_VERSION` in `datavloot_platform/cli.py`.

---

## Repo layout

```
datavloot_platform/                         # the datavloot Python package
├── cli.py                                 # datavloot new | demo | start | launch; DBT_PACKAGE_VERSION
├── storage.py                             # how dbt, dlt, assets and notebooks attach the lake
├── crowsnest/                             # the Crows Nest dashboard (FastAPI + a prebuilt frontend)
└── templates/
    ├── scaffold/                          # new-project template (served via `datavloot new`)
    └── demo/                              # NOAA worked example (served via `datavloot demo`)
deploy/
├── compose/                               # the Falcon: the platform on Docker Compose
└── thalassa/                              # OpenTofu module for a Falcon VM on Thalassa Cloud
docs/                                      # reference documentation for the platform
tests/
```

`dim_date`/`dim_time` ship as macros in the dbt package (`build_dim_date`/`build_dim_time`), not
as models. Every consuming project owns its own `dim_date.sql`/`dim_time.sql` calling those
macros (already scaffolded in both templates), which is what makes the date range and time grain
configurable per project.

---

## If you are building models in a consuming project

You are in the wrong repo. Run `datavloot new <path>` to scaffold a new consuming project, then follow the `data-instructions.md` inside it.

---

## If you are modifying the toolkit

The captain will tell you which of these applies:

- **Adding or changing a macro, or a modelling convention** — that is the dbt package's
  repository, not this one. Once it is released there, move new projects to it by bumping
  `DBT_PACKAGE_VERSION` in `datavloot_platform/cli.py` and running the smoke tier
  (`pytest -m slow`), which installs that release.
- **Editing project templates** — `datavloot_platform/templates/scaffold/` and `demo/`, kept in
  step. That includes the blank `_sources.yml`/`_schema.yml` in `models/source/`, and the
  dimension/fact/dataset config templates in `models/business/`: business-layer models are
  entirely project-owned.
- **Editing `dim_date`/`dim_time`** — the macros are in the dbt package. A change there needs the
  same change in both project templates' `dim_date.sql`/`dim_time.sql`/`_dim_configs.yml` only if
  the column shape changes.
- **Updating the agent guide** — workflow and conventions live in the dbt package's
  `data-instructions.md`, the single source of truth for all consuming projects. The
  `data-instructions.md` inside each project template contains only project identity and a
  reference to the package doc — do not duplicate conventions there.

---

## Conventions

- Macros are namespaced as `optimist.<macro_name>` in consuming projects
- All business-layer config lives in YAML `meta` blocks — no logic in SQL files
- Source-layer models follow the double-underscore pattern: `stg_<source>__<table>`
- Column documentation (dbt docs) lives at the model level; macro selection config lives inside `meta`
- Modelling conventions (Kimball, materialization, CTE structure) live in the dbt package's `data-instructions.md` — consuming projects reference `dbt_packages/optimist/data-instructions.md`
