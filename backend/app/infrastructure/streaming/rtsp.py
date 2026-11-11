"""Fuentes RTSP/RTSPS independientes para el pipeline EN-3/EN-4 existente.

Este modulo REUTILIZA WebRTCReceiver.process_windows para preservar
VideoMAEBuffer, inferencia ONNX, almacenamiento y la politica de alertas.
Las conexiones se resuelven desde el registro privado de cámaras.
"""
import asyncio
import hashlib
import logging
import os
import secrets
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from urllib.parse import quote

import av
from app.domain.camera import CameraRegistration

from app.infrastructure.streaming.webrtc import Session, WebRTCReceiver

logger = logging.getLogger(__name__)


class _RTSPPeer:
    """Adaptador minimo para Session.snapshot y WebRTCReceiver.close."""
    connectionState = "connected"
    iceConnectionState = "connected"

    async def close(self):
        self.connectionState = "closed"
        self.iceConnectionState = "closed"


def _next_frame(iterator):
    try:
        return next(iterator)
    except StopIteration:
        return None


def _next_frame_list(iterator):
    frame = _next_frame(iterator)
    return None if frame is None else [frame]


def _next_frames(packets, recorder):
    """Lee paquetes hasta obtener frames; cada paquete pasa antes por el grabador de clips."""
    while True:
        packet = next(packets, None)
        if packet is None:
            return None
        try:
            recorder.push(packet)
        except Exception as exc:
            # Un fallo del clip no puede cortar el video ni la inferencia.
            logger.warning("Grabación de clip con error: %s", type(exc).__name__)
        frames = packet.decode()
        if frames:
            return frames


async def _blocking(executor, function, *args, on_cancel=None, **kwargs):
    """Esperar operaciones nativas antes de cerrar; cancelar no detiene FFmpeg."""
    future = asyncio.get_running_loop().run_in_executor(
        executor, partial(function, *args, **kwargs))
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        # Los timeouts de apertura/lectura limitan la espera del cierre.
        try:
            result = await future
            if on_cancel is not None:
                await asyncio.get_running_loop().run_in_executor(
                    executor, partial(on_cancel, result))
        except Exception:
            pass
        raise


def _verify_rtsps_fingerprint(host: str, port: int, expected: str):
    """Comprobacion previa de certificado. No sustituye TLS verificado extremo a extremo."""
    expected = expected.replace(":", "").upper().strip()
    if len(expected) != 64 or any(c not in "0123456789ABCDEF" for c in expected):
        raise ValueError("SENTRIX_RTSP_SHA256 debe ser un SHA-256 hexadecimal")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, port), timeout=5) as tcp:
        with context.wrap_socket(tcp, server_hostname=host) as tls:
            observed = hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest().upper()
    if not secrets.compare_digest(observed, expected):
        raise RuntimeError("Certificado RTSPS no coincide con la huella configurada")


