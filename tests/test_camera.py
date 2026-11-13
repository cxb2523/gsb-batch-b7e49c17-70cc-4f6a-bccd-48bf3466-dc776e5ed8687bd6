"""Locally verifiable tests for the on-demand camera hub (printdash/app/camera.py).

No real printer, no real ffmpeg, no network: ffmpeg is replaced by a fake
process factory, and the stream/measurement timing constants are shrunk so
the asynchronous lifecycle (shared stream, idle stop, snapshot fallback)
runs in well under a second.
"""
import asyncio
import io
import logging
import sys
import time

import pytest

from printdash.app import camera
from printdash.app.camera import (
    CameraHub,
    StreamMeter,
    clean_orient,
    orient_filters,
    orient_jpeg,
)

SOI, EOI = camera.SOI, camera.EOI


def jpeg_frame(tag: bytes = b"x") -> bytes:
    """A minimal 'JPEG' as far as the hub's SOI/EOI framing is concerned."""
    return SOI + b"\xff\xe0fake-jpeg-" + tag + EOI


def showinfo_line(pts: float, key: int) -> str:
    return (f"[info] n:   1 pts: 100 pts_time:{pts} pos: 42 "
            f"fmt:yuvj420p sar:1/1 iskey:{key}")


# -- fake ffmpeg -------------------------------------------------------------

class _FakeStdout:
    """Yields the given chunks in a loop, forever (a live stream never ends)."""

    def __init__(self, chunks, interval):
        self._chunks = chunks
        self._interval = interval
        self._i = 0

    async def read(self, n=-1):
        await asyncio.sleep(self._interval)
        chunk = self._chunks[self._i % len(self._chunks)]
        self._i += 1
        return chunk


class _FakeStderr:
    """Hands out the given info lines, then repeats them (the stream keeps
    reporting frames for as long as it runs)."""

    def __init__(self, lines, interval=0.01):
        self._lines = list(lines)
        self._interval = interval
        self._i = 0

    async def readline(self):
        await asyncio.sleep(self._interval)
        if not self._lines:
            return b""  # EOF: ffmpeg closed its info channel
        line = self._lines[self._i % len(self._lines)]
        self._i += 1
        return line.encode() + b"\n"


class FakeProc:
    def __init__(self, chunks, stderr_lines, interval):
        self.stdout = _FakeStdout(chunks, interval)
        self.stderr = _FakeStderr(stderr_lines)
        self.returncode = None
        self.killed = False
        self.waited = False

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        self.waited = True
        return self.returncode


class FakeFFmpeg:
    """Replacement for asyncio.create_subprocess_exec: records the command
    line and hands out fake processes instead of spawning real ffmpeg."""

    # NOTE: the interval must exceed the Windows asyncio clock resolution
    # (~15.6 ms); shorter sleeps return immediately on a busy loop and the
    # fake stream would spin instead of pacing frames.
    def __init__(self, chunks=None, stderr_lines=(), interval=0.03):
        self.chunks = chunks if chunks is not None else [jpeg_frame()]
        self.stderr_lines = list(stderr_lines)
        self.interval = interval
        self.calls = []   # every ffmpeg command line that was 'started'
        self.procs = []

    async def __call__(self, *args, **kwargs):
        self.calls.append(list(args))
        proc = FakeProc(self.chunks, list(self.stderr_lines), self.interval)
        self.procs.append(proc)
        return proc


@pytest.fixture
def ffmpeg_factory(monkeypatch):
    """Install a fake ffmpeg; returns a factory-configuring callable.
    Also keeps the measurement probe hermetic (no real `ffmpeg -h` call)."""
    monkeypatch.setattr(camera, "measure_available", lambda: False)

    def install(**kwargs):
        factory = FakeFFmpeg(**kwargs)
        monkeypatch.setattr(asyncio, "create_subprocess_exec", factory)
        return factory

    return install


# -- async helpers -----------------------------------------------------------

async def collect_frames(hub, out):
    """A viewer: appends every received frame until cancelled."""
    async for frame in hub.frames():
        out.append(frame)


