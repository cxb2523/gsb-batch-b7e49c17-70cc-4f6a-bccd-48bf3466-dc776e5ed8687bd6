"""Regressions for schema locks and RTSP recovery; no camera connection."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from app.infrastructure.persistence.alerts import AlertStore
from app.domain.alerts import EventPolicy
from app.infrastructure.persistence.detections import DetectionStore


def test_rtsp_reconnects_when_alerts_logs_and_close_fail(configured, monkeypatch):
    import app.infrastructure.streaming.rtsp as module
    from app.domain.pipeline import PipelineConfig, WindowBuffer
    from app.infrastructure.streaming.webrtc import Session

    class BrokenStore:
        def interrupt(self, *args):
            raise RuntimeError("storage unavailable")

        def emit(self, *args, **kwargs):
            raise RuntimeError("logs unavailable")

    async def exercise():
        receiver = module.RTSPReceiver(lambda *args: {}, detection_store=configured, alert_store=BrokenStore(),
                                       log_store=BrokenStore())
        session = Session(pc=module._RTSPPeer(), source_id="cam",
                          buffer=WindowBuffer(PipelineConfig()), alert_policy=EventPolicy())
        session.camera_config = receiver.default_camera
        session.active_alert = {"id": "alerta"}  # Con alerta abierta: si no, no se escribe en la base.
        receiver.sessions[session.id] = session
        opened = []

        class Container:
            def decode(self, **kwargs):
                return iter(())

            def close(self):
                raise RuntimeError("close failed")

        def open_stream(*args, **kwargs):
            opened.append(1)
            return Container()

        async def retry_sleep(delay):
            assert delay == 3
            if len(opened) == 2:
                receiver.sessions.pop(session.id)

        monkeypatch.setattr(module.av, "open", open_stream)
        monkeypatch.setattr(module.asyncio, "sleep", retry_sleep)
        await asyncio.wait_for(receiver._read_loop(session), 5)
        assert len(opened) == 2
        assert session.pending_alert_interruption
        assert session.active_alert == {"id": "alerta"}  # Sigue pendiente: se reintenta en el siguiente hueco.
        assert session.rtsp_status == "reconnecting"

    asyncio.run(exercise())


def test_rtsp_outage_is_logged_once_per_disconnection(configured, monkeypatch):
    import app.infrastructure.streaming.rtsp as module
    from app.domain.pipeline import PipelineConfig, WindowBuffer
    from app.infrastructure.streaming.webrtc import Session

    events = []

    class Logs:
        def emit(self, event_type, *args, **kwargs):
            events.append(event_type)

    class Alerts:
        def interrupt(self, *args):
            return 0

    async def exercise():
        receiver = module.RTSPReceiver(lambda *args: {}, detection_store=configured, alert_store=Alerts(),
                                       log_store=Logs())
        session = Session(pc=module._RTSPPeer(), source_id="cam",
                          buffer=WindowBuffer(PipelineConfig()), alert_policy=EventPolicy())
        session.camera_config = receiver.default_camera
        receiver.sessions[session.id] = session
        attempts = []

        class Frame:
            time, width, height = 0.0, 4, 4

        class Container:
            def __init__(self, frames):
                self.frames = frames

            def decode(self, **kwargs):
                return iter(self.frames)

            def close(self):
                pass

        def open_stream(*args, **kwargs):
            attempts.append(1)
            # Tres intentos fallidos, uno que recibe video y vuelve a caer, y otro fallido.
            if len(attempts) == 4:
                return Container([Frame()])
            raise ConnectionError("sin stream")

        async def retry_sleep(delay):
            if len(attempts) == 5:
                receiver.sessions.pop(session.id)

        monkeypatch.setattr(module.av, "open", open_stream)
        monkeypatch.setattr(module.asyncio, "sleep", retry_sleep)
        await asyncio.wait_for(receiver._read_loop(session), 5)
        assert len(attempts) == 5
        # Un registro por cada corte (antes y después de la recepción), no por intento.
        assert events.count("transport_error") == 2
        assert events.count("source_connected") == 1

    asyncio.run(exercise())
