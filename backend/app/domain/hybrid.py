"""Política del híbrido VadCLIP + VideoMAE (runner de Piero), aplicada en vivo.

VadCLIP decide el inicio y el fin del evento; VideoMAE solo pone la clase. Se actualiza una vez por
bloque de 16 frames (~0,53 s a 30 fps), al último frame del bloque, igual que el runner.

Diferencias con el runner, que procesa un archivo completo y consolida al final:
- La unión de reactivaciones (≤ merge_gap) se hace en vivo: cuando VadCLIP suelta, la alerta queda
  "cerrándose" y solo se cierra en la base si en merge_gap segundos no se reactiva. El fin registrado
  es el momento en que VadCLIP soltó, no el de la espera.
- Los eventos de más de max_event_seconds se cortan en vivo: se cierra el tramo y se abre otro.
- Si VadCLIP abre antes de que haya 61 frames para VideoMAE (~2 s tras conectar), el evento empieza
  igual en ese momento; la fila de la alerta se guarda con la primera clase de VideoMAE.
- Si al final gana "normal", el evento NO se descarta: VadCLIP manda y se usa la clase criminal más
  probable (decisión del 04-11).
Sin red, SQL, NumPy ni entorno.
"""
import math
from collections import deque
from dataclasses import dataclass

CLASS_NAMES = ("normal", "hurto", "robo", "agresion_fisica", "vandalismo")


@dataclass(frozen=True)
class HybridConfig:
    sampling_stride: int = 16       # frames por actualización de VadCLIP
    rolling_features: int = 8       # contexto del cabezal (~4,3 s)
    threshold: float = .85          # puntaje de anomalía suavizado para abrir/mantener
    smooth: int = 2
    confirm: int = 1
    release: int = 3                # actualizaciones bajo el umbral para soltar (~1,6 s)
    merge_gap: float = 8.0          # segundos para unir una reactivación al mismo evento
    max_event_seconds: float = 120.0
    class_smooth: int = 4           # suavizado de la clase en vivo de VideoMAE
    videomae_steps: int = 4         # 4 bloques = 64 frames: span de 61 y paso de VideoMAE
    queue_size: int = 8             # bloques en espera (~4 s); si se llena se pierde uno (window_gap)

    def __post_init__(self):
        if self.sampling_stride != 16 or self.videomae_steps != 4:
            raise ValueError("El híbrido requiere bloques de 16 frames y VideoMAE cada 4 bloques")
        if not 1 <= self.rolling_features <= 256:
            raise ValueError("rolling_features debe estar entre 1 y 256")
        if not (math.isfinite(self.threshold) and 0 < self.threshold < 1):
            raise ValueError("El umbral de anomalía debe estar entre 0 y 1")
        if min(self.smooth, self.confirm, self.release, self.class_smooth) < 1:
            raise ValueError("smooth, confirm, release y class_smooth deben ser positivos")
        if not (self.merge_gap >= 0 and self.max_event_seconds > 0) or not 1 <= self.queue_size <= 32:
            raise ValueError("merge_gap, max_event_seconds o queue_size inválidos")


def softmax(values):
    top = max(values)
    exps = [math.exp(v - top) for v in values]
    total = sum(exps)
    return [v / total for v in exps]


