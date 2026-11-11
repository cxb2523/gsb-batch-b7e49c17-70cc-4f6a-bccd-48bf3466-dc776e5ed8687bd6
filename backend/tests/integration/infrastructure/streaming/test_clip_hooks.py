"""Las alertas abren, cierran e interrumpen el clip de su cámara sin frenar la inferencia."""
import asyncio

from app.domain.alerts import EventPolicy
from app.domain.pipeline import PipelineConfig, WindowBuffer
from app.infrastructure.persistence.alerts import AlertStore
from app.infrastructure.streaming.rtsp import RTSPReceiver, _RTSPPeer
from app.infrastructure.streaming.webrtc import Session


class FakeRecorder:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def start(self, alert_id, timestamp):
        if self.fail:
            raise OSError("disco lleno")
        self.calls.append(("start", timestamp))

    def stop(self, alert_id, timestamp):
        self.calls.append(("stop", timestamp))

    def interrupt(self, alert_id, reason):
        self.calls.append(("interrupt", reason))

    def close(self, reason="source_stopped"):
        self.calls.append(("close", reason))


class FakeClips:
    def __init__(self):
        self.begun = []

    def begin(self, alert_id, camera):
        self.begun.append(camera)


def run(configured, labels, numbers, recorder):
    async def exercise():
        alerts = AlertStore(configured.path)
        clips = FakeClips()
        receiver = RTSPReceiver(lambda *args: None, detection_store=configured, alert_store=alerts, clips=clips,
                                predict_frames=lambda frames, timestamp: {
                                    "clase": labels[int(timestamp)], "confianza": .95,
                                    "timestamp": timestamp, "simulated": True})
        session = Session(pc=_RTSPPeer(), source_id="cam", buffer=WindowBuffer(PipelineConfig(queue_size=4)),
                          alert_policy=EventPolicy())
        session.clip_recorder = recorder
        receiver.sessions[session.id] = session
        task = asyncio.create_task(receiver.process_windows(session))
        try:
            numbers_left = list(numbers)
            while numbers_left:  # la cola admite 4 ventanas
                for number in numbers_left[:4]:
                    session.buffer.queue.put_nowait((number, [(object(), float(number))]))
                numbers_left = numbers_left[4:]
                await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
            return clips, alerts, session
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await receiver.close(session.id)

    return asyncio.run(exercise())


def test_closed_event_starts_and_stops_its_clip(configured):
    # Ventanas 1-3 Hurto (abre en la 2), 4-6 Normal (cierra en la 6).
    labels = {1: "Hurto", 2: "Hurto", 3: "Hurto", 4: "Normal", 5: "Normal", 6: "Normal"}
    recorder = FakeRecorder()
    clips, alerts, _ = run(configured, labels, range(1, 7), recorder)
    assert clips.begun == ["cam"]
    assert recorder.calls[:2] == [("start", 2.0), ("stop", 6.0)]
    assert alerts.list(status="closed")["total"] == 1


def test_window_gap_interrupts_the_clip(configured):
    labels = {1: "Hurto", 2: "Hurto", 4: "Hurto"}
    recorder = FakeRecorder()
    run(configured, labels, (1, 2, 4), recorder)
    assert recorder.calls[:2] == [("start", 2.0), ("interrupt", "window_gap")]


def test_clip_failure_does_not_lose_the_alert(configured):
    labels = {1: "Hurto", 2: "Hurto", 3: "Hurto"}
    _, alerts, session = run(configured, labels, (1, 2, 3), FakeRecorder(fail=True))
    # La alerta se guardó igual (al cerrar la sesión de prueba queda interrumpida).
    assert alerts.list()["total"] == 1
    assert session.windows_processed == 3 and session.processing_errors == 0
