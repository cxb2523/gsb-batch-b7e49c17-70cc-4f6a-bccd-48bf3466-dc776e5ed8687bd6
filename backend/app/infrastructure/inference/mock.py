"""Explicit deterministic test predictor."""
from app.domain.inference import Window, Prediction

class MockPredictor:
    def predict(self, window: Window) -> Prediction:
        # Fixture fija para integración. No representa una detección real.
        return Prediction(clase="Hurto", confianza=0.75,
                          timestamp=window.timestamp, simulated=True)
