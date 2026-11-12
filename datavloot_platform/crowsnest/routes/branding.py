"""
Branding route — how the Crows Nest presents a project: its name, its logo and
its colours, from an optional branding/ directory in the project.

    branding/
      branding.yml     name and colours, every key optional (see below)
      logo.svg         or logo.png; replaces the datavloot mark in the sidebar

    # branding.yml
    name: KetenConnect
    colors:
      accent: "#0070c0"      # buttons, links, spinner
      text: "#002060"        # text; muted text is derived from it
      background: "#f2f2f2"  # page background; hover and borders are derived from it
      sidebar: "#002060"     # the sidebar; without it, the accent darkened
      highlight: "#00b050"   # the active tab's marker, focus rings, notes

The frontend's colours are CSS variables (app/globals.css holds the defaults).
This route turns the colours into the full set of shades the frontend uses, so
a project names its colours once and never a shade. Without branding/ the Crows
Nest looks as it always has. With a logo, the sidebar shows the logo without
the name next to it: a logo usually carries the name already.
"""

import pathlib
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

try:
    import yaml
except ImportError:  # pragma: no cover - pyyaml comes with dbt and dagster
    yaml = None

router = APIRouter()

BRANDING_DIR = "branding"
LOGO_FILES = {"logo.svg": "image/svg+xml", "logo.png": "image/png"}

_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")
_WHITE = (255, 255, 255)
_BLACK = (0, 0, 0)


def _rgb(value) -> tuple[int, int, int] | None:
    match = _HEX.match(str(value).strip()) if value is not None else None
    if not match:
        return None
    hex_ = match.group(1)
    return tuple(int(hex_[i:i + 2], 16) for i in (0, 2, 4))


def _mix(a, b, share_of_b: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * share_of_b) for x, y in zip(a, b))


def _css(rgb) -> str:
    # The form Tailwind's `rgb(var(--x) / <alpha-value>)` expects.
    return " ".join(str(c) for c in rgb)


def shades(colors: dict) -> dict[str, str]:
    """CSS variables for the colours given; a colour left out keeps the default."""
    variables: dict[str, str] = {}
    accent = _rgb(colors.get("accent"))
    text = _rgb(colors.get("text"))
    background = _rgb(colors.get("background"))
    sidebar = _rgb(colors.get("sidebar"))
    highlight = _rgb(colors.get("highlight"))

    if accent:
        for step, share in ((50, 0.10), (100, 0.25), (200, 0.38), (400, 0.75)):
            variables[f"--cn-accent-{step}"] = _css(_mix(_WHITE, accent, share))
        variables["--cn-accent-600"] = _css(accent)
        for step, share in ((700, 0.15), (800, 0.40), (900, 0.55)):
            variables[f"--cn-accent-{step}"] = _css(_mix(accent, _BLACK, share))
        # The sidebar follows the accent, unless the project names its own below.
        variables["--cn-sidebar"] = variables["--cn-accent-900"]
    if sidebar:
        variables["--cn-sidebar"] = _css(sidebar)
    if highlight:
        variables["--cn-highlight"] = _css(highlight)
        # Darkened for text on white, where the colour itself can be too light to read.
        variables["--cn-highlight-700"] = _css(_mix(highlight, _BLACK, 0.30))
    if text:
        # Lightened toward white, not alpha, so muted text keeps its contrast
        # on any surface; ink-3, the faintest, still reads on white.
        for step, share in ((0, 0.0), (1, 0.15), (2, 0.30), (3, 0.45)):
            variables[f"--cn-ink-{step}"] = _css(_mix(text, _WHITE, share))
    if background:
        tint = accent or _BLACK
        variables["--cn-surface-1"] = _css(background)
        variables["--cn-surface-2"] = _css(_mix(background, tint, 0.08))
        variables["--cn-surface-3"] = _css(_mix(background, tint, 0.20))
    return variables


def _branding_dir() -> pathlib.Path:
    return pathlib.Path.cwd() / BRANDING_DIR


def _logo() -> pathlib.Path | None:
    for name in LOGO_FILES:
        path = _branding_dir() / name
        if path.is_file():
            return path
    return None


def _settings() -> dict:
    path = _branding_dir() / "branding.yml"
    if yaml is None or not path.is_file():
        return {}
    try:
        settings = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    return settings if isinstance(settings, dict) else {}


@router.get("")
async def get_branding():
    """The project's name, whether it has a logo, and its colours as CSS variables."""
    settings = _settings()
    colors = settings.get("colors")
    name = settings.get("name")
    return {
        "name": str(name) if name else None,
        "logo": "/api/branding/logo" if _logo() else None,
        "variables": shades(colors if isinstance(colors, dict) else {}),
    }


@router.get("/logo")
async def get_logo():
    path = _logo()
    if path is None:
        raise HTTPException(404, f"No logo in {BRANDING_DIR}/")
    return FileResponse(
        path,
        media_type=LOGO_FILES[path.name],
        headers={
            # An SVG opened on its own runs its scripts on this origin; the
            # sandbox keeps a logo a picture.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
        },
    )
