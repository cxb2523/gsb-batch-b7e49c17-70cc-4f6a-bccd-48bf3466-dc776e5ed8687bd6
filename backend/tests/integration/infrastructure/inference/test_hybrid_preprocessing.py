"""El preprocesamiento del híbrido da exactamente los tensores del runner de Piero."""
import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from app.infrastructure.inference.hybrid import clip_image, videomae_frame  # noqa: E402
from app.infrastructure.inference.videomae import MODEL_ROOT, inference_helpers  # noqa: E402

CLIP_MEAN = np.asarray([0.48145466, 0.4578275, 0.40821073], dtype=np.float32).reshape(1, 1, 3)
CLIP_STD = np.asarray([0.26862954, 0.26130258, 0.27577711], dtype=np.float32).reshape(1, 1, 3)


def runner_crop_and_normalize(frame):
    # Copia literal de run_realtime_hybrid_onnx.py (image_crop(frame, 5)).
    image = cv2.resize(frame, dsize=(340, 256))
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = image[16:240, 58:282, :]
    image = cv2.flip(image, 1)
    image = image.astype(np.float32) / 255.0
    image = (image - CLIP_MEAN) / CLIP_STD
    return np.ascontiguousarray(image.transpose(2, 0, 1)[None], dtype=np.float32)


@pytest.fixture
def frames():
    rng = np.random.default_rng(7)
    return [rng.integers(0, 256, size=(720, 1280, 3), dtype=np.uint8) for _ in range(16)]


def test_clip_input_matches_runner(frames):
    image = clip_image(frames[0])
    assert image.shape == (224, 224, 3) and image.dtype == np.uint8
    tensor = (image.astype(np.float32) / 255.0 - CLIP_MEAN) / CLIP_STD
    tensor = tensor.transpose(2, 0, 1)[None]
    np.testing.assert_allclose(tensor, runner_crop_and_normalize(frames[0]), atol=1e-6)


def test_videomae_tensor_matches_prepare_clip(frames):
    if not (MODEL_ROOT / "infer_onnx.py").is_file():
        pytest.skip("Requiere modelo/infer_onnx.py")
    helpers = inference_helpers(MODEL_ROOT)
    mean, std = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
    expected = helpers.prepare_clip(frames, 224, mean, std)
    reduced = np.stack([videomae_frame(frame) for frame in frames]).astype(np.float32) / 255.0
    actual = ((reduced - np.reshape(mean, (1, 1, 1, 3))) / np.reshape(std, (1, 1, 1, 3))).transpose(3, 0, 1, 2)[None]
    np.testing.assert_allclose(actual, expected, atol=1e-6)


def test_portrait_frames_crop_the_long_side():
    frame = np.zeros((640, 360, 3), dtype=np.uint8)
    assert videomae_frame(frame).shape == (224, 224, 3)