async def wait_until(pred, interval=0.02):
    while not pred():
        await asyncio.sleep(interval)


async def stop_viewer(task):
    """Cancel a viewer task and wait for it without re-raising CancelledError."""
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def make_hub(**cam):
    cam.setdefault("id", "cam1")
    cam.setdefault("name", "Cam 1")
    cam.setdefault("url", "rtsp://printer.local/stream")
    return CameraHub(cam)


# -- 1. shared stream lifecycle ----------------------------------------------

async def test_two_viewers_share_one_stream_and_idle_stop_cleans_up(
        ffmpeg_factory, monkeypatch):
    monkeypatch.setattr(camera, "IDLE_STOP_SECONDS", 0.3)
    factory = ffmpeg_factory()
    hub = make_hub()

    first, second = [], []
    viewer1 = asyncio.create_task(collect_frames(hub, first))
    viewer2 = asyncio.create_task(collect_frames(hub, second))

    # both viewers receive frames ...
    await asyncio.wait_for(
        wait_until(lambda: len(first) >= 2 and len(second) >= 2), 5)
    # ... over a single underlying ffmpeg task/process
    assert len(factory.calls) == 1
    task = hub._task
    assert task is not None and not task.done()
    assert hub.info()["active"] is True

    # the first viewer leaves: the second keeps receiving frames undisturbed
    await stop_viewer(viewer1)
    got_before = len(second)
    await asyncio.wait_for(wait_until(lambda: len(second) >= got_before + 2), 5)
    assert len(factory.calls) == 1          # no new ffmpeg was started
    assert hub._task is task and not task.done()

    # the last viewer leaves: after the idle timeout the task ends and the
    # subprocess is killed and reaped
    await stop_viewer(viewer2)
    await asyncio.wait_for(wait_until(lambda: task.done()), 5)
    assert factory.procs[0].killed
    assert factory.procs[0].waited
    assert hub._proc is None
    assert hub.info()["active"] is False


async def test_compat_mode_uses_longer_idle_timeout(ffmpeg_factory, monkeypatch):
    monkeypatch.setattr(camera, "IDLE_STOP_SECONDS", 0.2)
    monkeypatch.setattr(camera, "COMPAT_IDLE_STOP_SECONDS", 0.6)
    factory = ffmpeg_factory()
    hub = make_hub(compat=True)
    assert hub.fps <= camera.COMPAT_MAX_FPS
    assert hub.width <= camera.COMPAT_MAX_WIDTH

    frames = []
    viewer = asyncio.create_task(collect_frames(hub, frames))
    await asyncio.wait_for(wait_until(lambda: len(frames) >= 1), 5)
    await stop_viewer(viewer)

    task = hub._task
    # past the normal idle timeout the compat stream must still be alive
    await asyncio.sleep(0.35)
    assert not task.done()
    # past the compat idle timeout it is stopped and cleaned up
    await asyncio.wait_for(wait_until(lambda: task.done()), 5)
    assert factory.procs[0].killed


# -- 2. snapshots --------------------------------------------------------------

async def test_snapshot_reuses_frame_younger_than_3_seconds(ffmpeg_factory):
    factory = ffmpeg_factory()
    hub = make_hub()
    hub.frame = b"cached-jpeg"
    hub.frame_at = time.time() - 2.9  # just inside the 3 s reuse window

    assert await hub.snapshot() == b"cached-jpeg"
    assert factory.calls == []          # no stream was started
    assert hub._task is None


async def test_snapshot_starts_stream_and_waits_for_new_frame(
        ffmpeg_factory, monkeypatch):
    monkeypatch.setattr(camera, "IDLE_STOP_SECONDS", 0.3)
    new_frame = jpeg_frame(b"snap")
    factory = ffmpeg_factory(chunks=[new_frame])
    hub = make_hub()
    hub.frame = b"old-jpeg"
    hub.frame_at = time.time() - 10     # stale: older than 3 s

    assert await hub.snapshot(timeout=5) == new_frame
    assert len(factory.calls) == 1

    # the stream must not stay resident once the snapshot is done
    task = hub._task
    await asyncio.wait_for(wait_until(lambda: task.done()), 5)
    assert factory.procs[0].killed
    assert hub._proc is None


