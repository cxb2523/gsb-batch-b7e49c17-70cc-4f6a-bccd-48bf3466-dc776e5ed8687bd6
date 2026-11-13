# This copyright notice applies to this file only
#
# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: MIT

"""Unit tests for transcode.py that run without a GPU or network access.

PyNvVideoCodec and pycuda are replaced by lightweight in-process fakes before
the module under test is imported. The fakes record every call so tests can
assert on the exact keyword arguments handed to CreateEncoder.
"""

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
TRANSCODE_PATH = Path(__file__).resolve().parent / "transcode.py"


class FakeState:
    """Mutable configuration shared by the fake demuxer/decoder/encoder."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.packets = [object()]
        self.frames_per_packet = 1
        self.total_decoded_frames = None  # None -> frames_per_packet per packet
        self.width = 64
        self.height = 32
        self.encoder_kwargs = []
        self.encoder_calls = []
        self.encoded_frames = 0
        self.end_encode_calls = 0
        self.demuxer_created = 0
        self.decoder_created = 0
        self.frame_size = self.width * self.height * 3 // 2


STATE = FakeState()


class FakeFrame:
    def __init__(self, width, height, format):
        self.width = width
        self.height = height
        self.format = format
        self.gpuAlloc = object()
        self.frameSize = width * height * 3 // 2


class FakeDecodedFrame:
    def GetPtrToPlane(self, plane):
        return 0


class FakeDemuxer:
    def __init__(self, filename):
        STATE.demuxer_created += 1
        self.filename = filename

    def __iter__(self):
        return iter(STATE.packets)

    def GetNvCodecId(self):
        return "h264"


class FakeDecoder:
    def __init__(self, **kwargs):
        STATE.decoder_created += 1
        self.kwargs = kwargs
        self._remaining = STATE.total_decoded_frames

    def Decode(self, packet):
        if STATE.frames_per_packet <= 0:
            return iter(())
        if self._remaining is not None:
            count = min(STATE.frames_per_packet, self._remaining)
            self._remaining -= count
        else:
            count = STATE.frames_per_packet
        return iter([FakeDecodedFrame() for _ in range(count)])

    def GetWidth(self):
        return STATE.width

    def GetHeight(self):
        return STATE.height

    def GetFrameSize(self):
        return STATE.frame_size


class FakeEncoder:
    def __init__(self, width, height, fmt, use_cpu, **kwargs):
        STATE.encoder_kwargs.append(dict(kwargs))
        STATE.encoder_calls.append(
            {"width": width, "height": height, "fmt": fmt, "use_cpu": use_cpu, **kwargs}
        )
        self.frames = 0

    def Encode(self, frame):
        self.frames += 1
        STATE.encoded_frames += 1
        return bytes([0xAA])

    def EndEncode(self):
        STATE.end_encode_calls += 1
        return bytes([0xBB])


def _install_fake_modules():
    """Register GPU-dependent modules with fakes, before importing transcode."""
    nvc = types.ModuleType("PyNvVideoCodec")
    nvc.CreateDemuxer = lambda **kwargs: FakeDemuxer(**kwargs)
    nvc.CreateDecoder = lambda **kwargs: FakeDecoder(**kwargs)
    nvc.CreateEncoder = FakeEncoder

    pycuda = types.ModuleType("pycuda")
    pycuda_driver = types.ModuleType("pycuda.driver")
    pycuda_driver.memcpy_dtod = lambda *args, **kwargs: None
    pycuda_driver.mem_alloc = lambda size: object()
    pycuda_autoinit = types.ModuleType("pycuda.autoinit")
    pycuda_compiler = types.ModuleType("pycuda.compiler")
    pycuda_compiler.SourceModule = object

    nvc_utils = types.ModuleType("common.nvc_utils")
    nvc_utils.AppFrame = FakeFrame

    sys.modules.update(
        {
            "PyNvVideoCodec": nvc,
            "pycuda": pycuda,
            "pycuda.driver": pycuda_driver,
            "pycuda.autoinit": pycuda_autoinit,
            "pycuda.compiler": pycuda_compiler,
            "common.nvc_utils": nvc_utils,
        }
    )


def _load_transcode_module():
    spec = importlib.util.spec_from_file_location("transcode_under_test", TRANSCODE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
_install_fake_modules()
transcode = _load_transcode_module()


@pytest.fixture(autouse=True)
def _reset_state():
    STATE.reset()
    yield


def _write_config(tmp_path, payload, name="config.json"):
    path = tmp_path / name
    path.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    return path


def _run(argv):
    return transcode.main(argv)


def test_config_file_is_used_and_cli_overrides_only_codec_and_preset(tmp_path, capsys):
    config = {
        "codec": "h264",
        "preset": "P3",
        "rc": "vbr",
        "fps": 25,
        "gop": 250,
        "bf": 3,
        "bitrate": "10M",
        "maxbitrate": 0,
    }
    config_path = _write_config(tmp_path, config)
    out_path = tmp_path / "out.h264"
    STATE.frames_per_packet = 2
    STATE.packets = [object(), object(), object()]

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(out_path),
        "-c", "HEVC",
        "-p", "p5",
        "-json", str(config_path),
    ])

    assert rc == 0
    assert len(STATE.encoder_kwargs) == 1
    received = STATE.encoder_kwargs[0]
    # CLI-provided keys override the file and are normalized.
    assert received["codec"] == "hevc"
    assert received["preset"] == "P5"
    # Every other file key is forwarded verbatim.
    assert received["bitrate"] == "10M"
    assert received["gop"] == 250
    assert received["bf"] == 3
    assert received["rc"] == "vbr"
    assert received["fps"] == 25
    assert received["maxbitrate"] == 0
    # All decoded frames are encoded and the encoder is flushed exactly once.
    assert len(STATE.encoder_calls) == 1
    assert STATE.end_encode_calls == 1
    assert out_path.stat().st_size > 0


def test_config_file_alone_supplies_codec_and_preset(tmp_path):
    config_path = _write_config(tmp_path, {"codec": "AV1", "preset": "p4", "gop": 60})
    STATE.frames_per_packet = 1
    STATE.packets = [object()]

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(tmp_path / "out.h264"),
        "-json", str(config_path),
    ])

    assert rc == 0
    assert STATE.encoder_kwargs[0]["codec"] == "av1"
    assert STATE.encoder_kwargs[0]["preset"] == "P4"
    assert STATE.encoder_kwargs[0]["gop"] == 60


def test_without_json_keeps_legacy_normalization(tmp_path):
    STATE.packets = [object()]

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(tmp_path / "out.h264"),
        "-c", "H264",
        "-p", "p1",
    ])

    assert rc == 0
    assert STATE.encoder_kwargs[0]["codec"] == "h264"
    assert STATE.encoder_kwargs[0]["preset"] == "P1"


@pytest.mark.parametrize(
    "payload, expected_key",
    [
        ("{ this is not json", None),
        ({"codec": "h264"}, "preset"),
        ({"preset": "P3"}, "codec"),
        ({"codec": "h264", "preset": "P9"}, "preset"),
        ({"codec": "h264", "preset": "high"}, "preset"),
    ],
)
def test_invalid_config_fails_before_creating_output(tmp_path, payload, expected_key, capsys):
    config_path = _write_config(tmp_path, payload)
    out_path = tmp_path / "out.h264"

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(out_path),
        "-json", str(config_path),
    ])

    assert rc != 0
    assert not out_path.exists()
    # No GPU work is started when the config is rejected.
    assert STATE.encoder_kwargs == []
    assert STATE.end_encode_calls == 0

    err = capsys.readouterr().err
    assert str(config_path) in err
    if expected_key is not None:
        assert expected_key in err


def test_zero_decoded_frames_exits_nonzero_without_end_encode(tmp_path, capsys):
    config_path = _write_config(
        tmp_path, {"codec": "h264", "preset": "P3", "bitrate": "2M"}
    )
    out_path = tmp_path / "out.h264"
    STATE.packets = [object(), object()]
    STATE.frames_per_packet = 0

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(out_path),
        "-json", str(config_path),
    ])

    assert rc != 0
    assert STATE.encoder_kwargs == []
    assert STATE.end_encode_calls == 0
    assert not out_path.exists() or out_path.stat().st_size == 0
    err = capsys.readouterr().err.lower()
    assert "decode" in err and "frame" in err


def test_decoded_frame_count_matches_input(tmp_path):
    STATE.packets = [object() for _ in range(4)]
    STATE.frames_per_packet = 3
    STATE.total_decoded_frames = 10

    rc = _run([
        "-i", str(tmp_path / "in.mp4"),
        "-o", str(tmp_path / "out.h264"),
        "-c", "h264",
        "-p", "P4",
    ])

    assert rc == 0
    assert STATE.end_encode_calls == 1
    assert STATE.encoded_frames == 10
    assert (tmp_path / "out.h264").stat().st_size > 0
