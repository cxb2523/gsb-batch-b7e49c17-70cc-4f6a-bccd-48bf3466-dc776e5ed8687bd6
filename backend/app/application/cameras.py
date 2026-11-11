"""Camera registration and source lifecycle without HTTP or media libraries."""
import asyncio
import inspect
from pydantic import ValidationError
from app.domain.camera import CameraRegistration
from app.application.ports import CameraRepository, SourceGateway
from app.application.errors import InvalidInput, NotFound, Conflict, Unavailable, Forbidden

class CameraService:
    def __init__(self, repository: CameraRepository, sources: SourceGateway, default_camera, lock):
        self.repository = repository
        self.sources = sources
        self.default_camera = default_camera
        self.lock = lock

    async def _storage(self, method, *args, **kwargs):
        try:
            return await asyncio.to_thread(method, *args, **kwargs)
        except Exception:
            raise Unavailable("Registro de camaras no disponible") from None

    async def initialize_cameras(self):
        await self._storage(self.repository.save, self.default_camera)

    async def _camera(self, source_id):
        camera = await self._storage(self.repository.get, source_id)
        if camera is None:
            raise NotFound("Camara no registrada")
        return camera

    async def list_cameras(self):
        cameras = await self._storage(self.repository.list)
        return [{**c.public_config(), "active": self.sources.active(c.source_id) is not None} for c in cameras]

    async def get_camera(self, source_id: str):
        camera = await self._camera(source_id)
        return {**camera.public_config(), "active": self.sources.active(source_id) is not None}

    def _resolve_camera(self, body, base):
        values = base.private_config()
        values.update(body.model_dump(exclude_unset=True, exclude={"password"}))
        if "password" in body.model_fields_set:
            values["password"] = body.password.get_secret_value()
        try:
            camera = CameraRegistration.model_validate(values)
            if camera.protocol == "rtsps" and not camera.password.get_secret_value():
                raise ValueError("Falta password")
            return camera
        except (ValidationError, ValueError):
            raise InvalidInput("Configuracion RTSP/RTSPS invalida") from None

    async def register_camera(self, body: CameraRegistration):
        async with self.lock:
            camera = self._resolve_camera(body, self.default_camera)
            if "stream_path" not in body.model_fields_set:
                camera.stream_path = body.source_id
            if "name" not in body.model_fields_set:
                camera.name = body.source_id
            if not await self._storage(self.repository.save, camera):
                raise Conflict("Camara ya registrada")
            return camera.public_config()

    async def update_camera(self, source_id: str, body: CameraRegistration, may_change_enabled: bool = True):
        async with self.lock:
            if source_id != body.source_id:
                raise InvalidInput("source_id no se puede cambiar")
            if self.sources.active(source_id):
                raise Conflict("Detener la camara antes de editarla")
            current = await self._camera(source_id)
            if not may_change_enabled and "enabled" in body.model_fields_set and body.enabled != current.enabled:
                raise Forbidden("Solo un admin puede activar o desactivar una camara")
            camera = self._resolve_camera(body, current)
            if not await self._storage(self.repository.save, camera, update=True):
                raise NotFound("Camara no registrada")
            return camera.public_config()

    async def delete_camera(self, source_id: str):
        async with self.lock:
            if self.sources.active(source_id):
                raise Conflict("Detener la camara antes de eliminarla")
            if not await self._storage(self.repository.delete, source_id):
                raise NotFound("Camara no registrada")
            return {"source_id": source_id, "deleted": True}

    async def list_sources(self):
        return [await self.source_status(c.source_id)
                for c in await self._storage(self.repository.list)]

    async def start_source(self, body):
        async with self.lock:
            camera = await self._storage(self.repository.get, body.source_id)
            if camera is None:
                if body.stream_path is None:
                    raise NotFound("Enviar stream_path para una camara nueva")
                camera = self.default_camera.model_copy(update={
                    "source_id": body.source_id, "name": body.source_id,
                    "stream_path": body.stream_path})
                if not await self._storage(self.repository.save, camera):
                    camera = await self._camera(body.source_id)
            if not camera.enabled:
                raise Conflict("Camara deshabilitada")
            active = self.sources.active(body.source_id)
            if body.stream_path is not None and body.stream_path != camera.stream_path:
                if active:
                    raise Conflict("Detener la camara antes de cambiar stream_path")
                camera = camera.model_copy(update={"stream_path": body.stream_path})
                if not await self._storage(self.repository.save, camera, update=True):
                    raise NotFound("Camara no registrada")
            if active:
                return self.sources.snapshot(active)  # POST idempotente por cámara
            opened = self.sources.open(camera)
            # Local: abre la sesión; distribuido: registra el estado deseado para los workers.
            return await opened if inspect.isawaitable(opened) else opened

    async def source_status(self, source_id: str):
        await self._camera(source_id)
        session = self.sources.active(source_id)
        if session is not None:
            return self.sources.snapshot(session)
        return {"source_id": source_id, "active": False, "status": "stopped",
                "latest_result": None, "frames_received": 0, "windows_processed": 0}

    async def stop_source(self, source_id: str):
        async with self.lock:
            await self._camera(source_id)
            session = self.sources.active(source_id)
            if session:
                await self.sources.close(session.id)
                return {"source_id": source_id, "status": "stopped", "active": False}
        return {"source_id": source_id, "status": "stopped", "active": False}
