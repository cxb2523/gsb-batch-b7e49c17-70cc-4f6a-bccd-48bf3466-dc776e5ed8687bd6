"""
The Crows Nest's Dashboards panel (routes/apps.py): the project's apps/ folder,
served with `marimo run`.

On a laptop the Crows Nest starts one apps server for every app and keeps it;
behind a proxy (the Falcon) the apps are a service of their own, which it only
links to. A name from the browser never reaches outside apps/.
"""

import asyncio
import socket
import subprocess
import sys
import threading
import time

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.routes import apps, notebooks  # noqa: E402

from .test_crowsnest_notebooks import (  # noqa: E402
    OWN_GROUP,
    SERVE,
    SERVES_FROM_A_CHILD,
    answered_meanwhile,
    finds_the_listener,
    kill_tree,
    meets_the_other_request,
    post_twice_at_once,
    serves,
    wait_until,
)

DASHBOARD = '''import marimo

app = marimo.App(width="full", app_title="Vessel traffic")
'''


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    for var in ("CROWSNEST_AUTH_TOKEN", "CROWSNEST_APPS_URL", "CROWSNEST_APPS_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(apps, "_apps_process", None)
    # A free port of its own, so an apps server the developer runs on 2719 is not in the way.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        monkeypatch.setattr(apps, "APPS_PORT", s.getsockname()[1])

    def make(with_apps=True, **env) -> TestClient:
        if with_apps:
            (tmp_path / "apps").mkdir(exist_ok=True)
            (tmp_path / "apps" / "traffic.py").write_text(DASHBOARD, encoding="utf-8")
            (tmp_path / "apps" / "plain.py").write_text("import marimo\n", encoding="utf-8")
        for var, value in env.items():
            monkeypatch.setenv(var, value)
        cn_config.reset_config()
        from datavloot_platform.crowsnest.server import create_app
        return TestClient(create_app())

    yield make
    cn_config.reset_config()


class _FakeProcess:
    def poll(self):
        return None


def test_lists_apps_with_their_titles(make_client):
    listed = make_client().get("/api/apps/list").json()
    assert listed == {
        "apps": [
            {"name": "plain.py", "title": "plain"},
            {"name": "traffic.py", "title": "Vessel traffic"},
        ],
        "available": True,
    }


def test_a_project_without_apps_says_so(make_client):
    assert make_client(with_apps=False).get("/api/apps/list").json() == {"apps": [], "available": False}


@pytest.mark.parametrize("name", ["../notebooks/explore.py", "..\\secret.py", "traffic.txt", "missing.py"])
def test_open_stays_inside_apps(make_client, monkeypatch, name):
    monkeypatch.setattr(apps, "start_marimo", lambda args: pytest.fail("started marimo for " + name))
    response = make_client().post("/api/apps/open", json={"name": name})
    assert response.status_code in (400, 404)


class _Answers:
    status_code = 200


class _Client:
    """httpx.AsyncClient for a server that answers right away."""

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        return _Answers()


def test_a_laptop_starts_one_server_for_every_app(make_client, monkeypatch):
    calls = []

    def start(args):
        calls.append(args)
        return _FakeProcess()

    monkeypatch.setattr(apps, "start_marimo", start)
    monkeypatch.setattr(apps.httpx, "AsyncClient", _Client)
    client = make_client()

    first = client.post("/api/apps/open", json={"name": "traffic.py"}).json()
    second = client.post("/api/apps/open", json={"name": "plain.py"}).json()

    assert first["url"] == "http://127.0.0.1:2719/?file=traffic.py"
    assert second["url"] == "http://127.0.0.1:2719/?file=plain.py"
    port = str(apps.APPS_PORT)
    assert calls == [["run", "apps", "--headless", "--no-token", "--port", port]], "one server for every app"


@pytest.mark.parametrize("step", ["port_in_use", "start_marimo"])
def test_other_requests_are_answered_during_a_first_open(make_client, monkeypatch, step):
    meanwhile = []
    results = {"port_in_use": False, "start_marimo": _FakeProcess()}
    monkeypatch.setattr(apps.httpx, "AsyncClient", _Client)

    with make_client() as client:
        for name, result in results.items():
            def stand_in(*args, name=name, result=result):
                if name == step:
                    meanwhile.append(answered_meanwhile(client))
                return result

            monkeypatch.setattr(apps, name, stand_in)
        response = client.post("/api/apps/open", json={"name": "traffic.py"})

    assert response.status_code == 200, response.json()
    assert meanwhile == [True], f"{step} held up every other request"


def test_two_opens_at_once_start_one_server(make_client, monkeypatch):
    calls = []

    def start(args):
        calls.append(args)
        return _FakeProcess()

    barrier = threading.Barrier(2, timeout=1)
    monkeypatch.setattr(apps, "port_in_use", lambda port: meets_the_other_request(barrier))
    monkeypatch.setattr(apps, "start_marimo", start)
    monkeypatch.setattr(apps.httpx, "AsyncClient", _Client)

    with make_client() as client:
        responses = post_twice_at_once(client, "/api/apps/open", "traffic.py")

    assert [response.status_code for response in responses] == [200, 200]
    assert len(calls) == 1, "two apps servers started on one port"


def test_a_second_open_does_not_wait_for_the_first(make_client, monkeypatch):
    """The lock covers the check and the start, not the wait of up to 30 s until the server answers."""
    second_returned = threading.Event()
    first_is_waiting = threading.Event()
    seen_by_the_first = []

    class _SlowForTheFirst(_Client):
        async def get(self, url):
            if not first_is_waiting.is_set():
                first_is_waiting.set()
                deadline = time.monotonic() + 5
                while not second_returned.is_set() and time.monotonic() < deadline:
                    await asyncio.sleep(0.05)
                seen_by_the_first.append(second_returned.is_set())
            return _Answers()

    monkeypatch.setattr(apps, "start_marimo", lambda args: _FakeProcess())
    monkeypatch.setattr(apps.httpx, "AsyncClient", _SlowForTheFirst)

    with make_client() as client:
        first = threading.Thread(target=client.post, args=("/api/apps/open",), kwargs={"json": {"name": "traffic.py"}})
        first.start()
        assert first_is_waiting.wait(timeout=5), "the first Open never got to the wait"
        assert client.post("/api/apps/open", json={"name": "plain.py"}).status_code == 200
        second_returned.set()
        first.join(timeout=30)

    assert not first.is_alive(), "the first Open never returned"
    assert seen_by_the_first == [True], "the second Open waited for the first"


def test_open_leaves_a_foreign_apps_server_alone(make_client, monkeypatch):
    """Whatever else holds the port -- another project's apps -- is not ours to stop; Open says so."""
    monkeypatch.setattr(apps, "start_marimo", lambda args: pytest.fail("started an apps server next to a foreign one"))
    client = make_client()
    foreign = subprocess.Popen([sys.executable, "-c", SERVE, str(apps.APPS_PORT)], **OWN_GROUP)
    try:
        assert wait_until(lambda: serves(apps.APPS_PORT)), "the foreign server never listened"
        response = client.post("/api/apps/open", json={"name": "traffic.py"})
        assert response.status_code == 409
        assert finds_the_listener(apps.APPS_PORT) in response.json()["detail"]
        assert foreign.poll() is None, "the Crows Nest stopped an apps server it did not start"
    finally:
        foreign.kill()
        foreign.wait(timeout=10)


def test_an_apps_service_is_linked_to_not_started(make_client, monkeypatch):
    monkeypatch.setattr(apps, "start_marimo", lambda args: pytest.fail("started marimo next to the apps service"))
    client = make_client(CROWSNEST_APPS_PUBLIC_URL="https://apps.example.nl/")

    opened = client.post("/api/apps/open", json={"name": "traffic.py"}).json()
    assert opened["url"] == "https://apps.example.nl/?file=traffic.py"
    assert client.get("/api/services").json()["apps_url"] == "https://apps.example.nl"


def test_a_laptop_links_the_local_apps_server(make_client):
    assert make_client().get("/api/services").json()["apps_url"] == "http://127.0.0.1:2719"


@pytest.mark.parametrize("route", [apps, notebooks], ids=["apps", "notebooks"])
def test_the_marimo_servers_stop_with_the_crows_nest(monkeypatch, route):
    # Both run in their own process group; left running they serve a session
    # that is over, which the next Crows Nest then shows as live. Whatever the
    # server started goes too: `marimo edit` runs a kernel process per session.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-c", SERVES_FROM_A_CHILD, str(port), SERVE], stdout=subprocess.PIPE, **OWN_GROUP
    )
    child = int(server.stdout.readline())
    monkeypatch.setattr(route, "_apps_process" if route is apps else "_marimo_process", server)
    try:
        assert wait_until(lambda: serves(port)), "the stand-in's child never served"
        route._stop_server()
        assert wait_until(lambda: server.poll() is not None, timeout=10), "the server outlived the Crows Nest"
        assert wait_until(lambda: not serves(port), timeout=5), "a process the server started outlived the Crows Nest"
    finally:
        kill_tree(child)
        kill_tree(server.pid)
        server.wait(timeout=10)
        server.stdout.close()
