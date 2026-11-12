"""
Start a project's Datavloot at login, with a shortcut to its Crows Nest (#116).

`datavloot autostart on`, run from the project directory, puts down:

  - an entry that runs `datavloot start --no-open` at login, for this user only
    and without admin rights: a shortcut in the per-user Startup folder on
    Windows, a LaunchAgent on macOS;
  - a shortcut named after the project, with its icon, that runs `datavloot
    open`: in the Start menu and on the desktop on Windows, as a small app in
    ~/Applications on macOS.

`datavloot shortcut on` puts down only the shortcut, for someone who wants to
open Datavloot with a click but not have it start at every login; run after
`autostart on`, it takes the login entry away and keeps the shortcut.

`off` (of either) removes all of it, and `status` says what is there. What `on`
made is recorded in .datavloot/autostart.json in the project, so `off` removes
exactly that, even after the project was renamed in branding.yml.

At login nobody watches a terminal, so `start` writes everything to
logs/datavloot-start.log. A shortcut cannot show an error itself: `datavloot
open` opens the browser once the Crows Nest answers, starts Datavloot in the
background when it does not, and opens that log when starting fails.

Windows' scheduled task at logon would be the other route, but creating one
for a logon trigger asks for admin rights on a managed laptop; the Startup
folder does not. A Windows service (running without anyone logged in) is out
of scope: scheduled runs therefore happen only while the user is logged in.

The macOS half is covered by unit tests on the files it writes, not yet on a
real Mac.

Stdlib and pyyaml only, so `autostart` works before the optimist extra is
installed, and the fast test tier can import it.
"""

import contextlib
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser

import yaml

CROWSNEST_PORT = 8080
LOG_FILE = pathlib.Path("logs") / "datavloot-start.log"
# Written by `datavloot start` while it runs, so `datavloot open` does not start
# a second one next to a start that is still waiting for Dagster.
PID_FILE = pathlib.Path("logs") / "datavloot-start.pid"
STATE_DIR = pathlib.Path(".datavloot")
RECORD_FILE = STATE_DIR / "autostart.json"

# Past this size the log moves to datavloot-start.log.1 at the next start, so a
# machine that starts Datavloot every day for a year does not fill up.
_LOG_MAX_BYTES = 5 * 1024 * 1024

# How long `datavloot open` waits for a Crows Nest it started. `start` gives
# Dagster 60 seconds; the first start after an install also compiles Python
# bytecode and loads the dbt manifest, which on a slow laptop takes minutes.
OPEN_TIMEOUT = 300

_FALLBACK_ICON = pathlib.Path(__file__).parent / "crowsnest" / "static" / "datavloot-logo.png"

# Windows' Known Folder IDs, for folders a company may redirect (the desktop
# into OneDrive, most often). APPDATA and USERPROFILE are the fallbacks.
_FOLDERID = {
    "startup": "{B97D20BB-F46A-4C97-BA10-5E3608430854}",
    "programs": "{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}",
    "desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
}

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)


# --------------------------------------------------------------------------
# the project
# --------------------------------------------------------------------------

def project_name(project_dir: pathlib.Path) -> str:
    """The name the Crows Nest shows (branding.yml `name`), else the folder's name."""
    path = project_dir / "branding" / "branding.yml"
    try:
        settings = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        settings = None
    name = settings.get("name") if isinstance(settings, dict) else None
    return str(name).strip() if name and str(name).strip() else project_dir.name


def icon_source(project_dir: pathlib.Path) -> tuple[pathlib.Path, str | None]:
    """
    The image to make the shortcut's icon from, and a note when it is not the project's own.

    A shortcut icon needs a bitmap, and nothing in the standard library or on a
    bare Windows draws an SVG. branding/icon.png comes first, because a logo is
    often a wordmark that is unreadable at icon size; then logo.png; then the
    datavloot mark.
    """
    branding = project_dir / "branding"
    for name in ("icon.png", "logo.png"):
        if (branding / name).is_file():
            return branding / name, None
    if (branding / "logo.svg").is_file():
        return _FALLBACK_ICON, (
            "branding/logo.svg cannot be turned into an icon here, so the shortcut gets "
            "the datavloot mark. Put a square branding/icon.png next to it and run "
            "this command again for the project's own."
        )
    return _FALLBACK_ICON, None


