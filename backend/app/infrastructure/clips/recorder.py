"""Grabador de clips por cámara: copia los paquetes H.264 recibidos a un MP4, sin recodificar.

Mantiene en memoria los últimos segundos de paquetes. Al abrirse una alerta empieza a escribir desde el
keyframe anterior al inicio pedido (pre-roll), así el clip incluye el comienzo real de la anomalía, que
ocurre ~2 ventanas antes de que la alerta se confirme. El MP4 es fragmentado: si el proceso muere, lo
escrito hasta el último fragmento se puede recuperar (ver service.repair).

Todo el trabajo de disco ocurre bajo un lock; push() lo llama el hilo lector RTSP y start/stop el bucle
de eventos.
"""
import logging
import os
import threading
from collections import deque
from dataclasses import dataclass

import av

logger = logging.getLogger(__name__)
FRAGMENTED = {"movflags": "frag_keyframe+empty_moov+default_base_moof"}
# Escribir al disco en cada paquete: sin esto PyAV retiene el video en memoria hasta cerrar y un corte lo pierde.
FLUSH = {"flush_packets": "1"}


@dataclass
class ClipResult:
    alert_id: str
    camera: str
    path: str | None
    complete: bool
    reason: str


class ClipRecorder:
    def __init__(self, camera, directory, on_closed, *, pre_roll=5.0, post_roll=2.0, max_seconds=300.0):
        self.camera, self.directory, self.on_closed = camera, directory, on_closed
        self.pre_roll, self.post_roll, self.max_seconds = pre_roll, post_roll, max_seconds
        # Lo necesario para el pre-roll más un GOP largo de margen.
        self.keep_seconds = pre_roll + 10.0
        self.lock = threading.Lock()
        self.buffer = deque()
        self.stream = None
        self.pending = None   # (alert_id, desde) esperando un keyframe
        self.current = None   # clip abierto
        self.stop_at = None
        self.stop_reason = None
        self._finished = []

    # --- hilo lector ---------------------------------------------------------------------------------
    def configure(self, stream):
        """Nueva conexión: la línea temporal cambia, así que el clip abierto se cierra como parcial."""
        with self.lock:
            if self.current is not None:
                self._close("source_reconnected", complete=False)
            self.buffer.clear()
            self.stream = stream
        self._dispatch()

    def push(self, packet):
        if packet.size == 0 or packet.pts is None or packet.time_base is None:
            return
        item = (float(packet.pts * packet.time_base), packet.is_keyframe, bytes(packet), packet.pts,
                packet.dts, packet.duration)
        with self.lock:
            self.buffer.append(item)
            while self.buffer and item[0] - self.buffer[0][0] > self.keep_seconds:
                self.buffer.popleft()
            if self.current is None:
                if self.pending is not None:
                    self._open()  # escribe el búfer, que ya incluye este paquete
            else:
                self._write(item)
            if self.current is not None:
                if self.stop_at is not None and item[0] >= self.stop_at:
                    self._close(self.stop_reason, complete=True)
                elif item[0] - self.current["start"] > self.max_seconds:
                    self._close("max_duration", complete=False)
        self._dispatch()

    # --- bucle de eventos --------------------------------------------------------------------------
    def start(self, alert_id, timestamp):
        with self.lock:
            if self.current is not None:
                # Si el anterior ya había cerrado y solo faltaba el post-roll, está completo.
                closed = self.stop_at is not None
                self._close("closed" if closed else "overlapped", complete=closed)
            elif self.pending is not None:
                self._finished.append(ClipResult(self.pending[0], self.camera, None, False, "overlapped"))
            self.pending = (alert_id, timestamp - self.pre_roll)
            self.stop_at = None
        self._dispatch()

    def stop(self, alert_id, timestamp):
        """Cierre normal: sigue grabando post_roll segundos después del fin del evento."""
        with self.lock:
            if self.current is not None and self.current["alert_id"] == alert_id:
                self.stop_at = (timestamp if timestamp is not None else self.current["last"]) + self.post_roll
                self.stop_reason = "closed"
            elif self.pending is not None and self.pending[0] == alert_id:
                # Nunca llegó un keyframe: no hay video que guardar.
                self.pending = None
                self._finished.append(ClipResult(alert_id, self.camera, None, False, "no_video"))
        self._dispatch()

    def interrupt(self, alert_id, reason):
        """Evento interrumpido (corte, ventana perdida, fallo): se cierra ya, como parcial."""
        with self.lock:
            if self.current is not None and self.current["alert_id"] == alert_id:
                self._close(reason, complete=False)
            elif self.pending is not None and self.pending[0] == alert_id:
                self.pending = None
                self._finished.append(ClipResult(alert_id, self.camera, None, False, reason))
        self._dispatch()

    def close(self, reason="source_stopped"):
        with self.lock:
            if self.current is not None:
                self._close(reason, complete=False)
            elif self.pending is not None:
                self._finished.append(ClipResult(self.pending[0], self.camera, None, False, reason))
                self.pending = None
        self._dispatch()

    # --- interno (con lock) -----------------------------------------------------------------------
    def _open(self):
        alert_id, since = self.pending
        keyframes = [i for i, item in enumerate(self.buffer) if item[1]]
        if not keyframes or self.stream is None:
            return
        before = [i for i in keyframes if self.buffer[i][0] <= since]
        first = before[-1] if before else keyframes[0]
        os.makedirs(self.directory, exist_ok=True)
        path = os.path.join(self.directory, f"{alert_id}.mp4.part")
        output = av.open(path, "w", format="mp4", options=FRAGMENTED, container_options=FLUSH)
        try:
            out_stream = output.add_stream_from_template(self.stream)
        except Exception:
            output.close()
            raise
        start = self.buffer[first]
        base = start[4] if start[4] is not None else start[3]
        self.current = {"alert_id": alert_id, "output": output, "stream": out_stream, "path": path,
                        "base": base, "start": start[0], "last": start[0]}
        self.pending = None
        for item in list(self.buffer)[first:]:
            self._write(item)

    def _write(self, item):
        current = self.current
        time, keyframe, data, pts, dts, duration = item
        packet = av.Packet(data)
        packet.pts = pts - current["base"]
        packet.dts = dts - current["base"] if dts is not None else None
        packet.duration = duration
        packet.time_base = self.stream.time_base
        packet.stream = current["stream"]
        packet.is_keyframe = keyframe
        try:
            current["output"].mux(packet)
            current["last"] = time
        except av.error.FFmpegError as exc:
            # Un paquete dañado no debe perder el clip completo.
            logger.warning("Paquete descartado en el clip de %s: %s", self.camera, type(exc).__name__)

    def _close(self, reason, complete):
        current, self.current = self.current, None
        self.stop_at = None
        final = current["path"][: -len(".part")]
        try:
            current["output"].close()
            os.replace(current["path"], final)
        except Exception:
            logger.exception("No se pudo cerrar el clip de %s", self.camera)
            final = current["path"]  # queda .part: se recupera al reiniciar
        self._finished.append(ClipResult(current["alert_id"], self.camera, final, complete, reason))

    def _dispatch(self):
        while True:
            with self.lock:
                if not self._finished:
                    return
                result = self._finished.pop(0)
            try:
                self.on_closed(result)
            except Exception:
                logger.exception("No se pudo entregar el clip de %s", self.camera)
