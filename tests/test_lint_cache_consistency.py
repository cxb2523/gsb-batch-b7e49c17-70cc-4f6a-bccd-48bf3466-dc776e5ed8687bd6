"""Cache / suppression consistency of ``pycodemath lint`` (module L1).

The cache may skip the *analysis* of a file whose source and configuration did not
change; it may never change the *result*. For every file, a cold run and a cache
hit must produce byte-identical findings, the same suppressed count, the same
function count and the same analysis counters, and the SARIF produced from the two
runs must be the same document. The negative paths are covered too: a syntax error
is an error report (never a silent pass), an unknown rule on ``--explain`` exits 2,
and a legacy / partial cache payload is rebuilt instead of being half-interpreted.

Everything here runs on small static-rule files (no worker processes, no network).
"""

from __future__ import annotations

import json
import textwrap
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import pytest

from pycodemath.lint.__main__ import main
from pycodemath.lint.config import Config
from pycodemath.lint.engine import (
    CACHE_FORMAT,
    FileReport,
    _cache_path,
    _digest,
    lint_file,
)
from pycodemath.lint.sarif import to_sarif

# A file exercising BOTH suppression syntaxes. File-level: PCM503 nowhere appears.
# Line-level: the money line's PCM401/PCM503 and the ``EPS`` line's PCM502 are
# silenced in place, while the unsuppressed ``2 ^ 8`` finding stays reported.
SAMPLE = textwrap.dedent("""\
    # pcm: file-ignore[PCM503]

    def gross(price: float) -> float:
        return round(price * 1.23, 2)  # pcm: ignore[PCM401]


    EPS = 10^-6  # pcm: ignore[PCM502]
    BITS = 2 ^ 8 - 1
""")

BROKEN = "def broken(:\n"


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def _report_digest(report: FileReport) -> dict[str, object]:
    """Everything about a FileReport that must be stable across cache hits."""
    return {
        "path": report.path,
        "findings": [f.to_dict() for f in report.findings],
        "suppressed": report.suppressed,
        "error": report.error,
        "functions": report.functions,
        "analysed": dict(sorted(report.analysed.items())),
    }


def _three_runs(path: Path, tmp_path: Path, **cfg_kw: object) -> tuple[FileReport, FileReport, FileReport]:
    """Cold (no cache), cache miss (writes the cache), cache hit."""
    cold = lint_file(path, Config(root=str(tmp_path), cache=False, **cfg_kw))  # type: ignore[arg-type]
    cache_cfg = Config(root=str(tmp_path), cache=True, **cfg_kw)  # type: ignore[arg-type]
    miss = lint_file(path, cache_cfg)
    hit = lint_file(path, cache_cfg)
    return cold, miss, hit


# --------------------------------------------------------------------------- acceptance sample


def test_sample_actually_exercises_both_suppression_kinds(tmp_path: Path) -> None:
    """The fixture must silence findings at file level AND line level, and keep one
    finding — otherwise the consistency checks below would be vacuous."""
    path = _write(tmp_path, "sample.py", SAMPLE)
    report = lint_file(path, Config(root=str(tmp_path), cache=False, select=("PCM",)))
    kept = {(f.code, f.line) for f in report.findings}
    assert report.suppressed >= 2, report.suppressed
    # the bare ``2 ^ 8`` line has no suppression comment: it must survive
    assert ("PCM502", 8) in kept
    # PCM503 is file-ignored; the money line's PCM401 and the EPS line's PCM502
    # are line-ignored — none of them may remain
    assert all(code not in {c for c, _ in kept} for code in ("PCM401", "PCM503"))
    assert not any(line == 7 for _, line in kept)


