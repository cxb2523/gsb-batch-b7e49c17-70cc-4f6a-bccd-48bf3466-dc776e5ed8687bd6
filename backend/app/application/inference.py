"""Run and record an inference without HTTP or a concrete model/database."""
import logging
import time
from app.domain.inference import Prediction
from app.application.errors import InvalidInput, Unavailable
from app.application.ports import DetectionRepository, LogRepository

logger = logging.getLogger(__name__)

class InferenceService:
    def __init__(self, predictor, store: DetectionRepository, logs: LogRepository, *, real_mode=False):
        self.predictor, self.store, self.logs = predictor, store, logs
        self.real_mode = real_mode

    def predict(self, window):
        if self.real_mode and len(window.frames) != 16:
            raise InvalidInput("VideoMAE requiere exactamente 16 frames muestreados; para video use WebRTC")
        started = time.perf_counter()
        try:
            result = self.predictor().predict(window)
            prediction = Prediction.model_validate(result)
            inference_ms = round((time.perf_counter() - started) * 1000, 3)
        except Exception:
            logger.exception("Error al ejecutar el predictor")
            self.logs.emit("inference_error", "No se pudo ejecutar la inferencia HTTP", level="ERROR",
                           camera=window.source_id, processing_ms=round((time.perf_counter()-started)*1000, 3))
            raise Unavailable("Predictor no disponible") from None
        try:
            detection = self.store.save(prediction.model_dump(exclude_none=True), window.source_id)
        except Exception:
            logger.exception("Error almacenando detección")
            self.logs.emit("detection_storage_error", "No se pudo almacenar la detección HTTP", level="ERROR",
                           camera=window.source_id, inference_ms=inference_ms,
                           processing_ms=round((time.perf_counter()-started)*1000, 3))
            raise Unavailable("Almacenamiento de detecciones no disponible") from None

        self.logs.emit("inference_completed", "Inferencia HTTP completada y detección almacenada",
                       camera=window.source_id, detection_id=detection["id"], inference_ms=inference_ms,
                       processing_ms=round((time.perf_counter()-started)*1000, 3))
        return prediction, detection["id"]
