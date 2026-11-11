"""La tabla alert_clips funciona igual en PostgreSQL (Neon) que en SQLite."""
import os
from urllib.parse import quote
from uuid import uuid4

import pytest

from app.infrastructure.persistence.clips import ClipStore

pytestmark = pytest.mark.postgres


def test_clip_rows_roundtrip_in_postgres():
    url = os.getenv("SENTRIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requiere SENTRIX_TEST_DATABASE_URL")
    url = url.replace("-pooler.", ".", 1)
    import psycopg
    from psycopg import sql
    schema = "test_clips_" + uuid4().hex
    with psycopg.connect(url, autocommit=True, connect_timeout=5) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            isolated = url + ("&" if "?" in url else "?") + "options=" + quote("-csearch_path=" + schema)
            store = ClipStore(isolated)
            store.begin("a1", "camara1", "pc1", "/clips/a1.mp4")
            store.begin("a1", "camara1", "pc2", "/clips/a1.mp4")  # reintento: no duplica
            assert store.update("a1", "ready", object_key="camara1/a1.mp4", duration_seconds=12.5,
                                size_bytes=900, local_path=None) == 1
            row = store.get("a1")
            assert (row["status"], row["worker_id"], row["object_key"], row["local_path"]) == \
                ("ready", "pc2", "camara1/a1.mp4", None)
            assert store.get("otra") is None
            with pytest.raises(ValueError):
                store.update("a1", "inventado")
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
