"""Receptor WebRTC con ventanas TA-2 e inferencia desacoplada de la recepción."""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from uuid import uuid4

from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError
from aiortc.contrib.media import MediaRelay
from app.domain.pipeline import WindowBuffer
from app.application.errors import InvalidOffer, NotFound, Conflict
from app.application.processing import WindowProcessor
from app.infrastructure.settings import pipeline_config
from app.infrastructure.streaming.frames import prepare_frames
from dataclasses import asdict

logger = logging.getLogger(__name__)


@dataclass
class Session:
    pc: RTCPeerConnection
    source_id: str
    id: str = field(default_factory=lambda: str(uuid4()))
    frames: int = 0
    width: int | None = None
    height: int | None = None
    timestamp: float | None = None
    created: float = field(default_factory=time.monotonic)
    last_frame: float | None = None
    tasks: set = field(default_factory=set)
    buffer: WindowBuffer | None = None
    windows_processed: int = 0
    processing_errors: int = 0
    processing: bool = False
    latest_result: dict | None = None
    # Timestamp de la última ventana guardada que pasó por la política (fin de una alerta interrumpida).
    last_window_timestamp: float | None = None
    last_error: str | None = None
    relay: MediaRelay = field(default_factory=MediaRelay)
    source_track: object = None
    processing_track: object = None
    alert_policy: object = None
    policy_epoch: int = 0
    last_policy_window: int = 0
    pending_alert_interruption: bool = False
    active_alert: dict | None = None  # fila de la alerta abierta; solo cambia al abrir, cerrar o interrumpir
    clip_recorder: object = None  # graba el clip del evento cuando el transporte lo permite (RTSP)
    alert_end_hint: float | None = None  # híbrido: fin marcado por VadCLIP mientras espera la unión

    def snapshot(self):
        return {"session_id": self.id, "source_id": self.source_id,
                "connection_state": self.pc.connectionState,
                "ice_state": self.pc.iceConnectionState,
                "frames_received": self.frames, "width": self.width,
                "height": self.height, "timestamp": self.timestamp,
                "last_frame_age_seconds": None if self.last_frame is None
                else round(time.monotonic() - self.last_frame, 3),
                "frames_sampled": self.buffer.sampled,
                "windows_created": self.buffer.created,
                "windows_processed": self.windows_processed,
                "windows_dropped": self.buffer.dropped,
                "windows_queued": self.buffer.queue.qsize(),
                "frames_in_partial_window": len(self.buffer.partial),
                "timestamp_resets": self.buffer.resets,
                "invalid_timestamps": self.buffer.invalid_timestamps,
                "processing": self.processing,
                "processing_errors": self.processing_errors,
                "last_processing_error": self.last_error,
                "pipeline_config": asdict(self.buffer.config),
                "latest_result": self.latest_result}


