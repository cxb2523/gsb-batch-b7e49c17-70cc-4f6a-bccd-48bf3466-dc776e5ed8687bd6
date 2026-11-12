"""
The Crows Nest opens before Dagster is ready (`datavloot start`), and says so.

From a shortcut nothing showed for half a minute while Dagster loaded the
project; now the Crows Nest is there within seconds and calls Dagster
"starting" until it answers, or "failed" with the reason.
"""

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest import startup  # noqa: E402
from datavloot_platform.crowsnest.server import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    # Nothing listens here: Dagster does not answer.
    monkeypatch.setenv("CROWSNEST_DAGSTER_URL", "http://127.0.0.1:9/graphql")
    monkeypatch.setenv("CROWSNEST_MARIMO_URL", "http://127.0.0.1:9")
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    cn_config.reset_config()
    yield TestClient(create_app(host="127.0.0.1"))
    startup.set_dagster(None)
    cn_config.reset_config()


def test_without_start_a_silent_dagster_is_offline(client):
    """`datavloot launch` on its own sets nothing: the probe decides, as before."""
    startup.set_dagster(None)
    health = client.get("/api/health").json()
    assert health["services"]["dagster"] == "offline"
    assert "dagster_error" not in health


def test_while_dagster_loads_it_is_starting(client):
    startup.set_dagster("starting")
    assert client.get("/api/health").json()["services"]["dagster"] == "starting"


def test_when_loading_failed_it_says_why(client):
    startup.set_dagster("failed", "Code location 'ketenconnect' failed to load: boom")
    health = client.get("/api/health").json()
    assert health["services"]["dagster"] == "failed"
    assert "boom" in health["dagster_error"]


def test_ready_means_the_probe_decides_again(client):
    """Once ready, a Dagster that stops answering is offline, not still starting."""
    startup.set_dagster("ready")
    assert client.get("/api/health").json()["services"]["dagster"] == "offline"


def test_starting_reports_the_stage_and_the_time_so_far(client):
    """The banner shows the step and a clock; the first start has nothing to compare with."""
    startup.set_dagster("starting")
    start = client.get("/api/health").json()["dagster_start"]
    assert start["stage"] == "server"
    assert start["elapsed"] >= 0
    assert start["expected"] is None

    startup.set_stage("project")
    assert client.get("/api/health").json()["dagster_start"]["stage"] == "project"
    # The watcher never moves it back.
    startup.set_stage("server")
    assert client.get("/api/health").json()["dagster_start"]["stage"] == "project"


def test_the_last_start_sets_what_the_next_expects(client):
    startup.set_dagster("starting", expected=95.0)
    assert client.get("/api/health").json()["dagster_start"]["expected"] == 95.0


def test_no_start_progress_once_ready_or_failed(client):
    startup.set_dagster("starting")
    startup.set_dagster("ready")
    assert "dagster_start" not in client.get("/api/health").json()
    startup.set_dagster("failed", "boom")
    assert "dagster_start" not in client.get("/api/health").json()


def test_a_webserver_that_answers_is_still_starting_until_the_project_loaded(client, monkeypatch):
    """Dagster's webserver answers well before its code location has loaded."""
    import httpx

    class Answers:
        status_code = 200

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *args, **kwargs):
            return Answers()

        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("no Marimo")

    from datavloot_platform.crowsnest import server

    monkeypatch.setattr(server, "async_client", lambda timeout: Client())
    startup.set_dagster("starting")
    assert client.get("/api/health").json()["services"]["dagster"] == "starting"
    startup.set_dagster("ready")
    assert client.get("/api/health").json()["services"]["dagster"] == "ok"


def test_start_times_are_kept_per_project(tmp_path):
    assert startup.last_start_seconds(tmp_path) is None
    startup.record_start_seconds(tmp_path, 83.24)
    assert startup.last_start_seconds(tmp_path) == 83.2
    (tmp_path / ".datavloot" / "dagster-start.json").write_text("not json")
    assert startup.last_start_seconds(tmp_path) is None
