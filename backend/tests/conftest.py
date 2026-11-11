"""Isolated test configuration; never load deployment credentials."""
import os
import pytest
from pathlib import Path


def pytest_collection_modifyitems(items):
    """Expose the same four scopes through both folders and pytest markers."""
    root = Path(__file__).resolve().parent
    markers = {"unit": "unit", "black-box": "black_box", "integration": "integration", "e2e": "e2e"}
    for item in items:
        scope = Path(item.path).relative_to(root).parts[0]
        if scope in markers:
            item.add_marker(getattr(pytest.mark, markers[scope]))


@pytest.fixture
def configured(monkeypatch, tmp_path):
    monkeypatch.setenv("SENTRIX_DATABASE_URL", "")
    monkeypatch.setenv("SENTRIX_DETECTION_DB", str(tmp_path / "detections.sqlite3"))
    monkeypatch.setenv("SENTRIX_LOG_DB", str(tmp_path / "logs.sqlite3"))
    monkeypatch.setenv("SENTRIX_CONTROL_API_KEY", "test-control-key")
    monkeypatch.setenv("SENTRIX_PREDICTOR", "mock")
    monkeypatch.setenv("SENTRIX_VIDEO_TRANSPORT", "rtsp")
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://sentrix-vercel-upload.vercel.app")
    for key in list(os.environ):
        if key.startswith("TA2_") or key == "SENTRIX_ALERT_THRESHOLDS":
            monkeypatch.delenv(key, raising=False)
    for key in ("PROTOCOL", "HOST", "PORT", "USER", "PASSWORD", "SHA256"):
        monkeypatch.delenv("SENTRIX_RTSP_" + key, raising=False)
    for key in ("SENTRIX_SOURCE_ID", "SENTRIX_STREAM_PATH", "SENTRIX_CAMERA_NAME"):
        monkeypatch.delenv(key, raising=False)
    from app.infrastructure.persistence.detections import DetectionStore
    return DetectionStore(tmp_path / "detections.sqlite3")


@pytest.fixture
def api_client(configured, monkeypatch):
    """API fixture with real storage, deterministic inference and no remote cameras."""
    import asyncio
    from fastapi.testclient import TestClient
    from app.bootstrap import create_app

    app = create_app(mode="mock", transport="rtsp")

    async def idle_reader(session):
        await asyncio.Event().wait()

    monkeypatch.setattr(app.state.video_receiver, "_read_loop", idle_reader)
    with TestClient(app, headers={"X-API-Key": "test-control-key"}) as client:
        yield client
