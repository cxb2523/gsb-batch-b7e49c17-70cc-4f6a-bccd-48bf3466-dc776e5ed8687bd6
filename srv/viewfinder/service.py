"""Viewfinder frame service and camera backends.

The service runs a single background thread that owns the camera.  It always
keeps the *latest* JPEG frame in memory for the MJPEG feed.  The design
guarantees:

* On camera open failure the service moves to ``failed`` and records a
  structured reason (e.g. device busy / init exception); no placeholder
  frames are ever produced.
* While running, only genuinely new frames from the backend update
  ``last_frame_at`` - a stalled backend can never refresh the frame time.
* A stall is derived from real frame arrival times, so a frozen camera
  cannot masquerade as a live picture.
* Retry (re-open) is explicit and restores the stream when it succeeds.

Two backends are provided:

* :class:`FakeBackend` - pure-PIL frame generator used for local tests and
  demos, with injectable failures / stalls (no hardware needed).
* :class:`PicameraBackend` - real Raspberry Pi camera backend using
  ``picamerax``; imported lazily so this module works off-device.

Configuration is read from environment variables (set at service creation):

GONZO_VF_BACKEND         ``fake`` (default off-device) or ``picamera``
GONZO_VF_RESOLUTION      e.g. ``640x480`` (default)
GONZO_VF_FPS             target frames per second (default 24)
GONZO_VF_STALL_TIMEOUT   seconds without a new frame before "paused" (3)
GONZO_VF_FAIL_MODE       fake backend failure injection, see FakeBackend
GONZO_VF_FAIL_AFTER      fake backend: fail after N frames
"""

import io
import os
import threading
import time

from PIL import Image, ImageDraw

# Service lifecycle states
STATE_STARTING = 'starting'
STATE_RUNNING = 'running'
STATE_FAILED = 'failed'
STATE_STOPPED = 'stopped'

# Structured failure codes, mapped to user-facing text on the page.
FAIL_DEVICE_BUSY = 'device_busy'
FAIL_INIT = 'init_failed'
FAIL_RUNTIME = 'runtime_error'
FAIL_BACKEND_UNAVAILABLE = 'backend_unavailable'

BOUNDARY = b'--gonzovf'


class ViewfinderError(Exception):
    """Base class for viewfinder backend errors."""

    code = FAIL_INIT

    def __init__(self, message, code=None):
        super().__init__(message)
        if code is not None:
            self.code = code


class CameraBusyError(ViewfinderError):
    """The camera device is already in use by another process."""

    code = FAIL_DEVICE_BUSY


class CameraInitError(ViewfinderError):
    """Camera initialization failed for any other reason."""

    code = FAIL_INIT


class CameraRuntimeError(ViewfinderError):
    """A successfully opened camera stopped producing frames / died."""

    code = FAIL_RUNTIME


def parse_resolution(value, default=(640, 480)):
    try:
        width, height = value.lower().split('x')
        width, height = int(width), int(height)
        if width > 0 and height > 0:
            return (width, height)
    except (AttributeError, ValueError):
        pass
    return default