def test_cold_and_cached_reports_are_identical(tmp_path: Path) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    cold, miss, hit = _three_runs(path, tmp_path, select=("PCM",))
    assert not miss.cached and hit.cached  # the second run really used the cache
    assert _report_digest(cold) == _report_digest(miss) == _report_digest(hit)
    # the four invariants named in the contract, asserted individually for clarity
    assert cold.suppressed == miss.suppressed == hit.suppressed
    assert [f.to_dict() for f in cold.findings] == [f.to_dict() for f in hit.findings]
    assert cold.functions == miss.functions == hit.functions
    assert cold.analysed == miss.analysed == hit.analysed


def test_suppressed_findings_never_reach_the_report(tmp_path: Path) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    cold, _, hit = _three_runs(path, tmp_path, select=("PCM",))
    suppressed_codes = {"PCM401", "PCM503"}
    for report in (cold, hit):
        assert suppressed_codes.isdisjoint({f.code for f in report.findings})
        # suppressed count is exactly the raw findings removed by selection+filter
        raw_codes = _raw_codes(path, report.path)
        assert report.suppressed + len(report.findings) == len(raw_codes)


def _raw_codes(path: Path, shown: str) -> list[str]:
    from pycodemath.lint.engine import _raw

    config = replace(Config(root=str(path.parent), cache=False),
                     select=("PCM",), extend_select=(), ignore=(), per_file_ignores=())
    raw, _, _ = _raw(path.read_text(encoding="utf-8-sig"), shown, config)
    return [f.code for f in raw]


# --------------------------------------------------------------------------- SARIF stability


def test_sarif_is_identical_before_and_after_cache(tmp_path: Path) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    cold, miss, hit = _three_runs(path, tmp_path, select=("PCM",))
    sarif_cold = to_sarif(cold.findings, root_uri="file:///repo/")
    sarif_hit = to_sarif(hit.findings, root_uri="file:///repo/")
    assert json.dumps(sarif_cold, sort_keys=True) == json.dumps(sarif_hit, sort_keys=True)

    results = sarif_hit["runs"][0]["results"]
    assert results, "the sample keeps at least one finding to fingerprint"
    kept_codes = {f.code for f in hit.findings}
    # nothing silenced leaks into the platform-facing results
    assert {"PCM401", "PCM503"}.isdisjoint({r["ruleId"] for r in results})
    for result, finding in zip(results, hit.findings):
        assert result["ruleId"] == finding.code
        region = result["locations"][0]["physicalLocation"]["region"]
        assert region["startLine"] == finding.line and region["startColumn"] == finding.col
        assert result["partialFingerprints"] == {"pcmLint/v1": _fingerprint(finding)}
        if finding.witness is not None:
            assert result["properties"]["witness"] == finding.witness.to_dict()
    # and every kept finding produced exactly one result, in the same order
    assert [r["ruleId"] for r in results] == [f.code for f in hit.findings]


def _fingerprint(finding: object) -> str:
    from pycodemath.lint.sarif import _fingerprint as fp

    return fp(finding)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- selection over the cache


def test_changing_selection_keeps_suppression_consistent(tmp_path: Path) -> None:
    """The cache stores the ALL-rules analysis; narrowing ``--select`` reuses it but
    must report the same suppressed/findings as a cold run with the narrow select."""
    path = _write(tmp_path, "sample.py", SAMPLE)
    lint_file(path, Config(root=str(tmp_path), cache=True, select=("PCM",)))  # populate
    narrowed = Config(root=str(tmp_path), cache=True, select=("PCM5",))
    hit = lint_file(path, narrowed)
    cold = lint_file(path, Config(root=str(tmp_path), cache=False, select=("PCM5",)))
    assert hit.cached
    assert _report_digest(hit) == _report_digest(cold)


# --------------------------------------------------------------------------- negative paths


def test_syntax_error_is_an_error_on_every_run(tmp_path: Path) -> None:
    path = _write(tmp_path, "broken.py", BROKEN)
    cold, miss, hit = _three_runs(path, tmp_path)
    for report in (cold, miss, hit):
        assert report.error is not None and "syntax error" in report.error
        assert report.findings == () and report.suppressed == 0
        assert not report.cached  # an unanalysable file is never cached as a result
    # no cache entry was written for it
    assert not list((tmp_path / ".pcm_lint_cache").rglob("*.json"))


