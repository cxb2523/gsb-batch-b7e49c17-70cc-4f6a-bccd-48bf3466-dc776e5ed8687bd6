"""Modelos del híbrido: CLIP + cabezal VadCLIP (detector) y VideoMAE (clase), en el mismo proceso.

Preprocesamiento idéntico al runner de Piero (`run_realtime_hybrid_onnx.py`):
- CLIP: el primer frame de cada bloque de 16, redimensionado a 340×256, recorte [16:240, 58:282],
  espejo horizontal y normalización de CLIP.
- Cabezal: los últimos 8 vectores de CLIP rellenados con ceros hasta 256; se usa la última posición.
- VideoMAE: los mismos 16 frames y el mismo tensor que hoy (lado corto 224, recorte central).
Los pesos van en `modelo/vadclip/` (fuera de git) junto a su `metadata.json`.
"""
import json
import os
import threading
from pathlib import Path

import numpy as np

from app.domain.hybrid import HybridConfig
from app.infrastructure.inference.videomae import MODEL_ROOT, VideoMAEPredictor

VADCLIP_CLASSES = ["Normal", "Abuse", "Arrest", "Arson", "Assault", "Burglary", "Explosion", "Fighting",
                   "RoadAccidents", "Robbery", "Shooting", "Shoplifting", "Stealing", "Vandalism"]


def vadclip_root():
    return Path(os.getenv("SENTRIX_VADCLIP_ROOT") or MODEL_ROOT / "vadclip")


def load_vadclip_metadata(root=None, require_files=True):
    # Un worker con servidor de inferencia solo necesita la política: no exige los pesos.
    root = Path(root or vadclip_root())
    metadata = json.loads((root / "metadata.json").read_text(encoding="utf-8"))
    clip, head = metadata["clip"], metadata["head"]
    if (clip["input"] != {"name": "images", "shape": [1, 3, 224, 224]}
            or clip["output"] != {"name": "features", "shape": [1, 512]}
            or head["context_length"] != 256 or head["classes"] != VADCLIP_CLASSES):
        raise ValueError("Contrato de CLIP/VadCLIP incompatible")
    if len(clip["mean"]) != 3 or len(clip["std"]) != 3 or min(clip["std"]) <= 0:
        raise ValueError("Normalización de CLIP inválida")
    for name in (clip["onnx_file"], head["onnx_file"]):
        if Path(name).name != name or (require_files and not (root / name).is_file()):
            raise FileNotFoundError(f"Falta el modelo {name} en {root}")
    return metadata


def config_from_env(metadata=None):
    """Valores del runner, ajustables por entorno (SENTRIX_HYBRID_*)."""
    policy = dict((metadata or {}).get("policy", {}))
    def value(name, cast):
        raw = os.getenv("SENTRIX_HYBRID_" + name.upper())
        return cast(raw) if raw not in (None, "") else policy.get(name, getattr(HybridConfig, name))
    return HybridConfig(**{name: value(name, cast) for name, cast in (
        ("threshold", float), ("smooth", int), ("confirm", int), ("release", int), ("merge_gap", float),
        ("max_event_seconds", float), ("rolling_features", int), ("class_smooth", int),
        ("queue_size", int))})


def clip_image(bgr):
    """Frame BGR → imagen RGB uint8 224×224 lista para CLIP (sin normalizar)."""
    import cv2
    image = cv2.resize(bgr, dsize=(340, 256))
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return np.ascontiguousarray(cv2.flip(image[16:240, 58:282, :], 1))


def videomae_frame(bgr, size=224):
    """Frame BGR → RGB uint8 con lado corto 224 y recorte central (lo que hace prepare_clip por frame)."""
    import cv2
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    if height < width:
        new_height, new_width = size, round(width * size / height)
    else:
        new_width, new_height = size, round(height * size / width)
    resized = cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
    top, left = (new_height - size) // 2, (new_width - size) // 2
    return np.ascontiguousarray(resized[top:top + size, left:left + size])


def to_bgr(frame):
    return frame if isinstance(frame, np.ndarray) else frame.to_ndarray(format="bgr24")