def _file_name(name: str) -> str:
    """name, safe as a file name on Windows and macOS."""
    cleaned = "".join("_" if c in '<>:"/\\|?*' or ord(c) < 32 else c for c in name)
    return cleaned.strip().rstrip(".") or "Datavloot"


def _slug(project_dir: pathlib.Path) -> str:
    """A name for launchd that stays apart for two projects with the same folder name."""
    digest = hashlib.sha1(str(project_dir).encode("utf-8")).hexdigest()[:8]
    base = "".join(c if c.isalnum() else "-" for c in project_dir.name.lower()).strip("-")
    return f"{base or 'project'}-{digest}"


def _platform() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return sys.platform


def python(gui: bool) -> str:
    """
    The interpreter of the environment running this command, which has datavloot.

    On Windows `gui` asks for pythonw.exe, which opens no console window. Not
    resolved: a venv's python is a link to the base interpreter, which does not
    have the project's packages.
    """
    exe = pathlib.Path(sys.executable)
    if gui and _platform() == "windows":
        pythonw = exe.with_name("pythonw.exe")
        if pythonw.is_file():
            return str(pythonw)
    return str(exe)


def start_args() -> list[str]:
    """`datavloot start` as autostart and `open` run it: no browser, output to the log."""
    return ["-m", "datavloot_platform.cli", "start", "--no-open", "--log", str(LOG_FILE)]


def open_args() -> list[str]:
    return ["-m", "datavloot_platform.cli", "open"]


# --------------------------------------------------------------------------
# the log, and whether a start is running
# --------------------------------------------------------------------------

def _rotate(log: pathlib.Path) -> None:
    try:
        if log.stat().st_size > _LOG_MAX_BYTES:
            os.replace(log, log.with_name(log.name + ".1"))
    except OSError:
        # Missing, or held open by another process (Windows): rotate next time.
        pass


