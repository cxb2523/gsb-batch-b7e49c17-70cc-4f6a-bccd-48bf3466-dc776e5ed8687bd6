"""The 360 equirectangular pipeline, on synthetic inputs and fake tools.

Nothing here touches a real ml-sharp or a real splat-transform: the depth step
is replaced by a function that writes a tiny valid PLY, and the merge step is
driven by throwaway scripts written into the test's temporary directory. What
is under test is the orchestration the backend itself owns -- cube face
extraction and validation, the per-face rotation, and the three merge outcomes
(success, tool missing, tool failing) together with the metadata that records
which one happened.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from plyfile import PlyData, PlyElement

from app.services import mode360, storage


def _make_equirectangular(path: Path, width: int = 24, height: int = 12) -> Path:
    """Write a small but genuine 2:1 equirectangular-style image."""

    lon = np.linspace(0.0, 2.0 * np.pi, width, endpoint=False)
    lat = np.linspace(-np.pi / 2.0, np.pi / 2.0, height)
    # Three smooth gradients keyed off longitude/latitude, so every cube face
    # samples a different region rather than a flat, featureless rectangle.
    r = (128.0 + 127.0 * np.sin(lon)[None, :]).repeat(height, axis=0)
    g = (128.0 + 127.0 * np.cos(lon)[None, :]).repeat(height, axis=0)
    b = (128.0 + 127.0 * np.sin(lat)[:, None]).repeat(width, axis=1)
    pixels = np.stack([r, g, b], axis=-1).astype(np.uint8)
    Image.fromarray(pixels).save(path)
    return path


def _write_tiny_ply(path: Path, seed: int = 0) -> None:
    """Write a minimal valid point PLY with the fields the pipeline rewrites."""

    count = 12
    base = np.linspace(-1.0, 1.0, count, dtype=np.float32)
    vertices = np.empty(
        count,
        dtype=[
            ("x", "f4"),
            ("y", "f4"),
            ("z", "f4"),
            ("rot_0", "f4"),
            ("rot_1", "f4"),
            ("rot_2", "f4"),
            ("rot_3", "f4"),
        ],
    )
    vertices["x"] = base
    vertices["y"] = base[::-1] + float(seed) * 0.01
    vertices["z"] = np.full(count, -2.0, dtype=np.float32)
    vertices["rot_0"] = 1.0
    vertices["rot_1"] = 0.0
    vertices["rot_2"] = 0.0
    vertices["rot_3"] = 0.0
    PlyData([PlyElement.describe(vertices, "vertex")]).write(path)


def _fake_run_mlsharp(job, stdout_path=None, stderr_path=None, append_logs=False):
    """Stand-in for ml-sharp: emit the PLY the real tool would have produced."""

    input_stem = job.input_image.stem or "scene"
    ply_out = job.workdir / f"{input_stem}.ply"
    _write_tiny_ply(ply_out, seed=len(input_stem))
    return ply_out


def _write_python_tool(path: Path, *, succeeds: bool) -> str:
    """A temporary merge CLI: writes its last arg as output, then exits.

    Returns the command list joined the way an env var carries it. The script
    is run through the current interpreter so the test needs no executable bit
    and behaves identically on Windows and Linux.
    """

    if succeeds:
        body = (
            "import sys\n"
            "out = sys.argv[-1]\n"
            "with open(out, 'wb') as handle:\n"
            "    handle.write(b'merged ply bytes')\n"
            "sys.exit(0)\n"
        )
    else:
        # Writes partial output before failing, to prove the pipeline discards
        # half-finished merge files instead of treating them as a scene.
        body = (
            "import sys\n"
            "out = sys.argv[-1]\n"
            "with open(out, 'wb') as handle:\n"
            "    handle.write(b'partial')\n"
            "sys.stderr.write('synthetic merge failure\\n')\n"
            "sys.exit(1)\n"
        )
    path.write_text(body, encoding="utf-8")
    return f"{sys.executable} {path}"


@pytest.fixture
def isolated_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point storage at the test's own directory, never the real .data."""

    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(storage, "DATA_ROOT", root)
    monkeypatch.setattr(mode360.storage, "DATA_ROOT", root)
    return root


# --------------------------------------------------------------------------- #
# Cube face extraction
# --------------------------------------------------------------------------- #


