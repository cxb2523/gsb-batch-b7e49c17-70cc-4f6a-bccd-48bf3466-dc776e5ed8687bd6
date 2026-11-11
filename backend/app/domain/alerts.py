"""Temporal confirmation rules; no network, SQL or environment reads."""
DEFAULT_THRESHOLDS = {"Hurto": .50, "Robo": .60, "Agresión física": .60, "Vandalismo": .55}


class EventPolicy:
    def __init__(self, thresholds=None, confirmation=2, normal_confirmation=3):
        self.thresholds = dict(thresholds or DEFAULT_THRESHOLDS)
        if set(self.thresholds) != set(DEFAULT_THRESHOLDS) or any(
                not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in self.thresholds.values()):
            raise ValueError("Se requieren cuatro thresholds finitos entre 0 y 1")
        if confirmation < 1 or normal_confirmation < 1:
            raise ValueError("Las confirmaciones deben ser positivas")
        self.confirmation = confirmation
        self.normal_confirmation = normal_confirmation
        self.reset()

    def reset(self):
        self.active_class = None
        self.candidate_class = None
        self.candidate_count = 0
        self.release_count = 0
        self.start_timestamp = None

    def update(self, result, timestamp):
        clase, confidence = result["clase"], result["confianza"]
        candidate = clase in self.thresholds and confidence >= self.thresholds[clase]
        started = ended = False
        if self.active_class is None:
            self.candidate_count = self.candidate_count + 1 if candidate and clase == self.candidate_class else int(candidate)
            self.candidate_class = clase if candidate else None
            if self.candidate_count >= self.confirmation:
                self.active_class = clase
                self.start_timestamp = timestamp
                started = True
        else:
            # Una confianza criminal baja no equivale a haber vuelto a Normal.
            self.release_count = self.release_count + 1 if clase == "Normal" else 0
            if self.release_count >= self.normal_confirmation:
                ended = True
                self.active_class = None
                self.start_timestamp = None
                self.candidate_class = None
                self.candidate_count = 0
                self.release_count = 0
        return {**result, "alert": dict(active=self.active_class is not None, candidate=candidate,
            started=started, ended=ended, clase=self.active_class, start_timestamp=self.start_timestamp,
            candidate_count=self.candidate_count, release_count=self.release_count,
            threshold=self.thresholds.get(self.active_class or clase))}
