"""Al pasar el tope de espacio se borran los clips más antiguos y el panel los ve como `missing`."""
import asyncio

import pytest

from app.application.clip_retention import ClipRetention
from app.infrastructure.persistence.clips import ClipStore


class Bucket:
    def __init__(self, fail=()):
        self.objects, self.fail = {}, set(fail)

    def delete(self, key):
        if key in self.fail:
            raise RuntimeError("sin permiso")
        self.objects.pop(key, None)


def _store(tmp_path, sizes):
    """Clips con inicio creciente: c0 es el más antiguo."""
    store, bucket = ClipStore(tmp_path / "clips.db"), Bucket()
    for index, size in enumerate(sizes):
        alert_id = f"c{index}"
        store.begin(alert_id, "camara1", "w", f"{alert_id}.mp4")
        store.update(alert_id, "ready", object_key=f"camara1/{alert_id}.mp4", size_bytes=size)
        bucket.objects[f"camara1/{alert_id}.mp4"] = size
    return store, bucket


def _purge(store, bucket, **options):
    options.setdefault("max_bytes", 1000)
    return asyncio.run(ClipRetention(store, bucket, **options).purge())


def test_under_the_limit_deletes_nothing(tmp_path):
    store, bucket = _store(tmp_path, [300, 300, 300])
    assert _purge(store, bucket) == {"deleted": 0, "freed_bytes": 0, "total_bytes": 900}
    assert len(bucket.objects) == 3


def test_over_the_limit_deletes_oldest_down_to_target(tmp_path):
    store, bucket = _store(tmp_path, [400, 400, 400, 400])  # 1600 > 1000; objetivo 800
    result = _purge(store, bucket)
    assert result == {"deleted": 2, "freed_bytes": 800, "total_bytes": 800}
    assert sorted(bucket.objects) == ["camara1/c2.mp4", "camara1/c3.mp4"]
    purged = store.get("c0")
    assert (purged["status"], purged["object_key"], purged["reason"]) == ("missing", None, "purged_for_space")
    assert store.get("c3")["status"] == "ready"
    # Una segunda pasada ya no encuentra nada que borrar.
    assert _purge(store, bucket)["deleted"] == 0


def test_in_progress_clips_are_never_deleted(tmp_path):
    store, bucket = _store(tmp_path, [900, 900])
    store.begin("grabando", "camara1", "w", "grabando.mp4")
    store.begin("subiendo", "camara1", "w", "subiendo.mp4")
    store.update("subiendo", "uploading", local_path="subiendo.mp4", size_bytes=5000)
    _purge(store, bucket)
    assert store.get("grabando")["status"] == "recording"
    assert store.get("subiendo")["status"] == "uploading"


def test_a_failed_delete_stops_and_keeps_the_row(tmp_path):
    store, bucket = _store(tmp_path, [600, 600, 600])
    bucket.fail = {"camara1/c0.mp4"}
    assert _purge(store, bucket)["deleted"] == 0
    assert store.get("c0")["status"] == "ready" and store.get("c0")["object_key"]
    bucket.fail = set()
    assert _purge(store, bucket)["deleted"] == 2  # reintenta en el siguiente ciclo


def test_reports_what_was_purged(tmp_path):
    store, bucket = _store(tmp_path, [600, 600])
    calls = []
    _purge(store, bucket, on_purge=lambda *args: calls.append(args))
    assert calls == [(1, 600, 600)]


@pytest.mark.parametrize("options", [dict(max_bytes=0), dict(interval=0), dict(target=0), dict(target=1.5)])
def test_invalid_settings_are_rejected(tmp_path, options):
    store, bucket = _store(tmp_path, [])
    with pytest.raises(ValueError):
        ClipRetention(store, bucket, **{"max_bytes": 1000, **options})
