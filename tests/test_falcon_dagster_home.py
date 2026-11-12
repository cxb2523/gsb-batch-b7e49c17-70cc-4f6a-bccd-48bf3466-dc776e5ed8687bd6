"""
The Falcon's `prepare` creates Dagster's storage before the services start (#45).

After `prepare`, dagster-webserver, dagster-daemon and the code server open the
instance at the same moment. On an empty DAGSTER_HOME each one creates the SQLite
storage and stamps its schema version, so a storage can end up with two version
rows; the next process to open it then fails with "alembic_version has more than
one head". Reproduced: 4 of 10 trials with three processes. `dagster instance
migrate` in `prepare.sh` creates the storage first, in one process.

Marked `slow`: it starts several Python processes that each import Dagster.
"""

import glob
import multiprocessing
import os
import pathlib
import sqlite3
import subprocess
import sys

import pytest

pytest.importorskip("dagster", reason="dagster is not installed")

pytestmark = pytest.mark.slow

PREPARE = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "compose" / "prepare.sh"

DAGSTER_YAML = """\
concurrency:
  pools:
    default_limit: 1
    granularity: op
"""


def test_prepare_creates_the_storage_before_the_services_start():
    lines = [line.strip() for line in PREPARE.read_text(encoding="utf-8").splitlines()]
    assert "dagster instance migrate" in lines
    # After dagster.yaml is in DAGSTER_HOME, or the storage settings in it are missed.
    copy = next(i for i, line in enumerate(lines) if line.startswith("cp dagster.yaml"))
    assert lines.index("dagster instance migrate") > copy


def _open_instance(home: str, barrier) -> None:
    os.environ["DAGSTER_HOME"] = home
    from dagster import DagsterInstance

    barrier.wait()
    with DagsterInstance.get() as instance:
        instance.get_runs(limit=1)


def _version_rows(home: pathlib.Path) -> dict[str, list]:
    rows = {}
    for db in glob.glob(str(home / "**" / "*.db"), recursive=True):
        con = sqlite3.connect(db)
        try:
            rows[db] = con.execute("select version_num from alembic_version").fetchall()
        except sqlite3.OperationalError:
            pass  # a SQLite file without alembic versioning
        finally:
            con.close()
    return rows


@pytest.mark.parametrize("trial", range(3))
def test_services_starting_together_after_migrate_find_one_schema_version(tmp_path, trial):
    home = tmp_path / "dagster_home"
    home.mkdir()
    (home / "dagster.yaml").write_text(DAGSTER_YAML, encoding="utf-8")

    # What prepare.sh does, in the same environment the services get.
    subprocess.run(
        [sys.executable, "-m", "dagster", "instance", "migrate"],
        env={**os.environ, "DAGSTER_HOME": str(home)},
        check=True,
        capture_output=True,
    )

    # Then the webserver, the daemon and the code server, all at once.
    context = multiprocessing.get_context("spawn")
    barrier = context.Barrier(3)
    processes = [context.Process(target=_open_instance, args=(str(home), barrier)) for _ in range(3)]
    for p in processes:
        p.start()
    for p in processes:
        p.join(timeout=120)
    assert all(p.exitcode == 0 for p in processes), [p.exitcode for p in processes]

    rows = _version_rows(home)
    assert rows, "no Dagster storage was created"
    assert all(len(r) == 1 for r in rows.values()), rows
