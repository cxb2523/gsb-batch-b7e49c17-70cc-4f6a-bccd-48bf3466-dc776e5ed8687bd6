"""Unit tests for integrity's per-check verdicts (`decide_status`): pure functions, no ffmpeg.

Covers the rules the integration tests cannot reach deterministically: a non-zero decoder exit whose stderr matches
no known error category, a frames check that could not run, and per-stream timestamp findings."""
from __future__ import annotations

from media_analysis.analyzers.integrity import decide_status


def _decode(exit_code: int = 0, categories=None, lines: int = 0) -> dict:
    return {"status": "performed", "exit_code": exit_code,
            "errors": {"error_line_count": lines, "categories": categories or {}, "samples": []}, "seconds": 1.0}


def _frames(status: str = "performed", expected=100, decoded=100, reason=None) -> dict:
    return {"status": status, "reason": reason, "expected_video_frames": expected, "decoded_video_frames": decoded}


def _timestamps(streams=None) -> dict:
    clean = {"non_monotonic_dts": 0, "gap_count": 0, "missing_pts": 0, "missing_dts": 0}
    return {"status": "performed", "streams": streams if streams is not None else {"0": dict(clean)}}


def test_clean_file_passes_with_all_checks_performed():
    out = decide_status(_decode(), _frames(), _timestamps())
    assert out["status"] == "PASS" and out["reasons"] == []
    assert {v["check"] for v in out["verdicts"]} == {"decode", "frames", "timestamps"}
    assert all(v["performed"] and v["contribution"] == "none" and v["detail"] for v in out["verdicts"])


def test_nonzero_exit_without_known_category_is_a_decode_fail_with_the_exit_code():
    """The defect: exit != 0, stderr empty or only unclassified lines -> previously only a bare exit-code fail,
    invisible in the category counts. Now the decode verdict says it explicitly and keeps the raw exit code."""
    for errors in ({"error_line_count": 0, "categories": {}, "samples": []},
                   {"error_line_count": 3, "categories": {"other": 3}, "samples": ["x"]}):
        decode = {"status": "performed", "exit_code": 1, "errors": errors, "seconds": 1.0}
        out = decide_status(decode, _frames(), _timestamps())
        assert out["status"] == "FAIL"
        dec = [v for v in out["verdicts"] if v["check"] == "decode"]
        assert len(dec) == 1 and dec[0]["contribution"] == "fail" and dec[0]["performed"]
        assert dec[0]["exit_code"] == 1 and "code 1" in dec[0]["detail"] and "no known error category" in dec[0]["detail"]


def test_nonzero_exit_with_known_category_stays_a_decode_fail():
    out = decide_status(_decode(exit_code=1, categories={"corrupt_data": 5}, lines=5), _frames(), _timestamps())
    assert out["status"] == "FAIL"
    dec = [v for v in out["verdicts"] if v["check"] == "decode"][0]
    assert dec["contribution"] == "fail" and dec["exit_code"] == 1 and "no known error category" not in dec["detail"]


def test_frames_not_performed_never_fails_the_file():
    for reason in ("no video stream", "container does not declare nb_frames; shortfall cannot be measured"):
        out = decide_status(_decode(), _frames(status="not_performed", expected=None, decoded=None, reason=reason), _timestamps())
        assert out["status"] == "PASS"
        fr = [v for v in out["verdicts"] if v["check"] == "frames"]
        assert len(fr) == 1 and fr[0]["performed"] is False and fr[0]["contribution"] == "none" and fr[0]["detail"] == reason


def test_frame_shortfall_is_a_frames_warn():
    out = decide_status(_decode(), _frames(expected=150, decoded=120), _timestamps())
    assert out["status"] == "WARN"
    fr = [v for v in out["verdicts"] if v["check"] == "frames"][0]
    assert fr["contribution"] == "warn" and "120" in fr["detail"] and "150" in fr["detail"]


def test_timestamp_findings_are_one_verdict_each():
    streams = {"0": {"non_monotonic_dts": 2, "gap_count": 1, "missing_pts": 0, "missing_dts": 0},
               "1": {"non_monotonic_dts": 0, "gap_count": 3, "missing_pts": 0, "missing_dts": 0}}
    out = decide_status(_decode(), _frames(), _timestamps(streams))
    assert out["status"] == "WARN"
    ts = [v for v in out["verdicts"] if v["check"] == "timestamps"]
    # non-monotonic DTS and gaps are separate, individually checkable warn bases, not one merged sentence
    assert len(ts) == 3 and all(v["contribution"] == "warn" and v["performed"] for v in ts)
    assert [v["stream"] for v in ts] == [0, 0, 1]
    assert sum("non-monotonic DTS" in v["detail"] for v in ts) == 1
    assert sum("timestamp gaps" in v["detail"] for v in ts) == 2
    assert len([r for r in out["reasons"] if "DTS" in r or "gaps" in r]) == 3


def test_fail_beats_warn_in_the_overall_status():
    streams = {"0": {"non_monotonic_dts": 0, "gap_count": 1, "missing_pts": 0, "missing_dts": 0}}
    out = decide_status(_decode(exit_code=1, categories={"corrupt_data": 2}, lines=2), _frames(), _timestamps(streams))
    assert out["status"] == "FAIL"
    assert {v["contribution"] for v in out["verdicts"]} == {"fail", "warn", "none"}
