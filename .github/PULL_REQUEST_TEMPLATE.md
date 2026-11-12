<!-- See CONTRIBUTING.md. Delete lines that do not apply; keep the rest short. -->

## What and why

<!-- One paragraph. What changes, and the reason. Link the issue if there is one: Closes #NN -->

## Which part

<!-- Tick what you touched. This decides which release train the change rides. -->

- [ ] `datavloot` Python package (CLI, Crows Nest, Dagster layer, templates)
- [ ] The pinned dbt package release (`DBT_PACKAGE_VERSION`)
- [ ] Falcon deployment (`deploy/`)
- [ ] Docs only

## Tests run locally

<!-- Tick what you ran. The tiers and their commands are in CONTRIBUTING.md. -->

- [ ] Fast tier (`-m "not slow and not package"`)
- [ ] Crows Nest tests, with fastapi and duckdb installed (required for changes under `crowsnest/`)
- [ ] Smoke tier (`-m slow`; required for changes to the templates or to `DBT_PACKAGE_VERSION`)
- [ ] Packaging tier (`tests/test_packaging.py`; required for changes to `pyproject.toml` or what ships)

## Checklist

- [ ] No version bump in `pyproject.toml`
- [ ] No conventions copied into the templates' `data-instructions.md` (they live in the dbt package)
- [ ] Scaffold and demo templates are kept in step
- [ ] Frontend source change comes with a rebuilt and committed `crowsnest/static/`
- [ ] Widened dependency bound is explained above
- [ ] Issues this closes are referenced (`Closes #...`)

## Breaking change?

<!-- If this changes behaviour for an existing consuming project (scaffold structure, CLI flag, the pinned dbt package release), say what breaks and what a consumer has to change. Otherwise delete this section. -->
