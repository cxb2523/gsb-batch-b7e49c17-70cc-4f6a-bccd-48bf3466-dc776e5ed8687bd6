import argparse
import json
import os
import site
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort


ROOT = Path(__file__).resolve().parent
METADATA_PATH = ROOT / "metadata.json"
_DLL_DIRECTORY_HANDLES = []


def preload_gpu_libraries():
    # cuDNN carga motores auxiliares dinámicamente además de las DLL de ORT.
    # Registrar las carpetas para que Windows pueda resolver esas dependencias.
    if os.name == "nt" and not _DLL_DIRECTORY_HANDLES:
        directories = []
        for package_root in site.getsitepackages():
            for directory in (Path(package_root) / "nvidia").glob("*/bin"):
                _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(directory)))
                directories.append(str(directory))
        if directories:
            os.environ["PATH"] = os.pathsep.join(directories + [os.environ.get("PATH", "")])
    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls(directory="")


def softmax(logits):
    logits = logits - np.max(logits)
    exp = np.exp(logits)
    return exp / exp.sum()


def resize_center_crop(frame, size):
    height, width = frame.shape[:2]

    if height < width:
        new_height = size
        new_width = round(width * size / height)
    else:
        new_width = size
        new_height = round(height * size / width)

    frame = cv2.resize(
        frame,
        (new_width, new_height),
        interpolation=cv2.INTER_LINEAR,
    )

    top = (new_height - size) // 2
    left = (new_width - size) // 2

    return frame[top:top + size, left:left + size]


def prepare_clip(frames, size, mean, std):
    processed = []

    for frame in frames:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame = resize_center_crop(frame, size)
        processed.append(frame)

    clip = np.stack(processed).astype(np.float32) / 255.0

    mean = np.asarray(mean, dtype=np.float32).reshape(1, 1, 1, 3)
    std = np.asarray(std, dtype=np.float32).reshape(1, 1, 1, 3)

    clip = (clip - mean) / std

    # T, H, W, C -> C, T, H, W -> N, C, T, H, W
    clip = clip.transpose(3, 0, 1, 2)[None]

    return np.ascontiguousarray(clip, dtype=np.float32)


def create_session(model_path, provider):
    if provider not in ("auto", "cpu", "cuda"):
        raise ValueError("Provider inválido")
    if provider != "cpu":
        preload_gpu_libraries()
    available = ort.get_available_providers()

    if provider == "cpu":
        providers = ["CPUExecutionProvider"]
    elif provider == "cuda":
        if "CUDAExecutionProvider" not in available:
            raise RuntimeError("CUDA no disponible. Instala requirements-gpu.txt en este entorno.")
        providers = [
            "CUDAExecutionProvider",
            "CPUExecutionProvider",
        ]
    else:
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if "CUDAExecutionProvider" in available
            else ["CPUExecutionProvider"]
        )

    try:
        session = ort.InferenceSession(
            str(model_path),
            providers=providers,
        )
    except Exception as error:
        if provider == "cuda":
            raise RuntimeError("No se pudo iniciar CUDA; no se usará CPU silenciosamente.") from error
        print(f"No se pudo iniciar el provider solicitado: {error}")
        print("Usando CPUExecutionProvider.")
        session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"],
        )

    if provider == "cuda" and "CUDAExecutionProvider" not in session.get_providers():
        raise RuntimeError("CUDA no se activó. Revisa las DLL de CUDA/cuDNN y el controlador NVIDIA.")
    if provider == "cuda":
        session.disable_fallback()
    if provider == "auto" and "CUDAExecutionProvider" not in session.get_providers():
        print("Aviso: inferencia en CPU; CUDA no está activo.")
    return session


