"""Adaptador del paquete de Piero; pesos compartidos y alertas por sesión."""
import importlib.util
import json
import os
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.domain.pipeline import VideoMAEConfig

# SENTRIX_MODEL_ROOT permite leer los pesos desde otra carpeta (p. ej. la versión FP16).
MODEL_ROOT = Path(os.getenv("SENTRIX_MODEL_ROOT") or Path(__file__).resolve().parents[4] / "modelo")
CLASS_NAMES = ["normal", "hurto", "robo", "agresion_fisica", "vandalismo"]
DISPLAY_NAMES = ["Normal", "Hurto", "Robo", "Agresión física", "Vandalismo"]


@lru_cache(maxsize=None)
def inference_helpers(root):
    spec = importlib.util.spec_from_file_location("sentrix_model_inference", root / "infer_onnx.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_metadata(root=MODEL_ROOT):
    metadata = json.loads((root / "metadata.json").read_text(encoding="utf-8"))
    if metadata["class_names"] != CLASS_NAMES or metadata["output_type"] != "logits":
        raise ValueError("Clases/salida incompatibles con el contrato SentriX")
    inputs = metadata["input"]
    if (inputs["shape"] != [1, 3, 16, 224, 224] or inputs["layout"] != "NCTHW"
            or inputs["dtype"] != "float32" or inputs["color_space"] != "RGB"):
        raise ValueError("Entrada VideoMAE incompatible")
    preprocess = metadata["preprocessing"]
    if (preprocess["resize"] != "resize_short_side_preserving_aspect_ratio"
            or preprocess["short_side_size"] != 224 or preprocess["crop"] != "center_crop"
            or preprocess["crop_size"] != 224 or preprocess["pixel_scale"] != "divide_by_255"
            or len(preprocess["mean"]) != 3 or len(preprocess["std"]) != 3
            or not np.isfinite(preprocess["mean"]).all()
            or not np.isfinite(preprocess["std"]).all() or min(preprocess["std"]) <= 0):
        raise ValueError("Preprocesamiento VideoMAE incompatible")
    if Path(metadata["onnx_file"]).name != metadata["onnx_file"]:
        raise ValueError("Nombre de modelo inválido")
    policy = metadata["alert_policy"]
    if (not 0 <= policy["crime_probability_threshold"] <= 1
            or min(policy["probability_smoothing_windows"], policy["consecutive_windows_to_start"],
                   policy["release_windows_to_end"]) < 1):
        raise ValueError("Política temporal inválida")
    config_from_metadata(metadata)
    return metadata


def config_from_metadata(metadata):
    temporal = metadata["temporal_sampling"]
    return VideoMAEConfig(window_size=int(temporal["num_frames"]),
                         sampling_rate=int(temporal["sampling_rate"]),
                         required_frame_span=int(temporal["required_frame_span"]),
                         inference_stride_frames=int(temporal["inference_stride_frames"]),
                         queue_size=int(os.getenv("TA2_QUEUE_SIZE", "2")))


class SessionAlertPolicy:
    def __init__(self, metadata, helpers):
        self.metadata = metadata
        self.helpers = helpers
        self.reset()

    def reset(self):
        config = self.metadata["alert_policy"]
        self.policy = self.helpers.AlertPolicy(
            CLASS_NAMES, config["probability_smoothing_windows"],
            config["crime_probability_threshold"], config["consecutive_windows_to_start"],
            config["release_windows_to_end"])

    def update(self, result, timestamp):
        probabilities = np.asarray([result["probabilities"][name] for name in CLASS_NAMES])
        state = self.policy.update(probabilities, timestamp)
        if state["ended"]:
            self.policy.alert_start = None
        result["smoothed_probabilities"] = dict(zip(CLASS_NAMES, state["smoothed"].tolist()))
        result["alert"] = {
            "active": bool(state["active"]), "candidate": bool(state["candidate"]),
            "started": bool(state["started"]), "ended": bool(state["ended"]),
            "clase": DISPLAY_NAMES[state["active_class"]] if state["active"] else None,
            "start_timestamp": self.policy.alert_start,
            "candidate_count": self.policy.candidate_count,
            "release_count": self.policy.release_count,
        }
        return result


class VideoMAEPredictor:
    def __init__(self, root=MODEL_ROOT, provider="cuda"):
        self.metadata = load_metadata(root)
        self.helpers = inference_helpers(root)
        model_path = root / self.metadata["onnx_file"]
        if not model_path.is_file() or not Path(str(model_path) + ".data").is_file():
            raise FileNotFoundError("Se requieren el modelo ONNX y sus pesos .onnx.data juntos")
        self.session = self.helpers.create_session(model_path, provider)
        inputs = self.session.get_inputs()
        if (len(inputs) != 1 or inputs[0].name != self.metadata["input"]["name"]
                or inputs[0].shape != self.metadata["input"]["shape"]
                or inputs[0].type != "tensor(float)"):
            raise ValueError("Grafo ONNX incompatible con metadata.json")
        self.input_name = inputs[0].name
        self.lock = threading.Lock()
        # El servicio no declara modelo listo antes de una inferencia válida.
        self._run(np.zeros((1, 3, 16, 224, 224), dtype=np.float32), 0)

    def _run(self, tensor, timestamp):
        with self.lock:
            logits = self.session.run(None, {self.input_name: tensor})[0]
        if logits.shape != (1, 5) or not np.isfinite(logits).all():
            raise RuntimeError("El modelo devolvió logits inválidos")
        probabilities = self.helpers.softmax(logits[0])
        winner = int(np.argmax(probabilities))
        return {"clase": DISPLAY_NAMES[winner], "confianza": float(probabilities[winner]),
                "timestamp": timestamp, "simulated": False,
                "probabilities": dict(zip(CLASS_NAMES, probabilities.tolist()))}

    def predict_bgr(self, frames, timestamp):
        if len(frames) != 16:
            raise ValueError("VideoMAE requiere exactamente 16 frames muestreados")
        preprocess = self.metadata["preprocessing"]
        tensor = self.helpers.prepare_clip(frames, preprocess["crop_size"],
                                           preprocess["mean"], preprocess["std"])
        return self._run(tensor, timestamp)

    def predict_frames(self, frames, timestamp):
        return self.predict_bgr([frame.to_ndarray(format="bgr24") for frame in frames], timestamp)

    def predict(self, window):
        # API HTTP: frames RGB normalizados; la política temporal es solo WebRTC.
        rgb = np.asarray(window.frames, dtype=np.float32)
        return self.predict_bgr([np.rint(frame[:, :, ::-1] * 255).astype(np.uint8)
                                 for frame in rgb], window.timestamp)

    def health(self):
        providers = self.session.get_providers()
        return {"model_loaded": True, "model": self.metadata["model_name"],
                "providers": providers, "gpu_active": "CUDAExecutionProvider" in providers}
