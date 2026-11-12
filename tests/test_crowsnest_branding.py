"""
The Crows Nest in a project's own colours (routes/branding.py): name, logo and
colours from an optional branding/ directory. Without it the Crows Nest looks as
it always has; a colour it cannot read is left at the default rather than
breaking the page.
"""

import json
import pathlib
import shutil
import subprocess

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest.routes import branding  # noqa: E402

LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'


@pytest.fixture
def project(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    duckdb.connect(str(db)).close()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    cn_config.reset_config()
    yield tmp_path
    cn_config.reset_config()


def _client() -> TestClient:
    from datavloot_platform.crowsnest.server import create_app
    return TestClient(create_app())


def test_without_branding_the_defaults_stay(project):
    assert _client().get("/api/branding").json() == {"name": None, "logo": None, "variables": {}}
    assert _client().get("/api/branding/logo").status_code == 404


def test_name_logo_and_colours_come_from_branding(project):
    (project / "branding").mkdir()
    (project / "branding" / "logo.svg").write_text(LOGO, encoding="utf-8")
    (project / "branding" / "branding.yml").write_text(
        'name: KetenConnect\ncolors:\n  accent: "#0070c0"\n  text: "#002060"\n  background: "#f2f2f2"\n',
        encoding="utf-8",
    )
    got = _client().get("/api/branding").json()

    assert got["name"] == "KetenConnect"
    assert got["logo"] == "/api/branding/logo"
    variables = got["variables"]
    assert variables["--cn-accent-600"] == "0 112 192"
    assert variables["--cn-ink-0"] == "0 32 96"
    assert variables["--cn-surface-1"] == "242 242 242"
    # Every shade the frontend uses is set, so no default shade shows through.
    expected = {f"--cn-accent-{s}" for s in (50, 100, 200, 400, 600, 700, 800, 900)}
    expected |= {f"--cn-ink-{s}" for s in range(4)} | {f"--cn-surface-{s}" for s in (1, 2, 3)}
    # The sidebar follows the accent when the project names no sidebar colour.
    expected |= {"--cn-sidebar"}
    assert set(variables) == expected
    assert variables["--cn-sidebar"] == variables["--cn-accent-900"]


def test_a_sidebar_and_highlight_colour_of_its_own():
    """KetenConnect: the website's navy for the sidebar, its green for the highlight."""
    variables = branding.shades({"accent": "#0070c0", "sidebar": "#002060", "highlight": "#00b050"})
    assert variables["--cn-sidebar"] == "0 32 96"
    assert variables["--cn-highlight"] == "0 176 80"
    darker = variables["--cn-highlight-700"]
    assert sum(int(c) for c in darker.split()) < sum((0, 176, 80))


def test_shades_run_from_light_to_dark():
    variables = branding.shades({"accent": "#0070c0"})
    lightness = [
        sum(int(c) for c in variables[f"--cn-accent-{s}"].split())
        for s in (50, 100, 200, 400, 600, 700, 800, 900)
    ]
    assert lightness == sorted(lightness, reverse=True)


def test_the_faintest_text_still_reads_on_white():
    # ink-3 is small muted text on white cards; keep it at 3:1 or better.
    def luminance(rgb):
        def channel(c):
            c /= 255
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        r, g, b = (channel(int(c)) for c in rgb.split())
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    ink_3 = branding.shades({"text": "#002060"})["--cn-ink-3"]
    assert 1.05 / (luminance(ink_3) + 0.05) >= 3


@pytest.mark.parametrize("value", ["blue", "#12345", "#gggggg", 7, None])
def test_a_colour_it_cannot_read_keeps_the_default(value):
    assert branding.shades({"accent": value}) == {}


def test_a_broken_branding_file_keeps_the_defaults(project):
    (project / "branding").mkdir()
    (project / "branding" / "branding.yml").write_text("name: [unclosed\n", encoding="utf-8")
    assert _client().get("/api/branding").json() == {"name": None, "logo": None, "variables": {}}


def test_an_svg_logo_cannot_run_scripts(project):
    (project / "branding").mkdir()
    (project / "branding" / "logo.svg").write_text(LOGO, encoding="utf-8")
    response = _client().get("/api/branding/logo")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"
    assert "sandbox" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"


# Node runs the frontend's lib/branding.js against a stand-in for <html>'s style.
_APPLY_BRANDING = """
import { applyBranding } from %s;
const props = new Map(Object.entries(%s));
const style = {
  get length() { return props.size; },
  ...Object.fromEntries([...props.keys()].map((k, i) => [i, k])),
  setProperty: (k, v) => props.set(k, v),
  removeProperty: (k) => props.delete(k),
};
// Array.from reads the names by index, as from a CSSStyleDeclaration.
Object.defineProperty(style, Symbol.iterator, { value: () => [...props.keys()][Symbol.iterator]() });
applyBranding(style, %s);
console.log(JSON.stringify(Object.fromEntries(props)));
"""


def _apply_branding(inline: dict, variables: dict) -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    module = (pathlib.Path(__file__).parents[1] / "datavloot_platform" / "crowsnest"
              / "frontend" / "lib" / "branding.js").as_uri()
    script = _APPLY_BRANDING % (json.dumps(module), json.dumps(inline), json.dumps(variables))
    result = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def test_another_projects_colours_do_not_stay():
    # app/layout.js applied the colours remembered from the project opened
    # before; this project has no branding/, so the defaults come back.
    previous = {"--cn-accent-600": "0 112 192", "--cn-sidebar": "0 32 96"}
    assert _apply_branding({**previous, "color": "red"}, {}) == {"color": "red"}


def test_the_new_colours_replace_the_old():
    previous = {"--cn-accent-600": "0 112 192", "--cn-highlight": "0 176 80"}
    assert _apply_branding(previous, {"--cn-accent-600": "1 2 3"}) == {"--cn-accent-600": "1 2 3"}
