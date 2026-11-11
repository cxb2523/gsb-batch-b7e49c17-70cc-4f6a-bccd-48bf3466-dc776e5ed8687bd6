"""Fuentes gestionadas por workers: la API escribe el estado deseado y lee lo que publican.

Implementa el mismo contrato que usa CameraService (active, snapshot, open, close), con una
vista en memoria que se refresca desde la base para responder sin esperar a la red.
"""
import asyncio
import json
import logging
from types import SimpleNamespace

logger = logging.getLogger(__name__)


class DistributedSources:
    def __init__(self, store, *, refresh_seconds=1.0, worker_ttl=15.0):
        self.store = store
        self.refresh_seconds = refresh_seconds
        self.worker_ttl = worker_ttl
        self.view = {}
        self.workers = {}

    async def refresh(self):
        rows = await asyncio.to_thread(self.store.overview)
        self.view = {row["source_id"]: row for row in rows}
        self.workers = await asyncio.to_thread(self.store.workers, self.worker_ttl)

    async def run(self):
        while True:
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("No se pudo refrescar el estado de las fuentes: %s", type(error).__name__)
            await asyncio.sleep(self.refresh_seconds)

    def active(self, source_id):
        row = self.view.get(source_id)
        if row is not None and row["desired"] == "running":
            return SimpleNamespace(id=source_id, source_id=source_id)
        return None

    def snapshot(self, session):
        row = self.view.get(session.source_id) or {}
        owner = row.get("worker_id") if row.get("lease_alive") else None
        if owner is not None and row.get("status_json") and row.get("status_worker") == owner:
            status = json.loads(row["status_json"])
            age = row.get("status_age")
            return {**status, "active": True, "worker_id": owner,
                    "status_age_seconds": None if age is None else round(float(age), 3)}
        return {"source_id": session.source_id, "active": True, "status": "pending", "worker_id": owner,
                "latest_result": None, "frames_received": 0, "windows_processed": 0}

    async def open(self, camera):
        await asyncio.to_thread(self.store.set_desired, camera.source_id, "running")
        await self.refresh()
        return self.snapshot(SimpleNamespace(source_id=camera.source_id))

    async def close(self, session_id):
        # En modo distribuido el identificador de la "sesión" es el de la cámara.
        await asyncio.to_thread(self.store.set_desired, session_id, "stopped")
        await self.refresh()

    def connection_status(self):
        running = sorted(source_id for source_id, row in self.view.items() if row["desired"] == "running")
        return {"transport": "rtsp", "configured": True, "mode": "distributed",
                "active_sources": running, "active_count": len(running),
                "workers": {worker_id: {"cameras": int(w["cameras"]), "capacity": w["capacity"]}
                            for worker_id, w in self.workers.items()}}
