"""
The Crows Nest's Pipelines panel (routes/pipelines.py) names runs as a person
reads them, and the footer shows the version of the package it came with.

A run started with "Materialize" in Dagster has no job of the project: Dagster
files it under its hidden __ASSET_JOB, which told the reader nothing.
"""

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest import server  # noqa: E402
from datavloot_platform.crowsnest.routes import pipelines  # noqa: E402


def _keys(*paths):
    return [{"path": path.split("/")} for path in paths]


@pytest.mark.parametrize(
    "job_name, selection, label",
    [
        ("ketenconnect_verversen", None, "ketenconnect_verversen"),
        ("__ASSET_JOB", None, "Materialize"),
        ("__ASSET_JOB", _keys("business/fct_antwoord"), "Materialize: business/fct_antwoord"),
        ("__ASSET_JOB", _keys("business/dim_vraag", "business/fct_antwoord"),
         "Materialize: business/dim_vraag, business/fct_antwoord"),
        ("__ASSET_JOB", _keys("a/b", "a/c", "a/d"), "Materialize · 3 assets"),
        # Older Dagster numbers the hidden job per partitions definition.
        ("__ASSET_JOB_0", _keys("a/b", "a/c", "a/d"), "Materialize · 3 assets"),
    ],
)
def test_runs_are_named_as_a_person_reads_them(job_name, selection, label):
    assert pipelines._job_label(job_name, selection) == label


@pytest.fixture
def client(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    cn_config.reset_config()
    yield TestClient(server.create_app())
    cn_config.reset_config()


def test_runs_keep_the_dagster_job_name_next_to_the_label(client, monkeypatch):
    async def dagster(query, variables=None):
        return {"data": {"runsOrError": {"__typename": "Runs", "results": [{
            "runId": "r1", "status": "SUCCESS", "jobName": "__ASSET_JOB",
            "assetSelection": _keys("a/b", "a/c", "a/d"), "startTime": 1.0, "endTime": 3.0, "tags": [],
        }]}}}

    monkeypatch.setattr(pipelines, "_dagster_query", dagster)
    run = client.get("/api/pipelines/runs").json()["runs"][0]
    assert run["job"] == "Materialize · 3 assets"
    assert run["job_name"] == "__ASSET_JOB"


def test_the_hidden_asset_job_is_not_listed_as_a_job(client, monkeypatch):
    async def dagster(query, variables=None):
        return {"data": {"repositoriesOrError": {"__typename": "RepositoryConnection", "nodes": [{
            "name": "__repository__",
            "jobs": [
                {"name": "__ASSET_JOB", "description": None, "isJob": True},
                {"name": "ketenconnect_verversen", "description": None, "isJob": True},
            ],
        }]}}}

    monkeypatch.setattr(pipelines, "_dagster_query", dagster)
    names = [job["name"] for job in client.get("/api/pipelines/jobs").json()["jobs"]]
    assert names == ["ketenconnect_verversen"]


def test_the_version_is_the_installed_package(client):
    from importlib.metadata import version

    assert client.get("/api/services").json()["version"] == version("datavloot")
