"""CoordinationStore contra PostgreSQL real, en un esquema temporal."""
import os
import time
from urllib.parse import quote
from uuid import uuid4

import pytest

pytestmark = pytest.mark.postgres


@pytest.fixture
def store():
    url = os.getenv("SENTRIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requiere SENTRIX_TEST_DATABASE_URL")
    url = url.replace("-pooler.", ".", 1)
    import psycopg
    from psycopg import sql
    from app.infrastructure.persistence.coordination import CoordinationStore
    schema = "test_coordination_" + uuid4().hex
    with psycopg.connect(url, autocommit=True, connect_timeout=5) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            yield CoordinationStore(url + ("&" if "?" in url else "?") + "options=" + quote("-csearch_path=" + schema))
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def test_leases_are_exclusive_renewable_and_expire(store):
    store.set_desired("camara1", "running")
    assert store.desired_running() == {"camara1"}
    assert store.claim("A", "camara1", 2) == {"previous": None}
    assert store.claim("B", "camara1", 2) is None
    assert store.renew("A", ["camara1"], 2) == {"camara1"}
    assert store.renew("B", ["camara1"], 2) == set()
    time.sleep(2.5)
    assert store.renew("A", ["camara1"], 2) == set()  # vencido: ya no se puede renovar
    assert store.claim("B", "camara1", 2) == {"previous": "A"}


def test_status_overview_and_retire(store):
    store.set_desired("camara1", "running")
    store.heartbeat("A", 2)
    store.claim("A", "camara1", 10)
    store.publish("A", [{"source_id": "camara1", "status": "receiving", "latest_result": {"clase": "Hurto"}}])
    row = {r["source_id"]: r for r in store.overview()}["camara1"]
    assert row["lease_alive"] and row["worker_id"] == "A" and row["status_worker"] == "A"
    assert '"Hurto"' in row["status_json"]
    assert store.workers(15)["A"]["cameras"] == 1
    store.retire("A")
    row = {r["source_id"]: r for r in store.overview()}["camara1"]
    assert row["worker_id"] is None and row["status_json"] is None
    assert "A" not in store.workers(15)


def test_concurrent_claims_have_a_single_winner(store):
    from concurrent.futures import ThreadPoolExecutor
    store.set_desired("camara1", "running")
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(lambda w: store.claim(w, "camara1", 10), [f"W{i}" for i in range(6)]))
    assert sum(result is not None for result in results) == 1
