"""La retención borra solo datos de rutina viejos y nunca lo que forma parte de una alerta."""
import asyncio
from datetime import datetime, timedelta, timezone

from app.application.retention import Retention
from app.infrastructure.persistence.alerts import AlertStore
from app.infrastructure.persistence.detections import DetectionStore
from app.infrastructure.persistence.inference_logs import InferenceLogStore


def _scenario(tmp_path):
    alerts = AlertStore(tmp_path / "events.db")
    logs = InferenceLogStore(tmp_path / "logs.db")

    def save(clase, t):
        return alerts.save(dict(clase=clase, confianza=.9, timestamp=t, simulated=True), "cam", session_id="s")

    routine = [save("Normal", t) for t in (1, 2, 3)]
    opening, candidate, closing = save("Hurto", 4), save("Robo", 5), save("Normal", 6)
    alerts.apply(dict(alert=dict(started=True, ended=False, threshold=.5)), opening)
    alerts.apply(dict(alert=dict(started=False, ended=True, threshold=.5)), closing)
    for _ in range(3):
        logs.write("inference_completed", "Inferencia de ventana completada", camera="cam")
    logs.write("alert_opened", "Evento confirmado", camera="cam")
    return alerts, logs, routine, (opening, candidate, closing)


def test_retention_keeps_alerts_and_their_detections(tmp_path):
    alerts, logs, routine, kept = _scenario(tmp_path)
    retention = Retention(alerts, logs, days=1)
    # Dos días después todo lo guardado queda fuera de la ventana de retención.
    result = asyncio.run(retention.purge(now=datetime.now(timezone.utc) + timedelta(days=2)))
    assert result == {"detections": 3, "logs": 3}
    assert {row["id"] for row in DetectionStore.list(alerts, limit=50)} == {row["id"] for row in kept}
    assert alerts.list(status="closed")["items"][0]["end_detection_id"] == kept[2]["id"]
    remaining = logs.list()["items"]
    assert sorted(row["event_type"] for row in remaining) == ["alert_opened", "data_purged"]


def test_retention_keeps_recent_rows_and_purges_in_batches(tmp_path):
    alerts, logs, routine, _ = _scenario(tmp_path)
    assert asyncio.run(Retention(alerts, logs, days=1).purge()) == {"detections": 0, "logs": 0}
    assert logs.list(event_type="data_purged")["total"] == 0
    later = datetime.now(timezone.utc) + timedelta(days=2)
    assert alerts.purge_detections(later, batch=2) == 3
    assert logs.purge(later, batch=2) == 3
