"""Cliente del servidor de inferencia compartido: el worker conserva el estado y la GPU queda en un solo proceso.

El worker recorta en CPU (imagen de CLIP y frames de VideoMAE) y envía uint8. El servidor no guarda nada por
cámara: cada bloque viaja con los vectores anteriores que necesita el cabezal de VadCLIP.
"""
import base64

import httpx
import numpy as np

from app.infrastructure.inference.hybrid import HybridPredictor, videomae_frame
from app.infrastructure.inference.videomae import CLASS_NAMES, DISPLAY_NAMES


class RemoteHybridPredictor:
    prepare_block = staticmethod(HybridPredictor.prepare_block)

    def __init__(self, url, api_key, *, timeout=10.0, transport=None):
        self.client = httpx.Client(base_url=url.rstrip("/"), headers={"X-API-Key": api_key},
                                   timeout=timeout, transport=transport)

    def _post(self, path, body):
        response = self.client.post(path, content=body, headers={"Content-Type": "application/octet-stream"})
        response.raise_for_status()
        return response.json()

    def detect(self, image, previous, rolling):
        # Vector y puntaje en un solo viaje: con la GPU lejos, cada ida y vuelta se nota.
        context = list(previous)[-(rolling - 1):] if rolling > 1 else []
        result = self._post("/infer/detect", image.tobytes() + b"".join(
            np.asarray(vector, dtype=np.float32).tobytes() for vector in context))
        feature = np.frombuffer(base64.b64decode(result["feature"]), dtype=np.float32).copy()
        return feature, (float(result["score"]), result["hint"], float(result["hint_probability"]))

    def classify(self, frames):
        if len(frames) != 16:
            raise ValueError("VideoMAE requiere exactamente 16 frames")
        return self._post("/infer/classify", np.stack(frames).tobytes())["logits"]

    def predict(self, window):
        # API HTTP: frames RGB normalizados, como en VideoMAEPredictor.
        rgb = np.asarray(window.frames, dtype=np.float32)
        logits = np.asarray(self.classify([videomae_frame(np.rint(frame[:, :, ::-1] * 255).astype(np.uint8))
                                           for frame in rgb]), dtype=np.float64)
        probabilities = np.exp(logits - logits.max())
        probabilities /= probabilities.sum()
        winner = int(np.argmax(probabilities))
        return {"clase": DISPLAY_NAMES[winner], "confianza": float(probabilities[winner]),
                "timestamp": window.timestamp, "simulated": False,
                "probabilities": dict(zip(CLASS_NAMES, probabilities.tolist()))}

    def health(self):
        # /health es público: no se expone la dirección interna del servidor de inferencia.
        try:
            remote = self.client.get("/health", timeout=3).json()
        except Exception:
            return {"model_loaded": False, "gpu_active": False, "policy": "hybrid", "inference": "remote",
                    "inference_reachable": False}
        return {"model_loaded": bool(remote.get("model_loaded")), "gpu_active": bool(remote.get("gpu_active")),
                "policy": "hybrid", "inference": "remote", "inference_reachable": True}

    def close(self):
        self.client.close()