def open_log(path: pathlib.Path):
    """The log, opened for appending, line by line so a crash loses nothing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    _rotate(path)
    return open(path, "a", encoding="utf-8", errors="replace", buffering=1)


def redirect_output(project_dir: pathlib.Path, log: "str | None"):
    """
    Send this process's output to the log, and return the file for child processes.

    Under pythonw (autostart, the shortcut) there is no stdout at all, and
    whatever goes wrong would vanish: then the log is used even when `--log`
    was not given. Returns None when output stays on the terminal.
    """
    if log is None and sys.stdout is not None:
        return None
    path = project_dir / (log or LOG_FILE)
    handle = open_log(path)
    stamp = datetime.datetime.now().isoformat(sep=" ", timespec="seconds")
    handle.write(f"\n===== {stamp} datavloot start (pid {os.getpid()}) in {project_dir} =====\n")
    sys.stdout = sys.stderr = handle
    return handle


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        # os.kill(pid, 0) would end the process on Windows.
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def start_running(project_dir: pathlib.Path) -> bool:
    """Whether a `datavloot start` for this project is running, ready or not."""
    try:
        pid = int((project_dir / PID_FILE).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    return _alive(pid)


@contextlib.contextmanager
def start_marker(project_dir: pathlib.Path):
    """Mark that `datavloot start` runs, for as long as the block lasts."""
    path = project_dir / PID_FILE
    mine = str(os.getpid())
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(mine, encoding="utf-8")
    except OSError:
        pass  # without the marker `open` may start a second one; not worth failing for
    try:
        yield
    finally:
        try:
            if path.read_text(encoding="utf-8").strip() == mine:
                path.unlink()
        except OSError:
            pass


# --------------------------------------------------------------------------
# datavloot open
# --------------------------------------------------------------------------

def crowsnest_state(port: int = CROWSNEST_PORT) -> str:
    """
    "up" when the Crows Nest answers on port, "other" when something else does,
    "down" when nothing listens.

    /api/health is the one path that needs no token when the Crows Nest has one.
    """
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=3) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return "up" if isinstance(body, dict) and "services" in body else "other"
    except urllib.error.HTTPError:
        return "other"
    except (urllib.error.URLError, OSError, ValueError):
        return "down"


def spawn_start(project_dir: pathlib.Path, log) -> subprocess.Popen:
    """
    Start `datavloot start` in the background, as autostart does.

    Its output goes to the log from the first line, so even an import error in
    the new process is there to read. On Windows it is pythonw, which has no
    console; CREATE_NO_WINDOW covers a python.exe fallback. Its own process
    group or session, so it outlives `open`.
    """
    kwargs: dict = {"cwd": project_dir, "stdin": subprocess.DEVNULL, "stdout": log, "stderr": subprocess.STDOUT}
    if _platform() == "windows":
        kwargs["creationflags"] = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([python(gui=True), *start_args()], **kwargs)


def show_file(path: pathlib.Path) -> None:
    """Open path in the program the system uses for it: Notepad, Console, a text editor."""
    if _platform() == "windows":
        os.startfile(str(path))  # noqa: S606 -- a file this toolkit wrote
    elif _platform() == "macos":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def open_crowsnest(project_dir: pathlib.Path, port: int = CROWSNEST_PORT, timeout: int = OPEN_TIMEOUT) -> int:
    """
    Open the Crows Nest in the browser, starting Datavloot first when it is not running.

    What the shortcut runs. It has no window to show an error in, so when
    starting fails or takes longer than timeout seconds, it opens the log,
    where `start` wrote why. Returns the exit code.
    """
    url = f"http://localhost:{port}"
    log_path = project_dir / LOG_FILE

    if crowsnest_state(port) == "up":
        webbrowser.open(url)
        return 0

    proc = None
    with open_log(log_path) as log:
        if crowsnest_state(port) == "other":
            log.write(
                f"\ndatavloot open: something other than the Crows Nest answers on port {port}. "
                "Stop it, or stop the other Datavloot, and try again.\n"
            )
        elif start_running(project_dir):
            # Autostart at login, or another click, got there first: wait for it.
            _say("Datavloot is starting; waiting for the Crows Nest…")
        else:
            _say(f"Starting Datavloot in the background; the log is {log_path}")
            proc = spawn_start(project_dir, log)

    deadline = time.monotonic() + timeout
    while proc is not None or start_running(project_dir):
        if crowsnest_state(port) == "up":
            webbrowser.open(url)
            return 0
        if proc is not None and proc.poll() is not None:
            break
        if time.monotonic() > deadline:
            with open_log(log_path) as log:
                log.write(f"\ndatavloot open: the Crows Nest did not answer within {timeout} seconds.\n")
            break
        time.sleep(1)

    if crowsnest_state(port) == "up":  # a start that finished between two checks
        webbrowser.open(url)
        return 0
    _say(f"The Crows Nest did not start; see {log_path}")
    show_file(log_path)
    return 1


def _say(message: str) -> None:
    # From the shortcut this runs under pythonw, which has no stdout.
    if sys.stdout is not None:
        print(message, flush=True)


# --------------------------------------------------------------------------
# icons
# --------------------------------------------------------------------------

def _png_size(png: bytes) -> tuple[int, int]:
    if png[:8] != b"\x89PNG\r\n\x1a\n" or png[12:16] != b"IHDR":
        raise ValueError("not a PNG")
    return struct.unpack(">II", png[16:24])


def ico_from_png(png: bytes) -> bytes:
    """
    An .ico holding png as its one image.

    Windows reads PNG-compressed icon images since Vista, so no image library
    is needed. The size fields hold 0 for 256 pixels; larger images are scaled
    down first (_fit_png), since the format does not describe them.
    """
    width, height = _png_size(png)
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", width % 256, height % 256, 0, 0, 1, 32, len(png), 6 + 16)
    return header + entry + png


_FIT_PNG_PS1 = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($env:DATAVLOOT_ICON_IN)
try {
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)
    $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
    $w = [int]($src.Width * $scale); $h = [int]($src.Height * $scale)
    $g.DrawImage($src, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
    $g.Dispose()
    $bmp.Save($env:DATAVLOOT_ICON_OUT, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
} finally { $src.Dispose() }
"""


def _powershell(script: str, env: dict) -> None:
    shell = shutil.which("powershell") or shutil.which("pwsh")
    if not shell:
        raise RuntimeError("PowerShell is not on the PATH")
    result = subprocess.run(
        [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        timeout=120,
        creationflags=CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip() or f"exit code {result.returncode}")


def _fit_png(png_path: pathlib.Path) -> bytes:
    """png_path's image at most 256 pixels square, scaled by Windows' own System.Drawing."""
    png = png_path.read_bytes()
    width, height = _png_size(png)
    if width <= 256 and height <= 256:
        return png
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "icon.png"
        _powershell(_FIT_PNG_PS1, {"DATAVLOOT_ICON_IN": str(png_path), "DATAVLOOT_ICON_OUT": str(out)})
        return out.read_bytes()


def write_windows_icon(source: pathlib.Path, dest: pathlib.Path) -> pathlib.Path | None:
    """The .ico a shortcut needs, or None (the shortcut then shows Python's icon)."""
    try:
        data = ico_from_png(_fit_png(source))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        print(f"Warning: no icon for the shortcut ({e}).", file=sys.stderr)
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def write_mac_icon(source: pathlib.Path, dest: pathlib.Path) -> pathlib.Path | None:
    """An .icns made by sips, which every Mac has; None without it."""
    sips = shutil.which("sips")
    if not sips:
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [sips, "-s", "format", "icns", str(source), "--out", str(dest)], capture_output=True
    )
    return dest if result.returncode == 0 and dest.is_file() else None