def test_extract_cube_faces_writes_six_faces_in_face_spec_order(tmp_path: Path) -> None:
    source = _make_equirectangular(tmp_path / "pano.360.jpg")
    workdir = tmp_path / "job"
    workdir.mkdir()

    extractions = mode360.extract_cube_faces(source, workdir)

    assert [item.face.index for item in extractions] == [spec.index for spec in mode360.FACE_SPECS]
    assert [item.face.name for item in extractions] == [spec.name for spec in mode360.FACE_SPECS]
    for index, extraction in enumerate(extractions):
        expected = workdir / f"face_{index}.jpg"
        assert extraction.image_path == expected
        assert expected.is_file() and expected.stat().st_size > 0
        # Every face is a square image of the source's height.
        with Image.open(expected) as face_img:
            assert face_img.size == (12, 12)
        # The clamped FOV is carried on the extraction itself.
        assert extraction.face.fov_deg == mode360.DEFAULT_OVERSCAN_FOV_DEG


def test_fov_is_clamped_and_recorded_on_every_face(tmp_path: Path) -> None:
    source = _make_equirectangular(tmp_path / "pano.360.PNG")
    workdir = tmp_path / "job"
    workdir.mkdir()

    too_wide = mode360.extract_cube_faces(source, workdir, overscan_fov_deg=142.0)
    assert {item.face.fov_deg for item in too_wide} == {110.0}

    for face in workdir.glob("face_*.jpg"):
        face.unlink()
    too_narrow = mode360.extract_cube_faces(source, workdir, overscan_fov_deg=40.0)
    assert {item.face.fov_deg for item in too_narrow} == {100.0}


def test_360_filename_detection_is_case_insensitive_and_accepts_jpeg() -> None:
    accepted = [
        "room.360.jpg",
        "room.360.JPG",
        "room.360.Jpeg",
        "room.360.jpeg",
        "ROOM.360.PNG",
        "room.360.png",
    ]
    rejected = ["room.jpg", "room.360.webp", "room360.jpg", "room.360.jpg.bak"]

    assert all(mode360.is_360_filename(name) for name in accepted)
    assert not any(mode360.is_360_filename(name) for name in rejected)


# --------------------------------------------------------------------------- #
# Invalid inputs
# --------------------------------------------------------------------------- #


def test_missing_source_raises_mode360_error(tmp_path: Path) -> None:
    with pytest.raises(mode360.Mode360Error, match="not found"):
        mode360.extract_cube_faces(tmp_path / "absent.360.jpg", tmp_path / "job")


def test_zero_byte_source_raises_mode360_error(tmp_path: Path) -> None:
    source = tmp_path / "empty.360.jpg"
    source.write_bytes(b"")
    with pytest.raises(mode360.Mode360Error, match="empty"):
        mode360.extract_cube_faces(source, tmp_path / "job")


def test_unreadable_source_raises_mode360_error(tmp_path: Path) -> None:
    # A non-empty file that is not an image must report a Mode360Error rather
    # than letting PIL's own exception escape the pipeline.
    source = tmp_path / "broken.360.jpeg"
    source.write_bytes(b"this is definitely not a jpeg")
    with pytest.raises(mode360.Mode360Error, match="could not be read"):
        mode360.extract_cube_faces(source, tmp_path / "job")


def test_wrong_aspect_ratio_raises_mode360_error(tmp_path: Path) -> None:
    # 3:1 is well outside the 0.1 tolerance around 2:1.
    off_ratio = tmp_path / "wide.360.jpg"
    Image.fromarray(np.zeros((10, 30, 3), dtype=np.uint8)).save(off_ratio)
    with pytest.raises(mode360.Mode360Error, match="aspect ratio"):
        mode360.extract_cube_faces(off_ratio, tmp_path / "job")


def test_borderline_aspect_ratio_is_accepted(tmp_path: Path) -> None:
    # 2.08:1 deviates by 0.08, inside the 0.1 tolerance.
    source = tmp_path / "near.360.jpg"
    Image.fromarray(np.zeros((12, 25, 3), dtype=np.uint8)).save(source)
    workdir = tmp_path / "job"
    workdir.mkdir()
    extractions = mode360.extract_cube_faces(source, workdir)
    assert len(extractions) == 6


# --------------------------------------------------------------------------- #
# Full pipeline: the three merge outcomes
# --------------------------------------------------------------------------- #


def _run_pipeline(
    tmp_path: Path,
    isolated_data_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    merge_cli_env: str | None,
):
    monkeypatch.setattr(mode360.mlsharp, "run_mlsharp", _fake_run_mlsharp)
    if merge_cli_env is None:
        monkeypatch.delenv("SPLAT_MERGE_CLI", raising=False)
        monkeypatch.setattr(mode360.shutil, "which", lambda _name: None)
    else:
        monkeypatch.setenv("SPLAT_MERGE_CLI", str(merge_cli_env))

    job_id = "testjob"
    job_dir = storage.job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    source = _make_equirectangular(job_dir / "pano.360.jpg")

    metadata = mode360.process_equirectangular_job(
        job_id, source, job_dir, mlsharp_cli="fake-ml-sharp"
    )
    return job_id, job_dir, source, metadata


