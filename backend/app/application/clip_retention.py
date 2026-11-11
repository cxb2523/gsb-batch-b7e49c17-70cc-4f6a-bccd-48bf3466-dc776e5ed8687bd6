"""Retención de clips por espacio: si el bucket supera el tope, se borran los clips más antiguos.

El espacio se calcula con `alert_clips.size_bytes` (solo clips; el bucket debe ser exclusivo de ellos).
Al pasar el tope se borra hasta quedar en `target` (p. ej. 80 %), para no borrar un clip en cada ciclo.
Primero se borra el objeto y después se marca la fila: si falla a medias, el siguiente ciclo lo repite.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


class ClipRetention:
    def __init__(self, clips, storage, *, max_bytes, target=0.8, interval=300.0, on_purge=None):
        if max_bytes <= 0 or interval <= 0 or not 0 < target <= 1:
            raise ValueError("El tope, el intervalo y la proporción objetivo deben ser válidos")
        self.clips, self.storage = clips, storage
        self.max_bytes, self.target, self.interval, self.on_purge = max_bytes, target, interval, on_purge

    async def run(self):
        while True:
            try:
                await self.purge()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("No se pudo aplicar la retención de clips")
            await asyncio.sleep(self.interval)

    async def purge(self):
        return await asyncio.to_thread(self._purge)

    def _purge(self):
        stored = self.clips.stored()
        total = sum(size for _, _, size in stored)
        if total <= self.max_bytes:
            return {"deleted": 0, "freed_bytes": 0, "total_bytes": total}
        goal = self.max_bytes * self.target
        deleted = freed = 0
        for alert_id, key, size in stored:
            if total <= goal:
                break
            try:
                self.storage.delete(key)
            except Exception:
                # Sin permiso o sin red: se detiene y se reintenta; no se marca lo que sigue en el bucket.
                logger.exception("No se pudo borrar el clip %s del bucket", alert_id)
                break
            self.clips.mark_purged(alert_id)
            total -= size
            freed += size
            deleted += 1
        if deleted and self.on_purge:
            self.on_purge(deleted, freed, total)
        return {"deleted": deleted, "freed_bytes": freed, "total_bytes": total}