# --------------------------------------------------------------------------
# Windows
# --------------------------------------------------------------------------

def _known_folder(key: str) -> pathlib.Path | None:
    """Where Windows has this user's folder, redirected or not; None if it cannot say."""
    if os.name != "nt":
        return None
    try:
        import ctypes
        import uuid
        from ctypes import wintypes

        guid = uuid.UUID(_FOLDERID[key])
        buf = (ctypes.c_byte * 16).from_buffer_copy(guid.bytes_le)
        path = ctypes.c_wchar_p()
        shell32 = ctypes.windll.shell32
        shell32.SHGetKnownFolderPath.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
        if shell32.SHGetKnownFolderPath(ctypes.byref(buf), 0, None, ctypes.byref(path)) != 0:
            return None
        try:
            return pathlib.Path(path.value)
        finally:
            ctypes.windll.ole32.CoTaskMemFree(path)
    except Exception:  # noqa: BLE001 -- the environment variables below are the fallback
        return None


def windows_folders() -> dict[str, pathlib.Path]:
    appdata = pathlib.Path(os.environ.get("APPDATA") or pathlib.Path.home() / "AppData" / "Roaming")
    programs = appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    profile = pathlib.Path(os.environ.get("USERPROFILE") or pathlib.Path.home())
    fallback = {"startup": programs / "Startup", "programs": programs, "desktop": profile / "Desktop"}
    return {key: _known_folder(key) or path for key, path in fallback.items()}


_SHORTCUTS_PS1 = r"""
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
foreach ($s in ($env:DATAVLOOT_SHORTCUTS | ConvertFrom-Json)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $s.path) | Out-Null
    $link = $shell.CreateShortcut($s.path)
    $link.TargetPath = $s.target
    $link.Arguments = $s.arguments
    $link.WorkingDirectory = $s.workdir
    $link.Description = $s.description
    if ($s.icon) { $link.IconLocation = "$($s.icon),0" }
    $link.Save()
}
"""


def _quote(arg: str) -> str:
    return f'"{arg}"' if any(c in arg for c in ' \t"') else arg


def write_windows_shortcuts(shortcuts: list[dict]) -> None:
    """
    Write .lnk files through WScript.Shell, which every Windows has, so no pywin32.

    A .lnk and not a .url: an internet shortcut can only open a URL, and the
    shortcut has to run `datavloot open` to start Datavloot when it is not up.
    The list goes in as JSON in an environment variable, so no name or path
    needs quoting for PowerShell.
    """
    _powershell(_SHORTCUTS_PS1, {"DATAVLOOT_SHORTCUTS": json.dumps(shortcuts)})


def _windows_plan(project_dir: pathlib.Path, name: str, icon: "pathlib.Path | None", login: bool = True) -> list[dict]:
    folders = windows_folders()
    file_name = _file_name(name) + ".lnk"
    pythonw = python(gui=True)

    def link(path, args, description):
        return {
            "path": str(path),
            "target": pythonw,
            "arguments": " ".join(_quote(a) for a in args),
            "workdir": str(project_dir),
            "description": description,
            "icon": str(icon) if icon else "",
        }

    at_login = [link(folders["startup"] / file_name, start_args(), f"Start {name} (Datavloot) at login")]
    return (at_login if login else []) + [
        link(folders["programs"] / file_name, open_args(), f"Open {name} in the Crows Nest"),
        link(folders["desktop"] / file_name, open_args(), f"Open {name} in the Crows Nest"),
    ]


# --------------------------------------------------------------------------
# macOS
# --------------------------------------------------------------------------

