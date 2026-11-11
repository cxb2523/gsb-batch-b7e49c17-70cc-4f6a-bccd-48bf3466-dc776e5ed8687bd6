from app.domain.alerts import EventPolicy


def test_alert_requires_confirmation_and_three_normal_windows_to_close():
    policy = EventPolicy()
    crime = {"clase": "Hurto", "confianza": .95}
    normal = {"clase": "Normal", "confianza": .99}
    assert policy.update(crime, 1)["alert"]["started"] is False
    assert policy.update(crime, 2)["alert"]["started"] is True
    assert policy.update(normal, 3)["alert"]["active"] is True
    assert policy.update(normal, 4)["alert"]["active"] is True
    final = policy.update(normal, 5)["alert"]
    assert final["ended"] is True and final["active"] is False


def test_low_crime_confidence_does_not_close_an_active_event():
    policy = EventPolicy(confirmation=1)
    policy.update({"clase": "Robo", "confianza": .95}, 1)
    for timestamp in range(2, 6):
        state = policy.update({"clase": "Robo", "confianza": .1}, timestamp)["alert"]
        assert state["active"] is True and state["ended"] is False


def test_reset_discards_pending_confirmation():
    policy = EventPolicy()
    crime = {"clase": "Hurto", "confianza": .95}
    policy.update(crime, 1)
    policy.reset()
    assert policy.update(crime, 2)["alert"]["started"] is False
