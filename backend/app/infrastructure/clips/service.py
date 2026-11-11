"""Une grabadores, la tabla alert_clips y el almacenamiento (bucket o disco local).

Cada clip cerrado se mide, se sube al bucket (si está configurado) y se borra del disco. Lo que quede en
la carpeta al arrancar es trabajo pendiente de un corte: los .part se reparan como parciales y los .mp4
se vuelven a subir. Así un apagón no pierde el video ya grabado.
"""
import logging
import os
import socket
from concurrent.futures import ThreadPoolExecutor

import av

from app.infrastructure.clips.recorder import ClipRecorder

logger = logging.getLogger(__name__)


def repair(part_path, final_path):
    """Copia los GOP completos de un fMP4 cortado; el último, posiblemente truncado, se descarta."""
    pending, written = [], 0
    with av.open(part_path) as source:
        video = source.streams.video[0]
        with av.open(final_path, "w", format="mp4", options={"movflags": "+faststart"}) as output:
            out = output.add_stream_from_template(video)

            def flush():
                nonlocal written
                for packet in pending:
                    packet.stream = out
                    output.mux(packet)
                written += len(pending)
                pending.clear()

            try:
                for packet in source.demux(video):
                    if packet.size == 0 or packet.pts is None:
                        continue
                    if packet.is_keyframe:
                        flush()
                    pending.append(packet)
            except av.error.FFmpegError:
                pending.clear()
    if not written:
        os.remove(final_path)
    return written


def probe(path):
    with av.open(path) as container:
        duration = container.duration / av.time_base if container.duration else None
    return (round(duration, 3) if duration else None), os.path.getsize(path)


class ClipService:
    def __init__(self, store, storage, directory, *, pre_roll=5.0, post_roll=2.0, max_seconds=300.0,
                 keep_local=False, worker_id=None):
        self.store, self.storage, self.directory = store, storage, directory
        self.pre_roll, self.post_roll, self.max_seconds = pre_roll, post_roll, max_seconds
        self.keep_local = keep_local
        self.worker_id = worker_id or socket.gethostname()
        self.cameras = {}
        # Un solo hilo: las subidas no compiten con la inferencia ni se pisan entre sí.
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sentrix-clips")

    def recorder(self, camera):
        return ClipRecorder(camera, self.directory, self._closed, pre_roll=self.pre_roll,
                            post_roll=self.post_roll, max_seconds=self.max_seconds)

    def begin(self, alert_id, camera):
        self.cameras[alert_id] = camera
        self.store.begin(alert_id, camera, self.worker_id, os.path.join(self.directory, f"{alert_id}.mp4"))

    def _closed(self, result):
        self.executor.submit(self._finish, result.alert_id, result.camera, result.path, result.complete,
                             result.reason)

    def _finish(self, alert_id, camera, path, complete, reason):
        try:
            if path is None or not os.path.exists(path):
                self.store.update(alert_id, "missing", reason=reason, local_path=None)
                return
            if os.path.getsize(path) == 0:
                # No se escribió ningún paquete: no hay video que guardar ni subida que reintentar.
                os.remove(path)
                self.store.update(alert_id, "missing", reason=reason, local_path=None)
                return
            if path.endswith(".part"):
                final = path[: -len(".part")]
                if not repair(path, final):
                    os.remove(path)
                    self.store.update(alert_id, "missing", reason=reason, local_path=None)
                    return
                os.remove(path)
                path, complete = final, False
            duration, size = probe(path)
            status = "ready" if complete else "partial"
            if self.storage is None:
                self.store.update(alert_id, status, local_path=path, duration_seconds=duration,
                                  size_bytes=size, reason=reason)
                return
            self.store.update(alert_id, "uploading", local_path=path)
            key = f"{camera}/{alert_id}.mp4"
            self.storage.upload(path, key)
            self.store.update(alert_id, status, object_key=key, duration_seconds=duration, size_bytes=size,
                              reason=reason, local_path=path if self.keep_local else None)
            if not self.keep_local:
                os.remove(path)
        except Exception:
            # El archivo queda en disco y se reintenta en el próximo arranque.
            logger.exception("No se pudo guardar el clip %s", alert_id)
        finally:
            self.cameras.pop(alert_id, None)

    def recover(self):
        """Retoma clips que un corte dejó sin cerrar o sin subir en esta máquina."""
        if not os.path.isdir(self.directory):
            return 0
        names = sorted(os.listdir(self.directory))
        recovered = 0
        for name in names:
            if not (name.endswith(".mp4") or name.endswith(".mp4.part")):
                continue
            alert_id = name.split(".", 1)[0]
            row = self.store.get(alert_id)
            if row is None:
                continue
            if row["status"] in ("ready", "partial") and (row.get("object_key") or self.storage is None):
                continue  # ya guardado; el archivo queda solo por keep_local o almacenamiento local
            path = os.path.join(self.directory, name)
            complete = name.endswith(".mp4") and row["status"] == "uploading"
            self.executor.submit(self._finish, alert_id, row["camera"], path, complete,
                                 row.get("reason") or "recovered_after_restart")
            recovered += 1
        return recovered

    def shutdown(self):
        self.executor.shutdown(wait=True)
