"""Consulta del clip de una alerta para el panel."""
from app.application.errors import NotFound, Unavailable

# Estados del contrato con el panel: recording | ready | partial | missing.
PUBLIC_STATUS = {"recording": "recording", "uploading": "recording", "ready": "ready", "partial": "partial",
                 "missing": "missing"}


class ClipQueries:
    def __init__(self, alerts, clips, storage=None, *, url_seconds=600):
        self.alerts, self.clips, self.storage, self.url_seconds = alerts, clips, storage, url_seconds

    def get(self, alert_id):
        try:
            alert = self.alerts.get(alert_id)
            clip = self.clips.get(alert_id) if alert is not None else None
        except Exception:
            raise Unavailable("Almacenamiento de clips no disponible") from None
        if alert is None:
            raise NotFound("Alerta no encontrada")
        if clip is None:
            # Alerta activa sin fila todavía: el worker la está por crear.
            status = "recording" if alert["status"] == "active" else "missing"
            return {"alert_id": alert_id, "status": status, "url": None, "duration_seconds": None,
                    "size_bytes": None, "storage": None, "reason": None}
        status = PUBLIC_STATUS[clip["status"]]
        url, storage = None, None
        if status in ("ready", "partial"):
            if clip.get("object_key") and self.storage is not None:
                try:
                    url, storage = self.storage.url(clip["object_key"], self.url_seconds), "remote"
                except Exception:
                    raise Unavailable("No se pudo firmar la URL del clip") from None
            elif clip.get("local_path"):
                storage = "local"  # solo en el disco del worker; aún no se puede reproducir desde el panel
        return {"alert_id": alert_id, "status": status, "url": url,
                "duration_seconds": clip.get("duration_seconds"), "size_bytes": clip.get("size_bytes"),
                "storage": storage, "reason": clip.get("reason"), "url_expires_in": self.url_seconds if url else None}