class AlertPolicy:
    def __init__(
        self,
        class_names,
        smooth,
        threshold,
        consecutive,
        release,
    ):
        self.class_names = class_names
        self.history = deque(maxlen=smooth)
        self.threshold = threshold
        self.consecutive = consecutive
        self.release = release

        self.candidate_count = 0
        self.release_count = 0
        self.active = False
        self.active_class = 0
        self.alert_start = None

    def update(self, probabilities, current_sec):
        self.history.append(probabilities)

        smoothed = np.mean(
            np.stack(self.history),
            axis=0,
        )

        crime_class = int(np.argmax(smoothed[1:])) + 1
        crime_probability = float(smoothed[crime_class])
        normal_probability = float(smoothed[0])

        candidate = (
            crime_probability >= self.threshold
            and crime_probability > normal_probability
        )

        started = False
        ended = False

        if not self.active:
            if candidate:
                self.candidate_count += 1
            else:
                self.candidate_count = 0

            if self.candidate_count >= self.consecutive:
                self.active = True
                self.active_class = crime_class
                self.release_count = 0
                self.alert_start = current_sec
                started = True
        else:
            if candidate:
                self.release_count = 0
                self.active_class = crime_class
            else:
                self.release_count += 1

                if self.release_count >= self.release:
                    self.active = False
                    self.active_class = 0
                    self.candidate_count = 0
                    self.release_count = 0
                    ended = True

        return {
            "smoothed": smoothed,
            "candidate": candidate,
            "started": started,
            "ended": ended,
            "active": self.active,
            "active_class": self.active_class,
            "alert_start": self.alert_start,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument(
        "--provider",
        choices=["auto", "cpu", "cuda"],
        default="auto",
    )
    parser.add_argument("--no-display", action="store_true")
    args = parser.parse_args()

    metadata = json.loads(
        METADATA_PATH.read_text(encoding="utf-8")
    )

    model_path = ROOT / metadata["onnx_file"]

    if not model_path.exists():
        raise FileNotFoundError(model_path)

    video_path = Path(args.video)

    if not video_path.exists():
        raise FileNotFoundError(video_path)

    class_names = metadata["class_names"]
    input_config = metadata["input"]
    preprocess = metadata["preprocessing"]
    temporal = metadata["temporal_sampling"]
    alert_config = metadata["alert_policy"]

    num_frames = int(temporal["num_frames"])
    sampling_rate = int(temporal["sampling_rate"])
    required_span = int(temporal["required_frame_span"])
    stride = int(temporal["inference_stride_frames"])
    input_size = int(input_config["shape"][-1])

    session = create_session(model_path, args.provider)
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    print("Modelo:", model_path)
    print("Providers activos:", session.get_providers())

    policy = AlertPolicy(
        class_names=class_names,
        smooth=int(
            alert_config["probability_smoothing_windows"]
        ),
        threshold=float(
            alert_config["crime_probability_threshold"]
        ),
        consecutive=int(
            alert_config["consecutive_windows_to_start"]
        ),
        release=int(
            alert_config["release_windows_to_end"]
        ),
    )

    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS))

    if not np.isfinite(fps) or fps <= 0:
        raise RuntimeError("FPS inválidos.")

    frame_buffer = deque(maxlen=required_span)

    frame_index = 0
    next_inference_frame = required_span - 1
    latest_probs = np.array([1, 0, 0, 0, 0], dtype=np.float32)
    smoothed_probs = latest_probs.copy()
    inference_ms = 0.0

    start_wall = time.perf_counter()

    print(f"Video: {video_path.name}")
    print(f"FPS: {fps:.2f}")
    print("Q o Esc para salir.")

    while True:
        ok, frame = cap.read()

        if not ok:
            break

        current_sec = frame_index / fps
        frame_buffer.append(frame.copy())

        if (
            frame_index >= next_inference_frame
            and len(frame_buffer) == required_span
        ):
            buffered = list(frame_buffer)

            sampled = [
                buffered[index * sampling_rate]
                for index in range(num_frames)
            ]

            tensor = prepare_clip(
                sampled,
                input_size,
                preprocess["mean"],
                preprocess["std"],
            )

            start = time.perf_counter()

            logits = session.run(
                [output_name],
                {input_name: tensor},
            )[0][0]

            inference_ms = (
                time.perf_counter() - start
            ) * 1000.0

            latest_probs = softmax(logits)
            state = policy.update(latest_probs, current_sec)
            smoothed_probs = state["smoothed"]

            if state["started"]:
                print(
                    f"ALERTA INICIADA {current_sec:.2f}s | "
                    f"{class_names[state['active_class']]} | "
                    f"{smoothed_probs[state['active_class']]:.1%}"
                )

            if state["ended"]:
                print(f"ALERTA FINALIZADA {current_sec:.2f}s")
                policy.alert_start = None

            next_inference_frame += stride

        if not args.no_display:
            display = cv2.resize(
                frame,
                (960, 720),
                interpolation=cv2.INTER_LINEAR,
            )

            panel = np.zeros((720, 430, 3), dtype=np.uint8)
            canvas = np.hstack([display, panel])

            if policy.active:
                state_text = "ALERTA"
                state_color = (30, 30, 255)
                shown_class = policy.active_class

                cv2.rectangle(
                    canvas,
                    (5, 5),
                    (955, 715),
                    state_color,
                    8,
                )
            elif policy.candidate_count > 0:
                state_text = (
                    f"CONFIRMANDO "
                    f"{policy.candidate_count}/"
                    f"{policy.consecutive}"
                )
                state_color = (0, 180, 255)
                shown_class = int(np.argmax(smoothed_probs))
            else:
                state_text = "NORMAL"
                state_color = (70, 200, 70)
                shown_class = int(np.argmax(smoothed_probs))

            x = 985

            cv2.putText(
                canvas,
                "VideoMAE ONNX",
                (x, 45),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            cv2.rectangle(
                canvas,
                (x, 75),
                (1365, 140),
                state_color,
                -1,
            )

            cv2.putText(
                canvas,
                state_text,
                (x + 15, 118),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            lines = [
                f"Tiempo: {current_sec:.2f} s",
                f"Clase: {class_names[shown_class]}",
                f"Inferencia: {inference_ms:.1f} ms",
                "",
                "Probabilidades suavizadas:",
            ]

            for index, name in enumerate(class_names):
                lines.append(
                    f"{name}: {smoothed_probs[index]:.1%}"
                )

            lines.extend([
                "",
                "smooth=4  threshold=0.40",
                "confirm=2 release=3",
                "",
                "Q / Esc: salir",
            ])

            for index, text in enumerate(lines):
                cv2.putText(
                    canvas,
                    text,
                    (x, 185 + index * 34),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (225, 225, 225),
                    1,
                    cv2.LINE_AA,
                )

            cv2.imshow("VideoMAE ONNX", canvas)

            target = start_wall + frame_index / fps
            delay = max(
                1,
                int((target - time.perf_counter()) * 1000),
            )

            key = cv2.waitKey(delay) & 0xFF

            if key in (ord("q"), 27):
                break

        frame_index += 1

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
