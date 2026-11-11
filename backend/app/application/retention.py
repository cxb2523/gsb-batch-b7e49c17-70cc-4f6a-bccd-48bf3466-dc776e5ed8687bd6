"""Retención: borra periódicamente los datos de rutina más antiguos que N días.

Se borran solo las detecciones Normal que no abren ni cierran una alerta y los logs
`inference_completed`. Las alertas, las detecciones de alerta y los demás eventos se conservan.
Con 7 cámaras se guardan ~12 MB por hora, así que sin esto la base crece sin límite.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


class Retention:
    def __init__(self, alerts, logs, *, days, interval=3600.0):
        if days <= 0 or interval <= 0:
            raise ValueError("Los días de retención y el intervalo deben ser positivos")
        self.alerts, self.logs, self.days, self.interval = alerts, logs, days, interval

    async def run(self):
        while True:
            try:
                await self.purge()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Un fallo de limpieza no debe detener el servicio; se reintenta en el siguiente ciclo.
                logger.exception("No se pudo aplicar la retención de datos")
            await asyncio.sleep(self.interval)

    async def purge(self, now=None):
        before = (now or datetime.now(timezone.utc)) - timedelta(days=self.days)
        logs = await asyncio.to_thread(self.logs.purge, before)
        detections = await asyncio.to_thread(self.alerts.purge_detections, before)
        if logs or detections:
            await asyncio.to_thread(self.logs.emit, "data_purged",
                f"Retención de {self.days:g} días: {detections} detecciones y {logs} logs borrados")
        return {"detections": detections, "logs": logs}
