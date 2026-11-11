import pytest
from pydantic import ValidationError
from app.domain.camera import CameraRegistration


def test_public_camera_config_never_exposes_password():
    camera = CameraRegistration(source_id="cam", password="unit-only")
    assert camera.public_config()["has_password"] is True
    assert "password" not in camera.public_config()
    assert camera.private_config()["password"] == "unit-only"


@pytest.mark.parametrize("values", [
    {"source_id": "../cam"}, {"source_id": ""}, {"host": "not-an-ip"},
    {"port": 0}, {"stream_path": "../secret"}, {"fingerprint": "invalid"},
    {"protocol": "https"}, {"protocol": "rtsps", "fingerprint": ""},
])
def test_camera_rejects_invalid_connection_config(values):
    with pytest.raises(ValidationError):
        CameraRegistration.model_validate({"source_id": "cam", **values})
