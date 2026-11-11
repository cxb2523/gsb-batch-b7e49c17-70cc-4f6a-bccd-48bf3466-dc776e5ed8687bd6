"""Use cases run with in-memory ports, without FastAPI, SQL or GPU."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.application.cameras import CameraService
from app.application.errors import Conflict, InvalidInput, NotFound, Unavailable
from app.application.inference import InferenceService
from app.application.queries import RecordQueries
from app.domain.camera import CameraRegistration
from app.domain.inference import Prediction, Window


class MemoryCameras:
    def __init__(self):
        self.cameras = {}

    def get(self, identifier):
        return self.cameras.get(identifier)

    def list(self):
        return list(self.cameras.values())

    def save(self, camera, *, update=False):
        if (camera.source_id in self.cameras) != update:
            return False
        self.cameras[camera.source_id] = camera
        return True

    def delete(self, identifier):
        return self.cameras.pop(identifier, None) is not None

class MemorySources:
    def __init__(self):
        self.sessions = {}
        self.opened = 0

    def active(self, identifier):
        return self.sessions.get(identifier)

    def snapshot(self, session):
        return {"source_id": session.id, "active": True}

    def open(self, camera):
        self.opened += 1
        session = SimpleNamespace(id=camera.source_id)
        self.sessions[camera.source_id] = session
        return self.snapshot(session)

    async def close(self, identifier):
        self.sessions.pop(identifier)

def test_camera_registration_and_lifecycle_use_only_ports():
    async def exercise():
        repository, sources = MemoryCameras(), MemorySources()
        default = CameraRegistration(source_id="default", password="private-test-password")
        service = CameraService(repository, sources, default, asyncio.Lock())
        body = CameraRegistration(source_id="new")
        camera = await service.register_camera(body)
        assert camera["stream_path"] == "new"
        assert camera["name"] == "new"
        assert camera["has_password"] is True and "password" not in camera
        with pytest.raises(Conflict):
            await service.register_camera(body)
        start = SimpleNamespace(source_id="new", stream_path=None)
        assert await service.start_source(start) == await service.start_source(start)
        assert sources.opened == 1
        with pytest.raises(Conflict):
            await service.update_camera("new", body)
        with pytest.raises(Conflict):
            await service.delete_camera("new")
        await service.stop_source("new")
        assert (await service.delete_camera("new"))["deleted"] is True
        with pytest.raises(NotFound):
            await service.get_camera("new")

    asyncio.run(exercise())

def test_camera_storage_failure_is_an_application_error():
    class BrokenCameras(MemoryCameras):
        def list(self):
            raise RuntimeError("private SQL diagnostic")

    async def exercise():
        service = CameraService(BrokenCameras(), MemorySources(), None, asyncio.Lock())
        with pytest.raises(Unavailable, match="Registro de camaras no disponible"):
            await service.list_cameras()

    asyncio.run(exercise())