class HybridPolicy:
    def __init__(self, config=None):
        self.config = config or HybridConfig()
        self.reset()

    def reset(self):
        c = self.config
        self.scores = deque(maxlen=c.smooth)
        self.class_history = deque(maxlen=c.class_smooth)
        self.incident = False           # VadCLIP sobre el umbral (alerta "activa" del runner)
        self.open = False               # hay una alerta abierta en la base (incluye la espera de unión)
        self.candidate_count = 0
        self.release_count = 0
        self.gate_until = None          # fin de la espera de unión tras soltar
        self.start = None               # inicio del tramo abierto
        self.pending_end = None         # momento en que VadCLIP soltó (fin del evento si no se reactiva)
        self.step = 0
        self.last_videomae_step = None
        self.windows = []               # (timestamp, logits) de VideoMAE dentro del tramo

    def update(self, timestamp, score, span_ready):
        """Una actualización de VadCLIP. Devuelve qué pasó y si hay que correr VideoMAE ahora."""
        c = self.config
        self.step += 1
        ended = None
        # Terminó la espera sin reactivación: el evento se cierra con el fin que marcó VadCLIP.
        if not self.incident and self.gate_until is not None and timestamp > self.gate_until:
            self.gate_until = None
            self.class_history.clear()
            if self.open:
                ended = self._end(self.pending_end)
        self.scores.append(float(score))
        smoothed = sum(self.scores) / len(self.scores)
        candidate = smoothed >= c.threshold
        started = resumed = released = split = False
        if not self.incident:
            self.candidate_count = self.candidate_count + 1 if candidate else 0
            if self.candidate_count >= c.confirm:
                if self.open:
                    resumed = True      # reactivación dentro de merge_gap: mismo evento
                    self.pending_end = None
                else:
                    self.class_history.clear()
                    started = True
                    self.start = timestamp
                    self.open = True
                self.gate_until = None
                self.incident = True
                self.release_count = 0
        else:
            if candidate:
                self.release_count = 0
            else:
                self.release_count += 1
                if self.release_count >= c.release:
                    self.incident = False
                    self.candidate_count = 0
                    self.release_count = 0
                    released = True
                    self.gate_until = timestamp + c.merge_gap
                    self.pending_end = timestamp
        if self.incident and not started and timestamp - self.start >= c.max_event_seconds:
            # Tramo técnico como el runner: se cierra aquí y sigue en una alerta nueva.
            ended = self._end(timestamp)
            self.start = timestamp
            self.open = True
            started = split = True
        gate = self.incident or (self.gate_until is not None and timestamp <= self.gate_until)
        scheduled = span_ready and (self.last_videomae_step is None
                                    or self.step - self.last_videomae_step >= c.videomae_steps)
        run_videomae = gate and span_ready and (scheduled or started or resumed or released)
        return {"timestamp": timestamp, "score": float(score), "smoothed_score": smoothed,
                "candidate": candidate, "incident": self.incident, "open": self.open,
                "started": started, "resumed": resumed, "released": released, "split": split,
                "ended": ended, "run_videomae": run_videomae, "start_timestamp": self.start if self.open else None,
                "pending_end": self.pending_end}

    def add_videomae(self, timestamp, logits):
        """Registra una clasificación de VideoMAE; devuelve probabilidades y clase en vivo suavizada."""
        if len(logits) != len(CLASS_NAMES) or not all(math.isfinite(v) for v in logits):
            raise ValueError("VideoMAE devolvió logits inválidos")
        self.last_videomae_step = self.step
        probabilities = softmax(list(logits))
        self.class_history.append(probabilities)
        smoothed = [sum(column) / len(self.class_history) for column in zip(*self.class_history)]
        if self.open:
            self.windows.append((timestamp, list(logits)))
        return probabilities, smoothed

    def live_class(self, smoothed):
        """Clase para mostrar mientras el evento sigue: la criminal más probable (VadCLIP ya dijo anomalía)."""
        index = max(range(1, len(CLASS_NAMES)), key=lambda i: smoothed[i])
        return CLASS_NAMES[index], smoothed[index]

    def _end(self, end):
        windows = [logits for ts, logits in self.windows if self.start <= ts <= end]
        if windows:
            mean = [sum(column) / len(windows) for column in zip(*windows)]
            probabilities = softmax(mean)
            winner = max(range(len(CLASS_NAMES)), key=lambda i: probabilities[i])
            # Si gana "normal", VadCLIP manda: se usa la clase criminal más probable.
            crime = winner if winner != 0 else max(range(1, len(CLASS_NAMES)), key=lambda i: probabilities[i])
            final = {"clase": CLASS_NAMES[crime], "confianza": probabilities[crime],
                     "videomae_normal": winner == 0, "windows": len(windows),
                     "probabilities": dict(zip(CLASS_NAMES, probabilities))}
        else:
            final = {"clase": None, "confianza": None, "videomae_normal": False, "windows": 0, "probabilities": None}
        result = {"start": self.start, "end": end, **final}
        self.windows = [(ts, logits) for ts, logits in self.windows if ts > end]
        self.open = False
        self.pending_end = None
        return result
