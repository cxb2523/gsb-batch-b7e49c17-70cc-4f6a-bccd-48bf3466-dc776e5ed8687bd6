"""El cliente remoto envía lo que espera el servidor y devuelve lo mismo que el predictor local."""
import base64
import json

import httpx
import numpy as np
import pytest

IMAGE_BYTES = 224 * 224 * 3
CLIP_BYTES = 16 * IMAGE_BYTES
FEATURE_BYTES = 512 * 4


def remote(handler):
    from app.infrastructure.inference.remote import RemoteHybridPredictor
    return RemoteHybridPredictor("http://inferencia:8099", "clave", transport=httpx.MockTransport(handler))


def image():
    return np.zeros((224, 224, 3), dtype=np.uint8)


def detect_reply(feature=None):
    feature = np.full(512, .25, dtype=np.float32) if feature is None else feature
    return {"feature": base64.b64encode(feature.tobytes()).decode(), "score": .9, "hint": "Assault",
            "hint_probability": .7}


@pytest.mark.parametrize("previous, rolling, sent", [(0, 8, 0), (3, 8, 3), (7, 8, 7), (8, 8, 7), (5, 1, 0)])
def test_detect_sends_only_the_vectors_the_head_can_use(previous, rolling, sent):
    seen = {}

    def handler(request):
        seen.update(path=request.url.path, size=len(request.content), key=request.headers["x-api-key"])
        return httpx.Response(200, json=detect_reply())

    feature, result = remote(handler).detect(image(), [np.ones(512, dtype=np.float32)] * previous, rolling)
    assert seen == {"path": "/infer/detect", "size": IMAGE_BYTES + sent * FEATURE_BYTES, "key": "clave"}
    assert feature.shape == (512,) and feature[0] == .25
    assert result == (.9, "Assault", .7)


def test_detect_keeps_the_most_recent_vectors_in_order():
    seen = {}

    def handler(request):
        seen["body"] = request.content
        return httpx.Response(200, json=detect_reply())

    remote(handler).detect(image(), [np.full(512, i, dtype=np.float32) for i in range(10)], 8)
    vectors = np.frombuffer(seen["body"], dtype=np.float32, offset=IMAGE_BYTES).reshape(-1, 512)
    assert vectors[:, 0].tolist() == [3, 4, 5, 6, 7, 8, 9]


def test_classify_sends_the_clip_and_rejects_a_wrong_length():
    def handler(request):
        assert request.url.path == "/infer/classify" and len(request.content) == CLIP_BYTES
        return httpx.Response(200, json={"logits": [0, 0, 0, 3, 0]})

    predictor = remote(handler)
    assert predictor.classify([image()] * 16) == [0, 0, 0, 3, 0]
    with pytest.raises(ValueError):
        predictor.classify([image()] * 15)


def test_a_server_error_reaches_the_processor():
    predictor = remote(lambda request: httpx.Response(500, json={"detail": "x"}))
    with pytest.raises(httpx.HTTPStatusError):
        predictor.detect(image(), [], 8)


def test_predict_returns_the_prediction_shape():
    from types import SimpleNamespace

    def handler(request):
        return httpx.Response(200, content=json.dumps({"logits": [0, 0, 0, 3, 0]}),
                              headers={"Content-Type": "application/json"})

    frames = np.zeros((16, 240, 320, 3), dtype=np.float32).tolist()
    result = remote(handler).predict(SimpleNamespace(frames=frames, timestamp=4.5))
    assert result["clase"] == "Agresión física" and result["timestamp"] == 4.5 and result["simulated"] is False
    assert sum(result["probabilities"].values()) == pytest.approx(1)


def test_health_hides_the_server_address_when_unreachable():
    def refuse(request):
        raise httpx.ConnectError("sin servidor", request=request)

    health = remote(refuse).health()
    assert health["inference_reachable"] is False and health["model_loaded"] is False
    assert health["policy"] == "hybrid" and "inferencia:8099" not in str(health)


def test_prepare_block_needs_no_model():
    from app.infrastructure.inference.remote import RemoteHybridPredictor

    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    picture, frames = RemoteHybridPredictor.prepare_block({"clip": frame, "videomae": [frame] * 16})
    assert picture.shape == (224, 224, 3) and len(frames) == 16 and frames[0].shape == (224, 224, 3)