def test_syntax_error_cli_exit_code(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = _write(tmp_path, "broken.py", BROKEN)
    assert main([str(path), "--no-cache"]) == 2
    out = capsys.readouterr()
    assert "All checks passed" not in out.out and "not analysed" in out.out


@pytest.mark.parametrize("code", ["PCM999", "pcm000", "ZZZ", "PCM"])
def test_explain_unknown_rule_exits_2(code: str, capsys: pytest.CaptureFixture[str]) -> None:
    # "PCM" is a prefix selector, not a rule id: it must not match either
    assert main(["--explain", code]) == 2
    assert "unknown rule" in capsys.readouterr().err


def test_known_rule_explain_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--explain", "pcm502"]) == 0
    assert capsys.readouterr().out.startswith("### PCM502")


# --------------------------------------------------------------------------- cache payload integrity


def _payload(path: Path, tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    config = Config(root=str(tmp_path), cache=True)
    shown = path.name
    cache = _cache_path(config, _digest(path.read_text(encoding="utf-8-sig"), config, shown))
    return cache, cast(dict[str, Any], json.loads(cache.read_text(encoding="utf-8")))


def test_written_payload_is_versioned_and_complete(tmp_path: Path) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    lint_file(path, Config(root=str(tmp_path), cache=True, select=("PCM",)))
    _, payload = _payload(path, tmp_path)
    assert payload["version"] == CACHE_FORMAT
    assert isinstance(payload["functions"], int)
    assert isinstance(payload["analysed"], dict)
    for entry in payload["findings"]:
        assert isinstance(entry["suppress_lines"], list)
        assert all(isinstance(n, int) for n in entry["suppress_lines"])
        assert entry["witness"] is None or isinstance(entry["witness"]["inputs"], dict)


@pytest.mark.parametrize("damage", ["legacy", "no_suppress_lines", "bad_analysed", "not_json"])
def test_partial_or_legacy_cache_is_rebuilt(tmp_path: Path, damage: str) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    config = Config(root=str(tmp_path), cache=True, select=("PCM",))
    lint_file(path, config)  # populate a valid cache
    cache, payload = _payload(path, tmp_path)

    if damage == "legacy":
        payload.pop("version")  # a pre-format-version entry
    elif damage == "no_suppress_lines":
        for entry in payload["findings"]:
            entry.pop("suppress_lines")
    elif damage == "bad_analysed":
        payload["analysed"] = {"spec": "many"}  # counters must be ints
    if damage == "not_json":
        cache.write_text("{this is not json", encoding="utf-8")
    else:
        cache.write_text(json.dumps(payload), encoding="utf-8")

    rebuilt = lint_file(path, config)
    assert not rebuilt.cached, "a damaged payload must not be accepted as a cache hit"
    cold = lint_file(path, Config(root=str(tmp_path), cache=False, select=("PCM",)))
    assert _report_digest(rebuilt) == _report_digest(cold)
    # the rebuild refreshed the entry into the current, valid format
    again = lint_file(path, config)
    assert again.cached and _report_digest(again) == _report_digest(cold)


def test_witness_and_suppression_lines_round_trip_through_cache(tmp_path: Path) -> None:
    path = _write(tmp_path, "sample.py", SAMPLE)
    cold, _, hit = _three_runs(path, tmp_path, select=("PCM",))
    for fresh, cached in zip(cold.findings, hit.findings):
        assert fresh.suppress_lines == cached.suppress_lines
        assert fresh.to_dict() == cached.to_dict()
        if fresh.witness is not None:
            assert cached.witness is not None
            assert fresh.witness.to_dict() == cached.witness.to_dict()
            assert fresh.witness.replay().differs == cached.witness.replay().differs
