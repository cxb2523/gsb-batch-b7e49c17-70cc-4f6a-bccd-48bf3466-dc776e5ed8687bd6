"""Reparto de cámaras entre workers: cada cámara la procesa un solo worker a la vez.

En cada ciclo el worker:
1. publica su latido;
2. renueva los leases de sus cámaras y suelta las que ya no debe procesar;
3. toma como máximo una cámara libre, solo si es de los workers menos cargados;
4. publica el estado de sus cámaras para que la API lo lea.
Si un worker se apaga de golpe, sus leases vencen y otro worker toma sus cámaras.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


class Coordinator:
    def __init__(self, store, cameras, receiver, alerts, worker_id, *, capacity=2, ttl=15.0, interval=2.0):
        if capacity < 1 or ttl <= interval:
            raise ValueError("La capacidad debe ser positiva y el TTL mayor que el intervalo")
        self.store, self.cameras, self.receiver, self.alerts = store, cameras, receiver, alerts
        self.worker_id, self.capacity, self.ttl, self.interval = worker_id, capacity, ttl, interval

    def owned(self):
        return {session.source_id: session for session in list(self.receiver.sessions.values())}

    async def run(self):
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Falló un ciclo de coordinación del worker %s", self.worker_id)
            await asyncio.sleep(self.interval)

    async def tick(self):
        await asyncio.to_thread(self.store.heartbeat, self.worker_id, self.capacity)
        desired = await asyncio.to_thread(self.store.desired_running)
        owned = self.owned()
        keep = [source_id for source_id in owned if source_id in desired]
        renewed = await asyncio.to_thread(self.store.renew, self.worker_id, keep, self.ttl)
        lost = [source_id for source_id in owned if source_id not in renewed]
        for source_id in lost:
            await self.receiver.close(owned[source_id].id)
        if lost:
            await asyncio.to_thread(self.store.release, self.worker_id, lost)
        await self._claim_one(desired)
        snapshots = [self.receiver.snapshot(session) for session in self.owned().values()]
        await asyncio.to_thread(self.store.publish, self.worker_id, snapshots)

    async def _claim_one(self, desired):
        owned = self.owned()
        if len(owned) >= self.capacity:
            return None
        loads = await asyncio.to_thread(self.store.workers, self.ttl)
        others = [w["cameras"] for worker_id, w in loads.items()
                  if worker_id != self.worker_id and w["cameras"] < w["capacity"]]
        if others and len(owned) > min(others):
            return None  # otro worker con menos carga debe tomarla
        for source_id in sorted(desired - set(owned)):
            claim = await asyncio.to_thread(self.store.claim, self.worker_id, source_id, self.ttl)
            if claim is None:
                continue
            camera = await asyncio.to_thread(self.cameras.get, source_id)
            if camera is None or not camera.enabled:
                await asyncio.to_thread(self.store.release, self.worker_id, [source_id])
                continue
            if claim["previous"] is not None and self.alerts is not None:
                # El dueño anterior dejó de renovar: sus alertas abiertas no pueden continuar.
                count = await asyncio.to_thread(self.alerts.interrupt_camera, source_id, "worker_lost")
                if count:
                    await self.receiver.log_event("alert_interrupted", "Evento interrumpido: worker_lost",
                                                  camera=source_id, level="WARNING")
            self.receiver.open(camera)
            await self.receiver.log_event("source_assigned", f"Cámara asignada al worker {self.worker_id}",
                                          camera=source_id)
            return source_id
        return None

    async def stop(self):
        owned = self.owned()
        for session in owned.values():
            await self.receiver.close(session.id)
        await asyncio.to_thread(self.store.retire, self.worker_id)
