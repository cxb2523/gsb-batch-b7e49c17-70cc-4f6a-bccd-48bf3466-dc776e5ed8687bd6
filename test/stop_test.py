# -*- coding: utf-8 -*-
"""Offline tests for the nava stop chain (no sound card or real audio required)."""
import io
import threading
import time

import pytest

import nava
from nava import params
from nava.functions import play, stop, stop_all


class FakeProcess:
    """Fake stand-in for subprocess.Popen objects created by _play_proc_alsa/_play_proc_afplay."""

    def __init__(self):
        self.stdout = io.BytesIO()
        self.stdin = io.BytesIO()
        self.stderr = io.BytesIO()
        self.terminated = False
        self.killed = False
        self._done = threading.Event()

    def wait(self, timeout=None):
        """Block until the process finishes (finish/terminate/kill), like Popen.wait."""
        self._done.wait(timeout)
        return 0

    def terminate(self):
        self.terminated = True
        self._done.set()

    def kill(self):
        self.killed = True
        self._done.set()

    def finish(self):
        """Simulate the process ending on its own (sound segment fully played)."""
        self._done.set()


class FakePlayerFactory:
    """Factory replacing _play_proc_alsa; records every created fake process."""

    def __init__(self):
        self.processes = []
        self.enter_count = 0
        self._lock = threading.Lock()
        # When armed, process creation blocks until allow_creation() is called.
        # This deterministically widens the gap between two looped plays.
        self._block_creation = threading.Event()
        self._creation_allowed = threading.Event()

    def __call__(self, sound_path):
        with self._lock:
            self.enter_count += 1
        if self._block_creation.is_set():
            self._creation_allowed.wait(timeout=10)
        proc = FakeProcess()
        with self._lock:
            self.processes.append(proc)
        return proc

    def block_creation(self):
        self._block_creation.set()

    def allow_creation(self):
        self._creation_allowed.set()


def wait_for(condition, timeout=5.0):
    """Poll condition() until it is true or raise AssertionError."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met within {0}s".format(timeout))


@pytest.fixture
def fake_player(monkeypatch, tmp_path):
    """Patch the ALSA player process factory and clean up nava thread state."""
    factory = FakePlayerFactory()
    monkeypatch.setattr("nava.functions._play_proc_alsa", factory)
    saved_map = dict(params._play_threads_map)
    saved_counter = params._play_threads_counter
    params._play_threads_map.clear()
    params._play_threads_counter = 0
    sound_file = tmp_path / "test_sound.wav"
    sound_file.write_bytes(b"RIFFfake")
    yield factory, str(sound_file)
    stop_all()
    for thread in params._play_threads_map.values():
        thread.join(timeout=5)
    params._play_threads_map.clear()
    params._play_threads_map.update(saved_map)
    params._play_threads_counter = saved_counter


def get_thread(sound_id):
    return params._play_threads_map[sound_id]


def test_stop_while_playing(fake_player):
    """stop() terminates the currently playing process and ends the thread."""
    factory, sound_path = fake_player
    sound_id = play(sound_path, async_mode=True, loop=True, engine=nava.Engine.ALSA)
    wait_for(lambda: len(factory.processes) == 1)
    proc = factory.processes[0]

    stop(sound_id)

    thread = get_thread(sound_id)
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert proc.terminated
    # No new process may be started after stop returned.
    time.sleep(0.2)
    assert factory.enter_count == 1


def test_stop_between_plays(fake_player):
    """stop() landing in the gap between two looped plays still stops the sound."""
    factory, sound_path = fake_player
    sound_id = play(sound_path, async_mode=True, loop=True, engine=nava.Engine.ALSA)
    wait_for(lambda: len(factory.processes) == 1)

    # First segment ends; the worker thread enters the factory for the next
    # segment and blocks there -> we are exactly "between two plays".
    factory.block_creation()
    factory.processes[0].finish()
    wait_for(lambda: factory.enter_count == 2)

    # stop() must wait for the in-flight creation, then prevent any further plays.
    stop_thread = threading.Thread(target=stop, args=(sound_id,))
    stop_thread.start()
    time.sleep(0.2)  # give stop() a chance to run; it cannot finish yet
    assert stop_thread.is_alive()

    factory.allow_creation()
    stop_thread.join(timeout=5)
    assert not stop_thread.is_alive()

    thread = get_thread(sound_id)
    thread.join(timeout=5)
    assert not thread.is_alive()
    # The in-flight process was terminated and no further process was created.
    wait_for(lambda: len(factory.processes) == 2)
    assert factory.processes[1].terminated
    time.sleep(0.2)
    assert factory.enter_count == 2


def test_repeated_stop_same_id(fake_player):
    """Stopping the same sound id twice is harmless and leaves other sounds alone."""
    factory, sound_path = fake_player
    sound_id_1 = play(sound_path, async_mode=True, loop=True, engine=nava.Engine.ALSA)
    sound_id_2 = play(sound_path, async_mode=True, loop=True, engine=nava.Engine.ALSA)
    wait_for(lambda: len(factory.processes) == 2)

    stop(sound_id_1)
    stop(sound_id_1)  # must not raise

    thread_1 = get_thread(sound_id_1)
    thread_1.join(timeout=5)
    assert not thread_1.is_alive()
    assert factory.processes[0].terminated

    # The other sound is untouched.
    thread_2 = get_thread(sound_id_2)
    assert thread_2.is_alive()
    assert not factory.processes[1].terminated

    stop(sound_id_2)
    thread_2.join(timeout=5)
    assert not thread_2.is_alive()


def test_stop_all_starts_no_new_processes(fake_player):
    """stop_all() stops every thread and no new play processes appear afterwards."""
    factory, sound_path = fake_player
    sound_ids = [
        play(sound_path, async_mode=True, loop=True, engine=nava.Engine.ALSA)
        for _ in range(3)
    ]
    wait_for(lambda: len(factory.processes) == 3)

    stop_all()

    for sound_id in sound_ids:
        thread = get_thread(sound_id)
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert all(proc.terminated for proc in factory.processes)

    created = factory.enter_count
    time.sleep(0.3)
    assert factory.enter_count == created
