"""TA-2 provisional: muestreo por tiempo de video y ventanas sin solapamiento."""
import asyncio
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class PipelineConfig:
    fps: float = 4
    width: int = 64
    height: int = 64
    window_size: int = 8
    queue_size: int = 2

    def __post_init__(self):
        if not math.isfinite(self.fps) or not 0 < self.fps <= 60:
            raise ValueError("TA2_FPS debe estar entre 0 (exclusivo) y 60")
        if not 1 <= self.width <= 224 or not 1 <= self.height <= 224:
            raise ValueError("TA2_WIDTH y TA2_HEIGHT deben estar entre 1 y 224")
        if not 1 <= self.window_size <= 32 or not 1 <= self.queue_size <= 4:
            raise ValueError("TA2_WINDOW_SIZE: 1–32; TA2_QUEUE_SIZE: 1–4")


class WindowBuffer:
    def __init__(self, config):
        self.config = config
        self.queue = asyncio.Queue(maxsize=config.queue_size)
        self.partial = []
        self.last_timestamp = None
        self.next_sample = None
        self.sampled = 0
        self.created = 0
        self.dropped = 0
        self.invalid_timestamps = 0
        self.resets = 0

    def push(self, frame, timestamp):
        if timestamp is None or not math.isfinite(timestamp) or timestamp < 0:
            self.invalid_timestamps += 1
            return
        interval = 1 / self.config.fps
        if self.last_timestamp is not None:
            if timestamp == self.last_timestamp:
                return
            if timestamp < self.last_timestamp or timestamp - self.last_timestamp > max(1, 2 * interval):
                self.partial.clear()
                self.next_sample = None
                self.resets += 1
        self.last_timestamp = timestamp
        if self.next_sample is not None and timestamp + 1e-9 < self.next_sample:
            return
        if self.next_sample is None:
            self.next_sample = timestamp
        self.next_sample += (math.floor(max(0, timestamp - self.next_sample) / interval) + 1) * interval
        self.partial.append((frame, timestamp))
        self.sampled += 1
        if len(self.partial) == self.config.window_size:
            self.created += 1
            window = (self.created, self.partial)
            self.partial = []
            if self.queue.full():
                self.queue.get_nowait()
                self.queue.task_done()
                self.dropped += 1
            self.queue.put_nowait(window)

    def clear(self):
        self.partial.clear()
        while not self.queue.empty():
            self.queue.get_nowait()
            self.queue.task_done()


@dataclass(frozen=True)
class VideoMAEConfig:
    window_size: int = 16
    sampling_rate: int = 4
    required_frame_span: int = 61
    inference_stride_frames: int = 64
    width: int = 224
    height: int = 224
    queue_size: int = 2
    sampling_mode: str = "received_frame_index"

    def __post_init__(self):
        if self.required_frame_span != (self.window_size - 1) * self.sampling_rate + 1:
            raise ValueError("Span incompatible con el muestreo VideoMAE")
        if self.inference_stride_frames < self.required_frame_span or not 1 <= self.queue_size <= 4:
            raise ValueError("Stride o cola VideoMAE inválidos")


class VideoMAEBuffer(WindowBuffer):
    """Frames 0,4,...,60; siguiente ventana 64,68,...,124, como Piero."""
    def __init__(self, config):
        super().__init__(config)
        self.frame_index = 0

    def push(self, frame, timestamp):
        if timestamp is None or not math.isfinite(timestamp) or timestamp < 0:
            self.invalid_timestamps += 1
            self.partial.clear()
            self.frame_index = 0
            self.resets += 1
            self.last_timestamp = None
            return
        if self.last_timestamp is not None:
            if timestamp == self.last_timestamp:
                return
            if timestamp < self.last_timestamp or timestamp - self.last_timestamp > 1:
                self.partial.clear()
                self.frame_index = 0
                self.resets += 1
        self.last_timestamp = timestamp
        index = self.frame_index % self.config.inference_stride_frames
        self.frame_index += 1
        if index >= self.config.required_frame_span or index % self.config.sampling_rate:
            return
        self.partial.append((frame, timestamp, self.resets))
        self.sampled += 1
        if len(self.partial) == self.config.window_size:
            self.created += 1
            window = (self.created, self.partial)
            self.partial = []
            if self.queue.full():
                self.queue.get_nowait()
                self.queue.task_done()
                self.dropped += 1
            self.queue.put_nowait(window)


class HybridBuffer(WindowBuffer):
    """Bloques de 16 frames para el híbrido, como el runner de Piero.

    De cada bloque guarda el primer frame (entrada de CLIP) y los frames 3, 7, 11 y 15, que son los que
    VideoMAE toma de los últimos 61 cuando corre al final de un bloque (16 frames, uno de cada 4).
    El bloque sale a la cola en su frame 15, con el timestamp de ese frame.
    """
    VIDEOMAE_POSITIONS = (3, 7, 11, 15)

    def __init__(self, config):
        super().__init__(config)
        self.frame_index = 0
        self.first = None

    def _restart(self):
        self.partial.clear()
        self.first = None
        self.frame_index = 0
        self.resets += 1

    def push(self, frame, timestamp):
        if timestamp is None or not math.isfinite(timestamp) or timestamp < 0:
            self.invalid_timestamps += 1
            self._restart()
            self.last_timestamp = None
            return
        if self.last_timestamp is not None:
            if timestamp == self.last_timestamp:
                return
            if timestamp < self.last_timestamp or timestamp - self.last_timestamp > 1:
                self._restart()
        self.last_timestamp = timestamp
        position = self.frame_index % self.config.sampling_stride
        self.frame_index += 1
        if position == 0:
            self.first = frame
            self.partial = []
        if position in self.VIDEOMAE_POSITIONS:
            self.partial.append(frame)
            self.sampled += 1
        if position == self.config.sampling_stride - 1 and self.first is not None and len(self.partial) == 4:
            self.created += 1
            block = (self.created, {"clip": self.first, "videomae": self.partial, "timestamp": timestamp,
                                    "epoch": self.resets})
            self.partial = []
            self.first = None
            if self.queue.full():
                self.queue.get_nowait()
                self.queue.task_done()
                self.dropped += 1
            self.queue.put_nowait(block)
