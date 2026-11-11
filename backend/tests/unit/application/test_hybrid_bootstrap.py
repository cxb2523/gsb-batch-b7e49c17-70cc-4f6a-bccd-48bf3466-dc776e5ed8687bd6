"""El arranque elige el híbrido por defecto y lo conecta sin cargar los modelos todavía."""
import json

import pytest


def write_metadata(root, **policy):
    root.mkdir()
    for name in ("clip_visual.onnx", "vadclip_head.onnx"):
        (root / name).write_bytes(b"x")
    from app.infrastructure.inference.hybrid import VADCLIP_CLASSES
    (root / "metadata.json").write_text(json.dumps({
        "clip": {"onnx_file": "clip_visual.onnx", "input": {"name": "images", "shape": [1, 3, 224, 224]},
                 "output": {"name": "features", "shape": [1, 512]},
                 "mean": [0.48145466, 0.4578275, 0.40821073], "std": [0.26862954, 0.26130258, 0.27577711]},
        "head": {"onnx_file": "vadclip_head.onnx", "context_length": 256, "classes": VADCLIP_CLASSES},
        "policy": policy}), encoding="utf-8")


def test_hybrid_is_the_default_and_uses_block_processing(configured, monkeypatch, tmp_path):
    write_metadata(tmp_path / "vadclip", threshold=0.8)
    monkeypatch.setenv("SENTRIX_VADCLIP_ROOT", str(tmp_path / "vadclip"))
    monkeypatch.delenv("SENTRIX_PREDICTOR")
    monkeypatch.setenv("SENTRIX_HYBRID_RELEASE", "4")
    from app.application.hybrid_processing import HybridContext, HybridProcessor
    from app.bootstrap import create_app
    from app.domain.pipeline import HybridBuffer
    app = create_app()
    receiver = app.state.video_receiver
    assert isinstance(receiver.processor, HybridProcessor)
    assert receiver.buffer_factory is HybridBuffer
    context = receiver.policy_factory()
    assert isinstance(context, HybridContext)
    # metadata.json fija el umbral y el entorno puede ajustar el resto.
    assert context.config.threshold == 0.8 and context.config.release == 4
    assert app.state.predictor is None   # se carga en el arranque (lifespan)


def test_videomae_mode_keeps_en4(configured, monkeypatch):
    monkeypatch.setenv("SENTRIX_PREDICTOR", "videomae")
    from app.application.processing import WindowProcessor
    from app.bootstrap import create_app
    assert isinstance(create_app().state.video_receiver.processor, WindowProcessor)


def test_missing_vadclip_models_fail_at_startup(configured, monkeypatch, tmp_path):
    monkeypatch.setenv("SENTRIX_VADCLIP_ROOT", str(tmp_path / "no-existe"))
    monkeypatch.setenv("SENTRIX_PREDICTOR", "hybrid")
    from app.bootstrap import create_app
    with pytest.raises(FileNotFoundError):
        create_app()


def test_unknown_predictor_is_rejected(configured, monkeypatch):
    monkeypatch.setenv("SENTRIX_PREDICTOR", "meanpool")
    from app.bootstrap import create_app
    with pytest.raises(ValueError):
        create_app()
