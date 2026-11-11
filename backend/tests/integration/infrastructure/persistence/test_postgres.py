"""Regressions for schema locks and RTSP recovery; no camera connection."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from app.infrastructure.persistence.alerts import AlertStore
from app.domain.alerts import EventPolicy
from app.infrastructure.persistence.detections import DetectionStore


pytestmark = pytest.mark.postgres

def test_postgres_concurrent_schema_and_alert_writes():
    import os
    from urllib.parse import quote
    from uuid import uuid4

    url = os.getenv("SENTRIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requiere SENTRIX_TEST_DATABASE_URL")
    # Neon transaction poolers reject search_path in startup options.
    # Use the direct endpoint so every connection stays in the test schema.
    url = url.replace("-pooler.", ".", 1)
    import psycopg
    from psycopg import sql

    schema = "test_alert_recovery_" + uuid4().hex
    with psycopg.connect(url, autocommit=True, connect_timeout=5) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        isolated = url + ("&" if "?" in url else "?") + "options=" + quote(
            "-csearch_path=" + schema + " -clock_timeout=30000 -cstatement_timeout=60000")
        try:
            records = [DetectionStore(isolated).save(
                dict(clase="Hurto", confianza=.9, timestamp=1, simulated=True),
                "cam", session_id=f"s{i}") for i in range(6)]
            opening = dict(alert=dict(started=True, ended=False, threshold=.5))

            def open_and_interrupt(record):
                # Independent stores force concurrent first-time schema initialization.
                store = AlertStore(isolated)
                event = store.apply(opening, record)
                assert event["status"] == "active"
                assert store.interrupt(record["session_id"], "source_disconnected") == 1
                assert store.apply(opening, record) is None
                interrupted = store.get(event["id"])
                assert interrupted["status"] == "interrupted"
                assert interrupted["timestamp_fin"] == 1 and interrupted["duracion_segundos"] == 0

            with ThreadPoolExecutor(max_workers=6) as executor:
                list(executor.map(open_and_interrupt, records))
            store = AlertStore(isolated)
            assert store.list(status="active")["total"] == 0
            assert store.list(status="interrupted")["total"] == 6
            from app.infrastructure.persistence.inference_logs import InferenceLogStore

            def write_logs(worker):
                logs = InferenceLogStore(isolated)
                return [logs.write("inference_completed", f"window {i}",
                                   camera=f"cam{worker}", window_id=f"{worker}:{i}")
                        for i in range(4)]

            with ThreadPoolExecutor(max_workers=6) as executor:
                batches = list(executor.map(write_logs, range(6)))
            logs = InferenceLogStore(isolated)
            assert logs.list()["total"] == 24
            assert logs.list(camera="cam0")["total"] == 4
            for batch in batches:
                for record in batch:
                    assert logs.get(record["id"]) == record
            # Retención: las 6 detecciones abren alertas y se conservan; los logs de rutina se borran.
            from datetime import datetime, timedelta, timezone
            later = datetime.now(timezone.utc) + timedelta(days=2)
            store.save(dict(clase="Normal", confianza=.9, timestamp=2, simulated=True), "cam", session_id="s0")
            assert store.purge_detections(later, batch=4) == 1
            assert logs.purge(later, batch=10) == 24
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
