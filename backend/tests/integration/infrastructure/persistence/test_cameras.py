import os
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from urllib.parse import quote
from uuid import uuid4

import pytest

from app.domain.camera import CameraRegistration
from app.infrastructure.persistence.cameras import CameraStore


def test_camera_sql_roundtrip_and_update(tmp_path):
    path = tmp_path / "cameras.db"
    store = CameraStore(path)
    camera = CameraRegistration(source_id="cam", password="integration-only")
    assert store.save(camera) is True
    assert store.save(camera) is False
    restored = CameraStore(path).get("cam")
    assert restored.private_config() == camera.private_config()
    restored.enabled = False
    assert store.save(restored, update=True) is True
    assert store.list()[0].enabled is False
    assert store.delete("cam") is True
    assert store.get("cam") is None


def test_camera_schema_is_locked_committed_and_not_repeated(monkeypatch):
    import app.infrastructure.persistence.cameras as module
    operations = []

    class Connection:
        def execute(self, statement, parameters=None):
            operations.append(statement)
            return SimpleNamespace(rowcount=1, fetchone=lambda: None)

        def __enter__(self):
            return self

        def __exit__(self, kind, value, traceback):
            operations.append("ROLLBACK" if kind else "COMMIT")

        def close(self):
            operations.append("CLOSE")

    monkeypatch.setattr(module, "connect", lambda _: Connection())
    store = CameraStore("postgresql://unused")
    store.get("cam")
    create = next(i for i, value in enumerate(operations) if "CREATE TABLE" in value)
    select = next(i for i, value in enumerate(operations) if value.startswith("SELECT config_json"))
    assert operations.index("SELECT pg_advisory_xact_lock(734821906)") < create < operations.index("COMMIT") < select
    operations.clear()
    store.get("cam")
    assert not any("CREATE TABLE" in value for value in operations)


@pytest.mark.postgres
def test_concurrent_first_start_on_empty_schema():
    # Regresión del experimento de concurrencia: API y workers arrancan juntos contra un esquema vacío.
    url = os.getenv("SENTRIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requiere SENTRIX_TEST_DATABASE_URL")
    url = url.replace("-pooler.", ".", 1)
    import psycopg
    from psycopg import sql
    schema = "test_cameras_" + uuid4().hex
    with psycopg.connect(url, autocommit=True, connect_timeout=5) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            isolated = url + ("&" if "?" in url else "?") + "options=" + quote("-csearch_path=" + schema)
            cameras = [CameraRegistration(source_id=f"cam{i}") for i in range(6)]
            with ThreadPoolExecutor(max_workers=6) as executor:
                saved = list(executor.map(lambda camera: CameraStore(isolated).save(camera), cameras))
            assert saved == [True] * 6
            assert len(CameraStore(isolated).list()) == 6
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
