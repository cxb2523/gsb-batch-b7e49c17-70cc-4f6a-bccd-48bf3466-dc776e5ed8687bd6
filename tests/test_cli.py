from __future__ import annotations

from pathlib import Path

import pytest

from geofeed_harvester import cli
from geofeed_harvester.sources import PreparedInputs, SourceResult, RPSL_BULK_SOURCES


def _all_bulk_failed_inputs(tmp_path: Path) -> PreparedInputs:
    (tmp_path / "normalized.txt").write_text("", encoding="utf-8")
    sources = tuple(
        SourceResult(
            name=source.name,
            kind="bulk",
            rir=source.rir,
            url=source.url,
            status="failed",
            fetched_at="2026-01-01T00:00:00+00:00",
            error="connect_error",
            stage="download",
        )
        for source in RPSL_BULK_SOURCES
    )
    return PreparedInputs(
        sources=sources,
        normalized_rir_path=tmp_path / "normalized.txt",
    )


def test_cli_exits_nonzero_when_all_bulk_sources_fail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    prepared = _all_bulk_failed_inputs(tmp_path)
    monkeypatch.setattr(cli, "prepare_inputs", lambda **kwargs: prepared)
    monkeypatch.setattr(
        "sys.argv",
        [
            "geofeed-harvester",
            "--auto-discover",
            "--skip-lacnic",
            "--bulk-dir",
            str(tmp_path / "bulk"),
            "--normalized-rir-dump",
            str(tmp_path / "normalized.txt"),
            "--direct-geofeed-dir",
            str(tmp_path / "direct"),
            "--out-dir",
            str(tmp_path / "dist"),
            "--cache-dir",
            str(tmp_path / "cache"),
        ],
    )

    exit_code = cli.main()

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "harvest failed" in captured.err
    assert "all bulk RIR sources failed" in captured.err
    assert not (tmp_path / "dist" / "geofeed.csv").exists()
    assert not (tmp_path / "dist" / "manifest.json").exists()
