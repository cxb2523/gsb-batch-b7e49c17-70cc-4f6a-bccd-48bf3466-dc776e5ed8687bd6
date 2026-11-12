"""
The Crows Nest behind a proxy (the Falcon, deploy/compose).

On a laptop the browser finds Dagster at localhost:3000 and the Crows Nest
starts Marimo itself. Behind Traefik both live at their own public URL, which
the browser has to be given; and Marimo is a service of its own, which the
Crows Nest must not start or kill.
"""

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest import processes  # noqa: E402
from datavloot_platform.crowsnest.routes import notebooks  # noqa: E402


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    (tmp_path / "notebooks").mkdir()
    (tmp_path / "notebooks" / "explore.py").write_text("import marimo\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    for var in ("CROWSNEST_AUTH_TOKEN", "CROWSNEST_DAGSTER_PUBLIC_URL", "CROWSNEST_MARIMO_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)

    def make(**env) -> TestClient:
        for var, value in env.items():
            monkeypatch.setenv(var, value)
        cn_config.reset_config()
        from datavloot_platform.crowsnest.server import create_app
        return TestClient(create_app())

    yield make
    cn_config.reset_config()


def test_a_laptop_keeps_its_localhost_links(make_client):
    services = make_client().get("/api/services").json()
    assert services["dagster_url"] == "http://localhost:3000"
    assert services["marimo_url"] == "http://127.0.0.1:2718"


def test_the_browser_gets_the_public_urls(make_client):
    client = make_client(
        CROWSNEST_DAGSTER_URL="http://dagster-webserver:3000/graphql",
        CROWSNEST_DAGSTER_PUBLIC_URL="https://dagster.example.nl/",
        CROWSNEST_MARIMO_URL="http://marimo:2718",
        CROWSNEST_MARIMO_PUBLIC_URL="https://marimo.example.nl",
    )
    services = client.get("/api/services").json()
    assert services["dagster_url"] == "https://dagster.example.nl"
    assert services["marimo_url"] == "https://marimo.example.nl"


def test_a_marimo_service_is_linked_to_not_started(make_client, monkeypatch):
    started, stopped = [], []
    monkeypatch.setattr(notebooks.subprocess, "Popen", lambda *a, **k: started.append(a))
    monkeypatch.setattr(processes, "terminate_tree", stopped.append)
    # Something the Crows Nest would stop on a laptop, so that /stop has a reason to.
    monkeypatch.setattr(notebooks, "_marimo_process", _Running())
    client = make_client(CROWSNEST_MARIMO_PUBLIC_URL="https://marimo.example.nl")

    launched = client.post("/api/notebooks/launch", json={"name": "explore.py"}).json()
    assert launched["url"] == "https://marimo.example.nl/?file=explore.py"

    assert client.post("/api/notebooks/stop").json() == {"stopped": False}
    assert started == [] and stopped == [], "the Crows Nest started or stopped a process next to the Marimo service"


class _Running:
    """A process that has not exited."""

    def poll(self):
        return None


def test_the_panel_learns_whether_marimo_is_shared(make_client):
    # Shared (the Falcon): one Marimo for the whole notebooks/ folder, whose
    # root is its own file list; the panel then opens the launched notebook's
    # URL rather than the root, which would open notebooks in a new tab.
    assert make_client().get("/api/services").json()["marimo_shared"] is False
    shared = make_client(CROWSNEST_MARIMO_PUBLIC_URL="https://marimo.example.nl")
    assert shared.get("/api/services").json()["marimo_shared"] is True
