"""Rol inference (modelos compartidos) y workers que le delegan la inferencia."""
import base64

import numpy as np
import pytest

IMAGE_BYTES = 224 * 224 * 3
CLIP_BYTES = 16 * IMAGE_BYTES
FEATURE_BYTES = 512 * 4
HEADERS = {"X-API-Key": "test-control-key"}


class FakeModels:
    def __init__(self):
        self.detected = []
        self.classified = []

    def health(self):
        return {"model_loaded": True, "gpu_active": True, "policy": "hybrid"}

    def detect(self, image, previous, rolling):
        self.detected.append((image.shape, image.dtype, len(previous), rolling))
        return np.full(512, .5, dtype=np.float32), (.9, "Assault", .7)

    def classify(self, frames):
        self.classified.append((len(frames), frames[0].shape, frames[0].dtype))
        return [0.0, 0.0, 0.0, 3.0, 0.0]


@pytest.fixture
def inference_server(configured):
    from fastapi.testclient import TestClient
    from app.bootstrap import create_app

    models = FakeModels()
    with TestClient(create_app(models, role="inference")) as client:
        yield client, models


def test_server_needs_no_database_and_checks_the_key(inference_server, monkeypatch):
    client, models = inference_server
    health = client.get("/health").json()
    assert health["role"] == "inference" and health["model_loaded"] is True
    assert client.post("/infer/detect", content=b"\0" * IMAGE_BYTES).status_code == 401
    assert client.post("/infer/classify", content=b"\0" * CLIP_BYTES).status_code == 401
    assert models.detected == [] and models.classified == []


def test_server_ignores_the_clerk_mode(configured, monkeypatch):
    from fastapi.testclient import TestClient
    from app.bootstrap import create_app

    monkeypatch.setenv("SENTRIX_AUTH_MODE", "clerk")
    with TestClient(create_app(FakeModels(), role="inference")) as client:
        response = client.post("/infer/detect", content=b"\0" * IMAGE_BYTES, headers=HEADERS)
    assert response.status_code == 200


def test_detect_returns_vector_and_score(inference_server):
    client, models = inference_server
    body = b"\0" * IMAGE_BYTES + np.ones((3, 512), dtype=np.float32).tobytes()
    reply = client.post("/infer/detect", content=body, headers=HEADERS).json()
    assert np.frombuffer(base64.b64decode(reply["feature"]), dtype=np.float32).shape == (512,)
    assert (reply["score"], reply["hint"], reply["hint_probability"]) == (.9, "Assault", .7)
    assert models.detected == [((224, 224, 3), "uint8", 3, 4)]


@pytest.mark.parametrize("size", [IMAGE_BYTES - 1, IMAGE_BYTES + 1, IMAGE_BYTES + 256 * FEATURE_BYTES])
def test_detect_rejects_bad_sizes(inference_server, size):
    client, models = inference_server
    assert client.post("/infer/detect", content=b"\0" * size, headers=HEADERS).status_code == 422
    assert models.detected == []


def test_detect_rejects_invalid_vectors(inference_server):
    client, models = inference_server
    body = b"\0" * IMAGE_BYTES + np.full((1, 512), np.nan, dtype=np.float32).tobytes()
    assert client.post("/infer/detect", content=body, headers=HEADERS).status_code == 422
    assert models.detected == []


def test_classify_accepts_a_clip_larger_than_the_public_limit(inference_server):
    client, models = inference_server
    response = client.post("/infer/classify", content=b"\0" * CLIP_BYTES, headers=HEADERS)
    assert response.status_code == 200 and response.json()["logits"][3] == 3.0
    assert models.classified == [(16, (224, 224, 3), "uint8")]
    assert client.post("/infer/classify", content=b"\0" * 10, headers=HEADERS).status_code == 422


def test_worker_with_inference_url_uses_the_hybrid_without_loading_models(configured, monkeypatch):
    from fastapi.testclient import TestClient
    from app.application.hybrid_processing import HybridProcessor
    from app.bootstrap import create_app
    from app.infrastructure.inference import hybrid
    from app.infrastructure.inference.remote import RemoteHybridPredictor

    monkeypatch.setenv("SENTRIX_INFERENCE_URL", "http://127.0.0.1:9")  # puerto cerrado: servidor caído
    monkeypatch.setattr(hybrid, "HybridPredictor", lambda **_: pytest.fail("no debe cargar el modelo"))
    monkeypatch.setattr(hybrid, "load_vadclip_metadata", _metadata_without_weights(hybrid))
    app = create_app(mode="hybrid", transport="rtsp")
    assert isinstance(app.state.video_receiver.processor, HybridProcessor)
    with TestClient(app) as client:
        assert isinstance(app.state.predictor, RemoteHybridPredictor)
        health = client.get("/health").json()
        assert health["inference"] == "remote" and health["inference_reachable"] is False
        assert health["policy"] == "hybrid"
    assert app.state.predictor is None


def _metadata_without_weights(hybrid):
    original = hybrid.load_vadclip_metadata

    def load(root=None, require_files=True):
        assert require_files is False, "un worker remoto no debe exigir los pesos"
        return original(root, require_files=False)
    return load


def test_inference_url_is_rejected_with_videomae_only(configured, monkeypatch):
    from app.bootstrap import create_app

    monkeypatch.setenv("SENTRIX_INFERENCE_URL", "http://127.0.0.1:9")
    with pytest.raises(ValueError, match="hybrid"):
        create_app(mode="videomae", transport="rtsp")


def test_unknown_role_is_rejected(configured):
    from app.bootstrap import create_app

    with pytest.raises(ValueError, match="inference"):
        create_app(role="otro")