class WebRTCReceiver:
    def __init__(self, predict_window, config=None, *, buffer_factory=WindowBuffer,
                 predict_frames=None, policy_factory=None, detection_store=None, log_store=None, alert_store=None):
        self.alert_store = alert_store
        self.log_store = log_store
        self.detection_store = detection_store
        self.predict_window = predict_window
        self.config = config or pipeline_config()
        self.buffer_factory = buffer_factory
        self.predict_frames = predict_frames
        self.policy_factory = policy_factory
        self.sessions: dict[str, Session] = {}
        self.viewers = {}
        self.lock = asyncio.Lock()
        self.processor = WindowProcessor(prepare_frames)

    async def log_event(self, event_type, message, *, session=None, **kwargs):
        if self.log_store is not None:
            if session is not None:
                kwargs.update(camera=session.source_id, session_id=session.id)
            await asyncio.to_thread(self.log_store.emit, event_type, message, **kwargs)

    async def alert_opened(self, session, event):
        """Gancho: se confirmó un evento. El receptor RTSP empieza su clip."""

    async def alert_finished(self, session, alert_id, end_timestamp, *, complete, reason):
        """Gancho: terminó un evento (cerrado o interrumpido)."""

    async def interrupt_alert(self, session, reason):
        alert, session.active_alert = session.active_alert, None
        # Híbrido: si VadCLIP ya había soltado, el evento termina ahí y no en la última ventana.
        hint = session.alert_end_hint
        end = hint if hint is not None else session.last_window_timestamp
        session.alert_end_hint = None
        if alert is not None:
            try:
                await self.alert_finished(session, alert["id"], end, complete=False, reason=reason)
            except Exception:
                logger.exception("No se pudo cerrar el clip del evento interrumpido")
        # Sin alerta abierta no se toca la base: bloquea la tabla para todas las cámaras y, si un hueco la
        # dispara, la demora genera más huecos. Al desconectarse sí va, para cerrar la sesión.
        if self.alert_store is not None and (alert is not None or reason == "source_disconnected"):
            # El evento termina en la última ventana procesada antes del corte.
            try:
                count = await asyncio.to_thread(self.alert_store.interrupt, session.id, reason, end)
            except Exception:
                # Sigue abierta en la base: se conserva para reintentar en el siguiente hueco.
                session.active_alert, session.alert_end_hint = alert, hint
                raise
            if count:
                await self.log_event("alert_interrupted", "Evento interrumpido: " + reason,
                                     session=session, level="WARNING")

    async def viewer_status(self, viewer_id: str):
        viewer = self.viewers.get(viewer_id)
        if viewer is None:
            raise NotFound("Espectador no encontrado")
        return {"viewer_id": viewer_id, "session_id": viewer['session_id'],
                "connection_state": viewer['pc'].connectionState,
                "ice_state": viewer['pc'].iceConnectionState}

    async def delete_viewer(self, viewer_id: str):
        if viewer_id not in self.viewers:
            raise NotFound("Espectador no encontrado")
        await self.close_viewer(viewer_id)
        return {"viewer_id": viewer_id, "closed": True}

    async def close_viewer(self, viewer_id):
        viewer = self.viewers.pop(viewer_id, None)
        if viewer is None:
            return
        timer = viewer.get('timer')
        if timer and timer is not asyncio.current_task():
            timer.cancel()
            await asyncio.gather(timer, return_exceptions=True)
        if viewer.get('track'):
            viewer['track'].stop()
        await viewer['pc'].close()

    async def viewer_timeout(self, viewer_id):
        await asyncio.sleep(30)
        viewer = self.viewers.get(viewer_id)
        if viewer and viewer['pc'].connectionState != 'connected':
            await self.close_viewer(viewer_id)

    async def viewer_offer(self, offer):
        async with self.lock:
            session = self.sessions.get(offer.session_id)
            if session is None:
                raise NotFound("La fuente ya no existe")
            if session.source_track is None or session.pc.connectionState != 'connected':
                raise Conflict("La fuente aún no está conectada")
            if len(self.viewers) >= 4:
                raise Conflict("Límite de cuatro espectadores alcanzado")
            viewer_id = str(uuid4())
            pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            viewer = {'pc': pc, 'session_id': session.id, 'track': None}
            self.viewers[viewer_id] = viewer

        @pc.on('connectionstatechange')
        async def on_state():
            if pc.connectionState in ('closed', 'failed'):
                await self.close_viewer(viewer_id)

        try:
            async with asyncio.timeout(15):
                await pc.setRemoteDescription(RTCSessionDescription(sdp=offer.sdp, type=offer.type))
                transceivers = pc.getTransceivers()
                # Una oferta recvonly genera una dirección local sendonly.
                if (len(transceivers) != 1 or transceivers[0].kind != 'video'
                        or transceivers[0].receiver.track is not None or pc.sctp is not None):
                    raise ValueError('El espectador debe ofrecer solo video recvonly')
                viewer['track'] = session.relay.subscribe(session.source_track, buffered=False)
                pc.addTrack(viewer['track'])
                await pc.setLocalDescription(await pc.createAnswer())
                if transceivers[0].currentDirection != 'sendonly':
                    raise ValueError('Se requiere recvonly en el emisor de la oferta')
            if session.id not in self.sessions or viewer_id not in self.viewers:
                raise ValueError('La fuente se cerró durante la negociación')
            viewer['timer'] = asyncio.create_task(self.viewer_timeout(viewer_id))
            return {'type': 'answer', 'sdp': pc.localDescription.sdp,
                    'viewer_id': viewer_id, 'session_id': session.id, 'source_id': session.source_id}
        except asyncio.CancelledError:
            await self.close_viewer(viewer_id)
            raise
        except Exception:
            await self.close_viewer(viewer_id)
            raise InvalidOffer('Oferta de espectador inválida o fuente cerrada; use video recvonly e ICE completo') from None

    async def list_sessions(self):
        return [session.snapshot() for session in self.sessions.values()]

    async def status(self, session_id: str):
        if session_id not in self.sessions:
            raise NotFound("Sesión no encontrada o ya cerrada")
        return self.sessions[session_id].snapshot()

    async def delete(self, session_id: str):
        if session_id not in self.sessions:
            raise NotFound("Sesión no encontrada o ya cerrada")
        await self.close(session_id)
        return {"session_id": session_id, "closed": True}

    async def close(self, session_id):
        session = self.sessions.pop(session_id, None)
        if session is None:
            return
        for viewer_id, viewer in list(self.viewers.items()):
            if viewer['session_id'] == session_id:
                await self.close_viewer(viewer_id)
        pending = [task for task in session.tasks if task is not asyncio.current_task()]
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        try:
            await self.interrupt_alert(session, "source_disconnected")
        except Exception:
            logger.exception("No se pudo interrumpir la alerta de la fuente")
            await self.log_event("alert_storage_error", "No se pudo actualizar la alerta al cerrar la fuente",
                                 session=session, level="ERROR")
        session.buffer.clear()
        session.latest_result = None
        session.alert_policy = None
        if session.processing_track:
            session.processing_track.stop()
        if session.source_track:
            session.source_track.stop()
        await session.pc.close()
        await self.log_event("source_disconnected", "Fuente cerrada", session=session)
        logger.info("Fuente cerrada: %s; frames=%s", session.id, session.frames)

    async def shutdown(self):
        for session_id in list(self.sessions):
            await self.close(session_id)
        for viewer_id in list(self.viewers):
            await self.close_viewer(viewer_id)

    def spawn(self, session, coroutine):
        task = asyncio.create_task(coroutine)
        session.tasks.add(task)
        def finished(task):
            session.tasks.discard(task)
            if not task.cancelled():
                error = task.exception()
                if error is not None:
                    logger.error("Terminó una tarea de la fuente %s: %s",
                                 session.source_id, type(error).__name__)
        task.add_done_callback(finished)

    async def consume(self, session, track):
        try:
            while True:
                frame = await track.recv()
                self.accept_frame(session, frame)
                if session.frames == 1:
                    await self.log_event("source_connected", "Primer frame de la fuente recibido", session=session)
        except MediaStreamError:
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Falló la recepción WebRTC: %s", session.id)
            await self.log_event("source_error", "Falló la recepción de video", session=session, level="ERROR")
        finally:
            await self.close(session.id)

    def accept_frame(self, session, frame):
        session.frames += 1
        session.width, session.height = frame.width, frame.height
        session.timestamp = float(frame.time) if frame.time is not None else None
        session.last_frame = time.monotonic()
        if session.frames == 1:
            logger.info("Primer frame: %s (%sx%s)", session.id, frame.width, frame.height)
        previous_epoch = session.buffer.resets
        session.buffer.push(frame, session.timestamp)
        if session.alert_policy is not None and session.buffer.resets != previous_epoch:
            session.pending_alert_interruption = True
            session.alert_policy.reset()
            session.policy_epoch = session.buffer.resets
            session.last_policy_window = 0
            session.latest_result = None

    async def watchdog(self, session):
        while session.id in self.sessions:
            await asyncio.sleep(2)
            # Limpia ofertas abandonadas y fuentes sin frames durante 30 segundos.
            if time.monotonic() - (session.last_frame or session.created) > 30:
                await self.log_event("source_timeout", "Fuente sin frames durante 30 segundos",
                                     session=session, level="WARNING")
                await self.close(session.id)
                return

    async def process_windows(self, session):
        await self.processor.run(self, session)

    async def offer(self, offer):
        async with self.lock:
            if self.sessions:
                raise Conflict("Ya hay una fuente activa; cierre su sesión primero")
            pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            session = Session(pc=pc, source_id=offer.source_id,
                              buffer=self.buffer_factory(self.config),
                              alert_policy=self.policy_factory() if self.policy_factory else None)
            self.sessions[session.id] = session

        tracks = []

        @pc.on("track")
        def on_track(track):
            tracks.append(track)

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed"):
                await self.close(session.id)

        try:
            async with asyncio.timeout(15):
                await pc.setRemoteDescription(RTCSessionDescription(sdp=offer.sdp, type=offer.type))
                if len(tracks) != 1 or tracks[0].kind != "video":
                    raise ValueError("Se requiere una única pista de video, sin audio")
                await pc.setLocalDescription(await pc.createAnswer())
            session.source_track = tracks[0]
            session.processing_track = session.relay.subscribe(tracks[0], buffered=False)
            self.spawn(session, self.consume(session, session.processing_track))
            self.spawn(session, self.process_windows(session))
            self.spawn(session, self.watchdog(session))
            return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type,
                    "session_id": session.id, "source_id": session.source_id}
        except asyncio.CancelledError:
            await self.close(session.id)
            raise
        except Exception as exc:
            await self.close(session.id)
            logger.info("Oferta WebRTC rechazada: %s", type(exc).__name__)
            await self.log_event("source_error", "Oferta WebRTC rechazada", session=session, level="ERROR")
            raise InvalidOffer("Oferta inválida: envíe una pista de video y SDP con candidatos ICE completos") from None
