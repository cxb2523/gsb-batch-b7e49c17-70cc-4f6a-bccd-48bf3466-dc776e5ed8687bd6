#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Acceptance tests for the Gonzo Pi web viewfinder degradation states.

Runs fully offline with the fake camera backend - no hardware required.

Run from the srv/ directory:

    python -I -m unittest viewfinder.tests.test_viewfinder -v

or from the repo root:

    python -I -m unittest discover -s srv -v
"""

import json
import os
import threading
import time
import unittest
import urllib.request
from urllib.error import HTTPError, URLError
from wsgiref.simple_server import WSGIRequestHandler, make_server

# Make the viewfinder package importable when this file is run directly.
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from viewfinder.service import (  # noqa: E402
    CameraBusyError,
    CameraInitError,
    CameraRuntimeError,
    FakeBackend,
    STATE_FAILED,
    STATE_RUNNING,
    STATE_STARTING,
    STATE_STOPPED,
    ViewfinderService,
    reset_service,
)
import viewfinder.webapp as webapp  # noqa: E402


def wait_until(predicate, timeout=5.0, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def make_service(fail_mode='none', stall_timeout=0.6, fps=24,
                 resolution=(320, 240), fail_after=5):
    backend = FakeBackend(resolution=resolution, fps=fps,
                          fail_mode=fail_mode, fail_after=fail_after)
    service = ViewfinderService(backend, resolution=resolution, fps=fps,
                                stall_timeout=stall_timeout)
    reset_service(service)
    # Mimic a camera the operator has already opened. The /status endpoint
    # deliberately never auto-starts a camera, so tests start explicitly.
    service.start()
    return service, backend


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):  # silence test server access log
        pass


class HttpHarness:
    """Start the real web.py WSGI app on an ephemeral localhost port."""

    def __init__(self):
        self.httpd = None
        self.thread = None
        self.base = None

    def __enter__(self):
        app = webapp.make_app().wsgifunc()
        # Bind directly to port 0 so the OS atomically assigns a free port
        # (probing first then re-binding would race on Windows where ports
        # can be handed out again before make_server runs).
        self.httpd = make_server('127.0.0.1', 0, app,
                                 handler_class=QuietHandler)
        port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever,
                                       daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:%d' % port
        return self

    def get(self, path, timeout=5):
        req = urllib.request.Request(self.base + path)
        return urllib.request.urlopen(req, timeout=timeout)

    def post(self, path, timeout=5):
        req = urllib.request.Request(self.base + path, method='POST',
                                     data=b'')
        return urllib.request.urlopen(req, timeout=timeout)

    def get_bytes(self, path, limit=200000, timeout=8):
        """Read up to ``limit`` raw bytes from a (streaming) GET."""
        req = urllib.request.Request(self.base + path)
        resp = urllib.request.urlopen(req, timeout=timeout)
        chunks = []
        total = 0
        while total < limit:
            chunk = resp.read(4096)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        resp.close()
        return b''.join(chunks), resp.status, resp.headers

    def __exit__(self, *exc):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()


class ServiceStateTests(unittest.TestCase):

    def tearDown(self):
        reset_service(None)

    def test_happy_path_running_and_advancing_frames(self):
        service, _ = make_service()
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING))
            snap = service.snapshot()
            self.assertEqual(snap['resolution'], '320x240')
            self.assertEqual(snap['fps'], 24)
            self.assertFalse(snap['stalled'])
            self.assertGreater(snap['frame_seq'], 0)
            self.assertIsNotNone(snap['last_frame_at'])
        finally:
            service.stop()
        self.assertEqual(service.snapshot()['state'], STATE_STOPPED)

    def test_device_busy_records_failure_reason(self):
        service, backend = make_service(fail_mode='busy')
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_FAILED))
            snap = service.snapshot()
            self.assertEqual(snap['last_error']['code'], 'device_busy')
            self.assertIn('already in use', snap['last_error']['message'])
            # A failed camera never produced a frame.
            self.assertIsNone(snap['last_frame_at'])
            self.assertEqual(snap['frame_seq'], 0)
        finally:
            service.stop()

    def test_init_failure_records_failure_reason(self):
        service, _ = make_service(fail_mode='init')
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_FAILED))
            snap = service.snapshot()
            self.assertEqual(snap['last_error']['code'], 'init_failed')
        finally:
            service.stop()

    def test_retry_recovers_after_failure(self):
        # Backend fails on first open; swapping in a healthy backend before
        # retry models the operator freeing the camera and retrying.
        service, backend = make_service(fail_mode='busy')
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_FAILED))

            healthy = FakeBackend(resolution=service.resolution,
                                  fps=service.fps)
            service.backend = healthy
            service.retry()
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING))
            snap = service.snapshot()
            # Successful retry clears the recorded failure reason.
            self.assertIsNone(snap['last_error'])
            self.assertGreater(snap['frame_seq'], 0)
        finally:
            service.stop()

    def test_stall_does_not_refresh_frame_time(self):
        service, backend = make_service(stall_timeout=0.4)
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING))
            # Freeze the camera and wait for the producer thread to have
            # actually stopped delivering frames (stall flag latches).
            backend.stall()
            self.assertTrue(wait_until(
                lambda: service.snapshot()['stalled'] is True, timeout=3))

            stalled_seq = service.snapshot()['frame_seq']
            stalled_at = service.snapshot()['last_frame_at']
            self.assertIsNotNone(stalled_at)
            # While stalled for several poll cycles, no frame time moves.
            for _ in range(4):
                time.sleep(0.15)
                snap = service.snapshot()
                self.assertTrue(snap['stalled'])
                self.assertEqual(snap['frame_seq'], stalled_seq)
                self.assertEqual(snap['last_frame_at'], stalled_at)

            # Resume: new frames clear the stall automatically.
            backend.resume()
            self.assertTrue(wait_until(
                lambda: service.snapshot()['stalled'] is False, timeout=3))
            self.assertGreater(service.snapshot()['frame_seq'],
                               stalled_seq)
        finally:
            service.stop()

    def test_first_frame_never_arrives_is_stalled(self):
        # A camera that opens but never delivers a first frame must still
        # surface "waiting for frames" instead of hanging on "starting".
        backend = FakeBackend(resolution=(320, 240), fps=24,
                              fail_mode='stall')
        service = ViewfinderService(backend, resolution=(320, 240), fps=24,
                                    stall_timeout=0.4)
        reset_service(service)
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['stalled'] is True, timeout=3))
            snap = service.snapshot()
            self.assertEqual(snap['frame_seq'], 0)
            self.assertIsNone(snap['last_frame_at'])
            # Not a failure: the camera opened, frames are just absent.
            self.assertIsNone(snap['last_error'])
            # Resume: frames begin and the stall clears automatically.
            backend.resume()
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING,
                timeout=3))
            self.assertTrue(wait_until(
                lambda: service.snapshot()['stalled'] is False, timeout=3))
        finally:
            service.stop()

    def test_runtime_failure_mid_stream(self):
        # Give the camera several healthy frames so RUNNING is long-lived,
        # but do not depend on observing that transient state: under load
        # the producer can reach FAILED between two polls. The durable
        # guarantees are checked after the failure settles.
        service, _ = make_service(fail_mode='runtime:8',
                                  stall_timeout=0.4)
        service.start()
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_FAILED,
                timeout=5))
            snap = service.snapshot()
            self.assertEqual(snap['last_error']['code'], 'runtime_error')
            # Frames produced before the failure remain the last ones,
            # proving the camera ran before it died.
            self.assertGreater(snap['frame_seq'], 0)
        finally:
            service.stop()

    def test_wait_for_frame_never_replays_old_frame(self):
        service, backend = make_service(stall_timeout=0.3)
        try:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['frame_seq'] >= 2))
            seq = service.snapshot()['frame_seq']
            backend.stall()
            # Wait until the producer is demonstrably stalled before
            # asserting on wait_for_frame, so no in-flight frame can win.
            self.assertTrue(wait_until(
                lambda: service.snapshot()['stalled'] is True, timeout=3))
            # While stalled, wait_for_frame must time out rather than
            # handing the same frame back as a "new" one.
            frame, got_seq = service.wait_for_frame(seq, timeout=0.5)
            self.assertIsNone(frame)
            self.assertEqual(got_seq, seq)
            backend.resume()
        finally:
            service.stop()

    def test_backend_exception_types(self):
        with self.assertRaises(CameraBusyError):
            FakeBackend(fail_mode='busy').open()
        with self.assertRaises(CameraInitError):
            FakeBackend(fail_mode='init').open()
        backend = FakeBackend(fail_mode='runtime:0')
        with self.assertRaises(CameraRuntimeError):
            backend.read_frame()


class HttpEndToEndTests(unittest.TestCase):

    def tearDown(self):
        reset_service(None)

    def test_status_endpoint_live(self):
        make_service()
        with HttpHarness() as h:
            with h.get('/viewfinder/status') as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode())
            self.assertEqual(data['state'], STATE_RUNNING)
            self.assertFalse(data['stalled'])
            self.assertEqual(data['resolution'], '320x240')
            self.assertEqual(data['fps'], 24)

    def test_feed_emits_real_multipart_jpeg_parts(self):
        make_service(fps=24)
        with HttpHarness() as h:
            body, status, headers = h.get_bytes('/viewfinder/feed',
                                                limit=40000)
        self.assertEqual(status, 200)
        self.assertIn('multipart/x-mixed-replace',
                      headers.get('Content-Type', ''))
        self.assertIn(b'--gonzovf', body)
        self.assertIn(b'Content-Type: image/jpeg', body)
        # JPEG SOI marker is present, proving real encoded frames flow.
        self.assertIn(b'\xff\xd8\xff', body)

    def test_failed_camera_feed_returns_503_no_fake_image(self):
        make_service(fail_mode='busy')
        with HttpHarness() as h:
            # Wait for the service to reach failed state.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with h.get('/viewfinder/status') as resp:
                    if json.loads(resp.read().decode())['state'] \
                            == STATE_FAILED:
                        break
                time.sleep(0.05)
            try:
                h.get('/viewfinder/feed')
                self.fail('feed should have returned 503')
            except HTTPError as err:
                self.assertEqual(err.code, 503)
                payload = json.loads(err.read().decode())
                self.assertEqual(payload['last_error']['code'],
                                 'device_busy')
                # Error response must not pretend to be an image.
                self.assertNotIn('image/',
                                 err.headers.get('Content-Type', ''))

    def test_retry_endpoint_recovers_stream(self):
        service, backend = make_service(fail_mode='busy')
        with HttpHarness() as h:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_FAILED))
            # Operator frees the camera, then clicks the page's retry button.
            service.backend = FakeBackend(resolution=service.resolution,
                                          fps=service.fps)
            with h.post('/viewfinder/retry') as resp:
                data = json.loads(resp.read().decode())
            self.assertIn(data['state'],
                          (STATE_STARTING, STATE_RUNNING))
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING))
            # After recovery the feed serves real frames again.
            body, status, _ = h.get_bytes('/viewfinder/feed', limit=20000)
            self.assertEqual(status, 200)
            self.assertIn(b'\xff\xd8\xff', body)

    def test_page_renders_with_status_panel(self):
        make_service()
        with HttpHarness() as h:
            with h.get('/viewfinder') as resp:
                html = resp.read().decode()
        self.assertEqual(resp.status, 200)
        # Status area and image area are separate, simultaneously visible.
        self.assertIn('id="vf-panel"', html)
        self.assertIn('id="vf-img"', html)
        self.assertIn('/viewfinder/feed', html)
        self.assertIn('/viewfinder/status', html)
        # No fullscreen overlay pattern is used for the notice element.
        self.assertNotIn('position:fixed', html.replace(' ', '').lower()
                         .replace('\n', ''))

    def test_stall_visible_via_status_over_http(self):
        service, backend = make_service(stall_timeout=0.4)
        with HttpHarness() as h:
            self.assertTrue(wait_until(
                lambda: service.snapshot()['state'] == STATE_RUNNING))
            backend.stall()
            self.assertTrue(wait_until(
                lambda: _poll_stalled(h) is True, timeout=4))
            stalled_snap = service.snapshot()
            self.assertIsNotNone(stalled_snap['last_frame_at'])
            backend.resume()
            self.assertTrue(wait_until(
                lambda: _poll_stalled(h) is False, timeout=4))


def _poll_stalled(harness):
    try:
        with harness.get('/viewfinder/status') as resp:
            return json.loads(resp.read().decode())['stalled']
    except URLError:
        return None


if __name__ == '__main__':
    unittest.main(verbosity=2)
