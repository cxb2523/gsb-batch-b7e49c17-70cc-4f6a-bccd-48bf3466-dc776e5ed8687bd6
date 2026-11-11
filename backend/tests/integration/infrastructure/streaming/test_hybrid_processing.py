"""El procesador del híbrido guarda detecciones y abre/cierra alertas donde VadCLIP lo marca."""
import asyncio

import pytest

STEP = 16 / 30
CRIME = [0.0, 0.0, 0.0, 3.0, 0.0]   # agresión física


class FakeModels:
    """El 'frame' de CLIP es directamente el puntaje de anomalía de ese bloque."""
    def __init__(self):
        self.classified = 0

    @staticmethod
    def prepare_block(block):
        return block["clip"], block["videomae"]

    @staticmethod
    def feature(image):
        return image

    @staticmethod
    def anomaly(features):
        return features[-1], "Assault", .9

    def detect(self, image, previous, rolling):
        feature = self.feature(image)
        return feature, self.anomaly((list(previous) + [feature])[-rolling:])

    def classify(self, frames):
        assert len(frames) == 16
        self.classified += 1
        return CRIME


def build(configured, tmp_path, merge_gap=1.0):
    from app.application.hybrid_processing import HybridContext, HybridProcessor
    from app.domain.hybrid import HybridConfig
    from app.domain.pipeline import HybridBuffer
    from app.infrastructure.persistence.alerts import AlertStore
    from app.infrastructure.persistence.inference_logs import InferenceLogStore
    from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
    from app.infrastructure.streaming.webrtc import Session

    class Receiver(RTSPReceiver):
        hooks = []

        async def alert_opened(self, session, event):
            self.hooks.append(("opened", event["id"], event["timestamp_inicio"]))

        async def alert_finished(self, session, alert_id, end_timestamp, *, complete, reason):
            self.hooks.append(("finished", alert_id, end_timestamp, complete, reason))

    config = HybridConfig(merge_gap=merge_gap, queue_size=32)
    models = FakeModels()
    alerts = AlertStore(configured.path)
    logs = InferenceLogStore(tmp_path / "hybrid-logs.db")
    receiver = Receiver(lambda *args: None, config, detection_store=configured, alert_store=alerts, log_store=logs)
    receiver.hooks = []
    receiver.processor = HybridProcessor(lambda: models)
    session = Session(pc=_RTSPPeer(), source_id="cam", buffer=HybridBuffer(config), alert_policy=HybridContext(config))
    receiver.sessions[session.id] = session
    return receiver, session, alerts, logs, models


def put(session, scores, first=1):
    for offset, score in enumerate(scores):
        number = first + offset
        session.buffer.queue.put_nowait((number, {"clip": score, "videomae": [0] * 4,
                                                  "timestamp": number * STEP, "epoch": 0}))


async def run(receiver, session):
    task = asyncio.create_task(receiver.process_windows(session))
    await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
    return task


async def stop(receiver, session, task):
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await receiver.close(session.id)


def test_vadclip_opens_and_closes_the_alert_and_videomae_sets_the_class(configured, tmp_path):
    receiver, session, alerts, logs, models = build(configured, tmp_path)

    async def exercise():
        # 4 normales (span listo), 6 altos, 4 bajos (suelta) y espera de unión de 1 s.
        put(session, [.1] * 4 + [.95] * 6 + [.1] * 8)
        task = await run(receiver, session)
        try:
            closed = alerts.list(status="closed")["items"]
            assert len(closed) == 1
            alert = closed[0]
            assert alert["timestamp_inicio"] == pytest.approx(6 * STEP)   # suavizado de 2: el 5 promedia 0,525
            # Suavizado de 2: el bloque 11 aún promedia 0,525; suelta en el 13 (tercer bajo).
            assert alert["timestamp_fin"] == pytest.approx(13 * STEP)
            assert alert["clase"] == "Agresión física"
            assert alert["confianza"] >= .85 and alert["threshold"] == .85
            assert receiver.hooks == [("opened", alert["id"], pytest.approx(6 * STEP)),
                                      ("finished", alert["id"], pytest.approx(13 * STEP), True, "closed")]
            detections = configured.list(limit=100)
            # VideoMAE: al abrir (6), cada 4 bloques (10) y al soltar (13); sin evento, Normal cada 4 bloques.
            assert models.classified == 3
            assert sorted(d["timestamp"] for d in detections if d["clase"] != "Normal") == \
                pytest.approx([6 * STEP, 10 * STEP, 13 * STEP])
            assert any(d["clase"] == "Normal" for d in detections)
            assert len(detections) <= 18 / 4 + 3 + 1
            assert alert["end_detection_id"] in {d["id"] for d in detections}
            assert session.latest_result["alert"]["active"] is False
            assert logs.list(event_type="alert_opened")["total"] == 1
            assert logs.list(event_type="alert_closed")["total"] == 1
        finally:
            await stop(receiver, session, task)

    asyncio.run(exercise())


def test_lost_block_while_closing_interrupts_at_the_vadclip_end(configured, tmp_path):
    receiver, session, alerts, logs, _ = build(configured, tmp_path, merge_gap=8.0)

    async def exercise():
        put(session, [.1] * 4 + [.95] * 6 + [.1] * 4)   # suelta en el bloque 13; espera 8 s
        task = await run(receiver, session)
        try:
            assert alerts.list(status="active")["total"] == 1
            assert session.latest_result["alert"]["closing"] is True
            put(session, [.1], first=20)                  # falta el 15..19: window_gap
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            interrupted = alerts.list(status="interrupted")["items"]
            assert len(interrupted) == 1
            assert interrupted[0]["interruption_reason"] == "window_gap"
            assert interrupted[0]["timestamp_fin"] == pytest.approx(13 * STEP)
            assert receiver.hooks[-1][2:] == (pytest.approx(13 * STEP), False, "window_gap")
        finally:
            await stop(receiver, session, task)

    asyncio.run(exercise())


def test_event_opened_before_videomae_span_starts_where_vadclip_detected(configured, tmp_path):
    receiver, session, alerts, logs, _ = build(configured, tmp_path)

    async def exercise():
        put(session, [.95] * 6)   # alto desde el bloque 1: VideoMAE recién puede correr en el 4
        task = await run(receiver, session)
        try:
            active = alerts.list(status="active")["items"]
            assert len(active) == 1
            assert active[0]["timestamp_inicio"] == pytest.approx(1 * STEP)
            assert configured.get(active[0]["detection_id"])["timestamp"] == pytest.approx(4 * STEP)
        finally:
            await stop(receiver, session, task)

    asyncio.run(exercise())


def test_processing_error_interrupts_and_resets(configured, tmp_path):
    receiver, session, alerts, logs, models = build(configured, tmp_path)

    def broken(frames):
        raise RuntimeError("GPU")

    async def exercise():
        put(session, [.1] * 4 + [.95] * 2)
        task = await run(receiver, session)
        try:
            assert alerts.list(status="active")["total"] == 1
            models.classify = broken
            put(session, [.95] * 4, first=7)   # VideoMAE toca en el bloque 10
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            assert session.processing_errors == 1
            assert alerts.list(status="interrupted")["items"][0]["interruption_reason"] == "processing_error"
        finally:
            await stop(receiver, session, task)

    asyncio.run(exercise())
