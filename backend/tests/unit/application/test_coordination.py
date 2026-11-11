"""Reparto de cámaras entre workers, recuperación ante caídas y cambios de estado deseado."""
import asyncio

import pytest

from app.application.coordination import Coordinator
from tests.support.coordination import FakeAlerts, FakeCameras, FakeCoordinationStore, FakeReceiver


def worker(store, name, *, capacity=2, alerts=None, cameras=None):
    return Coordinator(store, cameras or FakeCameras(), FakeReceiver(), alerts or FakeAlerts(), name,
                       capacity=capacity, ttl=15, interval=2)


def run(*coroutines):
    async def sequence():
        for coroutine in coroutines:
            await coroutine
    asyncio.run(sequence())


def assert_single_owner(store, *workers):
    for source_id in store.desired_running():
        holders = [w.worker_id for w in workers if source_id in w.receiver.cameras()]
        assert len(holders) <= 1, (source_id, holders)
        if holders:
            assert store.owner(source_id) == holders[0]


def test_cameras_are_balanced_and_never_duplicated():
    store = FakeCoordinationStore()
    for source_id in ("camara1", "camara2", "camara3"):
        store.set_desired(source_id, "running")
    a, b = worker(store, "A"), worker(store, "B")
    for _ in range(3):
        run(a.tick(), b.tick())
        store.now += 2
        assert_single_owner(store, a, b)
    assert sorted(a.receiver.cameras() + b.receiver.cameras()) == ["camara1", "camara2", "camara3"]
    assert {len(a.receiver.cameras()), len(b.receiver.cameras())} == {1, 2}


def test_capacity_is_respected():
    store = FakeCoordinationStore()
    for number in range(5):
        store.set_desired(f"camara{number}", "running")
    a = worker(store, "A", capacity=2)
    for _ in range(5):
        run(a.tick())
        store.now += 2
    assert len(a.receiver.cameras()) == 2


def test_crashed_worker_cameras_are_taken_over_and_their_alerts_interrupted():
    store = FakeCoordinationStore()
    for source_id in ("camara1", "camara2"):
        store.set_desired(source_id, "running")
    alerts = FakeAlerts()
    a, b = worker(store, "A"), worker(store, "B", capacity=3, alerts=alerts)
    for _ in range(3):
        run(a.tick(), b.tick())
        store.now += 2
    lost = a.receiver.cameras()
    assert lost
    # A se apaga de golpe: deja de renovar. B sigue con su ciclo normal.
    for _ in range(12):
        run(b.tick())
        store.now += 2
    assert b.receiver.cameras() == ["camara1", "camara2"]
    assert sorted(alerts.interrupted) == sorted((source_id, "worker_lost") for source_id in lost)


def test_takeover_waits_for_lease_expiry():
    store = FakeCoordinationStore()
    store.set_desired("camara1", "running")
    a, b = worker(store, "A"), worker(store, "B")
    run(a.tick())
    store.now += 14  # todavía dentro del TTL de 15 s
    run(b.tick())
    assert b.receiver.cameras() == []
    store.now += 2
    run(b.tick())
    assert b.receiver.cameras() == ["camara1"]


def test_stopped_camera_is_closed_and_released():
    store = FakeCoordinationStore()
    store.set_desired("camara1", "running")
    a = worker(store, "A")
    run(a.tick())
    assert a.receiver.cameras() == ["camara1"]
    store.set_desired("camara1", "stopped")
    store.now += 2
    run(a.tick())
    assert a.receiver.cameras() == []
    assert store.owner("camara1") is None


def test_graceful_stop_hands_over_without_waiting_for_ttl():
    store = FakeCoordinationStore()
    store.set_desired("camara1", "running")
    a, b = worker(store, "A"), worker(store, "B")
    run(a.tick(), b.tick())
    run(a.stop())
    run(b.tick())
    assert b.receiver.cameras() == ["camara1"]


def test_disabled_camera_is_not_opened():
    store = FakeCoordinationStore()
    store.set_desired("camara1", "running")
    a = worker(store, "A", cameras=FakeCameras(disabled={"camara1"}))
    run(a.tick())
    assert a.receiver.cameras() == [] and store.owner("camara1") is None


def test_invalid_configuration_is_rejected():
    with pytest.raises(ValueError):
        Coordinator(FakeCoordinationStore(), FakeCameras(), FakeReceiver(), None, "A", capacity=0)
    with pytest.raises(ValueError):
        Coordinator(FakeCoordinationStore(), FakeCameras(), FakeReceiver(), None, "A", ttl=2, interval=2)
