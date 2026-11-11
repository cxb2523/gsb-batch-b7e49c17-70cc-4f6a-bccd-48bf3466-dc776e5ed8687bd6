"""Lógica del autoescalador, sin Azure ni Neon. Uso: python -m pytest test_autoescalar.py -q"""
from workers_azure import Scaler

ON, OFF = "VM running", "VM deallocated"


def fleet(*states):
    return {f"sx-w{i + 1}": state for i, state in enumerate(states)}


def test_starts_the_first_stopped_vm_when_capacity_is_short():
    assert Scaler(4).decide(1, fleet(OFF, OFF, OFF), {}, 0) == ("start", "sx-w1")
    assert Scaler(4).decide(5, fleet(ON, OFF, OFF), {"sx-w1": 4}, 0) == ("start", "sx-w2")


def test_exact_capacity_needs_no_change():
    assert Scaler(4).decide(4, fleet(ON, OFF, OFF), {"sx-w1": 4}, 0) is None
    assert Scaler(4).decide(0, fleet(OFF, OFF, OFF), {}, 0) is None


def test_never_asks_for_more_than_the_fleet():
    assert Scaler(4).decide(40, fleet(ON, ON, ON), {}, 0) is None


def test_a_starting_vm_is_not_started_twice():
    assert Scaler(4).decide(4, fleet("VM starting", OFF, OFF), {}, 0) is None


def test_a_vm_still_shutting_down_blocks_nothing():
    assert Scaler(4).decide(8, fleet(ON, "VM deallocating", "VM deallocating"), {}, 0) is None


def test_waits_before_stopping_and_picks_the_emptiest():
    scaler = Scaler(4, hold=600)
    vms = fleet(ON, ON, ON)
    cameras = {"sx-w1": 2, "sx-w2": 1}
    assert scaler.decide(3, vms, cameras, 0) is None
    assert scaler.decide(3, vms, cameras, 599) is None
    assert scaler.decide(3, vms, cameras, 600) == ("stop", "sx-w3")


def test_a_returning_camera_cancels_the_pending_stop():
    scaler = Scaler(4, hold=600)
    assert scaler.decide(0, fleet(ON, OFF, OFF), {}, 0) is None
    assert scaler.decide(1, fleet(ON, OFF, OFF), {}, 300) is None
    assert scaler.decide(0, fleet(ON, OFF, OFF), {}, 600) is None  # el contador volvió a empezar


def test_moving_cameras_waits_again_but_empty_vms_do_not():
    scaler = Scaler(4, hold=600)
    busy = fleet(ON, ON, OFF)
    assert scaler.decide(1, busy, {"sx-w1": 1, "sx-w2": 1}, 0) is None
    assert scaler.decide(1, busy, {"sx-w1": 1, "sx-w2": 1}, 600) == ("stop", "sx-w1")
    assert scaler.decide(1, busy, {"sx-w1": 1, "sx-w2": 1}, 601) is None
    idle = Scaler(4, hold=600)
    assert idle.decide(0, fleet(ON, ON, OFF), {}, 0) is None
    assert idle.decide(0, fleet(ON, ON, OFF), {}, 600) == ("stop", "sx-w1")
    assert idle.decide(0, fleet(OFF, ON, OFF), {}, 601) == ("stop", "sx-w2")
