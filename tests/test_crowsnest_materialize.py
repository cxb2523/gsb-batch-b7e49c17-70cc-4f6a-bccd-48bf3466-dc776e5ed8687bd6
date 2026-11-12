"""
The Pipelines panel's "Materialize all" button: POST /api/pipelines/materialize-all.

It makes the call `datavloot start --run` makes (cli.materialize_all, tested in
test_install_scripts.py); these tests cover what the route adds around it.
"""

import pytest

pytest.importorskip("fastapi", reason="fastapi is not installed")
pytest.importorskip("httpx", reason="httpx is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform import cli  # noqa: E402
from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.routes import query as query_route  # noqa: E402


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    monkeypatch.setenv("CROWSNEST_DAGSTER_URL", "http://dagster.test/graphql")
    cn_config.reset_config()
    from datavloot_platform.crowsnest.server import create_app
    yield TestClient(create_app())
    cn_config.reset_config()


def _no_run():
    async def active_run():
        return None
    return active_run


def test_it_starts_a_run_tagged_as_the_crows_nest(client, monkeypatch):
    calls = []
    monkeypatch.setattr(query_route, "_active_run", _no_run())
    monkeypatch.setattr(
        cli, "materialize_all",
        lambda url, started_by: calls.append((url, started_by)) or (True, "Started a run of 41 assets in noaa."),
    )
    r = client.post("/api/pipelines/materialize-all")
    assert r.status_code == 200, r.text
    assert r.json()["message"].startswith("Started a run")
    assert calls == [("http://dagster.test/graphql", "Crows Nest")]


def test_a_run_in_progress_is_not_started_twice(client, monkeypatch):
    async def active_run():
        return "Materialize · 41 assets"

    monkeypatch.setattr(query_route, "_active_run", active_run)
    monkeypatch.setattr(cli, "materialize_all", lambda *a: pytest.fail("started a second run"))
    r = client.post("/api/pipelines/materialize-all")
    assert r.status_code == 409
    assert "already in progress" in r.json()["detail"]


def test_a_refused_run_comes_back_as_an_error_with_the_reason(client, monkeypatch):
    monkeypatch.setattr(query_route, "_active_run", _no_run())
    monkeypatch.setattr(
        cli, "materialize_all",
        lambda *a: (False, "Could not start the run: boom. Start it in Dagster instead."),
    )
    r = client.post("/api/pipelines/materialize-all")
    assert r.status_code == 502
    assert "boom" in r.json()["detail"]
