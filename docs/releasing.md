# Releasing

One thing ships from this repo: the **`datavloot` Python package**, installed via PyPI
(`pip install`).

The **`optimist` dbt package** has its own repository,
[dbt-datavloot-optimist](https://github.com/datavloot/dbt-datavloot-optimist), with its own versions and releases. This repo only
decides which of its releases new projects get:

- `DBT_PACKAGE_VERSION` in [`datavloot_platform/cli.py`](../datavloot_platform/cli.py) is the
  tag that `datavloot new` and `datavloot demo` write into a new project's `packages.yml`, as
  the release archive of that tag (`tarball:`), so `dbt deps` does not need git.
- To move new projects to a new dbt package release, bump the constant in a pull request. The
  smoke test (`tests/test_scaffold_smoke.py`) installs the package from that tag's archive on
  GitHub, so CI checks the toolkit against exactly what new projects will get. New projects pick
  it up with the next datavloot release.

Until 2026-10 the dbt package lived in this repository under `dbt/optimist/`, released with bare
`X.Y.Z` tags and a moving `X.Y.x` branch. Those tags and the `0.1.x` branch stay, because
projects created before then install the package from them (`subdirectory: "dbt/optimist"`); do
not move or delete them.

---

## Releasing the datavloot PyPI package

How the `datavloot` Python package (the CLI + Crows Nest + everything under
`datavloot_platform/`) gets versioned, built, and published to PyPI.

### Versioning

SemVer, `version` in [`pyproject.toml`](../pyproject.toml) — the single source of truth (not
dynamic; there's no `[tool.hatch.version]` source, so this field must be bumped by hand before
every release). Independent of the dbt package's versions.

- **PATCH** — bug fixes, no consumer-facing change.
- **MINOR** — backwards-compatible additions: new CLI commands/flags, new optional
  dependencies/extras, new Crows Nest features.
- **MAJOR** — breaking changes: removing/renaming a CLI command or flag, renaming or removing
  an extra (e.g. `[optimist]`), dropping support for a Python version, changing the scaffolded
  project structure in a way that breaks existing projects on upgrade.

No moving-branch scheme is needed — PyPI itself is the
distribution point, and `pip`'s own version specifiers (e.g. `datavloot[optimist]<1.0`) already
give consumers a "stay within a major" option without any extra git machinery on our side.

### Git refs

One immutable tag per release: `datavloot-vX.Y.Z`, matching the version just published to PyPI.
Prefixed with `datavloot-`, so the tags never collide with the bare `X.Y.Z` tags the dbt package
used while it lived here.

### Cutting a release

1. Decide the bump type (see Versioning above) based on what changed since the last release.
2. On a feature branch off `main`, update `version` in `pyproject.toml` to match, run `uv lock`
   (the lock records the project's own version), and commit both. Put the release notes in the
   pull request description; step 9 reuses them.
3. Push the branch, open a pull request against `main`, and merge it on GitHub. **Do not merge
   locally**: the tag in step 8 has to point at the merge commit GitHub creates.
   ```bash
   git push -u origin <branch>
   gh pr create --base main --title "Release X.Y.Z"
   ```
4. Wait for CI on that merge commit to pass. Pull requests run the smoke test on Linux only;
   `main` runs it on Linux, Windows and macOS, so this is the first time the release is tested
   on all three.
   ```bash
   gh run list --branch main --limit 1
   ```
5. Build from the merge commit in a **clean** checkout. A working copy can hold untracked files
   that are not ignored (old build output, notes, a `temp/` folder); the sdist would pack them.
   A detached worktree has only what git tracks:
   ```bash
   git fetch origin
   git worktree add --detach ../datavloot-build <merge-commit>
   cd ../datavloot-build
   uv build
   ```
6. Sanity-check the built artifacts before uploading anything:
   ```bash
   uvx twine check dist/*
   ls -lh dist/
   ```
   `twine check` validates metadata and README rendering only — it will pass a 300 MB wheel
   without comment, which is exactly how 0.1.1 shipped 66.9 MB of frontend build inputs. So
   check the size too: **the wheel should be well under 5 MB**. If it is not, something that
   only a nested `.gitignore` was hiding has entered the build; see the `exclude` list in
   [`pyproject.toml`](../pyproject.toml). `tests/test_packaging.py` asserts this in CI on every
   commit.

   Then install the wheel the way a user would, in a fresh environment, and build a new
   project with it. A version on PyPI can never be uploaded again, so this is the last cheap
   moment to find a problem:
   ```bash
   uv venv --seed --python 3.12 /tmp/release-check
   /tmp/release-check/bin/python -m pip install "datavloot[optimist] @ file://$PWD/dist/datavloot-X.Y.Z-py3-none-any.whl"
   cd /tmp && /tmp/release-check/bin/datavloot new shop && cd shop
   DBT_PROFILES_DIR=. /tmp/release-check/bin/dbt deps
   DBT_PROFILES_DIR=. /tmp/release-check/bin/dbt build
   ```
   (On Windows the executables are in `Scripts\` instead of `bin/`.) Call the environment's
   own `datavloot` and `dbt` by path: if its install failed, a `datavloot` elsewhere on `PATH`
   would run instead, and the check would pass without testing the release.
7. Publish, from the build directory:
   ```bash
   uv publish
   ```
   Needs a PyPI API token scoped to the `datavloot` project (pypi.org → Account settings → API
   tokens; it is shown once, so keep it in a password manager). Either set `UV_PUBLISH_TOKEN`,
   or answer the prompt with `__token__` as the username and the token as the password.

   Compare the hashes PyPI reports with the files you built:
   ```bash
   curl -s https://pypi.org/pypi/datavloot/X.Y.Z/json | python -c "import sys, json; [print(f['digests']['sha256'], f['filename']) for f in json.load(sys.stdin)['urls']]"
   sha256sum dist/*
   ```
   `pip install datavloot==X.Y.Z` can still report the version as missing for a few minutes,
   until PyPI's index catches up with its JSON API.
8. Tag the merge commit you built from, and push:
   ```bash
   git tag -a datavloot-vX.Y.Z <merge-commit> -m "datavloot X.Y.Z"
   git push origin datavloot-vX.Y.Z
   ```
   If the push is rejected, a tag protection rule on `datavloot-v*` needs your account in its
   bypass list.
9. Create the GitHub release from the tag, with the release notes from step 2 and the files
   you published:
   ```bash
   gh release create datavloot-vX.Y.Z --verify-tag --title "datavloot X.Y.Z" \
     --notes-file notes.md dist/datavloot-X.Y.Z-py3-none-any.whl dist/datavloot-X.Y.Z.tar.gz \
     install.ps1 install.sh
   ```
   `install.ps1` and `install.sh` go on every release, taken from the tagged commit. The
   website serves them from there: `https://datavloot.nl/install.ps1` and `/install.sh` redirect
   to `https://github.com/datavloot/datavloot-toolkit/releases/latest/download/<file>`, and
   GitHub's `latest` skips pre-releases. So the script people run is always the one released
   together with the newest stable version on PyPI, which is what the script installs by
   default (`datavloot[optimist]@latest`). A script from `main` could use options that the
   latest release does not have yet (0.4.0rc3's `datavloot start --run`, run against 0.3.0).
   Mark a release candidate with `--prerelease`, so `latest` keeps pointing at the last stable
   release.

   The website does not serve a release candidate's script. To test one, name its tag and
   version:
   ```powershell
   $env:DATAVLOOT_VERSION = '0.4.0rc3'; powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/datavloot/datavloot-toolkit/datavloot-v0.4.0rc3/install.ps1 | iex"
   ```
   Without `DATAVLOOT_VERSION` the script installs the latest stable version, which does not
   match an rc's script. Check that no `DATAVLOOT_*` variables from an earlier install are still
   set in the window (`Get-ChildItem Env:DATAVLOOT*`), and copy the whole line, including the
   leading `$`.
10. Check that `curl.exe -sIL https://datavloot.nl/install.ps1` ends on the new release's file (the
    redirects live in `site/_redirects` in the `datavloot-website` repository), and whether the
    release notes on the website need updating. Then remove the build worktree
    (`git worktree remove ../datavloot-build`).

### Current state

As of 2026-11-04:

- PyPI has **0.1.0**, **0.1.1**, **0.1.2**, **0.2.0** and **0.3.0**; `pyproject.toml` says
  `0.3.0`. Git has the tags `datavloot-v0.1.1`, `datavloot-v0.1.2`, `datavloot-v0.2.0` and
  `datavloot-v0.3.0`; `datavloot-v0.1.0` was never tagged. 0.2.0 is the first release with a
  GitHub release.
- New projects get the dbt package at **0.1.1** from dbt-datavloot-optimist
  (`DBT_PACKAGE_VERSION`).
- The bare tag `0.1.2` (2026-09-07) in this repo has no dbt package release behind it; it looks
  like the PyPI release tagged without its prefix. With the `Release` workflow gone it triggers
  nothing any more. Leave it, so a project that happens to pin it keeps working.