class HybridPredictor:
    """VideoMAE de siempre + CLIP y cabezal VadCLIP. Sin estado por cámara (eso vive en la sesión)."""

    def __init__(self, provider="cuda", root=None, videomae=None):
        self.root = Path(root or vadclip_root())
        self.metadata = load_vadclip_metadata(self.root)
        self.config = config_from_env(self.metadata)
        # VideoMAE primero: su helper registra las DLL de CUDA/cuDNN antes de crear las demás sesiones.
        self.videomae = videomae or VideoMAEPredictor(provider=provider)
        helpers = self.videomae.helpers
        self.clip = helpers.create_session(self.root / self.metadata["clip"]["onnx_file"], provider)
        self.head = helpers.create_session(self.root / self.metadata["head"]["onnx_file"], provider)
        if provider == "cuda" and not all("CUDAExecutionProvider" in s.get_providers()
                                          for s in (self.clip, self.head)):
            raise RuntimeError("CUDA no se activó en CLIP/VadCLIP; no se usará CPU sin avisar")
        self.mean = np.asarray(self.metadata["clip"]["mean"], dtype=np.float32).reshape(1, 1, 3)
        self.std = np.asarray(self.metadata["clip"]["std"], dtype=np.float32).reshape(1, 1, 3)
        videomae_pre = self.videomae.metadata["preprocessing"]
        self.vm_mean = np.asarray(videomae_pre["mean"], dtype=np.float32).reshape(1, 1, 1, 3)
        self.vm_std = np.asarray(videomae_pre["std"], dtype=np.float32).reshape(1, 1, 1, 3)
        self.lock = threading.Lock()
        # Calentamiento: no declarar el modelo listo antes de una inferencia válida.
        feature = self.feature(np.zeros((224, 224, 3), dtype=np.uint8))
        self.anomaly([feature])

    # --- preparación (CPU, por cámara) -----------------------------------------------------------
    @staticmethod
    def prepare_block(block):
        """Convierte un bloque del búfer en las entradas reducidas (≈ 0,9 MB por bloque)."""
        return clip_image(to_bgr(block["clip"])), [videomae_frame(to_bgr(f)) for f in block["videomae"]]

    # --- inferencia (GPU, compartida) -----------------------------------------------------------
    def feature(self, image):
        tensor = (image.astype(np.float32) / 255.0 - self.mean) / self.std
        tensor = np.ascontiguousarray(tensor.transpose(2, 0, 1)[None], dtype=np.float32)
        with self.lock:
            feature = self.clip.run(["features"], {"images": tensor})[0][0]
        if feature.shape != (512,) or not np.isfinite(feature).all():
            raise FloatingPointError("CLIP produjo un vector inválido")
        return feature.astype(np.float32, copy=True)

    def anomaly(self, features):
        size = len(features)
        visual = np.zeros((1, 256, 512), dtype=np.float32)
        visual[0, :size] = np.asarray(features, dtype=np.float32)
        with self.lock:
            logits1, logits2 = self.head.run(["logits1", "logits2"],
                                             {"visual": visual, "lengths": np.asarray([size], dtype=np.int64)})
        raw = float(logits1[0, size - 1, 0])
        if not np.isfinite(raw):
            raise FloatingPointError("VadCLIP produjo un puntaje inválido")
        score = float(1.0 / (1.0 + np.exp(-raw))) if raw >= 0 else float(np.exp(raw) / (1.0 + np.exp(raw)))
        hints = logits2[0, size - 1].astype(np.float64)
        hints = np.exp(hints - hints.max())
        hints /= hints.sum()
        hint = int(np.argmax(hints[1:])) + 1
        return score, VADCLIP_CLASSES[hint], float(hints[hint])

    def detect(self, image, previous, rolling):
        """Vector del bloque y puntaje con los últimos `rolling` vectores, incluido el nuevo."""
        feature = self.feature(image)
        return feature, self.anomaly((list(previous) + [feature])[-rolling:])

    def classify(self, frames):
        """16 frames RGB 224×224 uint8 → 5 logits de VideoMAE."""
        if len(frames) != 16:
            raise ValueError("VideoMAE requiere exactamente 16 frames")
        clip = (np.stack(frames).astype(np.float32) / 255.0 - self.vm_mean) / self.vm_std
        tensor = np.ascontiguousarray(clip.transpose(3, 0, 1, 2)[None], dtype=np.float32)
        with self.videomae.lock:
            logits = self.videomae.session.run(None, {self.videomae.input_name: tensor})[0]
        if logits.shape != (1, 5) or not np.isfinite(logits).all():
            raise RuntimeError("VideoMAE devolvió logits inválidos")
        return logits[0].astype(float).tolist()

    # --- compatibilidad con /predict y /health --------------------------------------------------
    def predict(self, window):
        return self.videomae.predict(window)

    def health(self):
        return {**self.videomae.health(), "detector": "VadCLIP (CLIP ViT-B/16 + cabezal)",
                "policy": "hybrid", "vadclip_providers": self.clip.get_providers(),
                "hybrid_config": {"threshold": self.config.threshold, "release": self.config.release,
                                  "merge_gap": self.config.merge_gap,
                                  "max_event_seconds": self.config.max_event_seconds}}
