"""The shared processing use case preserves temporal alert semantics."""
import asyncio

import pytest


@pytest.mark.parametrize("numbers,active", [([1, 2], True), ([1, 3], False)])
def test_window_processor_persists_detections_and_resets_on_gaps(configured, tmp_path, numbers, active):
    from app.domain.alerts import EventPolicy
    from app.domain.pipeline import PipelineConfig, WindowBuffer
    from app.infrastructure.persistence.alerts import AlertStore
    from app.infrastructure.persistence.inference_logs import InferenceLogStore
    from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
    from app.infrastructure.streaming.webrtc import Session

    async def exercise():
        alerts = AlertStore(configured.path)
        logs = InferenceLogStore(tmp_path / "processing-logs.db")
        receiver = RTSPReceiver(lambda *args: None, detection_store=configured, alert_store=alerts,
                                log_store=logs, predict_frames=lambda frames, timestamp: {
                                    "clase": "Hurto", "confianza": .95,
                                    "timestamp": timestamp, "simulated": True})
        session = Session(pc=_RTSPPeer(), source_id="test",
                          buffer=WindowBuffer(PipelineConfig()), alert_policy=EventPolicy())
        receiver.sessions[session.id] = session
        for number in numbers:
            session.buffer.queue.put_nowait((number, [(object(), float(number))]))
        task = asyncio.create_task(receiver.process_windows(session))
        try:
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            assert session.windows_processed == 2
            assert session.processing_errors == 0
            assert len(configured.list()) == 2
            assert session.latest_result["alert"]["active"] is active
            assert alerts.list(status="active")["total"] == int(active)
            assert logs.list(event_type="inference_completed")["total"] == 2
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await receiver.close(session.id)

    asyncio.run(exercise())


def test_window_processor_skips_alert_storage_without_active_alert(configured, tmp_path):
    from app.domain.alerts import EventPolicy
    from app.domain.pipeline import PipelineConfig, WindowBuffer
    from app.infrastructure.persistence.alerts import AlertStore
    from app.infrastructure.persistence.inference_logs import InferenceLogStore
    from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
    from app.infrastructure.streaming.webrtc import Session

    class CountingAlerts(AlertStore):
        calls = 0

        def apply(self, result, detection):
            CountingAlerts.calls += 1
            return super().apply(result, detection)

    async def exercise():
        alerts = CountingAlerts(configured.path)
        logs = InferenceLogStore(tmp_path / "processing-logs.db")
        receiver = RTSPReceiver(lambda *args: None, detection_store=configured, alert_store=alerts,
                                log_store=logs, predict_frames=lambda frames, timestamp: {
                                    "clase": "Normal" if timestamp < 3 else "Hurto", "confianza": .95,
                                    "timestamp": timestamp, "simulated": True})
        session = Session(pc=_RTSPPeer(), source_id="test",
                          buffer=WindowBuffer(PipelineConfig(queue_size=4)), alert_policy=EventPolicy())
        receiver.sessions[session.id] = session
        for number in (1, 2, 3):
            session.buffer.queue.put_nowait((number, [(object(), float(number))]))
        task = asyncio.create_task(receiver.process_windows(session))
        try:
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            # Normal, Normal y un primer candidato: sin alerta no se consulta la tabla.
            assert CountingAlerts.calls == 0
            assert session.latest_result["alert"]["id"] is None
            assert session.latest_result["alert"]["status"] is None
            session.buffer.queue.put_nowait((4, [(object(), 4.0)]))
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            assert CountingAlerts.calls == 1
            assert session.latest_result["alert"]["status"] == "active"
            assert alerts.list(status="active")["total"] == 1
            assert len(configured.list()) == 4
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await receiver.close(session.id)

    asyncio.run(exercise())


def test_window_processor_touches_alerts_only_when_opening_or_closing(configured, tmp_path):
    # Regresión del experimento: consultar alerts en cada ventana activa bloqueaba la tabla para
    # todas las cámaras y formaba cola con varias alertas a la vez.
    from app.domain.alerts import EventPolicy
    from app.domain.pipeline import PipelineConfig, WindowBuffer
    from app.infrastructure.persistence.alerts import AlertStore
    from app.infrastructure.persistence.inference_logs import InferenceLogStore
    from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
    from app.infrastructure.streaming.webrtc import Session

    class CountingAlerts(AlertStore):
        calls = 0

        def apply(self, result, detection):
            CountingAlerts.calls += 1
            return super().apply(result, detection)

    async def exercise():
        alerts = CountingAlerts(configured.path)
        logs = InferenceLogStore(tmp_path / "processing-logs.db")
        # Ventanas 1-5 Hurto (abre en la 2), 6-8 Normal (cierra en la 8).
        receiver = RTSPReceiver(lambda *args: None, detection_store=configured, alert_store=alerts,
                                log_store=logs, predict_frames=lambda frames, timestamp: {
                                    "clase": "Hurto" if timestamp < 6 else "Normal", "confianza": .95,
                                    "timestamp": timestamp, "simulated": True})
        session = Session(pc=_RTSPPeer(), source_id="test",
                          buffer=WindowBuffer(PipelineConfig(queue_size=4)), alert_policy=EventPolicy())
        receiver.sessions[session.id] = session
        task = asyncio.create_task(receiver.process_windows(session))
        try:
            for first in (1, 3, 5, 7):
                for number in (first, first + 1):
                    session.buffer.queue.put_nowait((number, [(object(), float(number))]))
                await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
                if first == 3:
                    opened = session.latest_result["alert"]["id"]
                    assert session.latest_result["alert"]["status"] == "active"
                if first == 5:
                    # Ventanas 3 a 6 con la alerta abierta: ninguna volvió a tocar la tabla.
                    assert CountingAlerts.calls == 1
                    assert session.latest_result["alert"]["id"] == opened
            assert CountingAlerts.calls == 2
            assert session.latest_result["alert"]["status"] == "closed"
            assert session.active_alert is None
            assert alerts.list(status="closed")["total"] == 1
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await receiver.close(session.id)

    asyncio.run(exercise())