def launch_agent(project_dir: pathlib.Path, label: str) -> dict:
    """The LaunchAgent that runs `datavloot start` at login."""
    log = str(project_dir / LOG_FILE)
    return {
        "Label": label,
        "ProgramArguments": [python(gui=False), *start_args()],
        "WorkingDirectory": str(project_dir),
        "RunAtLoad": True,
        # `start` writes its own log; these catch what happens before it can,
        # such as an environment that no longer has datavloot.
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "ProcessType": "Interactive",
    }


def app_launcher(project_dir: pathlib.Path) -> str:
    """The script inside the .app: `datavloot open` in the project."""
    return (
        "#!/bin/sh\n"
        "# Made by `datavloot autostart on` or `datavloot shortcut on`; `off` removes it.\n"
        f'cd "{project_dir}" || exit 1\n'
        f'exec "{python(gui=False)}" -m datavloot_platform.cli open\n'
    )


def app_info(name: str, label: str, has_icon: bool) -> dict:
    info = {
        "CFBundleName": name,
        "CFBundleDisplayName": name,
        "CFBundleIdentifier": f"{label}.open",
        "CFBundleExecutable": "open-crowsnest",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": "1",
        # No Dock icon for a script that is gone once the browser opens.
        "LSUIElement": True,
    }
    if has_icon:
        info["CFBundleIconFile"] = "icon"
    return info


# --------------------------------------------------------------------------
# on, off, status
# --------------------------------------------------------------------------

def _record_path(project_dir: pathlib.Path) -> pathlib.Path:
    return project_dir / RECORD_FILE


