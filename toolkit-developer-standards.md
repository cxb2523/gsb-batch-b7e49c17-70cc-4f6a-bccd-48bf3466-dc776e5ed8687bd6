# Toolkit Developer Standards

Decisions about how the toolkit is structured and how it relates to the project templates and example projects.
When working on any of these components, verify against the standards below.

---

## 1. Component roles

| Component | Role |
|---|---|
| [dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist) (own repository) | The `optimist` dbt package: macros and the modelling conventions. New projects pin it through `DBT_PACKAGE_VERSION` in `datavloot_platform/cli.py`. |
| `datavloot_platform/templates/scaffold/` | New-project template, served by `datavloot new`. Mirrors the structure a real project should have. |
| `datavloot_platform/templates/demo/` | NOAA worked example, served by `datavloot demo`. Demonstrates AIS + weather ingestion with Dagster + dlt. |
| `datavloot_platform/` | Dagster platform for the toolkit itself. Contains toolkit assets + commented dlt pattern. |

---

## 2. Architectural separation

`datavloot_platform/` is a **template**. Example project assets (like NOAA ingestion) must not be
added to it — that would imply they are building blocks rather than examples.

Each example project (e.g. `datavloot_platform/templates/demo/`) has its own `<project>_platform/` Dagster layer inside its own
directory. The root `datavloot_platform/` stays clean.

---

## 3. data-instructions.md as single source of truth

Everything a crew agent needs to work in a consuming project lives in the dbt package's `data-instructions.md`:
captain/crew model, pre-departure questions, workflow steps 1–7, modelling conventions, naming
conventions, file map, and when to pause. It ships with the package and becomes available at
`dbt_packages/optimist/data-instructions.md` after `dbt deps`.

**Consuming project data-instructions.md files** (inside `datavloot_platform/templates/scaffold/` and `datavloot_platform/templates/demo/`) contain only:
- Project name and one-line description
- A reference to `dbt_packages/optimist/data-instructions.md`
- A "Project context" section with project-specific details (sources, warehouse, orchestration)

They do **not** duplicate workflow or conventions. Convention updates are made once in the package
and inherited automatically on the next `dbt deps`.

**Root `data-instructions.md`** covers toolkit developer workflow only (macro authoring, template editing).
It is not the right place for project-level or modelling guidance.

---

## 4. Checklist for adding or changing a convention

- [ ] Update `data-instructions.md` in the dbt package's repository, release it, and bump `DBT_PACKAGE_VERSION` here
- [ ] Verify `datavloot_platform/templates/scaffold/data-instructions.md` and `datavloot_platform/templates/demo/data-instructions.md` still correctly reference the package doc (no duplication crept in)
- [ ] If the convention affects macro behaviour, update the package's `docs/` as well

---

## 5. Checklist for adding a new example project

- [ ] Create `datavloot_platform/templates/<project>/` — self-contained, not nested under another template
- [ ] Create `datavloot_platform/templates/<project>/<project>_platform/` for the Dagster layer (assets.py, definitions.py)
- [ ] Create `datavloot_platform/templates/<project>/pyproject.toml` with `[tool.dagster]` pointing to `<project>_platform.definitions`
- [ ] Copy `datavloot_platform/templates/scaffold/data-instructions.md` as the starting `data-instructions.md` and fill in project-specific details
- [ ] Add a CLI subcommand or update `datavloot demo` to point to the new template
- [ ] Add a section to the root `README.md` describing the example

## 6. Core design principle: DRY
- DRY = Don't Repeat Yourself. Never suggest copying code from one place to another and try to keep those in sync. Always let developer decide where the code should live.
