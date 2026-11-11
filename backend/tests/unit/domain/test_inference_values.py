import pytest
from pydantic import ValidationError
from app.domain.inference import Window, Prediction


@pytest.mark.parametrize("values", [
    {"timestamp": -1, "frames": [[[[0., 0., 0.]]]]},
    {"timestamp": 1, "frames": []},
    {"timestamp": 1, "frames": [[[[0., 0.]]]]},
    {"timestamp": 1, "frames": [[[[float("nan"), 0., 0.]]]]},
])
def test_window_rejects_invalid_timestamp_or_rgb_shape(values):
    with pytest.raises(ValidationError):
        Window.model_validate(values)


@pytest.mark.parametrize("confidence", [-.1, 1.1, float("nan")])
def test_prediction_rejects_invalid_confidence(confidence):
    with pytest.raises(ValidationError):
        Prediction(clase="Normal", confianza=confidence, timestamp=1, simulated=True)
