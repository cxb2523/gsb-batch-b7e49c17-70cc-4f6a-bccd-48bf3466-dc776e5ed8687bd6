"""Use cases run with in-memory ports, without FastAPI, SQL or GPU."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.application.cameras import CameraService
from app.application.errors import Conflict, InvalidInput, NotFound, Unavailable
from app.application.inference import InferenceService
from app.application.queries import RecordQueries
from app.domain.camera import CameraRegistration
from app.domain.inference import Prediction, Window


def test_inference_saves_validated_prediction_and_returns_detection_id():
    events, saved = [], []
    window = Window(timestamp=1, frames=[[[[0., 0., 0.]]]])

    class Model:
        def predict(self, value):
            assert value is window
            return Prediction(clase="Normal", confianza=.9, timestamp=1, simulated=True)

    class Repository:
        def save(self, result, camera):
            saved.append((result, camera))
            return {"id": "detection-1"}

    logs = SimpleNamespace(emit=lambda *args, **kwargs: events.append((args, kwargs)))
    service = InferenceService(lambda: Model(), Repository(), logs)
    result, identifier = service.predict(window)
    assert identifier == "detection-1" and result.clase == "Normal"
    assert saved[0][1] == window.source_id
    assert events[0][0][0] == "inference_completed"
    with pytest.raises(InvalidInput):
        InferenceService(lambda: Model(), Repository(), logs, real_mode=True).predict(window)

@pytest.mark.parametrize("stage", ["inference", "storage"])
def test_inference_failures_keep_operational_event_and_hide_internal_error(stage):
    events = []

    class Model:
        def predict(self, window):
            if stage == "inference":
                raise RuntimeError("private model diagnostic")
            return Prediction(clase="Normal", confianza=.9, timestamp=1, simulated=True)

    class Repository:
        def save(self, *args):
            raise RuntimeError("private database diagnostic")

    logs = SimpleNamespace(emit=lambda event, *args, **kwargs: events.append(event))
    service = InferenceService(lambda: Model(), Repository(), logs)
    with pytest.raises(Unavailable) as failure:
        service.predict(Window(timestamp=1, frames=[[[[0., 0., 0.]]]]))
    assert "private" not in str(failure.value)
    assert events == ["inference_error" if stage == "inference" else "detection_storage_error"]
