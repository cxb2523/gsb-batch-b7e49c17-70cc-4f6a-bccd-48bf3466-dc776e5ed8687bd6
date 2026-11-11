"""Procesamiento del híbrido por cámara: VadCLIP abre y cierra la alerta, VideoMAE pone la clase.

Cada bloque de 16 frames pasa por CLIP + cabezal VadCLIP. VideoMAE solo corre con el evento abierto
(y durante la espera de unión), cada 4 bloques, al abrir, al reactivarse y al soltar.
Detecciones guardadas: cada clasificación de VideoMAE y, sin evento, una "Normal" cada 4 bloques
(~2,13 s, el mismo ritmo de filas que antes) con confianza = 1 − puntaje de anomalía.
"""
import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from app.domain.hybrid import CLASS_NAMES, HybridPolicy
from app.domain.inference import Prediction

logger = logging.getLogger(__name__)
DISPLAY = {"normal": "Normal", "hurto": "Hurto", "robo": "Robo", "agresion_fisica": "Agresión física",
           "vandalismo": "Vandalismo"}


class HybridContext:
    """Estado del híbrido de una cámara (sesión). Se guarda en Session.alert_policy."""

    def __init__(self, config):
        self.config = config
        self.policy = HybridPolicy(config)
        self.features = deque(maxlen=config.rolling_features)
        self.blocks = deque(maxlen=config.videomae_steps)
        self.reset()

    def reset(self):
        self.policy.reset()
        self.features.clear()
        self.blocks.clear()
        self.since_saved = 0
        self.live = None              # última clase en vivo de VideoMAE: (clase, confianza, probabilidades)
        self.release_detection = None  # detección del momento en que VadCLIP soltó (cierre del evento)
        self.unsaved_start = None      # evento abierto por VadCLIP que aún espera su primera clase de VideoMAE


