"""Un hueco sin alerta abierta no debe tocar la base: ese bloqueo global realimentaba los descartes."""
import asyncio


def build(configured, tmp_path):
    from app.domain.hybrid import HybridConfig
    from app.domain.pipeline import HybridBuffer
    from app.infrastructure.persistence.alerts import AlertStore
    from app.infrastructure.persistence.inference_logs import InferenceLogStore
    from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
    from app.infrastructure.streaming.webrtc import Session

    config = HybridConfig(queue_size=4)
    receiver = RTSPReceiver(lambda *args: None, config, detection_store=configured, alert_store=AlertStore(configured.path),
                            log_store=InferenceLogStore(tmp_path / "logs.db"))
    return receiver, Session(pc=_RTSPPeer(), source_id="cam", buffer=HybridBuffer(config))


def spy(receiver, monkeypatch):
    calls = []
    monkeypatch.setattr(receiver.alert_store, "interrupt", lambda *args, **kwargs: calls.append(args[1]) or 0)
    return calls


def test_a_gap_without_an_open_alert_skips_the_database(configured, tmp_path, monkeypatch):
    receiver, session = build(configured, tmp_path)
    calls = spy(receiver, monkeypatch)
    for reason in ("window_gap", "timeline_reset", "processing_error", "rtsp_interrupted"):
        asyncio.run(receiver.interrupt_alert(session, reason))
    assert calls == []


def test_an_open_alert_is_still_interrupted(configured, tmp_path, monkeypatch):
    receiver, session = build(configured, tmp_path)
    calls = spy(receiver, monkeypatch)
    session.active_alert = {"id": "a1"}
    asyncio.run(receiver.interrupt_alert(session, "window_gap"))
    assert calls == ["window_gap"] and session.active_alert is None


def test_a_disconnect_always_closes_the_session(configured, tmp_path, monkeypatch):
    receiver, session = build(configured, tmp_path)
    calls = spy(receiver, monkeypatch)
    asyncio.run(receiver.interrupt_alert(session, "source_disconnected"))
    assert calls == ["source_disconnected"]