class FakeBackend:
    """Software camera backend: synthesises JPEG frames with PIL.

    ``fail_mode`` supports (also selectable via GONZO_VF_FAIL_MODE):

    * ``none``            - normal operation
    * ``busy``            - open() raises CameraBusyError (device occupied)
    * ``init``            - open() raises CameraInitError (init exception)
    * ``stall``           - opens fine, then read_frame() blocks forever
                            (simulates a camera that stops delivering frames)
    * ``runtime:<n>``     - opens fine, raises CameraRuntimeError after n
                            frames (default n = GONZO_VF_FAIL_AFTER or 5)
    """

    name = 'fake'

    def __init__(self, resolution=(640, 480), fps=24, fail_mode='none',
                 fail_after=5):
        self.resolution = tuple(resolution)
        self.fps = int(fps)
        self.fail_mode = fail_mode
        self.fail_after = int(fail_after)
        self._frame_no = 0
        # Pause gate: set while the camera is stalled, cleared by resume().
        self._paused = threading.Event()
        if fail_mode == 'stall':
            self._paused.set()
        self._closed = False

    # -- test / simulation helpers ----------------------------------------

    def resume(self):
        """Release a simulated stall; frames start flowing again."""
        self.fail_mode = 'none'
        self._paused.clear()

    def stall(self):
        """Freeze frame delivery at any point during the run."""
        self.fail_mode = 'stall'
        self._paused.set()

    def inject_runtime_failure(self, after=0):
        """Make the next read_frame() (or after ``after`` more frames) fail."""
        self.fail_mode = 'runtime:%d' % max(0, after)

    # -- backend interface -------------------------------------------------

    def open(self):
        if self.fail_mode == 'busy':
            raise CameraBusyError(
                'camera device is already in use by another process')
        if self.fail_mode == 'init':
            raise CameraInitError('camera initialization failed: '
                                  'simulated init exception')
        self._closed = False

    def read_frame(self):
        """Return one complete JPEG frame as bytes."""
        if self.fail_mode.startswith('runtime'):
            try:
                after = int(self.fail_mode.split(':', 1)[1])
            except (IndexError, ValueError):
                after = self.fail_after
            if self._frame_no >= after:
                raise CameraRuntimeError(
                    'camera stopped delivering frames (injected)')

        if self.fail_mode == 'stall':
            # Block until resume() clears the pause gate or close(); never
            # hand back an old frame. The stall persists across read_frame()
            # calls so a camera that never produces a first frame stays
            # genuinely frozen. Note Event.wait() returns True while the
            # event is SET, so we must not break on that return value.
            while self._paused.is_set() and not self._closed:
                self._paused.wait(timeout=0.2)
            if self._closed:
                raise CameraRuntimeError('camera closed while stalled')

        frame = self._render(self._frame_no)
        self._frame_no += 1
        return frame

    def close(self):
        self._closed = True
        self._paused.set()

    def _render(self, frame_no):
        image = Image.new('RGB', self.resolution, (18, 18, 24))
        draw = ImageDraw.Draw(image)
        width, height = self.resolution
        # A moving block so consecutive frames are visibly different and the
        # bytes differ - tests can prove the frame time really advances.
        x = int((frame_no * 8) % max(1, width - 60))
        draw.rectangle([x, height // 2 - 20, x + 60, height // 2 + 20],
                       fill=(252, 214, 18))
        draw.text((10, 10), 'Gonzo Pi fake camera frame %d' % frame_no,
                  fill=(240, 240, 240))
        draw.text((10, height - 24),
                  '%dx%d @ %dfps' % (width, height, self.fps),
                  fill=(180, 180, 180))
        buf = io.BytesIO()
        image.save(buf, format='JPEG', quality=70)
        return buf.getvalue()


class PicameraBackend:
    """Real Raspberry Pi camera backend (picamerax / legacy picamera API)."""

    name = 'picamera'

    def __init__(self, resolution=(640, 480), fps=24):
        self.resolution = tuple(resolution)
        self.fps = int(fps)
        self._camera = None
        self._stream = None

    def open(self):
        try:
            import picamerax as picamera  # lazy: unavailable off-device
        except ImportError:
            try:
                import picamera
            except ImportError as exc:
                raise ViewfinderError(
                    'picamera library is not available on this system: %s'
                    % exc, code=FAIL_BACKEND_UNAVAILABLE)
        try:
            camera = picamera.PiCamera()
            camera.resolution = self.resolution
            camera.framerate = self.fps
            self._stream = io.BytesIO()
            # Prime the camera so the first capture does not return a blank.
            time.sleep(0.2)
            self._camera = camera
        except Exception as exc:  # pragma: no cover - needs real hardware
            self.close()
            raise _classify_open_error(exc)

    def read_frame(self):
        if self._camera is None:  # pragma: no cover - defensive
            raise CameraRuntimeError('camera is not open')
        try:
            stream = self._stream
            stream.seek(0)
            stream.truncate()
            self._camera.capture(stream, format='jpeg',
                                 use_video_port=True)
            return stream.getvalue()
        except Exception as exc:  # pragma: no cover - needs real hardware
            raise CameraRuntimeError('camera frame capture failed: %s' % exc)

    def close(self):
        if self._camera is not None:  # pragma: no cover - hardware only
            try:
                self._camera.close()
            except Exception:
                pass
        self._camera = None
        self._stream = None


def _classify_open_error(exc):
    """Turn a picamera open exception into a structured viewfinder error."""
    text = str(exc).lower()
    busy_markers = (
        'mmal', 'in use', 'already', 'resource busy', 'device or resource',
        'no data received', 'cannot identify', 'permission denied',
        'busy',
    )
    # "No data received" / ENOSPC style mmal errors usually mean another
    # process (or a previous instance) still holds the camera.
    if any(marker in text for marker in busy_markers):
        return CameraBusyError('camera device busy or unavailable: %s' % exc)
    return CameraInitError('camera initialization failed: %s' % exc)


class ViewfinderService:
    """Owns the camera thread and exposes state / latest frame / feed."""

    def __init__(self, backend, resolution=(640, 480), fps=24,
                 stall_timeout=3.0):
        self.backend = backend
        self.resolution = tuple(resolution)
        self.fps = int(fps)
        self.stall_timeout = float(stall_timeout)

        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._thread = None
        self._stop_event = threading.Event()

        self.state = STATE_STOPPED
        self.latest_frame = None
        self.latest_frame_seq = 0
        self.latest_frame_at = None        # wall clock, for display
        self.latest_frame_mono = None      # monotonic clock, for stall math
        self.last_error = None             # dict: code/message/at
        self.started_at = None
        self.started_mono = None
        # Set the first time the camera thread is (re)started. Auto-start
        # on first page view uses this to avoid resurrecting a camera that
        # has explicitly failed - only the retry button may do that.
        self.ever_started = False

    # -- lifecycle ---------------------------------------------------------

    def ensure_running(self):
        """Auto-start the camera thread on first use only.

        A camera that has already been opened and failed is never
        resurrected here: the operator must press the explicit Retry
        control (:meth:`start`). This keeps a device-busy error visible
        instead of being hidden behind endless silent re-open attempts.
        """
        with self._lock:
            if self.ever_started:
                return
            self._start_locked()

    def start(self):
        """(Re)open the camera. Used both for auto-start and manual retry."""
        with self._lock:
            self._stop_locked()
            self._start_locked()

    retry = start

    def stop(self):
        with self._lock:
            self._stop_locked()
            self.state = STATE_STOPPED

    def _start_locked(self):
        self.ever_started = True
        self._stop_event = threading.Event()
        self.state = STATE_STARTING
        self.started_at = time.time()
        self.started_mono = time.monotonic()
        # A retry clears the visible failure only once the new backend
        # actually delivers a frame; the previous reason stays readable
        # until then via last_error (but state is no longer "failed").
        self._thread = threading.Thread(
            target=self._produce, name='viewfinder-camera', daemon=True)
        self._thread.start()

    def _stop_locked(self):
        if self._thread is not None and self._thread.is_alive():
            self._stop_event.set()
            try:
                self.backend.close()
            except Exception:
                pass
            self._thread.join(timeout=2.0)
        self._thread = None

    # -- producer thread ---------------------------------------------------

    def _produce(self):
        frame_interval = 1.0 / max(1, self.fps)
        try:
            self.backend.open()
        except ViewfinderError as exc:
            self._record_failure(exc.code, str(exc))
            return
        except Exception as exc:
            self._record_failure(FAIL_INIT, str(exc))
            return
        try:
            while not self._stop_event.is_set():
                frame = self.backend.read_frame()
                if not frame:
                    # Backend returned empty data: never treat it as a frame.
                    raise CameraRuntimeError(
                        'camera backend returned an empty frame')
                self._publish_frame(frame)
                if self._stop_event.wait(frame_interval):
                    break
        except ViewfinderError as exc:
            if not self._stop_event.is_set():
                self._record_failure(exc.code, str(exc))
        except Exception as exc:
            if not self._stop_event.is_set():
                self._record_failure(FAIL_RUNTIME, str(exc))
        finally:
            try:
                self.backend.close()
            except Exception:
                pass
            with self._lock:
                if self.state != STATE_FAILED:
                    self.state = STATE_STOPPED
                self._condition.notify_all()

    def _publish_frame(self, frame):
        with self._condition:
            self.latest_frame = frame
            self.latest_frame_seq += 1
            now = time.time()
            # ONLY a real backend frame can move the frame timestamps.
            self.latest_frame_at = now
            self.latest_frame_mono = time.monotonic()
            if self.state != STATE_RUNNING:
                self.state = STATE_RUNNING
                # First successful frame after a retry clears the old error.
                self.last_error = None
            self._condition.notify_all()

    def _record_failure(self, code, message):
        with self._condition:
            self.state = STATE_FAILED
            self.last_error = {
                'code': code,
                'message': message,
                'at': time.time(),
            }
            self._condition.notify_all()

    # -- feed / snapshot API ----------------------------------------------

    def wait_until_settled(self, timeout=3.0):
        """Block until startup resolves to running or failed.

        Returns the settled state name, or the current state on timeout.
        Lets an HTTP client decide the right response instead of racing
        the camera-open thread.
        """
        deadline = time.monotonic() + timeout
        with self._condition:
            while self.state == STATE_STARTING:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(timeout=min(remaining, 0.5))
            return self.state

    def wait_for_frame(self, last_seq, timeout=10.0):
        """Block until a frame newer than ``last_seq`` is available.

        Returns ``(frame_bytes, seq)`` or ``(None, last_seq)`` on timeout.
        Stalled backends simply time out - they cannot replay old frames.
        """
        deadline = time.monotonic() + timeout
        with self._condition:
            while self.latest_frame_seq == last_seq:
                if self.state == STATE_FAILED or self.state == STATE_STOPPED:
                    return None, self.latest_frame_seq
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None, self.latest_frame_seq
                self._condition.wait(timeout=min(remaining, 1.0))
            return self.latest_frame, self.latest_frame_seq

    def is_stalled(self):
        """True when no new frame arrived within the timeout.

        Applies both to a running camera that froze and to a camera still
        marked ``starting`` whose very first frame never arrives within
        the stall timeout - the page must show "waiting for frames" in
        either case rather than an indefinite blank/starting screen.
        """
        with self._lock:
            if self.state not in (STATE_RUNNING, STATE_STARTING):
                return False
            if self.latest_frame_mono is None:
                # No frame yet: measure the wait against the monotonic
                # start time so the two clocks can never disagree.
                reference = self.started_mono or time.monotonic()
                return (time.monotonic() - reference) > self.stall_timeout
            return (time.monotonic() - self.latest_frame_mono
                    > self.stall_timeout)

    def snapshot(self):
        """Plain-dict status for the /viewfinder/status JSON endpoint."""
        with self._lock:
            stalled = self.is_stalled()
            return {
                'state': self.state,
                'stalled': stalled,
                'resolution': '%dx%d' % self.resolution,
                'fps': self.fps,
                'stall_timeout': self.stall_timeout,
                'frame_seq': self.latest_frame_seq,
                'last_frame_at': self.latest_frame_at,
                'last_error': dict(self.last_error) if self.last_error
                else None,
            }


# --------------------------------------------------------------------------
# Environment-driven singleton used by the web layer
# --------------------------------------------------------------------------

_service_lock = threading.Lock()
_service = None


def _build_service_from_env():
    backend_name = os.environ.get('GONZO_VF_BACKEND', 'fake').strip().lower()
    resolution = parse_resolution(
        os.environ.get('GONZO_VF_RESOLUTION', '640x480'))
    try:
        fps = int(os.environ.get('GONZO_VF_FPS', '24'))
        if fps <= 0:
            fps = 24
    except ValueError:
        fps = 24
    try:
        stall_timeout = float(
            os.environ.get('GONZO_VF_STALL_TIMEOUT', '3'))
    except ValueError:
        stall_timeout = 3.0

    if backend_name == 'picamera':
        backend = PicameraBackend(resolution=resolution, fps=fps)
    else:
        fail_mode = os.environ.get('GONZO_VF_FAIL_MODE', 'none')
        try:
            fail_after = int(os.environ.get('GONZO_VF_FAIL_AFTER', '5'))
        except ValueError:
            fail_after = 5
        backend = FakeBackend(resolution=resolution, fps=fps,
                              fail_mode=fail_mode, fail_after=fail_after)
    return ViewfinderService(backend, resolution=resolution, fps=fps,
                             stall_timeout=stall_timeout)


def get_service():
    """Return the process-wide viewfinder service, creating it on demand."""
    global _service
    with _service_lock:
        if _service is None:
            _service = _build_service_from_env()
        return _service


def reset_service(service=None):
    """Replace the singleton (tests) or tear it down (service=None)."""
    global _service
    with _service_lock:
        if _service is not None:
            _service.stop()
        _service = service
    return service