class HybridProcessor:
    def __init__(self, models):
        self.models = models  # función que devuelve el HybridPredictor cargado

    async def run(self, runtime, session):
        while session.id in runtime.sessions:
            number, block = await session.buffer.queue.get()
            session.processing = True
            started = time.monotonic()
            stage = "inference"
            inference_ms = None
            window_id = f"{session.id}:{number}"
            context = session.alert_policy
            try:
                epoch = block["epoch"]
                if session.pending_alert_interruption:
                    await runtime.interrupt_alert(session, "timeline_reset")
                    session.pending_alert_interruption = False
                # Un bloque perdido rompe el contexto de VadCLIP y el span de VideoMAE.
                if epoch != session.policy_epoch or number != session.last_policy_window + 1:
                    await runtime.interrupt_alert(session, "timeline_reset" if epoch != session.policy_epoch else "window_gap")
                    context.reset()
                if epoch != session.buffer.resets:
                    await runtime.log_event("window_discarded", "Resultado descartado por cambio de línea temporal",
                                            session=session, window_id=window_id, level="WARNING")
                    continue
                models = self.models()
                features = list(context.features)

                def detect():
                    image, frames = models.prepare_block(block)
                    feature, result = models.detect(image, features, context.config.rolling_features)
                    return feature, frames, result
                feature, frames, (score, hint, hint_probability) = await asyncio.to_thread(detect)
                context.features.append(feature)
                context.blocks.append(frames)
                timestamp = block["timestamp"]
                decision = context.policy.update(timestamp, score, span_ready=len(context.blocks) == context.blocks.maxlen)
                prediction = None
                if decision["run_videomae"]:
                    clip = [frame for item in context.blocks for frame in item]
                    logits = await asyncio.to_thread(models.classify, clip)
                    probabilities, smoothed = context.policy.add_videomae(timestamp, logits)
                    winner = max(range(len(CLASS_NAMES)), key=lambda i: probabilities[i])
                    live, live_confidence = context.policy.live_class(smoothed)
                    context.live = (DISPLAY[live], live_confidence, dict(zip(CLASS_NAMES, smoothed)))
                    prediction = {"clase": DISPLAY[CLASS_NAMES[winner]], "confianza": probabilities[winner],
                                  "probabilities": dict(zip(CLASS_NAMES, probabilities))}
                elif context.since_saved + 1 >= context.config.videomae_steps:
                    prediction = {"clase": "Normal", "confianza": min(1.0, max(0.0, 1.0 - decision["smoothed_score"]))}
                inference_ms = round((time.monotonic() - started) * 1000, 3)
                context.since_saved = 0 if prediction is not None else context.since_saved + 1
                detection = None
                if prediction is not None and runtime.detection_store is not None:
                    stage = "storage"
                    record = Prediction.model_validate({**prediction, "timestamp": timestamp, "simulated": False})
                    detection = await asyncio.to_thread(
                        runtime.detection_store.save, record.model_dump(exclude_none=True), session.source_id,
                        session_id=session.id, window_id=window_id)
                    await runtime.log_event("inference_completed", "Inferencia de bloque completada",
                        session=session, window_id=window_id, inference_ms=inference_ms,
                        processing_ms=round((time.monotonic() - started) * 1000, 3), detection_id=detection["id"])
                if session.id not in runtime.sessions:
                    return
                stage = "alert_storage"
                await self._apply_alerts(runtime, session, context, decision, detection, timestamp,
                                         classified=decision["run_videomae"])
                session.policy_epoch = epoch
                session.last_policy_window = number
                if detection is not None:
                    session.last_window_timestamp = detection["timestamp"]
                alert = session.active_alert
                live = context.live if decision["open"] else None
                session.latest_result = {
                    "clase": live[0] if live else "Normal",
                    "confianza": live[1] if live else min(1.0, max(0.0, 1.0 - decision["smoothed_score"])),
                    "timestamp": timestamp, "simulated": False,
                    **({"probabilities": live[2]} if live else {}),
                    "anomaly_score": decision["smoothed_score"], "vadclip_hint": hint,
                    "vadclip_hint_probability": hint_probability,
                    "alert": {"active": decision["open"], "incident": decision["incident"],
                              "closing": decision["open"] and not decision["incident"],
                              "started": decision["started"], "ended": decision["ended"] is not None,
                              "clase": alert["clase"] if alert else None,
                              "id": alert["id"] if alert else None, "status": alert["status"] if alert else None,
                              "start_timestamp": decision["start_timestamp"],
                              "threshold": context.config.threshold},
                    "session_id": session.id, "source_id": session.source_id,
                    **({"detection_id": detection["id"]} if detection else {}),
                    "window_id": window_id, "window_end": timestamp, "frame_count": 16,
                    "processing_ms": round((time.monotonic() - started) * 1000, 3)}
                session.windows_processed += 1
                session.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception:
                if context is not None:
                    context.reset()
                    session.last_policy_window = 0
                    try:
                        await runtime.interrupt_alert(session, "processing_error")
                    except Exception:
                        logger.exception("No se pudo interrumpir el evento tras el fallo")
                session.processing_errors += 1
                session.last_error = "No se pudo procesar el bloque"
                logger.exception("Error procesando bloque de %s", session.id)
                await runtime.log_event("alert_storage_error" if stage == "alert_storage" else
                    "detection_storage_error" if stage == "storage" else "inference_error",
                    "No se pudo almacenar la alerta" if stage == "alert_storage" else
                    "No se pudo almacenar la detección" if stage == "storage" else "No se pudo procesar el bloque",
                    session=session, level="ERROR", window_id=window_id, inference_ms=inference_ms,
                    processing_ms=round((time.monotonic() - started) * 1000, 3))
            finally:
                session.processing = False
                session.buffer.queue.task_done()

    async def _apply_alerts(self, runtime, session, context, decision, detection, timestamp, *, classified):
        store = runtime.alert_store
        ended = decision["ended"]
        if ended is not None:
            context.unsaved_start = None  # terminó sin llegar a tener clase: no hay alerta que cerrar
        if ended is not None and session.active_alert is not None:
            alert, session.active_alert = session.active_alert, None
            session.alert_end_hint = None
            clase = DISPLAY[ended["clase"]] if ended["clase"] else alert["clase"]
            end_detection = detection["id"] if decision["split"] and detection else context.release_detection
            context.release_detection = None
            if store is not None:
                # El cierre llega merge_gap después de que VadCLIP soltó: la hora de fin se lleva a ese momento.
                finished_at = datetime.now(timezone.utc) - timedelta(seconds=max(0.0, timestamp - ended["end"]))
                await asyncio.to_thread(store.close_event, alert["id"], ended["end"], clase,
                                        finished_at.isoformat(), end_detection)
                await runtime.log_event("alert_closed", "VadCLIP confirmó el fin del evento", session=session,
                                        detection_id=end_detection)
            try:
                await runtime.alert_finished(session, alert["id"], ended["end"], complete=True, reason="closed")
            except Exception:
                logger.exception("No se pudo cerrar el clip de %s", session.source_id)
        if decision["started"]:
            context.unsaved_start = (decision["start_timestamp"], decision["smoothed_score"])
        if context.unsaved_start is not None and classified and detection is not None and store is not None:
            # La alerta empieza donde VadCLIP la detectó, aunque la fila se guarde con la primera clase.
            start, score = context.unsaved_start
            context.unsaved_start = None
            alert = await asyncio.to_thread(store.open_event, detection, context.live[0], score,
                                            context.config.threshold, start)
            session.active_alert = alert
            if alert is not None:
                await runtime.log_event("alert_opened", "VadCLIP detectó una anomalía", session=session,
                                        detection_id=detection["id"])
                try:
                    await runtime.alert_opened(session, alert)
                except Exception:
                    logger.exception("No se pudo iniciar el clip de %s", session.source_id)
        if decision["released"]:
            # Si el evento se interrumpe durante la espera de unión, termina donde VadCLIP soltó.
            session.alert_end_hint = timestamp
            context.release_detection = detection["id"] if detection else None
        elif decision["resumed"]:
            session.alert_end_hint = None
            context.release_detection = None
