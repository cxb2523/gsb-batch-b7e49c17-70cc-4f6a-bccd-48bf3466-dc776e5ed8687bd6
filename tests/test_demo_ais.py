"""
The demo's AIS download, without the network: a fake GET serves a small zip.

What ais.py promises: a missing CSV is downloaded, checked and unpacked; a
failed or wrong download leaves no guam_2025.csv behind and says what to do;
a CSV that is already there is left alone.
"""

import hashlib
import importlib.util
import io
import logging
import pathlib
import zipfile

import pytest

from datavloot_platform import cli

CSV = b"mmsi,base_date_time\n367796180,2025-01-01 00:20:06\n"


def _ais():
    """ais.py from the demo template; it is a module of the demo, not of the toolkit."""
    path = cli.TEMPLATES_DIR / "demo" / "noaa_platform" / "ais.py"
    spec = importlib.util.spec_from_file_location("demo_ais", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _zip(member: str = "guam_2025.csv", data: bytes = CSV) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(member, data)
    return buf.getvalue()


class _Response:
    def __init__(self, body: bytes, status: int = 200, cut_after: int | None = None):
        self.body, self.status, self.cut_after = body, status, cut_after

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status >= 400:
            raise OSError(f"{self.status} Server Error")

    def iter_content(self, size):
        # Small chunks, so a cut can fall in the middle of the body.
        for i in range(0, len(self.body), 64):
            if self.cut_after is not None and i >= self.cut_after:
                raise ConnectionError("connection reset")
            yield self.body[i : i + 64]


def _get(response: _Response):
    def get(url, stream, timeout):
        return response

    return get


BODY = _zip()


@pytest.fixture
def ais(monkeypatch):
    """The module, expecting the checksum of BODY instead of NOAA's file."""
    module = _ais()
    monkeypatch.setattr(module, "SHA256", hashlib.sha256(BODY).hexdigest())
    return module


@pytest.fixture
def csv_path(tmp_path) -> pathlib.Path:
    return tmp_path / "noaa" / "data" / "guam_2025.csv"


def _leftovers(csv_path: pathlib.Path) -> list[str]:
    return sorted(p.name for p in csv_path.parent.iterdir()) if csv_path.parent.exists() else []


def test_a_missing_csv_is_downloaded_and_unpacked(ais, csv_path):
    ais.ensure_csv(csv_path, logging.getLogger(), _get(_Response(BODY)))

    assert csv_path.read_bytes() == CSV
    assert _leftovers(csv_path) == ["guam_2025.csv"], "the zip or a .part file was left behind"


def test_an_existing_csv_is_left_alone(ais, csv_path):
    csv_path.parent.mkdir(parents=True)
    csv_path.write_bytes(b"already here")

    def get(*args, **kwargs):
        raise AssertionError("downloaded although the CSV exists")

    ais.ensure_csv(csv_path, logging.getLogger(), get)
    assert csv_path.read_bytes() == b"already here"


@pytest.mark.parametrize(
    "response",
    [
        _Response(BODY, status=503),
        _Response(BODY, cut_after=64),
    ],
    ids=["server error", "connection lost"],
)
def test_a_failed_download_leaves_nothing_and_says_what_to_do(ais, csv_path, response):
    with pytest.raises(RuntimeError, match="by hand"):
        ais.ensure_csv(csv_path, logging.getLogger(), _get(response))

    assert _leftovers(csv_path) == []


def test_a_different_file_is_refused(ais, csv_path):
    """NOAA replacing the file, or a truncated download, must not end up in the lake."""
    other = _zip(data=CSV + b"999,2025-12-31 23:59:59\n")
    with pytest.raises(RuntimeError, match="does not match"):
        ais.ensure_csv(csv_path, logging.getLogger(), _get(_Response(other)))

    assert _leftovers(csv_path) == []


def test_the_demo_loads_through_the_download():
    """The asset calls ensure_csv before it reads the CSV, instead of failing on a missing file."""
    source = (cli.TEMPLATES_DIR / "demo" / "noaa_platform" / "assets.py").read_text(encoding="utf-8")
    body = source.split("def noaa_guam_2025_raw", 1)[1]
    assert body.index("ais.ensure_csv(CSV_PATH") < body.index("read_csv(")