def read_record(project_dir: pathlib.Path) -> dict | None:
    try:
        record = json.loads(_record_path(project_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def _write_record(project_dir: pathlib.Path, record: dict) -> None:
    path = _record_path(project_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def _check_project(project_dir: pathlib.Path) -> None:
    if not (project_dir / "dbt_project.yml").is_file():
        raise SystemExit(
            f"Error: {project_dir} is not a Datavloot project (it has no dbt_project.yml). "
            "Run this from the project directory, where you run `datavloot start`."
        )


def turn_on(project_dir: pathlib.Path, login: bool = True) -> list[str]:
    """
    Put down the shortcuts, and with `login` the login entry; return what was
    made, for the user.
    """
    _check_project(project_dir)
    platform = _platform()
    if platform not in ("windows", "macos"):
        what = "autostart" if login else "a shortcut"
        raise SystemExit(f"Error: {what} is available on Windows and macOS.")

    # Start from nothing, so a renamed project does not keep its old shortcuts,
    # and `shortcut on` after `autostart on` takes the login entry away.
    turn_off(project_dir)

    name = project_name(project_dir)
    source, note = icon_source(project_dir)
    if note:
        print(f"Note: {note}\n")
    record: dict = {"platform": platform, "name": name, "login": login, "files": [], "dirs": []}

    if platform == "windows":
        icon = write_windows_icon(source, project_dir / STATE_DIR / "icon.ico")
        if icon:
            record["files"].append(str(icon))
        plan = _windows_plan(project_dir, name, icon, login)
        # Recorded first: a failure halfway still leaves `off` a list to clean up.
        record["files"] += [s["path"] for s in plan]
        _write_record(project_dir, record)
        try:
            write_windows_shortcuts(plan)
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            turn_off(project_dir)
            raise SystemExit(f"Error: could not create the shortcuts: {e}") from None
        made = [f"At login:   {plan[0]['path']}"] if login else []
        made += [f"Start menu: {plan[-2]['path']}", f"Desktop:    {plan[-1]['path']}"]
    else:
        home = pathlib.Path.home()
        label = f"nl.datavloot.autostart.{_slug(project_dir)}"
        agent = home / "Library" / "LaunchAgents" / f"{label}.plist"
        app = home / "Applications" / f"{_file_name(name)}.app"
        if login:
            record["files"].append(str(agent))
        record["dirs"].append(str(app))
        _write_record(project_dir, record)

        if login:
            agent.parent.mkdir(parents=True, exist_ok=True)
            agent.write_bytes(plistlib.dumps(launch_agent(project_dir, label)))
        contents = app / "Contents"
        (contents / "MacOS").mkdir(parents=True, exist_ok=True)
        launcher = contents / "MacOS" / "open-crowsnest"
        launcher.write_text(app_launcher(project_dir), encoding="utf-8")
        launcher.chmod(0o755)
        icon = write_mac_icon(source, contents / "Resources" / "icon.icns")
        (contents / "Info.plist").write_bytes(plistlib.dumps(app_info(name, label, icon is not None)))
        made = [f"At login:     {agent}"] if login else []
        made.append(f"Applications: {app}")
    return made


def _remove(path: pathlib.Path, is_dir: bool, attempts: int = 10) -> bool:
    """
    Remove path; False when it was not there. A shortcut just made is read by
    Explorer and the search indexer for a moment, during which Windows refuses
    to delete it: try again for a few seconds before giving up.
    """
    for attempt in range(attempts):
        try:
            if is_dir:
                shutil.rmtree(path)
            else:
                path.unlink()
            return True
        except FileNotFoundError:
            return False
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.3)
    return False


def turn_off(project_dir: pathlib.Path) -> list[str]:
    """Remove what `on` made, by its record; return what was removed."""
    record = read_record(project_dir)
    removed, stuck = [], []
    if record:
        paths = [(p, False) for p in record.get("files", [])] + [(p, True) for p in record.get("dirs", [])]
        for path, is_dir in paths:
            try:
                if _remove(pathlib.Path(path), is_dir):
                    removed.append(path)
            except OSError:
                stuck.append(path)
        if stuck:
            # The record stays, with what is left, so `off` again can finish.
            record["files"] = [p for p in record.get("files", []) if p in stuck]
            record["dirs"] = [p for p in record.get("dirs", []) if p in stuck]
            _write_record(project_dir, record)
            raise SystemExit(
                "Error: could not remove " + ", ".join(stuck) + " (another program has it open). "
                "Run the same command again in a moment, or delete it by hand."
            )
        _record_path(project_dir).unlink(missing_ok=True)
    # Only when empty: the directory is shared, and `datavloot update` keeps its
    # record of an installation there (install.json, see remote.py).
    with contextlib.suppress(OSError):
        (project_dir / STATE_DIR).rmdir()
    return removed


def status(project_dir: pathlib.Path) -> list[str]:
    """Lines saying what `on` put down and whether it is still there."""
    record = read_record(project_dir)
    lines = []
    if not record:
        lines.append("Autostart is off for this project, and it has no shortcut.")
    else:
        name = record.get("name", project_dir.name)
        # A record from before `shortcut` existed has no "login": it was autostart.
        login = record.get("login", True)
        command = "autostart" if login else "shortcut"
        lines.append(
            f"Autostart is on for {name}:" if login
            else f"{name} has a shortcut; autostart at login is off:"
        )
        for path in record.get("files", []) + record.get("dirs", []):
            there = "" if pathlib.Path(path).exists() else f"   (missing; run `datavloot {command} on` again)"
            lines.append(f"  {path}{there}")
    lines.append(f"Log: {project_dir / LOG_FILE}")
    state = crowsnest_state()
    lines.append({
        "up": f"The Crows Nest answers at http://localhost:{CROWSNEST_PORT}.",
        "other": f"Something other than the Crows Nest answers on port {CROWSNEST_PORT}.",
        "down": f"Nothing answers on port {CROWSNEST_PORT}; `datavloot open` starts it.",
    }[state])
    return lines


def main(action: str, project_dir: pathlib.Path, login: bool = True) -> None:
    """`datavloot autostart on|off|status`, or with login=False `datavloot shortcut on|off|status`."""
    command = "autostart" if login else "shortcut"
    if action == "on":
        made = turn_on(project_dir, login)
        print(("Autostart is on." if login else "The shortcut is there; Datavloot does not start at login.") + " Made:")
        for line in made:
            print(f"  {line}")
        if login:
            print(
                f"\nFrom the next login Datavloot starts by itself, without a window; its log is "
                f"{project_dir / LOG_FILE}."
            )
        print(
            f"\nThe shortcut opens the Crows Nest, and starts Datavloot first when it is not "
            f"running; its log is then {project_dir / LOG_FILE}. To start it now: datavloot open\n"
            f"Remove it with: datavloot {command} off"
        )
    elif action == "off":
        removed = turn_off(project_dir)
        if removed:
            print("Autostart is off. Removed:" if login else "The shortcut is gone. Removed:")
            for path in removed:
                print(f"  {path}")
            print("A Datavloot that is running now keeps running until you shut it down or log out.")
        else:
            print("There was no autostart or shortcut for this project; nothing to remove.")
    else:
        print("\n".join(status(project_dir)))
