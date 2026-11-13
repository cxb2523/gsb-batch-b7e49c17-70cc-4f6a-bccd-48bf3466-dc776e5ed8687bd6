"""integrity: full decode of every stream with error counting, decoded-frame accounting and packet timestamp checks.

Status vocabulary: PASS / WARN / FAIL. Every conclusion is traceable to a check via `data.verdicts`: one entry per
check (decode / frames / timestamps; several for timestamps when several streams or findings are involved), each
saying whether the check was actually performed, what it contributed to the final status (`fail`, `warn` or `none`)
and a human-readable basis. A check that could not be performed is `performed: false` with the reason, never a
silent PASS. The top-level status keeps its original priority: any `fail` contribution -> FAIL, else any `warn`
-> WARN, else PASS."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..packets import by_stream, run_packets, timestamp_report
from ..probe import container_duration, streams_of
from ..runner import ffmpeg_null_argv, run_argv
from .base import PROBE_OP, AnalysisContext, Analyzer

_ADDR = re.compile(r" @ 0x[0-9a-fA-F]+\]")
_CATEGORIES = (
    ("missing_reference", re.compile(r"reference picture missing|no frame!|missing picture", re.I)),
    ("corrupt_data", re.compile(r"Invalid data|corrupt|Invalid NAL|error while decoding|decode_slice_header error|concealing", re.I)),
    ("timestamp", re.compile(r"non monotonically increasing|timestamp discontinuity|Non-monotonous DTS|dts.*out of order", re.I)),
    ("packet_submit", re.compile(r"Error submitting packet", re.I)),
)


def classify_errors(stderr: str, max_lines: int) -> Dict[str, Any]:
    """Count decoder error lines by category. Lines are normalised (pointer addresses removed) and only the first
    `max_lines` distinct messages are kept as samples."""
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    counts: Dict[str, int] = {}
    samples: List[str] = []
    seen = set()
    for ln in lines:
        cat = next((name for name, rx in _CATEGORIES if rx.search(ln)), "other")
        counts[cat] = counts.get(cat, 0) + 1
        norm = _ADDR.sub("]", ln)
        if norm not in seen and len(samples) < max_lines:
            seen.add(norm)
            samples.append(norm[:200])
    return {"error_line_count": len(lines), "categories": dict(sorted(counts.items())), "samples": samples}


def parse_progress(stdout: str) -> Dict[str, Optional[float]]:
    """Last values of ffmpeg `-progress` key=value output."""
    frame: Optional[int] = None
    out_time: Optional[float] = None
    for ln in stdout.splitlines():
        if ln.startswith("frame="):
            try:
                frame = int(ln.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif ln.startswith("out_time_us="):
            try:
                out_time = int(ln.split("=", 1)[1].strip()) / 1_000_000
            except ValueError:
                pass
    return {"decoded_video_frames": frame, "decoded_time": round(out_time, 3) if out_time is not None else None}


def decide_status(decode: Dict[str, Any], frames: Dict[str, Any], timestamps: Dict[str, Any]) -> Dict[str, Any]:
    """Per-check verdicts plus the overall status. Every fail / warn reason is attached to the check that produced
    it; the overall status is the priority reduction over the verdicts (any fail -> FAIL, else any warn -> WARN,
    else PASS), identical to the historical semantics."""
    fails: List[str] = []
    warns: List[str] = []
    verdicts: List[Dict[str, Any]] = []

    if decode["status"] == "performed":
        errs = decode["errors"]
        known = sum(n for cat, n in errs["categories"].items() if cat != "other")
        reasons: List[str] = []
        if decode["exit_code"] != 0:
            # A non-zero exit is a decode failure in its own right, even when stderr matched no known error
            # category (or was empty): say so explicitly and keep the raw exit code.
            if known == 0:
                reasons.append(f"decoder exited with code {decode['exit_code']} and stderr matched no known error category")
            else:
                reasons.append(f"decoder exited with code {decode['exit_code']}")
        if errs["error_line_count"] > 0:
            reasons.append(f"{errs['error_line_count']} decoder error lines")
        fails.extend(reasons)
        verdicts.append({"check": "decode", "performed": True, "contribution": "fail" if reasons else "none",
                         "exit_code": decode["exit_code"],
                         "detail": "; ".join(reasons) if reasons else "full decode exited with code 0 and no error lines"})
    else:
        verdicts.append({"check": "decode", "performed": False, "contribution": "none",
                         "detail": decode.get("reason") or "decode not performed"})

    if frames["status"] == "performed":
        expected, decoded = frames.get("expected_video_frames"), frames.get("decoded_video_frames")
        if expected and decoded is not None:
            if decoded < expected:
                msg = f"decoded {decoded} video frames, container declares {expected}"
                warns.append(msg)
                verdicts.append({"check": "frames", "performed": True, "contribution": "warn", "detail": msg})
            else:
                verdicts.append({"check": "frames", "performed": True, "contribution": "none",
                                 "detail": f"decoded {decoded} of {expected} declared video frames"})
        else:
            verdicts.append({"check": "frames", "performed": True, "contribution": "none",
                             "detail": "decode progress reported no frame count; shortfall cannot be measured"})
    else:
        verdicts.append({"check": "frames", "performed": False, "contribution": "none",
                         "detail": frames.get("reason") or "frame count check not performed"})

    if timestamps["status"] == "performed":
        findings = 0
        for idx, rep in timestamps["streams"].items():
            msgs: List[str] = []
            if rep["non_monotonic_dts"]:
                msgs.append(f"stream {idx}: {rep['non_monotonic_dts']} non-monotonic DTS")
            if rep["gap_count"]:
                msgs.append(f"stream {idx}: {rep['gap_count']} timestamp gaps")
            if rep["missing_pts"] or rep["missing_dts"]:
                msgs.append(f"stream {idx}: {rep['missing_pts']} packets without pts, {rep['missing_dts']} without dts")
            warns.extend(msgs)
            findings += len(msgs)
            # one verdict per finding, so each warn basis is individually checkable against `checks.timestamps`
            verdicts.extend({"check": "timestamps", "performed": True, "contribution": "warn",
                             "stream": int(idx), "detail": m} for m in msgs)
        if not findings:
            verdicts.append({"check": "timestamps", "performed": True, "contribution": "none",
                             "detail": "packet timestamps monotonic, no gaps, none missing"})
    else:
        verdicts.append({"check": "timestamps", "performed": False, "contribution": "none",
                         "detail": timestamps.get("reason") or "timestamp check not performed"})

    contributions = {v["contribution"] for v in verdicts}
    status = "FAIL" if "fail" in contributions else "WARN" if "warn" in contributions else "PASS"
    return {"status": status, "reasons": fails + warns, "verdicts": verdicts}


class IntegrityAnalyzer(Analyzer):
    id = "integrity"
    algorithm_version = "2"
    supported_kinds = ("integrity",)
    required_capabilities = ("ffprobe", "ffmpeg")

    def plan(self, ctx, kind, parameters):
        return [PROBE_OP, {"executable": "ffmpeg", "purpose": "full decode of all streams, null output, error capture"},
                {"executable": "ffprobe", "purpose": "packet timestamps of all streams"}]

    def analyze(self, ctx: AnalysisContext, kind: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        p = ctx.probe()
        vids = streams_of(p, "video")
        ctx.record("ffmpeg", "full decode of all streams")
        argv = ffmpeg_null_argv(ctx.exe("ffmpeg"), ctx.input_path, "-map", "0", "-progress", "pipe:1", "-nostats", loglevel="error")
        r = run_argv(argv, ctx.timeout)
        decode = {"status": "performed", "exit_code": r.returncode, "errors": classify_errors(r.stderr, parameters["max_error_lines"]), "seconds": r.seconds}
        prog = parse_progress(r.stdout)
        frames = {"status": "performed", "reason": None,
                  "expected_video_frames": vids[0]["nb_frames"] if vids else None,
                  "expected_basis": "nb_frames of first video stream" if vids and vids[0]["nb_frames"] else None,
                  "decoded_video_frames": prog["decoded_video_frames"], "decoded_time": prog["decoded_time"],
                  "container_duration": container_duration(p)}
        if not vids:
            frames["status"] = "not_performed"
            frames["reason"] = "no video stream"
        elif not vids[0]["nb_frames"]:
            frames["status"] = "not_performed"
            frames["reason"] = "container does not declare nb_frames; shortfall cannot be measured"
        ctx.record("ffprobe", "packet timestamps of all streams")
        pkts = run_packets(ctx.exe("ffprobe"), ctx.input_path, ctx.timeout)
        reports = {str(idx): timestamp_report(group, gap_factor=2.5) for idx, group in sorted(by_stream(pkts).items())}
        timestamps = {"status": "performed", "streams": reports}
        verdict = decide_status(decode, frames, timestamps)
        return {"status": verdict["status"], "reasons": verdict["reasons"], "verdicts": verdict["verdicts"],
                "checks": {"decode": decode, "frames": frames, "timestamps": timestamps}}
