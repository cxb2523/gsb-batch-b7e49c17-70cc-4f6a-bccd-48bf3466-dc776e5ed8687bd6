import asyncio
import sys
import httpx
import pytest

def test_default_rtsp_configuration(configured):
    from app.infrastructure.streaming.rtsp import RTSPReceiver
    from app.presentation.http.schemas import StartSource
    receiver = RTSPReceiver(lambda frames, timestamp: {}, detection_store=configured)
    camera = receiver.default_camera
    assert (camera.source_id, camera.stream_path) == ("camara1", "camera01")
    assert (camera.protocol, camera.host, camera.port) == ("rtsp", "184.194.94.182", 8554)
    assert camera.password.get_secret_value() == ""
    assert camera.fingerprint == ""
    assert StartSource().source_id == "camara1"

def test_invalid_protocol_rejected(configured, monkeypatch):
    from app.infrastructure.streaming.rtsp import RTSPReceiver
    monkeypatch.setenv("SENTRIX_RTSP_PROTOCOL", "https")
    with pytest.raises(ValueError, match="PROTOCOL"):
        RTSPReceiver(lambda frames, timestamp: {})

def test_rtsps_still_requires_private_configuration(configured, monkeypatch):
    from app.infrastructure.streaming.rtsp import RTSPReceiver
    monkeypatch.setenv("SENTRIX_RTSP_PROTOCOL", "rtsps")
    with pytest.raises(ValueError, match="RTSPS requiere"):
        RTSPReceiver(lambda frames, timestamp: {})

def test_livekit_transport_removed(configured):
    from app.bootstrap import create_app
    with pytest.raises(ValueError, match="webrtc o rtsp"):
        create_app(mode="mock", transport="livekit")
    assert not any(name == "livekit" or name.startswith("livekit.") for name in sys.modules)