async def test_snapshot_timeout_returns_existing_frame_or_none(ffmpeg_factory):
    # a 'stream' that never delivers a decodable JPEG
    factory = ffmpeg_factory(chunks=[b"garbage-without-jpeg-markers"])

    hub = make_hub(id="cam-old")
    hub.frame = b"previous-jpeg"
    hub.frame_at = 0                    # long stale
    assert await hub.snapshot(timeout=0.3) == b"previous-jpeg"

    hub_none = make_hub(id="cam-none")
    assert await hub_none.snapshot(timeout=0.3) is None

    assert len(factory.calls) == 2
    await hub.stop()
    await hub_none.stop()
    assert all(p.killed for p in factory.procs)


# -- 3. mirroring / rotation ---------------------------------------------------

def test_clean_orient_normalizes_and_drops_noops():
    assert clean_orient(None) is None
    assert clean_orient("sideways") is None
    assert clean_orient({}) is None
    assert clean_orient({"rotate": 0, "flip_h": False, "flip_v": False}) is None
    assert clean_orient({"rotate": 360}) is None          # full turn = no-op
    assert clean_orient({"rotate": 45}) is None           # not a quarter turn
    assert clean_orient({"rotate": "90"}) == {"rotate": 90, "flip_h": False, "flip_v": False}
    assert clean_orient({"rotate": "junk", "flip_v": 1}) == {"rotate": 0, "flip_h": False, "flip_v": True}


def test_orient_filters_mirror_first_then_rotate_clockwise():
    assert orient_filters(None) == []
    assert orient_filters({"rotate": 0, "flip_h": True, "flip_v": False}) == ["hflip"]
    assert orient_filters({"rotate": 0, "flip_h": False, "flip_v": True}) == ["vflip"]
    assert orient_filters({"rotate": 90, "flip_h": True, "flip_v": True}) == [
        "hflip", "vflip", "transpose=1"]
    assert orient_filters({"rotate": 180, "flip_h": False, "flip_v": False}) == ["hflip", "vflip"]
    assert orient_filters({"rotate": 270, "flip_h": True, "flip_v": False}) == [
        "hflip", "transpose=2"]


def test_ffmpeg_args_apply_orient_and_measurement(monkeypatch):
    monkeypatch.setattr(camera, "measure_available", lambda: True)
    hub = make_hub(orient={"rotate": 90, "flip_h": True})
    args = hub._ffmpeg_args()

    assert args[0] == "ffmpeg"
    assert "-rtsp_transport" in args                    # tcp for rtsp
    vf = args[args.index("-vf") + 1]
    # measurement filter first, then mirror, then clockwise rotation, then scale
    assert vf.startswith("showinfo=checksum=0,")
    assert vf.index("hflip") < vf.index("transpose=1") < vf.index("scale")
    assert "scale='min(1280,iw)':-2" in vf
    assert args[args.index("-r") + 1] == "10"


def test_ffmpeg_args_compat_mode_ignores_printer_timestamps(monkeypatch):
    monkeypatch.setattr(camera, "measure_available", lambda: True)
    hub = CameraHub({"id": "c2", "url": "rtsp://x", "compat": True}, fps=30, width=1920)
    assert hub.fps == camera.COMPAT_MAX_FPS == 5
    assert hub.width == camera.COMPAT_MAX_WIDTH == 960

    args = hub._ffmpeg_args()
    # broken printer timestamps are replaced by the arrival time ...
    assert "-use_wallclock_as_timestamps" in args
    assert args[args.index("-use_wallclock_as_timestamps") + 1] == "1"
    assert "-reorder_queue_size" in args
    # ... and the stream is probed only briefly so the first frame comes faster
    assert args[args.index("-probesize") + 1] == "500000"
    assert args[args.index("-analyzeduration") + 1] == "1000000"
    assert "-max_delay" in args
    vf = args[args.index("-vf") + 1]
    assert "scale='min(960,iw)':-2" in vf
    assert args[args.index("-r") + 1] == "5"


