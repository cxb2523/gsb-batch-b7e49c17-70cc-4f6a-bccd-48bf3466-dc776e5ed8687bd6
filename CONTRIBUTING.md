# Contributing to datavloot-toolkit

Thanks for taking the time. This document covers how to set up a working copy, what to run before opening a pull request, and what maintainers look for when reviewing. Internals of the codebase are documented elsewhere and linked below rather than repeated here.

## What this repository ships

The `datavloot` Python package on PyPI: the CLI (`datavloot new`, `demo`, `launch`, `start`), the Crows Nest dashboard, the Dagster platform layer and the project templates, all under `datavloot_platform/`, plus the Falcon's deployment under `deploy/`.

The `optimist` dbt package (the macros and the modelling conventions) has its own repository, [dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist). Issues and pull requests about macros or conventions go there. This repo only pins which release of it new projects get (`DBT_PACKAGE_VERSION` in `datavloot_platform/cli.py`).

## License

The project is licensed under Apache-2.0. By submitting a contribution you agree that it is licensed under the same terms, with no additional restrictions. There is no CLA and no sign-off requirement.

## Before you start

Bug reports and feature requests go through GitHub Issues. A report is most useful when it includes the `datavloot` version (`pip show datavloot`), the Python version, the OS, and the exact command and output.

For a small fix (a typo, a broken link, an obvious bug with a clear fix) open a pull request directly. For anything larger, open an issue first and describe what you intend to change and why. This matters more than usual here: the toolkit has firm opinions on structure, and a change that is technically fine but crosses one of those lines will be sent back. Reading `toolkit-developer-standards.md` first saves everyone a round trip.

Changes that need an issue before code:

- changes to the scaffolded project structure
- new CLI commands or new dependencies in `pyproject.toml`

## Setting up a working copy

Prerequisites are the same as for using the toolkit (see the README): Python 3.10 to 3.13 and git. No C compiler is needed, except on Intel Macs (see the note in the README).

