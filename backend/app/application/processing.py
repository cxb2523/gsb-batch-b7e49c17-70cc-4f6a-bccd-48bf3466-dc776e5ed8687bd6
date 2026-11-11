"""Window inference, persistence and alert confirmation for any video transport."""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

class WindowProcessor:
    def __init__(self, prepare_frames):
        self.prepare_frames = prepare_frames

    async def run(self, runtime, session):
        while session.id in runtime.sessions:
            number, samples = await session.buffer.queue.get()
            session.processing = True
            started = time.monotonic()
            stage = "inference"
            inference_ms = None
            window_id = f"{session.id}:{number}"
            try:
                def execute():
                    if runtime.predict_frames is not None:
                        return runtime.predict_frames([sample[0] for sample in samples], samples[-1][1])
                    frames = self.prepare_frames([sample[0] for sample in samples], runtime.config)
                    return runtime.predict_window(frames, samples[-1][1])
                result = await asyncio.to_thread(execute)
                inference_ms = round((time.monotonic() - started) * 1000, 3)
                detection = None
                if runtime.detection_store is not None:
                    stage = "storage"
                    detection = await asyncio.to_thread(
                        runtime.detection_store.save, result, session.source_id,
                        session_id=session.id, window_id=f"{session.id}:{number}")
                stage = "policy"
                await runtime.log_event("inference_completed", "Inferencia de ventana completada",
                    session=session, window_id=window_id, inference_ms=inference_ms,
                    processing_ms=round((time.monotonic() - started)*1000, 3),
                    detection_id=detection["id"] if detection else None)
                if session.id not in runtime.sessions:
                    return
                if session.alert_policy is not None:
                    epoch = samples[0][2] if len(samples[0]) > 2 else session.buffer.resets
                    if session.pending_alert_interruption:
                        await runtime.interrupt_alert(session, "timeline_reset")
                        session.pending_alert_interruption = False
                    # No confirmar alertas como consecutivas si se perdió una ventana.
                    if epoch != session.policy_epoch or number != session.last_policy_window + 1:
                        await runtime.interrupt_alert(session, "timeline_reset" if epoch != session.policy_epoch else "window_gap")
                        session.alert_policy.reset()
                    if epoch != session.buffer.resets:
                        # La fuente cambió su línea temporal mientras se infería.
                        await runtime.log_event("window_discarded", "Resultado descartado por cambio de línea temporal",
                            session=session, window_id=window_id, level="WARNING",
                            detection_id=detection["id"] if detection else None)
                        continue
                    result = session.alert_policy.update(result, samples[-1][1])
                    if runtime.alert_store is not None and detection is not None:
                        event = None
                        # Solo abrir o cerrar cambia la alerta. apply bloquea la tabla alerts para todas las
                        # cámaras, así que las ventanas intermedias usan la fila que se guardó al abrirla.
                        if result["alert"]["started"] or result["alert"]["ended"]:
                            stage = "alert_storage"
                            event = await asyncio.to_thread(runtime.alert_store.apply, result, detection)
                            session.active_alert = event if event and event["status"] == "active" else None
                        elif result["alert"]["active"]:
                            event = session.active_alert
                        result["alert"]["id"] = event["id"] if event else None
                        result["alert"]["status"] = event["status"] if event else None
                        if result["alert"]["started"] or result["alert"]["ended"]:
                            await runtime.log_event("alert_opened" if result["alert"]["started"] else "alert_closed",
                                "Evento confirmado" if result["alert"]["started"] else "Regreso a Normal confirmado",
                                session=session, window_id=window_id, detection_id=detection["id"])
                        # El clip nunca debe frenar la inferencia ni perder la alerta.
                        try:
                            if result["alert"]["started"] and session.active_alert is not None:
                                await runtime.alert_opened(session, session.active_alert)
                            elif result["alert"]["ended"] and event is not None:
                                await runtime.alert_finished(session, event["id"], event.get("timestamp_fin"),
                                                             complete=True, reason="closed")
                        except Exception:
                            logger.exception("No se pudo actualizar el clip de %s", session.source_id)
                    session.policy_epoch = epoch
                    session.last_policy_window = number
                    if detection is not None:
                        session.last_window_timestamp = detection["timestamp"]
                session.latest_result = {
                    **result, "session_id": session.id, "source_id": session.source_id,
                    **({"detection_id": detection["id"]} if detection else {}),
                    "window_id": f"{session.id}:{number}",
                    "window_start": samples[0][1], "window_end": samples[-1][1],
                    "frame_count": len(samples),
                    "processing_ms": round((time.monotonic() - started) * 1000, 3)}
                session.windows_processed += 1
                session.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception:
                if session.alert_policy is not None:
                    session.alert_policy.reset()
                    session.last_policy_window = 0
                    try:
                        await runtime.interrupt_alert(session, "processing_error")
                    except Exception:
                        logger.exception("No se pudo interrumpir el evento tras el fallo")
                session.processing_errors += 1
                session.last_error = "No se pudo procesar la ventana"
                logger.exception("Error procesando ventana de %s", session.id)
                await runtime.log_event("alert_storage_error" if stage == "alert_storage" else
                    "detection_storage_error" if stage == "storage" else "inference_error",
                    "No se pudo almacenar la alerta" if stage == "alert_storage" else
                    "No se pudo almacenar la detección" if stage == "storage" else "No se pudo procesar la ventana",
                    session=session, level="ERROR", window_id=window_id, inference_ms=inference_ms,
                    processing_ms=round((time.monotonic()-started)*1000, 3))
            finally:
                session.processing = False
                session.buffer.queue.task_done()
