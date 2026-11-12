"""
Shared fixtures for the toolkit's own tests.

These test the *templates and packaging*, not a user's project. The scaffold
fixture goes through the same three calls `cli.cmd_new` makes, so a change to
any one is covered.
"""

import os
import pathlib
import shutil
import subprocess

import pytest

from datavloot_platform import cli

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def repo_root() -> pathlib.Path:
    return REPO_ROOT


def _scaffold(dest: pathlib.Path, name: str) -> pathlib.Path:
    """Create a project exactly as `datavloot new <dest>` does."""
    cli._copy_template(cli.TEMPLATES_DIR / "scaffold", dest)
    cli._substitute(dest, cli._to_identifier(name))
    cli._pin_versions(dest, cli._versions())
    return dest


@pytest.fixture
def scaffold(tmp_path: pathlib.Path) -> pathlib.Path:
    """A freshly scaffolded project named 'probe'. No dbt commands run."""
    return _scaffold(tmp_path / "probe", "probe")


def run_dbt(*args: str, cwd: pathlib.Path) -> subprocess.CompletedProcess:
    """
    Run dbt in `cwd` with that directory as the profiles dir.

    Returns the completed process rather than raising, so a test can assert on
    stdout as well as the exit code.
    """
    # dbt ignores NO_COLOR. Whether it colors depends on the platform and the
    # console, and a colored "[WARNING]" never matches a plain-text search, so a
    # test filtering for warnings found none and passed on every platform but
    # the Windows runner. DBT_USE_COLORS makes the output the same everywhere.
    env = {
        **os.environ,
        "DBT_PROFILES_DIR": str(cwd),
        "NO_COLOR": "1",
        "DBT_USE_COLORS": "false",
    }
    return subprocess.run(
        [shutil.which("dbt") or "dbt", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
    )