def _quadrant_jpeg():
    """64x32 JPEG: red top-left quadrant, white elsewhere."""
    from PIL import Image
    img = Image.new("RGB", (64, 32), (255, 255, 255))
    for x in range(32):
        for y in range(16):
            img.putpixel((x, y), (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=95)
    return buf.getvalue()


def _pixel(data, xy):
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGB")
    return img.getpixel(xy)


def _is_red(px):
    r, g, b = px
    return r > 180 and g < 90 and b < 90


def _is_white(px):
    return all(c > 200 for c in px)


def test_orient_jpeg_mirror_and_rotate_with_pillow():
    pytest.importorskip("PIL")
    src = _quadrant_jpeg()

    flipped = orient_jpeg(src, {"rotate": 0, "flip_h": True, "flip_v": False})
    assert _is_red(_pixel(flipped, (48, 8)))      # red moved to the top right
    assert _is_white(_pixel(flipped, (16, 8)))

    rotated = orient_jpeg(src, {"rotate": 90, "flip_h": False, "flip_v": False})
    # clockwise 90°: 64x32 -> 32x64, red top-left quadrant -> top right
    assert _is_red(_pixel(rotated, (24, 16)))
    assert _is_white(_pixel(rotated, (8, 48)))

    both = orient_jpeg(src, {"rotate": 90, "flip_h": True, "flip_v": False})
    # mirror first, then rotate clockwise (same order as the ffmpeg filters):
    # red ends up in the bottom-right quadrant of the 32x64 image
    assert _is_red(_pixel(both, (24, 48)))
    assert _is_white(_pixel(both, (8, 16)))


def test_orient_jpeg_returns_data_unchanged_without_orient_or_on_damage():
    data = b"\xff\xd8not-really-a-jpeg\xff\xd9"
    assert orient_jpeg(data, None) is data
    # broken image: returned as it came instead of raising
    assert orient_jpeg(data, {"rotate": 90, "flip_h": True, "flip_v": False}) == data


def test_orient_jpeg_without_pillow_returns_data_and_warns(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, "PIL", None)   # `from PIL import ...` fails
    monkeypatch.setattr(camera, "_pil_warned", False)
    data = b"\xff\xd8jpeg-bytes\xff\xd9"
    with caplog.at_level(logging.WARNING, logger="printdash.camera"):
        assert orient_jpeg(data, {"rotate": 180, "flip_h": False, "flip_v": False}) == data
    assert "Pillow" in caplog.text


# -- 4. measurement / logging --------------------------------------------------

def test_stream_meter_counts_frames_keyframes_and_timestamp_jumps():
    meter = StreamMeter(started=100.0)
    assert meter.feed("Input #0, rtsp, from 'rtsp://cam':", 100.5) is False
    assert meter.ready_at == 100.5
    meter.feed("Stream #0:0: Video: h264, yuvj420p(progressive), 1280x720, 25 fps, 25 tbr", 100.6)
    assert meter.codec == "h264"
    assert meter.size == "1280x720"
    assert meter.fps == "25"

    t = 101.0
    meter.feed(showinfo_line(0.0, 1), t)            # first decoded image
    meter.feed(showinfo_line(1.0, 0), t + 1)
    meter.feed(showinfo_line(2.0, 1), t + 10)       # next keyframe 10 s later
    meter.feed(showinfo_line(6.0, 0), t + 11)       # pts jumps ahead by 4 s
    meter.feed(showinfo_line(1.0, 0), t + 12)       # pts goes backwards
    assert meter.frames == 5
    assert meter.jumps == 2

    # measurement completes once MEASURE_SECONDS have passed since the first frame
    assert meter.feed(showinfo_line(2.0, 0), t + camera.MEASURE_SECONDS) is True
    assert meter.done
    assert meter.feed(showinfo_line(3.0, 0), t + 40) is False  # already done

    summary = meter.summary(t + 31)
    assert "1280x720 h264" in summary
    assert "announced 25 fps" in summary
    assert "images/s" in summary
    assert "full image every 10.0 s" in summary
    assert "timestamp jumps: 2" in summary
    assert "stream ready after 0.5 s" in summary
    assert "first image after 1.0 s" in summary


def test_stream_meter_compat_mode_marks_printer_timestamps_ignored():
    meter = StreamMeter(started=0.0, own_clock=True)
    meter.feed(showinfo_line(0.0, 1), 1.0)
    summary = meter.summary(2.0)
    assert "printer timestamps ignored" in summary
    assert "timestamp jumps" not in summary


async def test_measurement_and_first_image_are_logged(
        ffmpeg_factory, monkeypatch, caplog):
    monkeypatch.setattr(camera, "MEASURE_SECONDS", 0.2)
    monkeypatch.setattr(camera, "IDLE_STOP_SECONDS", 0.3)
    monkeypatch.setattr(camera, "COMPAT_IDLE_STOP_SECONDS", 0.3)
    monkeypatch.setattr(camera, "measure_available", lambda: True)
    stderr = ["Input #0, rtsp, from 'rtsp://printer.local/stream':",
              "Stream #0:0: Video: h264, yuvj420p(progressive), 1280x720, 25 fps, 25 tbr"]
    stderr += [showinfo_line(i * 0.04, 1 if i % 25 == 0 else 0) for i in range(400)]
    factory = ffmpeg_factory(stderr_lines=stderr)
    hub = make_hub(compat=True)

    frames = []
    with caplog.at_level(logging.INFO, logger="printdash.camera"):
        viewer = asyncio.create_task(collect_frames(hub, frames))
        await asyncio.wait_for(wait_until(
            lambda: any("measurement" in r.getMessage() for r in caplog.records)), 5)
        await stop_viewer(viewer)
        await asyncio.wait_for(wait_until(lambda: hub._task.done()), 5)

    messages = [r.getMessage() for r in caplog.records]
    # first-frame timing is logged, marked as compatibility mode
    assert any("first image after" in m and "compatibility mode" in m for m in messages)
    # the ~30 s measurement line is logged and notes the ignored printer timestamps
    measurement = next(m for m in messages if "measurement" in m)
    assert "printer timestamps ignored" in measurement
    assert "images/s" in measurement
    assert factory.procs[0].killed


async def test_early_stop_logs_partial_measurement(
        ffmpeg_factory, monkeypatch, caplog):
    # measurement window stays at the real 30 s, so a short viewing session
    # ends before it completes and the partial numbers are logged instead
    monkeypatch.setattr(camera, "IDLE_STOP_SECONDS", 0.2)
    monkeypatch.setattr(camera, "measure_available", lambda: True)
    stderr = ["Input #0, rtsp, from 'rtsp://printer.local/stream':",
              "Stream #0:0: Video: h264, yuvj420p(progressive), 1280x720, 25 fps, 25 tbr",
              showinfo_line(0.0, 1), showinfo_line(0.04, 0)]
    factory = ffmpeg_factory(stderr_lines=stderr)
    hub = make_hub()  # normal mode: printer timestamps are analysed

    frames = []
    with caplog.at_level(logging.INFO, logger="printdash.camera"):
        viewer = asyncio.create_task(collect_frames(hub, frames))
        await asyncio.wait_for(wait_until(lambda: len(frames) >= 1), 5)
        await stop_viewer(viewer)
        await asyncio.wait_for(wait_until(lambda: hub._task.done()), 5)

    messages = [r.getMessage() for r in caplog.records]
    assert any("first image after" in m and "compatibility" not in m for m in messages)
    stopped = next(m for m in messages if "measurement (stopped early)" in m)
    assert "timestamp jumps" in stopped
    assert factory.procs[0].killed