The recommended route is [uv](https://docs.astral.sh/uv/). Clone your fork and let uv create the virtual environment and install the package in editable mode, with the full stack and the test dependencies, at the versions in `uv.lock`:

```bash
git clone https://github.com/<you>/datavloot-toolkit.git
cd datavloot-toolkit
uv sync --all-extras
source .venv/bin/activate        # Windows: .venv\Scripts\activate
```

The `[optimist]` extra pulls in Dagster, dbt, dlt, DuckDB, Elementary, FastAPI and the rest, close to 200 packages; uv installs them in a fraction of the time pip takes. Editable mode means the `datavloot` command on your PATH runs the code in your checkout, so changes to the CLI or the templates are live without reinstalling.

Without uv, plain pip works too. It installs the newest versions the bounds in `pyproject.toml` allow rather than the locked ones, takes several minutes, and leaves you without `uv build` for the packaging tier (`pip install uv` inside the venv adds it):

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[optimist,dev]"
```

If you only want to run the fast tests and touch nothing else, the `[dev]` extra alone is enough (`uv sync --extra dev`, or `pip install -e ".[dev]"`); everything below assumes the full install.

### Dependencies and `uv.lock`

`uv.lock` pins the exact versions of the development environment, so everyone working on the toolkit runs the same ones and an upgrade happens on purpose rather than on the day someone reinstalls. It only affects this repository: users install from the published wheel, which resolves from the bounds in `pyproject.toml` and never sees the lock.

- **Changed a dependency in `pyproject.toml`?** Run `uv lock` and commit `uv.lock` with it. The `lint` job runs `uv lock --check` and fails a pull request whose lock does not match.
- **Upgrading.** `uv sync` keeps you on the locked versions. To move to newer releases within the bounds, run `uv lock --upgrade` in a pull request of its own, for example before a release, so the diff shows what moves and CI tests it.
- **What users get is tested separately.** The `smoke` job installs with pip, not from the lock, so a new release of a dependency that breaks users fails CI even while the lock still holds the older version.

## Running the tests

The suite is split into tiers by cost, and CI runs each as a separate job. Run the tier that matches what you changed; run all of them before opening a pull request. With the venv active:

Fast checks, no external tools (template placeholders, YAML validity, schema declarations):

```bash
pytest -m "not slow and not package"
```

Crows Nest auth and query-API security tests. These `importorskip` on fastapi and duckdb, so in an environment without the `[optimist]` extra they are silently skipped and report as passed. If you touch anything under `datavloot_platform/crowsnest/`, run them explicitly and check the output says `passed`, not `skipped`:

```bash
pytest tests/test_crowsnest_security.py tests/test_crowsnest_auth.py
```

Smoke test: scaffolds a fresh project with `datavloot new`, runs `dbt deps`, `dbt parse` and a build, checks that a real warehouse file appears, and then has Dagster materialize every asset, as the first run from the UI would. Needs git and network access for the hub packages; the Dagster step is skipped when the `[optimist]` extra is not installed. The dbt package is installed from GitHub at the release new projects pin (`DBT_PACKAGE_VERSION`), so this tests what a user gets. Run this for any change to the templates or to that pin:

```bash
pytest -m slow
```

Packaging test: builds a wheel and sdist and asserts that build inputs (the frontend source, dbt `target/` directories, `.uv-cache`, `.duckdb` files) are excluded and the wheel stays small. Needs uv, for `uv build` (see above). Run this if you touch `pyproject.toml`, add files under `datavloot_platform/`, or change anything about what ships:

```bash
pytest tests/test_packaging.py
```

To run everything at once, `pytest` with no arguments.

CI runs the same tests. The fast, Crows Nest and packaging jobs install dependencies per job with `uv run --with ...` instead of a venv, so they also catch a test that only passes because something unrelated happened to be installed locally. The smoke job installs the `[optimist]` extra with pip, the way a user does. On a pull request it runs on Linux only, to keep the wait short; on `main` after a merge it runs on Linux, Windows and macOS. For a change that could break on Windows or macOS (paths, installs, storage), run the full matrix on the branch first: Actions > CI > Run workflow. A separate `wheels` job checks that every dependency of the extra installs from a wheel on each platform, so a release that suddenly needs a compiler on users' machines fails CI instead of their install. A green local run on a full install is otherwise a reliable predictor of a green pipeline.

## Working on the Crows Nest frontend

The frontend source is a Next.js app in `datavloot_platform/crowsnest/frontend/`. What the server actually serves is the committed static export in `datavloot_platform/crowsnest/static/`. The source directory is excluded from the wheel; the static directory ships.

That means a frontend change is not done until the export has been rebuilt and committed:

```bash
cd datavloot_platform/crowsnest/frontend
npm install
npm run build
rm -rf ../static/* && cp -r out/* ../static/
```

Commit the regenerated `static/` together with the source change, in the same commit. The server prints a warning at startup when `static/` is older than the source, so if you see it, you skipped this step. A pull request that changes frontend source without an updated `static/` will be sent back, and one that changes `static/` without a corresponding source change will be rejected.

## Where things live and what to update together

Read `developer-instructions.md` for the repo layout and `toolkit-developer-standards.md` for the structural rules and the checklists. The short version of what reviewers check:

- Modelling or workflow conventions are changed in one place only: `data-instructions.md` in the dbt package's repository. The `data-instructions.md` files inside the two templates reference it (`dbt_packages/optimist/data-instructions.md`) and must not grow copies of it.
- The scaffold template (`datavloot_platform/templates/scaffold/`) and the demo (`datavloot_platform/templates/demo/`) are kept in step. A change to the scaffold's structure almost always needs the same change in the demo.
- `datavloot_platform/` at the root is a template for consuming projects. Example-specific assets (the NOAA ingestion, for instance) belong inside the example's own directory under `templates/`, never at the root.
- Dependency bounds in `pyproject.toml` follow the policy written in the comments there: cap 1.x packages below the next major, 0.x packages below the next minor, and keep the dagster core and companion series in lockstep. Do not widen a bound without saying why in the pull request.

## Branches, commits and pull requests

`main` is protected. All changes, including maintainers' own, go through a pull request from a branch. Work on a fork if you are not a maintainer.

Branch off `main` and keep the branch to one change. If `main` moves under you, rebase rather than merge it into your branch.

CI runs on pull requests, not on every branch push. To get it on a branch before it is ready for review, open the pull request as a draft.

Commit messages follow the existing history: a short imperative subject line that says what the change does and, where the "what" is not self-explanatory, why. Look at `git log --oneline` for the register. There is no prefix convention (no `feat:`, `fix:`) and none is wanted. If a commit needs explanation beyond the subject, put it in the body, and put the reasoning that would otherwise get lost into a code comment next to the thing it explains; this codebase leans on comments to record why a bound, an exclusion or a workaround exists.

A pull request should state what changed, why, and which test tiers you ran. Link the issue if there is one. Keep it reviewable: a pull request that reworks one thing gets merged, one that reworks four things gets a request to split it.

Things that will get a pull request bounced:

- a version bump in `pyproject.toml`; versions are bumped by maintainers as part of a release, not in feature pull requests
- committed `.duckdb` files, `dist/`, `target/`, `dbt_packages/`, `.env`, or anything else `.gitignore` already lists
- edits to `uv.lock` unrelated to a dependency you changed
- a new tag or branch named `X.Y.x`, or a bare `X.Y.Z` tag; projects created before the dbt package moved out still install it from the `0.1.x` branch and bare tags of this repository, and a new ref with such a name can silently change what they get

## Releases

Releases are cut by maintainers. The full procedure for both packages, including the moving-branch scheme for the dbt package and the tag naming that keeps the two series apart, is in `docs/releasing.md`. Contributors do not need to do anything for a release beyond getting their change merged.

## Documentation and housekeeping

Planned work, deferred items and known rough edges are tracked as [GitHub issues](https://github.com/datavloot/datavloot-toolkit/issues). If your change fixes one, write `Closes #<number>` in the pull request. If you find something worth doing but out of scope for your change, open an issue rather than leaving a TODO in code.

## Questions

Open an issue. For anything you would rather not put in public, the contact details are on [datavloot.nl](https://datavloot.nl).
