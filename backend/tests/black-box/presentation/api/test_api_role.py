"""Rol api: sin modelo; registra el estado deseado y muestra lo que publican los workers."""
import time

import pytest

from tests.support.coordination import FakeCoordinationStore


@pytest.fixture
def api_role(configured, monkeypatch):
    from fastapi.testclient import TestClient
    from app.bootstrap import create_app

    store = FakeCoordinationStore()
    app = create_app(mode="mock", transport="rtsp", role="api", coordination_store=store)
    with TestClient(app, headers={"X-API-Key": "test-control-key"}) as client:
        yield client, store


def wait_for(client, path, predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while True:
        body = client.get(path).json()
        if predicate(body) or time.monotonic() > deadline:
            return body
        time.sleep(0.2)


def test_api_role_reports_distributed_mode_and_does_not_infer(api_role):
    client, _ = api_role
    health = client.get("/health").json()
    assert health["role"] == "api"
    assert health["rtsp"]["mode"] == "distributed"
    assert client.post("/predict", json={"timestamp": 0, "frames": [[[[0, 0, 0]]]]}).status_code == 503


def test_api_role_delegates_sources_to_workers(api_role):
    client, store = api_role
    started = client.post("/sources/start", json={"source_id": "camara1"})
    assert started.status_code == 200
    assert started.json()["status"] == "pending"
    assert store.control["camara1"] == "running"

    # Un worker toma la cámara y publica su estado.
    store.claim("worker-1", "camara1", 15)
    store.publish("worker-1", [{"source_id": "camara1", "status": "receiving", "frames_received": 30,
                                "windows_processed": 1, "latest_result": {"clase": "Normal"}}])
    status = wait_for(client, "/sources/camara1/status", lambda body: body.get("status") == "receiving")
    assert status["worker_id"] == "worker-1"
    assert status["latest_result"] == {"clase": "Normal"}

    assert client.delete("/sources/camara1").status_code == 200
    assert store.control["camara1"] == "stopped"
    stopped = client.get("/sources/camara1/status").json()
    assert stopped["status"] == "stopped" and stopped["active"] is False


def test_unknown_role_is_rejected(configured):
    from app.bootstrap import create_app
    with pytest.raises(ValueError):
        create_app(mode="mock", transport="rtsp", role="otro")
