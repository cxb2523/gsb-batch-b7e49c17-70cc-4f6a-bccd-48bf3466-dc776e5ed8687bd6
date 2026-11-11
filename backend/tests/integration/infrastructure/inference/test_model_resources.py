from pathlib import Path
import app

APP = Path(app.__file__).resolve().parent

def test_videomae_still_resolves_existing_model_directory():
    from app.infrastructure.inference.videomae import MODEL_ROOT, load_metadata
    assert MODEL_ROOT == APP.parents[1] / "modelo"
    assert load_metadata()["input"]["shape"] == [1, 3, 16, 224, 224]