class RTSPReceiver(WebRTCReceiver):
    def __init__(self, *args, clips=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.clips = clips
        self.protocol = os.getenv("SENTRIX_RTSP_PROTOCOL", "rtsp").strip().lower()
        self.host = os.environ.get("SENTRIX_RTSP_HOST", "184.194.94.182").strip()
        self.port = int(os.environ.get("SENTRIX_RTSP_PORT", "8554"))
        self.user = os.environ.get("SENTRIX_RTSP_USER", "viewer")
        self.password = os.environ.get("SENTRIX_RTSP_PASSWORD", "")
        self.fingerprint = os.environ.get("SENTRIX_RTSP_SHA256", "")
        if self.protocol not in ("rtsp", "rtsps"):
            raise ValueError("SENTRIX_RTSP_PROTOCOL debe ser rtsp o rtsps")
        # Con autenticación solo por Clerk la clave compartida ya no se usa.
        if (os.getenv("SENTRIX_AUTH_MODE", "api_key").strip().lower() != "clerk"
                and not os.getenv("SENTRIX_CONTROL_API_KEY")):
            raise ValueError("Configurar SENTRIX_CONTROL_API_KEY")
        if self.protocol == "rtsps" and not (self.password and self.fingerprint):
            raise ValueError("RTSPS requiere SENTRIX_RTSP_PASSWORD y SENTRIX_RTSP_SHA256")
        # La dirección viene de configuración privada, nunca del cuerpo HTTP.
        self.default_camera = CameraRegistration(
            source_id=os.getenv("SENTRIX_SOURCE_ID", "camara1"),
            name=os.getenv("SENTRIX_CAMERA_NAME", "Gabriel"),
            stream_path=os.getenv("SENTRIX_STREAM_PATH", "camera01"),
            protocol=self.protocol, host=self.host, port=self.port, user=self.user,
            password=self.password, fingerprint=self.fingerprint)

    def _url(self, camera=None):
        camera = camera or self.default_camera
        # Las credenciales solo se usan dentro de FastAPI; no se registran en logs.
        credentials = ""
        if camera.password.get_secret_value():
            credentials = f"{quote(camera.user, safe='')}:{quote(camera.password.get_secret_value(), safe='')}@"
        return f"{camera.protocol}://{credentials}{camera.host}:{camera.port}/{camera.stream_path}"

    def active(self, source_id):
        return next((s for s in self.sessions.values() if s.source_id == source_id), None)

    def snapshot(self, session):
        result = session.snapshot()
        result["status"] = getattr(session, "rtsp_status", "connecting")
        result["active"] = True
        return result

    def connection_status(self):
        session = next(iter(self.sessions.values()), None)
        return {"transport": "rtsp", "configured": True,
                "state": session.rtsp_status if session else "stopped",
                "source_id": session.source_id if session else None,
                "active_sources": [s.source_id for s in self.sessions.values()],
                "active_count": len(self.sessions)}

    def _accept_rtsp_frame(self, session, frame, base_time):
        # frame.time puede faltar en algunos flujos RTSP; se usa reloj monotono.
        timestamp = float(frame.time) if frame.time is not None else time.monotonic() - base_time
        session.frames += 1
        session.width, session.height = frame.width, frame.height
        session.timestamp = timestamp
        session.last_frame = time.monotonic()
        previous_epoch = session.buffer.resets
        session.buffer.push(frame, timestamp)
        if session.alert_policy is not None and session.buffer.resets != previous_epoch:
            session.pending_alert_interruption = True
            session.alert_policy.reset()
            session.policy_epoch = session.buffer.resets
            session.last_policy_window = 0
            session.latest_result = None

    async def _read_loop(self, session):
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sentrix-rtsp")
        try:
            await self._read_connections(session, executor)
        finally:
            executor.shutdown(wait=False)

    async def _log_transport_event(self, *args, **kwargs):
        try:
            await self.log_event(*args, **kwargs)
        except Exception as exc:
            logger.warning("No se pudo guardar el evento RTSP: %s", type(exc).__name__)

    async def _read_connections(self, session, executor):
        camera = session.camera_config
        while session.id in self.sessions:
            container = None
            try:
                # Verificacion previa de huella del certificado autofirmado de EC2.
                if camera.protocol == "rtsps":
                    await _blocking(executor, _verify_rtsps_fingerprint,
                                    camera.host, camera.port, camera.fingerprint)
                container = await _blocking(
                    executor, av.open, self._url(camera), options={"rtsp_transport": "tcp"},
                    timeout=(5.0, 5.0), on_cancel=lambda opened: opened.close())
                recorder = session.clip_recorder
                if recorder is not None:
                    # Con clips se leen paquetes (para copiarlos sin recodificar) y se decodifican aquí.
                    video = container.streams.video[0]
                    await _blocking(executor, recorder.configure, video)
                    packets = await _blocking(executor, lambda: iter(container.demux(video)))
                    read = partial(_next_frames, packets, recorder)
                else:
                    iterator = await _blocking(executor, lambda: iter(container.decode(video=0)))
                    read = partial(_next_frame_list, iterator)
                base_time = time.monotonic()
                while session.id in self.sessions:
                    frames = await _blocking(executor, read)
                    if session.id not in self.sessions:
                        return
                    if frames is None:
                        raise ConnectionError("Fin de stream")
                    for frame in frames:
                        self._accept_rtsp_frame(session, frame, base_time)
                    if session.rtsp_status != "receiving":
                        session.rtsp_status = "receiving"
                        session.pc.connectionState = "connected"
                        session.last_error = None
                        await self._log_transport_event("source_connected", "Stream RTSP recibido", session=session)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # No registrar URL, password ni excepciones que incluyan la URL.
                logger.warning("%s temporalmente no disponible para %s: %s",
                               camera.protocol.upper(), session.source_id, type(exc).__name__)
                # Un corte se registra una sola vez; los reintentos siguientes solo van al log local.
                new_outage = getattr(session, "rtsp_status", None) != "reconnecting"
                session.rtsp_status = "reconnecting"
                session.pc.connectionState = "disconnected"
                session.last_error = f"Error de conexion: {type(exc).__name__}"
                session.buffer.clear()
                session.buffer.last_timestamp = None
                session.buffer.next_sample = None
                session.buffer.resets += 1
                if hasattr(session.buffer, "frame_index"):
                    session.buffer.frame_index = 0
                if session.alert_policy:
                    session.alert_policy.reset()
                    session.policy_epoch = session.buffer.resets
                    session.last_policy_window = 0
                    session.pending_alert_interruption = True
                    try:
                        await self.interrupt_alert(session, "rtsp_interrupted")
                    except Exception as storage_exc:
                        logger.warning("No se pudo interrumpir la alerta RTSP de %s: %s",
                                       session.source_id, type(storage_exc).__name__)
                        await self._log_transport_event("alert_storage_error",
                            "No se pudo actualizar la alerta tras la interrupción RTSP",
                            session=session, level="ERROR")
                    else:
                        session.pending_alert_interruption = False
                session.latest_result = None
                if new_outage:
                    await self._log_transport_event("transport_error", f"Stream {camera.protocol.upper()} interrumpido; reintentando",
                                         session=session, level="WARNING")
            finally:
                if container is not None:
                    try:
                        await _blocking(executor, container.close)
                    except Exception as close_exc:
                        logger.warning("No se pudo cerrar el contenedor RTSP de %s: %s",
                                       session.source_id, type(close_exc).__name__)
            if session.id in self.sessions:
                await asyncio.sleep(3)

    async def alert_opened(self, session, event):
        if self.clips is None or session.clip_recorder is None:
            return
        await asyncio.to_thread(self.clips.begin, event["id"], session.source_id)
        session.clip_recorder.start(event["id"], event["timestamp_inicio"])

    async def alert_finished(self, session, alert_id, end_timestamp, *, complete, reason):
        if session.clip_recorder is None:
            return
        if complete:
            session.clip_recorder.stop(alert_id, end_timestamp)
        else:
            # Puede escribir el cierre del archivo: fuera del bucle de eventos.
            await asyncio.to_thread(session.clip_recorder.interrupt, alert_id, reason)

    async def close(self, session_id):
        session = self.sessions.get(session_id)
        await super().close(session_id)
        if session is not None and session.clip_recorder is not None:
            await asyncio.to_thread(session.clip_recorder.close)

    def open(self, camera):
        session = Session(
            pc=_RTSPPeer(), source_id=camera.source_id,
            buffer=self.buffer_factory(self.config),
            alert_policy=self.policy_factory() if self.policy_factory else None,
        )
        session.rtsp_status = "connecting"
        session.camera_config = camera
        if self.clips is not None and session.alert_policy is not None:
            session.clip_recorder = self.clips.recorder(camera.source_id)
        self.sessions[session.id] = session
        self.spawn(session, self.process_windows(session))
        self.spawn(session, self._read_loop(session))
        return self.snapshot(session)
