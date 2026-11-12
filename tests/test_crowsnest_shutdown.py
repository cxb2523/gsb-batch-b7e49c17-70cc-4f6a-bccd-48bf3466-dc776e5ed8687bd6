"""
The Crows Nest's Shut down button: POST /api/shutdown.

Started from a shortcut, Datavloot runs without a window to close, so the
Crows Nest offers to stop it. Only on a laptop: on a shared host anyone
signed in could stop the service for everyone.
"""

import pytest

pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.server import create_app  # noqa: E402


class FakeServer:
    """Stands in for the uvicorn.Server cli.cmd_crowsnest runs the app in."""
    should_exit = False


@pytest.fixture(autouse=True)
def project(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    # Never a real Dagster: a running one on :3000 would get its runs cancelled.
    monkeypatch.setenv("CROWSNEST_DAGSTER_URL", "http://127.0.0.1:9/graphql")
    # No Dagster process left over from another test's `datavloot start`.
    from datavloot_platform.crowsnest import startup

    def clean():
        startup.set_dagster_process(None)
        startup.set_dagster(None)
        startup.set_stopping(False)

    clean()
    cn_config.reset_config()
    yield
    clean()
    cn_config.reset_config()


@pytest.fixture
def cancelled(monkeypatch):
    """Records cli.cancel_runs calls instead of making them; Marimo stops are recorded too."""
    from datavloot_platform import cli
    from datavloot_platform.crowsnest.routes import apps, notebooks

    calls = []
    monkeypatch.setattr(cli, "cancel_runs", lambda url, **kw: calls.append(url) or ["r1"])
    monkeypatch.setattr(cli, "free_finished_run_slots", lambda url: calls.append("slots freed") or [])
    monkeypatch.setattr(notebooks, "_stop_server", lambda: calls.append("notebooks stopped"))
    monkeypatch.setattr(apps, "_stop_server", lambda: calls.append("apps stopped"))
    return calls


def _app(host, server=True):
    app = create_app(host=host)
    if server:
        app.state.server = FakeServer()
    return app


def test_on_a_laptop_it_cancels_runs_then_asks_the_server_to_exit(cancelled):
    app = _app("127.0.0.1")
    client = TestClient(app)
    assert client.get("/api/services").json()["can_shutdown"] is True

    r = client.post("/api/shutdown")
    assert r.status_code == 200, r.text
    assert r.json()["cancelled_runs"] == ["r1"]
    # Runs first, their pool slots next, then Marimo, before the server is asked
    # to exit: the exit hooks come only once uvicorn has finished, and that can stall.
    assert cancelled == ["http://127.0.0.1:9/graphql", "slots freed", "notebooks stopped", "apps stopped"]
    assert app.state.server.should_exit is True


def test_shut_down_stops_dagster_itself_and_arms_the_backstop(cancelled, monkeypatch):
    """`datavloot start`'s Dagster, without waiting for the CLI to get control back."""
    from datavloot_platform.crowsnest import server as server_module
    from datavloot_platform.crowsnest import startup

    dagster = object()
    stopped, armed = [], []
    monkeypatch.setattr(server_module, "terminate_tree", stopped.append)
    startup.set_dagster_process(dagster)
    try:
        app = _app("127.0.0.1")
        app.state.after_shutdown = lambda: armed.append(True)
        assert TestClient(app).post("/api/shutdown").status_code == 200
    finally:
        startup.set_dagster_process(None)
    assert stopped == [dagster]
    assert armed == [True]
    assert app.state.server.should_exit is True


def test_a_real_crows_nest_exits_while_a_tab_keeps_a_connection_open(tmp_path):
    """
    End to end: `datavloot launch` in a throwaway project, a client holding a
    keep-alive connection like a browser tab, then Shut down. The process must
    be gone within the grace period plus a margin, not wait for the tab.
    """
    pytest.importorskip("uvicorn")
    duckdb = pytest.importorskip("duckdb")
    httpx = pytest.importorskip("httpx")
    import os
    import socket
    import subprocess
    import sys
    import time

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {
        **os.environ,
        "CROWSNEST_DUCKDB_PATH": str(db),
        "CROWSNEST_DAGSTER_URL": "http://127.0.0.1:9/graphql",
        "CROWSNEST_MARIMO_URL": "http://127.0.0.1:9",
    }
    env.pop("CROWSNEST_AUTH_TOKEN", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "datavloot_platform.cli", "launch", "--port", str(port), "--no-open"],
        cwd=tmp_path, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        tab = httpx.Client()  # its pooled connection stays open, as a tab's does
        for _ in range(60):
            try:
                tab.get(f"{url}/api/services", timeout=2)
                break
            except httpx.HTTPError:
                time.sleep(0.5)
        else:
            pytest.fail("the Crows Nest did not start")

        assert httpx.post(f"{url}/api/shutdown", timeout=30).status_code == 200
        proc.wait(timeout=15)
    finally:
        if proc.poll() is None:
            proc.kill()
            pytest.fail("the Crows Nest was still running 15 seconds after Shut down")


def test_the_server_does_not_wait_for_ever_on_open_connections(monkeypatch):
    """A browser tab holding a connection kept a Shut down from finishing."""
    pytest.importorskip("uvicorn")
    import argparse

    import uvicorn

    from datavloot_platform import cli

    seen = {}

    class Server:
        def __init__(self, config):
            seen["timeout"] = config.timeout_graceful_shutdown

        def run(self):
            pass

    monkeypatch.setattr(uvicorn, "Server", Server)
    cli.cmd_crowsnest(argparse.Namespace(host="127.0.0.1", port=8099, open=False))
    assert seen["timeout"] == cli.SHUTDOWN_GRACE_SECONDS > 0


@pytest.mark.parametrize("host", ["0.0.0.0", None])
def test_on_a_shared_host_it_is_refused(host, cancelled):
    app = _app(host)
    client = TestClient(app)
    assert client.get("/api/services").json()["can_shutdown"] is False

    r = client.post("/api/shutdown")
    assert r.status_code == 403
    assert app.state.server.should_exit is False
    assert cancelled == [], "a refused shutdown cancels nothing"


def test_without_a_server_of_its_own_there_is_nothing_to_stop(cancelled):
    """An app not run by `datavloot start` or `launch` (another ASGI server, a test)."""
    client = TestClient(_app("127.0.0.1", server=False))
    assert client.get("/api/services").json()["can_shutdown"] is False
    assert client.post("/api/shutdown").status_code == 409
    assert cancelled == []


# --------------------------------------------------------------------------
# cli.cancel_runs, against a stand-in for Dagster
# --------------------------------------------------------------------------

@pytest.fixture
def dagster(monkeypatch):
    httpx = pytest.importorskip("httpx")
    import json

    state = {"runs": [], "cancelled": [], "statuses": None}

    def handler(request):
        body = json.loads(request.content)
        if "terminateRun" in body["query"]:
            state["cancelled"].append(body["variables"]["runId"])
            return httpx.Response(200, json={"data": {"terminateRun": {"__typename": "TerminateRunSuccess"}}})
        state["statuses"] = body["variables"]["statuses"]
        return httpx.Response(200, json={"data": {"runsOrError": {"__typename": "Runs", "results": state["runs"]}}})

    transport = httpx.MockTransport(handler)

    def post(url, **kwargs):
        kwargs.pop("timeout", None)
        with httpx.Client(transport=transport) as client:
            return client.post(url, **kwargs)

    monkeypatch.setattr(httpx, "post", post)
    return state


def test_shutdown_cancels_every_active_run(dagster):
    from datavloot_platform import cli

    dagster["runs"] = [{"runId": "a", "updateTime": 10.0}, {"runId": "q", "updateTime": 20.0}]
    assert cli.cancel_runs("http://dagster/graphql") == ["a", "q"]
    assert set(dagster["statuses"]) == {"STARTING", "STARTED", "CANCELING", "QUEUED"}


def test_at_start_only_runs_left_by_an_earlier_dagster_are_cancelled(dagster):
    """A run this Dagster started (a sensor, a schedule) was updated after it started."""
    from datavloot_platform import cli

    dagster["runs"] = [{"runId": "left", "updateTime": 100.0}, {"runId": "new", "updateTime": 205.0}]
    cancelled = cli.cancel_runs(
        "http://dagster/graphql", statuses=("STARTING", "STARTED", "CANCELING"), not_updated_since=200.0
    )
    assert cancelled == ["left"]
    assert dagster["cancelled"] == ["left"]
    assert "QUEUED" not in dagster["statuses"], "a queued run waits for this Dagster; it is not left over"


def test_an_unreachable_dagster_cancels_nothing_and_does_not_raise():
    pytest.importorskip("httpx")
    from datavloot_platform import cli

    assert cli.cancel_runs("http://127.0.0.1:9/graphql") == []


# --------------------------------------------------------------------------
# cli.free_finished_run_slots, against a stand-in for Dagster
# --------------------------------------------------------------------------

@pytest.fixture
def pool(monkeypatch):
    """A `lake` pool: `claimed` and `pending` are run ids, `statuses` maps run id to status."""
    httpx = pytest.importorskip("httpx")
    import json

    state = {"claimed": [], "pending": [], "statuses": {}, "freed": [], "free_answer": None, "runs_answer": None}

    def handler(request):
        body = json.loads(request.content)
        query, variables = body["query"], body["variables"]
        if "freeConcurrencySlotsForRun" in query:
            if state["free_answer"] is not None:
                return httpx.Response(200, json=state["free_answer"])
            state["freed"].append(variables["runId"])
            return httpx.Response(200, json={"data": {"freeConcurrencySlotsForRun": True}})
        if "runsOrError" in query:
            if state["runs_answer"] is not None:
                return httpx.Response(200, json=state["runs_answer"])
            results = [
                {"runId": r, "status": state["statuses"][r]} for r in variables["runIds"] if r in state["statuses"]
            ]
            return httpx.Response(200, json={"data": {"runsOrError": {"__typename": "Runs", "results": results}}})
        limits = [
            {
                "claimedSlots": [{"runId": r} for r in state["claimed"]],
                "pendingSteps": [{"runId": r} for r in state["pending"]],
            }
        ]
        return httpx.Response(200, json={"data": {"instance": {"concurrencyLimits": limits}}})

    transport = httpx.MockTransport(handler)

    def post(url, **kwargs):
        kwargs.pop("timeout", None)
        with httpx.Client(transport=transport) as client:
            return client.post(url, **kwargs)

    monkeypatch.setattr(httpx, "post", post)
    return state


def test_the_slot_of_a_finished_run_is_freed(pool):
    """A cut-off run, marked cancelled, still claimed `lake`: every later run stayed Queued."""
    from datavloot_platform import cli

    pool["claimed"] = ["cut"]
    pool["statuses"] = {"cut": "CANCELED"}
    assert cli.free_finished_run_slots("http://dagster/graphql") == ["cut"]
    assert pool["freed"] == ["cut"]


@pytest.mark.parametrize("status", ["QUEUED", "STARTING", "STARTED", "CANCELING"])
def test_the_slot_of_a_run_that_is_not_finished_is_kept(pool, status):
    from datavloot_platform import cli

    pool["claimed"] = ["going"]
    pool["statuses"] = {"going": status}
    assert cli.free_finished_run_slots("http://dagster/graphql") == []
    assert pool["freed"] == []


def test_finished_and_running_runs_are_told_apart_and_a_run_is_freed_once(pool):
    from datavloot_platform import cli

    pool["claimed"] = ["cut", "going"]
    pool["pending"] = ["cut"]  # claims and waits on the same pool: still one run
    pool["statuses"] = {"cut": "FAILURE", "going": "STARTED"}
    assert cli.free_finished_run_slots("http://dagster/graphql") == ["cut"]
    assert pool["freed"] == ["cut"]


def test_an_empty_pool_asks_nothing_more(pool):
    from datavloot_platform import cli

    assert cli.free_finished_run_slots("http://dagster/graphql") == []
    assert pool["freed"] == []


def test_an_unreachable_dagster_frees_nothing_and_does_not_raise():
    pytest.importorskip("httpx")
    from datavloot_platform import cli

    assert cli.free_finished_run_slots("http://127.0.0.1:9/graphql") == []


def test_the_slot_of_a_run_deleted_in_dagster_is_freed(pool):
    """Deleting the stuck run is the obvious thing to try; its claim stays all the same."""
    from datavloot_platform import cli

    pool["claimed"] = ["deleted", "going"]
    pool["statuses"] = {"going": "STARTED"}
    assert cli.free_finished_run_slots("http://dagster/graphql") == ["deleted"]
    assert pool["freed"] == ["deleted"]


@pytest.mark.parametrize(
    "answer",
    [
        {"data": {"freeConcurrencySlotsForRun": False}},
        {"data": None, "errors": [{"message": "not allowed"}]},
    ],
)
def test_a_slot_dagster_did_not_free_is_not_reported_as_freed(pool, answer, capsys):
    from datavloot_platform import cli

    pool["claimed"] = ["cut"]
    pool["statuses"] = {"cut": "CANCELED"}
    pool["free_answer"] = answer
    assert cli.free_finished_run_slots("http://dagster/graphql") == []
    assert "cut" in capsys.readouterr().out


def test_when_dagster_cannot_list_the_runs_nothing_is_taken_for_deleted(pool):
    """A failed status query must not make every claiming run look deleted."""
    from datavloot_platform import cli

    pool["claimed"] = ["going"]
    pool["statuses"] = {"going": "STARTED"}
    pool["runs_answer"] = {"data": {"runsOrError": {"__typename": "PythonError", "message": "boom"}}}
    assert cli.free_finished_run_slots("http://dagster/graphql") == []
    assert pool["freed"] == []


def test_shut_down_while_dagster_loads_does_not_ask_it_anything(cancelled):
    from datavloot_platform.crowsnest import startup

    startup.set_dagster("starting")
    app = _app("127.0.0.1")
    r = TestClient(app).post("/api/shutdown")
    assert r.status_code == 200, r.text
    assert r.json()["cancelled_runs"] == []
    assert cancelled == ["notebooks stopped", "apps stopped"]
    assert startup.stopping() is True


def test_a_dagster_stopped_by_shut_down_is_not_reported_as_a_failed_start(monkeypatch, capsys):
    """The watcher in `datavloot start` sees Dagster exit; after Shut down that is no error."""
    import argparse

    from datavloot_platform import cli
    from datavloot_platform.crowsnest import startup

    class Proc:
        pid = 1

        def poll(self):
            return 1

    watcher = {}

    class Thread:
        def __init__(self, target, **kw):
            watcher["run"] = target

        def start(self):
            pass

    import threading

    monkeypatch.setattr(cli.subprocess, "Popen", lambda *a, **kw: Proc())
    monkeypatch.setattr(threading, "Thread", Thread)
    monkeypatch.setattr(cli, "cmd_crowsnest", lambda args: None)
    monkeypatch.setattr(cli, "terminate_tree", lambda proc: None)
    monkeypatch.setattr(cli, "_wait_for_dagster", lambda proc, url: "Dagster exited with code 1 before becoming ready.")
    cli._start(argparse.Namespace(run=False), "http://127.0.0.1:9/graphql", None, {}, None)

    startup.set_stopping()
    watcher["run"]()
    out = capsys.readouterr().out
    assert "Error:" not in out
    assert "shutting down" in out
    assert startup.dagster()[0] == "starting"
