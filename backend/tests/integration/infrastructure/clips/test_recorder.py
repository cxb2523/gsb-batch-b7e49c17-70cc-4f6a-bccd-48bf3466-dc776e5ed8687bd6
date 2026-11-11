"""El grabador copia el tramo del evento sin recodificar y resiste cortes."""
import os
import shutil

import pytest

from app.infrastructure.clips.recorder import ClipRecorder
from app.infrastructure.clips.service import repair
from tests.support.video import duration, make_h264, packets


@pytest.fixture(scope="module")
def source(tmp_path_factory):
    # 10 s a 30 fps con un keyframe por segundo.
    return make_h264(tmp_path_factory.mktemp("video") / "fuente.mp4")


def feed(recorder, source, actions, until=None):
    """Pasa los paquetes al grabador y ejecuta cada acción cuando el video llega a su segundo."""
    container, video, stream = packets(source)
    recorder.configure(video)
    pending = sorted(actions.items())
    try:
        for packet in stream:
            time = float(packet.pts * packet.time_base)
            if until is not None and time > until:
                break
            while pending and time >= pending[0][0]:
                pending.pop(0)[1]()
            recorder.push(packet)
    finally:
        container.close()


def test_clip_includes_pre_roll_and_post_roll(tmp_path, source):
    closed = []
    recorder = ClipRecorder("cam", str(tmp_path), closed.append, pre_roll=5, post_roll=2)
    # La alerta se confirma a los 6 s (el evento empezó antes) y cierra a los 7 s.
    feed(recorder, source, {6.0: lambda: recorder.start("a1", 6.0), 7.5: lambda: recorder.stop("a1", 7.0)})
    assert [(r.alert_id, r.complete, r.reason) for r in closed] == [("a1", True, "closed")]
    assert closed[0].path.endswith("a1.mp4") and not os.path.exists(closed[0].path + ".part")
    frames, seconds = duration(closed[0].path)
    # Desde el keyframe de 1 s (6 - 5 de pre-roll) hasta 9 s (7 + 2 de post-roll).
    assert seconds == pytest.approx(8.0, abs=0.1)
    assert frames == pytest.approx(240, abs=3)


def test_interrupted_event_is_closed_at_once_as_partial(tmp_path, source):
    closed = []
    recorder = ClipRecorder("cam", str(tmp_path), closed.append, pre_roll=1)
    feed(recorder, source, {3.0: lambda: recorder.start("a2", 3.0), 5.0: lambda: recorder.interrupt("a2", "window_gap")})
    assert [(r.complete, r.reason) for r in closed] == [(False, "window_gap")]
    assert duration(closed[0].path)[1] == pytest.approx(3.0, abs=0.1)


@pytest.mark.parametrize("cause,expected", [("reconnect", "source_reconnected"), ("long", "max_duration")])
def test_reconnection_and_duration_cap_close_partial_clips(tmp_path, source, cause, expected):
    closed = []
    recorder = ClipRecorder("cam", str(tmp_path), closed.append, pre_roll=0, max_seconds=3 if cause == "long" else 300)
    actions = {1.0: lambda: recorder.start("a3", 1.0)}
    feed(recorder, source, actions, until=6.0)
    if cause == "reconnect":
        recorder.configure(None)  # nueva conexión: la línea temporal ya no sirve
    assert [(r.complete, r.reason) for r in closed] == [(False, expected)]


def test_overlapping_and_videoless_events(tmp_path, source):
    closed = []
    recorder = ClipRecorder("cam", str(tmp_path), closed.append, pre_roll=0, post_roll=5)
    recorder.start("sin_video", 0.0)
    recorder.stop("sin_video", 0.0)  # cerró antes de recibir un keyframe
    feed(recorder, source, {2.0: lambda: recorder.start("b1", 2.0), 3.0: lambda: recorder.stop("b1", 3.0),
                            4.0: lambda: recorder.start("b2", 4.0)})
    recorder.close()
    assert [(r.alert_id, r.complete, r.reason) for r in closed] == [
        ("sin_video", False, "no_video"), ("b1", True, "closed"), ("b2", False, "source_stopped")]


def test_clip_cut_by_a_crash_is_repaired(tmp_path, source):
    recorder = ClipRecorder("cam", str(tmp_path), lambda result: None, pre_roll=0)
    feed(recorder, source, {1.0: lambda: recorder.start("a4", 1.0)}, until=8.0)
    # Apagón: el proceso muere con el archivo abierto y cortado a la mitad de un fragmento.
    part = tmp_path / "a4.mp4.part"
    copy = tmp_path / "copia.mp4.part"
    shutil.copy(part, copy)
    data = copy.read_bytes()
    copy.write_bytes(data[: int(len(data) * 0.6)])
    fixed = tmp_path / "copia.mp4"
    assert repair(str(copy), str(fixed)) > 0
    frames, seconds = duration(fixed)
    assert frames > 30 and seconds > 1
    recorder.close()