def _assert_six_layers_and_face_metadata(job_dir: Path, metadata: dict) -> None:
    mode_meta = metadata["mode360"]
    assert mode_meta["enabled"] is True
    assert len(mode_meta["faces"]) == 6
    assert mode_meta["layers"] == [f"face_{i}.ply" for i in range(6)]
    for index, face in enumerate(mode_meta["faces"]):
        spec = mode360.FACE_SPECS[index]
        assert face["index"] == spec.index
        assert face["name"] == spec.name
        assert face["yawDeg"] == spec.yaw_deg
        assert face["pitchDeg"] == spec.pitch_deg
        assert face["rollDeg"] == spec.roll_deg
        assert face["fovDeg"] == mode360.DEFAULT_OVERSCAN_FOV_DEG
        assert face["image"] == f"face_{index}.jpg"
        assert face["ply"] == f"face_{index}.ply"
    for index in range(6):
        assert (job_dir / f"face_{index}.jpg").is_file()
        assert (job_dir / f"face_{index}.ply").is_file()
    # metadata.json is always written, regardless of the merge branch.
    on_disk = json.loads(storage.metadata_path("testjob").read_text(encoding="utf-8"))
    assert on_disk == metadata


def test_pipeline_merges_when_tool_succeeds(
    tmp_path: Path, isolated_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tool = _write_python_tool(tmp_path / "good_merge.py", succeeds=True)
    job_id, job_dir, source, metadata = _run_pipeline(
        tmp_path, isolated_data_root, monkeypatch, merge_cli_env=tool
    )

    merged_name = f"{source.stem}.ply"
    mode_meta = metadata["mode360"]
    assert mode_meta["mergeState"] == "merged"
    assert mode_meta["mergedPly"] == merged_name
    assert (job_dir / merged_name).is_file()
    _assert_six_layers_and_face_metadata(job_dir, metadata)

    stdout = storage.stdout_log_path(job_id).read_text(encoding="utf-8")
    assert "360 merge: using" in stdout
    assert "SKIPPED" not in stdout and "FAILED" not in stdout


def test_pipeline_skips_merge_when_tool_missing(
    tmp_path: Path, isolated_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id, job_dir, source, metadata = _run_pipeline(
        tmp_path, isolated_data_root, monkeypatch, merge_cli_env=None
    )

    mode_meta = metadata["mode360"]
    assert mode_meta["mergeState"] == "skipped"
    assert mode_meta["mergedPly"] is None
    # The six layers survive for multi-layer playback.
    _assert_six_layers_and_face_metadata(job_dir, metadata)
    # No merged output of any name is left behind.
    assert not (job_dir / f"{source.stem}.ply").exists()
    assert sorted(job_dir.glob("*.ply")) == [job_dir / f"face_{i}.ply" for i in range(6)]

    stdout = storage.stdout_log_path(job_id).read_text(encoding="utf-8")
    assert "360 merge: SKIPPED" in stdout
    assert "SPLAT_MERGE_CLI" in stdout
    assert "splat-transform" in stdout


def test_pipeline_survives_failing_merge_and_keeps_no_half_output(
    tmp_path: Path, isolated_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tool = _write_python_tool(tmp_path / "bad_merge.py", succeeds=False)
    job_id, job_dir, source, metadata = _run_pipeline(
        tmp_path, isolated_data_root, monkeypatch, merge_cli_env=tool
    )

    mode_meta = metadata["mode360"]
    assert mode_meta["mergeState"] == "failed"
    assert mode_meta["mergedPly"] is None
    _assert_six_layers_and_face_metadata(job_dir, metadata)
    # The tool's partial output must have been discarded.
    merged_path = job_dir / f"{source.stem}.ply"
    assert not merged_path.exists()
    assert sorted(job_dir.glob("*.ply")) == [job_dir / f"face_{i}.ply" for i in range(6)]

    stdout = storage.stdout_log_path(job_id).read_text(encoding="utf-8")
    stderr = storage.stderr_log_path(job_id).read_text(encoding="utf-8")
    assert "360 merge: FAILED" in stdout
    assert "synthetic merge failure" in stderr


def test_merge_helper_discards_stale_output_before_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # With no tool available at all, a pre-existing output file from an older
    # run must not be mistaken for a freshly merged scene.
    monkeypatch.delenv("SPLAT_MERGE_CLI", raising=False)
    monkeypatch.setattr(mode360.shutil, "which", lambda _name: None)
    output = tmp_path / "stale.ply"
    output.write_bytes(b"from a previous run")
    inputs = [tmp_path / "face_0.ply"]
    inputs[0].write_bytes(b"x")

    ok = mode360._merge_plys(
        "splat-transform",
        output,
        inputs,
        tmp_path / "out.log",
        tmp_path / "err.log",
    )

    assert ok is False
    assert not output.exists()
