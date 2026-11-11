"""El servicio sube los clips, deja el estado en la base y retoma lo pendiente tras un corte."""
import os
import shutil

import pytest

from app.infrastructure.clips.recorder import ClipResult
from app.infrastructure.clips.service import ClipService
from app.infrastructure.persistence.clips import ClipStore
from tests.support.video import make_h264


class FakeStorage:
    def __init__(self, fail=False):
        self.uploaded, self.fail = {}, fail

    def upload(self, path, key):
        if self.fail:
            raise ConnectionError("sin red")
        self.uploaded[key] = os.path.getsize(path)

    def url(self, key, expires=600):
        return f"https://bucket.example/{key}?firma&expira={expires}"


@pytest.fixture
def clip(tmp_path):
    def create(name):
        folder = tmp_path / "clips"
        folder.mkdir(exist_ok=True)
        return str(make_h264(folder / name, seconds=3))
    return create


def service(tmp_path, storage, **options):
    return ClipService(ClipStore(tmp_path / "clips.db"), storage, str(tmp_path / "clips"), worker_id="pc1",
                       **options)


def test_closed_clip_is_uploaded_and_removed_from_disk(tmp_path, clip):
    storage = FakeStorage()
    clips = service(tmp_path, storage)
    clips.begin("a1", "camara1")
    path = clip("a1.mp4")
    clips._closed(ClipResult("a1", "camara1", path, True, "closed"))
    clips.shutdown()
    row = clips.store.get("a1")
    assert row["status"] == "ready" and row["object_key"] == "camara1/a1.mp4"
    assert row["duration_seconds"] == pytest.approx(3.0, abs=0.1) and row["size_bytes"] > 0
    assert storage.uploaded == {"camara1/a1.mp4": row["size_bytes"]}
    assert not os.path.exists(path) and row["local_path"] is None


def test_without_bucket_the_clip_stays_on_the_worker(tmp_path, clip):
    clips = service(tmp_path, None)
    clips.begin("a2", "camara1")
    path = clip("a2.mp4")
    clips._closed(ClipResult("a2", "camara1", path, False, "window_gap"))
    clips.shutdown()
    row = clips.store.get("a2")
    assert (row["status"], row["reason"], row["local_path"]) == ("partial", "window_gap", path)
    assert os.path.exists(path)


def test_failed_upload_is_retried_after_restart(tmp_path, clip):
    clips = service(tmp_path, FakeStorage(fail=True))
    clips.begin("a3", "camara1")
    path = clip("a3.mp4")
    clips._closed(ClipResult("a3", "camara1", path, True, "closed"))
    clips.shutdown()
    assert clips.store.get("a3")["status"] == "uploading" and os.path.exists(path)
    # Reinicio con red: el archivo pendiente se sube.
    storage = FakeStorage()
    restarted = service(tmp_path, storage)
    assert restarted.recover() == 1
    restarted.shutdown()
    assert restarted.store.get("a3")["status"] == "ready"
    assert "camara1/a3.mp4" in storage.uploaded and not os.path.exists(path)


def test_clip_left_open_by_a_power_cut_is_recovered_as_partial(tmp_path, clip):
    # El worker murió grabando: queda la fila "recording" y un .part cortado.
    clips = service(tmp_path, FakeStorage())
    clips.begin("a4", "camara2")
    source = clip("fuente.mp4")
    part = tmp_path / "clips" / "a4.mp4.part"
    shutil.move(source, part)
    storage = FakeStorage()
    restarted = service(tmp_path, storage)
    assert restarted.recover() == 1
    restarted.shutdown()
    row = restarted.store.get("a4")
    assert (row["status"], row["object_key"]) == ("partial", "camara2/a4.mp4")
    assert not part.exists()


def test_event_without_video_is_missing(tmp_path):
    clips = service(tmp_path, FakeStorage())
    clips.begin("a5", "camara1")
    clips._closed(ClipResult("a5", "camara1", None, False, "no_video"))
    clips.shutdown()
    assert clips.store.get("a5")["status"] == "missing"


@pytest.mark.parametrize("name", ["a6.mp4", "a6.mp4.part"])
def test_empty_clip_is_missing_and_leaves_nothing_on_disk(tmp_path, name):
    storage = FakeStorage()
    clips = service(tmp_path, storage)
    clips.begin("a6", "camara1")
    (tmp_path / "clips").mkdir()
    path = tmp_path / "clips" / name
    path.touch()
    clips._closed(ClipResult("a6", "camara1", str(path), True, "closed"))
    clips.shutdown()
    assert clips.store.get("a6")["status"] == "missing"
    assert storage.uploaded == {} and not path.exists()


def test_empty_clip_found_after_restart_is_missing(tmp_path):
    clips = service(tmp_path, FakeStorage())
    clips.begin("a7", "camara1")
    (tmp_path / "clips").mkdir()
    path = tmp_path / "clips" / "a7.mp4"
    path.touch()
    restarted = service(tmp_path, FakeStorage())
    assert restarted.recover() == 1
    restarted.shutdown()
    assert restarted.store.get("a7")["status"] == "missing" and not path.exists()
