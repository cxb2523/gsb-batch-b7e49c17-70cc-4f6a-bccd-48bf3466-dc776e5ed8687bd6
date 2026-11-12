"""
`datavloot autostart on|off|status`, `datavloot open`, and what `datavloot
start` does for them (#116): a Dagster home that persists, a log, and no
console windows under pythonw.

Every test runs against a home, APPDATA and USERPROFILE in a temporary
directory, with Windows' known-folder lookup switched off, so none of them
touches the real Startup folder, Start menu, desktop or LaunchAgents. The
Windows shortcut writer is replaced by one that writes JSON, so the Windows
half is tested on Linux and macOS too; the tests marked `live` at the end use
the real one, in a temporary folder.
"""

import argparse
import json
import os
import pathlib
import plistlib
import shutil
import struct
import subprocess
import sys
import zlib

import pytest

from datavloot_platform import autostart, cli
from datavloot_platform.crowsnest import processes


def make_png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    raw = b"".join(b"\x00" + b"\x00\x70\xc0\xff" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def home(tmp_path, monkeypatch):
    """A user's home of its own: HOME, USERPROFILE and APPDATA all point into it."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("APPDATA", str(home / "AppData" / "Roaming"))
    monkeypatch.setattr(pathlib.Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(autostart, "_known_folder", lambda key: None)
    monkeypatch.setattr(autostart, "crowsnest_state", lambda port=8080: "down")
    return home


@pytest.fixture
def venv(tmp_path, monkeypatch):
    """A stand-in environment, so the command lines are the same on every OS."""
    scripts = tmp_path / "venv" / "Scripts"
    scripts.mkdir(parents=True)
    for name in ("python.exe", "pythonw.exe"):
        (scripts / name).write_text("", encoding="utf-8")
    monkeypatch.setattr(sys, "executable", str(scripts / "python.exe"))
    return scripts


@pytest.fixture
def project(tmp_path):
    project = tmp_path / "work" / "keten connect"
    project.mkdir(parents=True)
    (project / "dbt_project.yml").write_text("name: keten\n", encoding="utf-8")
    (project / "dagster.yaml").write_text("concurrency:\n  pools:\n    default_limit: 1\n", encoding="utf-8")
    return project


def brand(project, name=None, files=()):
    branding = project / "branding"
    branding.mkdir(exist_ok=True)
    if name is not None:
        (branding / "branding.yml").write_text(f"name: {name}\n", encoding="utf-8")
    for file in files:
        (branding / file).write_bytes(make_png(16, 16) if file.endswith(".png") else b"<svg/>")


@pytest.fixture
def windows(monkeypatch, home, venv):
    """Windows, with shortcuts written as JSON instead of through WScript.Shell."""
    monkeypatch.setattr(autostart, "_platform", lambda: "windows")

    def write(shortcuts):
        for s in shortcuts:
            path = pathlib.Path(s["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(s), encoding="utf-8")

    monkeypatch.setattr(autostart, "write_windows_shortcuts", write)
    return home


@pytest.fixture
def macos(monkeypatch, home, venv):
    monkeypatch.setattr(autostart, "_platform", lambda: "macos")
    monkeypatch.setattr(autostart.shutil, "which", lambda name, **kw: None)  # no sips here
    return home


def files_under(*roots) -> set[str]:
    return {str(p) for root in roots for p in pathlib.Path(root).rglob("*")}


# --------------------------------------------------------------------------
# name and icon
# --------------------------------------------------------------------------

def test_the_name_comes_from_branding(project):
    brand(project, "KetenConnect")
    assert autostart.project_name(project) == "KetenConnect"


@pytest.mark.parametrize("yml", [None, "colors:\n  accent: '#0070c0'\n", "name: ''\n", "name: [unclosed\n"])
def test_the_name_falls_back_to_the_folder(project, yml):
    if yml is not None:
        (project / "branding").mkdir()
        (project / "branding" / "branding.yml").write_text(yml, encoding="utf-8")
    assert autostart.project_name(project) == "keten connect"


def test_the_icon_prefers_icon_png_then_logo_png(project):
    brand(project, files=["logo.png", "icon.png", "logo.svg"])
    assert autostart.icon_source(project) == (project / "branding" / "icon.png", None)
    (project / "branding" / "icon.png").unlink()
    assert autostart.icon_source(project) == (project / "branding" / "logo.png", None)


def test_an_svg_logo_gets_the_datavloot_mark_and_says_so(project):
    brand(project, files=["logo.svg"])
    source, note = autostart.icon_source(project)
    assert source == autostart._FALLBACK_ICON and source.is_file()
    assert "icon.png" in note


def test_no_branding_gets_the_datavloot_mark_quietly(project):
    assert autostart.icon_source(project) == (autostart._FALLBACK_ICON, None)


def test_an_ico_holds_the_png_whole():
    png = make_png(32, 16)
    ico = autostart.ico_from_png(png)
    reserved, kind, count = struct.unpack("<HHH", ico[:6])
    width, height, _, _, planes, bits, size, offset = struct.unpack("<BBBBHHII", ico[6:22])
    assert (reserved, kind, count) == (0, 1, 1)
    assert (width, height, planes, bits) == (32, 16, 1, 32)
    assert ico[offset:offset + size] == png


def test_a_256_pixel_icon_is_written_as_size_0():
    ico = autostart.ico_from_png(make_png(256, 256))
    assert ico[6:8] == b"\x00\x00"


@pytest.mark.parametrize("name, expected", [
    ("KetenConnect", "KetenConnect"),
    ('A/B: "C"?', "A_B_ _C__"),
    ("dots...", "dots"),
    ("  ", "Datavloot"),
])
def test_names_are_safe_file_names(name, expected):
    assert autostart._file_name(name) == expected


# --------------------------------------------------------------------------
# Windows
# --------------------------------------------------------------------------

def startup(home):
    return home / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def test_on_windows_makes_the_login_entry_and_two_shortcuts(windows, venv, project):
    brand(project, "KetenConnect", ["logo.png"])
    autostart.turn_on(project)

    programs = startup(windows).parent
    entry = json.loads((startup(windows) / "KetenConnect.lnk").read_text(encoding="utf-8"))
    menu = json.loads((programs / "KetenConnect.lnk").read_text(encoding="utf-8"))
    desktop = json.loads((windows / "Desktop" / "KetenConnect.lnk").read_text(encoding="utf-8"))

    icon = project / ".datavloot" / "icon.ico"
    assert icon.read_bytes()[:4] == b"\x00\x00\x01\x00"
    for link in (entry, menu, desktop):
        assert link["target"] == str(venv / "pythonw.exe"), "a console window at login"
        assert link["workdir"] == str(project)
        assert link["icon"] == str(icon)
    assert entry["arguments"] == r"-m datavloot_platform.cli start --no-open --log " + str(pathlib.Path("logs/datavloot-start.log"))
    assert menu["arguments"] == desktop["arguments"] == "-m datavloot_platform.cli open"


def test_off_on_windows_leaves_nothing_behind(windows, project):
    brand(project, "KetenConnect", ["logo.png"])
    before_home, before_project = files_under(windows), files_under(project)
    autostart.turn_on(project)
    assert files_under(windows) != before_home

    removed = autostart.turn_off(project)

    assert len(removed) == 4  # three shortcuts and the icon
    # Only the folders Windows has anyway are left: Startup, Programs, Desktop.
    assert {p for p in files_under(windows) - before_home if pathlib.Path(p).is_file()} == set()
    assert files_under(project) == before_project


def test_off_keeps_the_record_of_an_installation(windows, project):
    """.datavloot/ is shared with `datavloot update`, whose install.json must survive."""
    record = project / ".datavloot" / "install.json"
    record.parent.mkdir()
    record.write_text('{"ref": "v1.0.0"}', encoding="utf-8")
    brand(project, "KetenConnect", ["logo.png"])

    autostart.turn_on(project)
    autostart.turn_on(project)  # `on` again starts with `off`
    autostart.turn_off(project)

    assert record.read_text(encoding="utf-8") == '{"ref": "v1.0.0"}'


def test_on_again_after_a_rename_removes_the_old_shortcuts(windows, project):
    brand(project, "Old name")
    autostart.turn_on(project)
    brand(project, "New name")
    autostart.turn_on(project)

    names = {p.name for p in (windows / "Desktop").iterdir()}
    assert names == {"New name.lnk"}


def test_a_failed_shortcut_cleans_up_after_itself(windows, project, monkeypatch):
    def fail(shortcuts):
        pathlib.Path(shortcuts[0]["path"]).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(shortcuts[0]["path"]).write_text("half", encoding="utf-8")
        raise RuntimeError("COM said no")

    monkeypatch.setattr(autostart, "write_windows_shortcuts", fail)
    with pytest.raises(SystemExit, match="COM said no"):
        autostart.turn_on(project)
    assert not list(startup(windows).iterdir())
    assert not (project / ".datavloot").exists()


def test_the_folder_name_is_used_without_branding(windows, project):
    autostart.turn_on(project)
    assert (windows / "Desktop" / "keten connect.lnk").is_file()


# --------------------------------------------------------------------------
# macOS
# --------------------------------------------------------------------------

def test_on_macos_makes_a_launch_agent_and_an_app(macos, venv, project):
    brand(project, "KetenConnect")
    autostart.turn_on(project)

    agents = list((macos / "Library" / "LaunchAgents").iterdir())
    assert len(agents) == 1 and agents[0].name.startswith("nl.datavloot.autostart.keten-connect-")
    agent = plistlib.loads(agents[0].read_bytes())
    assert agent["Label"] == agents[0].stem
    assert agent["ProgramArguments"] == [
        str(venv / "python.exe"), "-m", "datavloot_platform.cli", "start", "--no-open",
        "--log", str(pathlib.Path("logs/datavloot-start.log")),
    ]
    assert agent["WorkingDirectory"] == str(project)
    assert agent["RunAtLoad"] is True
    assert agent["StandardErrorPath"] == str(project / "logs" / "datavloot-start.log")

    app = macos / "Applications" / "KetenConnect.app" / "Contents"
    info = plistlib.loads((app / "Info.plist").read_bytes())
    assert info["CFBundleExecutable"] == "open-crowsnest"
    assert info["CFBundleName"] == "KetenConnect"
    assert "CFBundleIconFile" not in info, "an icon that is not there"
    launcher = (app / "MacOS" / "open-crowsnest").read_text(encoding="utf-8")
    assert launcher.startswith("#!/bin/sh\n")
    assert f'cd "{project}"' in launcher
    assert f'exec "{venv / "python.exe"}" -m datavloot_platform.cli open' in launcher
    if os.name != "nt":
        assert os.access(app / "MacOS" / "open-crowsnest", os.X_OK)


def test_the_mac_app_gets_an_icon_when_sips_makes_one(macos, project, monkeypatch):
    brand(project, "KetenConnect", ["logo.png"])

    def sips(source, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"icns")
        return dest

    monkeypatch.setattr(autostart, "write_mac_icon", sips)
    autostart.turn_on(project)
    app = macos / "Applications" / "KetenConnect.app" / "Contents"
    assert plistlib.loads((app / "Info.plist").read_bytes())["CFBundleIconFile"] == "icon"
    assert (app / "Resources" / "icon.icns").is_file()


def test_off_on_macos_leaves_nothing_behind(macos, project):
    before_home, before_project = files_under(macos), files_under(project)
    autostart.turn_on(project)
    autostart.turn_off(project)
    left = {p for p in files_under(macos) - before_home if pathlib.Path(p).is_file()}
    assert left == set()
    assert not list((macos / "Applications").iterdir())
    assert files_under(project) == before_project


def test_two_projects_with_one_folder_name_get_two_agents(macos, tmp_path):
    for parent in ("a", "b"):
        project = tmp_path / parent / "demo"
        project.mkdir(parents=True)
        (project / "dbt_project.yml").write_text("", encoding="utf-8")
        autostart.launch_agent(project, "x")  # smoke
    a, b = autostart._slug(tmp_path / "a" / "demo"), autostart._slug(tmp_path / "b" / "demo")
    assert a != b and a.startswith("demo-")


# --------------------------------------------------------------------------
# status, and where it is refused
# --------------------------------------------------------------------------

def test_status_says_off_then_on_then_what_is_missing(windows, project):
    assert autostart.status(project)[0] == "Autostart is off for this project, and it has no shortcut."
    brand(project, "KetenConnect")
    autostart.turn_on(project)
    lines = autostart.status(project)
    assert lines[0] == "Autostart is on for KetenConnect:"
    assert not any("missing" in line for line in lines)

    (windows / "Desktop" / "KetenConnect.lnk").unlink()
    assert any("Desktop" in line and "missing" in line for line in autostart.status(project))
    assert any("datavloot-start.log" in line for line in lines)


def test_main_prints_each_action(windows, project, capsys):
    autostart.main("on", project)
    assert "Autostart is on" in capsys.readouterr().out
    autostart.main("status", project)
    assert "Autostart is on for" in capsys.readouterr().out
    autostart.main("off", project)
    assert "Autostart is off. Removed:" in capsys.readouterr().out
    autostart.main("off", project)
    assert "nothing to remove" in capsys.readouterr().out


def test_on_refuses_outside_a_project(windows, tmp_path):
    with pytest.raises(SystemExit, match="not a Datavloot project"):
        autostart.turn_on(tmp_path)


def test_on_refuses_on_linux(home, project, monkeypatch):
    monkeypatch.setattr(autostart, "_platform", lambda: "linux")
    with pytest.raises(SystemExit, match="Windows and macOS"):
        autostart.turn_on(project)


def test_the_cli_knows_the_new_commands(monkeypatch, tmp_path):
    called = []
    monkeypatch.setattr(
        autostart, "main",
        lambda action, d, login=True: called.append(("autostart" if login else "shortcut", action)),
    )
    monkeypatch.setattr(autostart, "open_crowsnest", lambda d: called.append(("open",)) or 0)
    monkeypatch.chdir(tmp_path)
    for argv in (["autostart", "on"], ["autostart", "status"], ["shortcut", "on"], ["shortcut", "off"], ["open"]):
        monkeypatch.setattr(sys, "argv", ["datavloot", *argv])
        try:
            cli.main()
        except SystemExit as e:
            assert e.code == 0
    assert called == [
        ("autostart", "on"), ("autostart", "status"), ("shortcut", "on"), ("shortcut", "off"), ("open",),
    ]


# --------------------------------------------------------------------------
# a shortcut without autostart
# --------------------------------------------------------------------------

def test_shortcut_on_windows_makes_the_shortcuts_without_the_login_entry(windows, venv, project):
    brand(project, "KetenConnect")
    made = autostart.turn_on(project, login=False)

    assert not startup(windows).exists() or not list(startup(windows).iterdir())
    desktop = json.loads((windows / "Desktop" / "KetenConnect.lnk").read_text(encoding="utf-8"))
    menu = json.loads((startup(windows).parent / "KetenConnect.lnk").read_text(encoding="utf-8"))
    assert desktop["arguments"] == menu["arguments"] == "-m datavloot_platform.cli open"
    assert [line.split(":")[0] for line in made] == ["Start menu", "Desktop"]


def test_shortcut_on_after_autostart_on_keeps_only_the_shortcuts(windows, project):
    brand(project, "KetenConnect")
    autostart.turn_on(project)
    assert (startup(windows) / "KetenConnect.lnk").is_file()

    autostart.turn_on(project, login=False)

    assert not (startup(windows) / "KetenConnect.lnk").exists()
    assert (windows / "Desktop" / "KetenConnect.lnk").is_file()
    assert autostart.status(project)[0] == "KetenConnect has a shortcut; autostart at login is off:"


def test_shortcut_off_leaves_nothing_behind(windows, project):
    before_home, before_project = files_under(windows), files_under(project)
    autostart.turn_on(project, login=False)
    autostart.turn_off(project)
    assert {p for p in files_under(windows) - before_home if pathlib.Path(p).is_file()} == set()
    assert files_under(project) == before_project


def test_shortcut_on_macos_makes_the_app_without_a_launch_agent(macos, project):
    brand(project, "KetenConnect")
    autostart.turn_on(project)
    autostart.turn_on(project, login=False)

    assert not list((macos / "Library" / "LaunchAgents").iterdir())
    assert (macos / "Applications" / "KetenConnect.app" / "Contents" / "Info.plist").is_file()
    autostart.turn_off(project)
    assert not list((macos / "Applications").iterdir())


def test_a_record_from_before_shortcut_reads_as_autostart(windows, project):
    """Records written before `login` was recorded were all autostart."""
    brand(project, "KetenConnect")
    autostart.turn_on(project)
    record = autostart.read_record(project)
    del record["login"]
    autostart._write_record(project, record)
    assert autostart.status(project)[0] == "Autostart is on for KetenConnect:"


def test_off_waits_for_a_shortcut_windows_still_holds(windows, project, monkeypatch):
    """Explorer reads a new .lnk for a moment; deleting it then fails with a sharing violation."""
    autostart.turn_on(project, login=False)
    real_unlink, refusals = pathlib.Path.unlink, []

    def unlink(self, missing_ok=False):
        if self.suffix == ".lnk" and len(refusals) < 2:
            refusals.append(self)
            raise PermissionError(32, "used by another process")
        return real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(pathlib.Path, "unlink", unlink)
    monkeypatch.setattr(autostart.time, "sleep", lambda s: None)
    autostart.turn_off(project)
    assert len(refusals) == 2
    assert not (windows / "Desktop" / "keten connect.lnk").exists()
    assert autostart.read_record(project) is None


def test_off_keeps_what_it_could_not_remove_for_next_time(windows, project, monkeypatch):
    autostart.turn_on(project, login=False)
    desktop = windows / "Desktop" / "keten connect.lnk"
    real_unlink = pathlib.Path.unlink

    def unlink(self, missing_ok=False):
        if self == desktop:
            raise PermissionError(32, "used by another process")
        return real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(pathlib.Path, "unlink", unlink)
    monkeypatch.setattr(autostart.time, "sleep", lambda s: None)
    with pytest.raises(SystemExit, match="Run the same command again"):
        autostart.turn_off(project)
    assert autostart.read_record(project)["files"] == [str(desktop)]

    monkeypatch.setattr(pathlib.Path, "unlink", real_unlink)
    assert autostart.turn_off(project) == [str(desktop)]
    assert autostart.read_record(project) is None


def test_shortcut_main_says_what_it_did(windows, project, capsys):
    autostart.main("on", project, login=False)
    out = capsys.readouterr().out
    assert "does not start at login" in out and "datavloot shortcut off" in out
    autostart.main("off", project, login=False)
    assert "The shortcut is gone. Removed:" in capsys.readouterr().out


# --------------------------------------------------------------------------
# datavloot open
# --------------------------------------------------------------------------

class FakeProc:
    def __init__(self, exits_after=None):
        self.polls = 0
        self.exits_after = exits_after

    def poll(self):
        self.polls += 1
        return 1 if self.exits_after is not None and self.polls >= self.exits_after else None


@pytest.fixture
def opener(project, monkeypatch):
    """open_crowsnest with the browser, the start, the clock and the log viewer recorded."""
    seen = {"browser": [], "spawned": [], "shown": []}
    monkeypatch.setattr(autostart.webbrowser, "open", seen["browser"].append)
    monkeypatch.setattr(autostart, "show_file", seen["shown"].append)
    monkeypatch.setattr(autostart.time, "sleep", lambda s: None)

    def states(*answers):
        answers = list(answers)
        monkeypatch.setattr(autostart, "crowsnest_state", lambda port=8080: answers.pop(0) if len(answers) > 1 else answers[0])

    def spawn(proc):
        def spawn_start(project_dir, log):
            seen["spawned"].append(project_dir)
            return proc
        monkeypatch.setattr(autostart, "spawn_start", spawn_start)

    seen["states"], seen["spawn"] = states, spawn
    return seen


def test_open_only_opens_the_browser_when_the_crows_nest_is_up(project, opener):
    opener["states"]("up")
    assert autostart.open_crowsnest(project) == 0
    assert opener["browser"] == ["http://localhost:8080"]
    assert opener["spawned"] == []


def test_open_starts_datavloot_and_waits_for_it(project, opener):
    opener["states"]("down", "down", "down", "down", "up")
    opener["spawn"](FakeProc())
    assert autostart.open_crowsnest(project) == 0
    assert opener["spawned"] == [project]
    assert opener["browser"] == ["http://localhost:8080"]
    assert opener["shown"] == []


def test_open_shows_the_log_when_starting_fails(project, opener):
    opener["states"]("down")
    opener["spawn"](FakeProc(exits_after=2))
    assert autostart.open_crowsnest(project) == 1
    assert opener["browser"] == []
    assert opener["shown"] == [project / "logs" / "datavloot-start.log"]


def test_open_gives_up_after_the_timeout(project, opener, monkeypatch):
    opener["states"]("down")
    opener["spawn"](FakeProc())
    ticks = iter(range(0, 10_000, 100))
    monkeypatch.setattr(autostart.time, "monotonic", lambda: next(ticks))
    assert autostart.open_crowsnest(project, timeout=250) == 1
    assert "did not answer within 250 seconds" in (project / "logs" / "datavloot-start.log").read_text(encoding="utf-8")


def test_open_waits_for_a_start_already_running(project, opener):
    opener["states"]("down", "down", "down", "up")
    with autostart.start_marker(project):
        assert autostart.open_crowsnest(project) == 0
    assert opener["spawned"] == [], "a second start next to one still loading"


def test_open_says_when_something_else_holds_the_port(project, opener):
    opener["states"]("other")
    assert autostart.open_crowsnest(project) == 1
    assert opener["spawned"] == []
    assert "something other than the Crows Nest" in (project / "logs" / "datavloot-start.log").read_text(encoding="utf-8")


@pytest.mark.parametrize("platform", ["windows", "macos"])
def test_open_starts_in_the_background_without_a_window(project, venv, monkeypatch, platform, tmp_path):
    monkeypatch.setattr(autostart, "_platform", lambda: platform)
    started = []
    monkeypatch.setattr(autostart.subprocess, "Popen", lambda args, **kwargs: started.append((args, kwargs)))
    with open(tmp_path / "log", "w") as log:
        autostart.spawn_start(project, log)
    args, kwargs = started[0]
    pythonw = venv / ("pythonw.exe" if platform == "windows" else "python.exe")
    assert args == [str(pythonw), *autostart.start_args()]
    assert kwargs["cwd"] == project
    assert kwargs["stderr"] == subprocess.STDOUT
    if platform == "windows":
        assert kwargs["creationflags"] & autostart.CREATE_NO_WINDOW
        assert "start_new_session" not in kwargs
    else:
        assert "creationflags" not in kwargs
        assert kwargs["start_new_session"] is True


def test_the_marker_names_a_running_start_and_goes_away(project):
    assert not autostart.start_running(project)
    with autostart.start_marker(project):
        assert autostart.start_running(project)
    assert not (project / autostart.PID_FILE).exists()


def test_a_marker_of_a_process_that_died_counts_for_nothing(project):
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    (project / "logs").mkdir()
    (project / autostart.PID_FILE).write_text(str(proc.pid), encoding="utf-8")
    assert not autostart.start_running(project)


# --------------------------------------------------------------------------
# datavloot start: the log, the Dagster home, no console windows
# --------------------------------------------------------------------------

def test_without_a_stdout_the_output_goes_to_the_log(project, monkeypatch):
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    handle = autostart.redirect_output(project, None)
    try:
        print("hello from pythonw")
        assert sys.stderr is handle
    finally:
        handle.close()
    text = (project / "logs" / "datavloot-start.log").read_text(encoding="utf-8")
    assert "datavloot start (pid" in text and "hello from pythonw" in text


def test_with_a_terminal_and_no_log_the_output_stays(project):
    assert autostart.redirect_output(project, None) is None


def test_a_big_log_is_rotated(project):
    log = project / "logs" / "datavloot-start.log"
    log.parent.mkdir()
    log.write_bytes(b"x" * (autostart._LOG_MAX_BYTES + 1))
    autostart.open_log(log).close()
    assert log.stat().st_size == 0
    assert log.with_name("datavloot-start.log.1").stat().st_size == autostart._LOG_MAX_BYTES + 1


def test_dagster_gets_a_home_in_the_project_with_a_copy_of_dagster_yaml(project, monkeypatch):
    monkeypatch.delenv("DAGSTER_HOME", raising=False)
    env = cli._dagster_home(project)
    home = project / ".dagster"
    assert env == {"DAGSTER_HOME": str(home)}
    assert (home / "dagster.yaml").read_text(encoding="utf-8") == (project / "dagster.yaml").read_text(encoding="utf-8")

    # Every start copies it again, so an edit counts from the next start...
    (project / "dagster.yaml").write_text("concurrency:\n  pools:\n    default_limit: 2\n", encoding="utf-8")
    (home / "history").mkdir()
    cli._dagster_home(project)
    assert "default_limit: 2" in (home / "dagster.yaml").read_text(encoding="utf-8")
    assert (home / "history").is_dir(), "the home is kept between starts"

    # ...and a project without one runs on Dagster's defaults, not a stale copy.
    (project / "dagster.yaml").unlink()
    cli._dagster_home(project)
    assert not (home / "dagster.yaml").exists()


def test_a_dagster_home_that_is_set_is_left_alone(project, monkeypatch, tmp_path):
    monkeypatch.setenv("DAGSTER_HOME", str(tmp_path / "elsewhere"))
    assert cli._dagster_home(project) == {}
    assert not (project / ".dagster").exists()


@pytest.mark.parametrize("platform, console, expected", [
    ("win32", False, processes.CREATE_NO_WINDOW),
    ("win32", True, 0),
    ("linux", False, 0),
    ("darwin", False, 0),
])
def test_no_window_only_on_windows_without_a_console(monkeypatch, platform, console, expected):
    monkeypatch.setattr(processes.sys, "platform", platform)
    monkeypatch.setattr(processes, "has_console", lambda: console)
    assert processes.console_child_flags() == expected


def test_marimo_gets_no_window_on_windows_only(monkeypatch):
    started = []
    monkeypatch.setattr(processes.subprocess, "Popen", lambda args, **kwargs: started.append(kwargs))
    processes.start_marimo(["edit"])
    flags = started[0].get("creationflags", 0)
    if sys.platform == "win32":
        assert flags & processes.CREATE_NO_WINDOW
        assert flags & subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        assert flags == 0
        assert started[0]["start_new_session"] is True


@pytest.fixture
def start(project, monkeypatch):
    """cmd_start up to the Crows Nest, with `dagster dev`'s Popen recorded."""
    pytest.importorskip("uvicorn", reason="uvicorn is not installed")
    monkeypatch.chdir(project)
    monkeypatch.delenv("DAGSTER_HOME", raising=False)
    # cmd_start may point these at the log; monkeypatch puts them back.
    monkeypatch.setattr(sys, "stdout", sys.stdout)
    monkeypatch.setattr(sys, "stderr", sys.stderr)
    popens = []

    class Dagster:
        pid = 0

        def poll(self):
            return 0

    def popen(args, **kwargs):
        popens.append(kwargs)
        return Dagster()

    marker_seen = []
    monkeypatch.setattr(cli.subprocess, "Popen", popen)
    monkeypatch.setattr(cli, "_wait_for_dagster", lambda *args: None)
    monkeypatch.setattr(cli, "cmd_crowsnest", lambda args: marker_seen.append(autostart.start_running(project)))
    monkeypatch.setattr(cli, "terminate_tree", lambda proc: None)
    # Creating or checking the lake is tested in test_cli_lake.py.
    monkeypatch.setattr(cli, "_check_lake", lambda project_dir: None)
    return popens, marker_seen


def test_start_runs_dagster_with_the_project_home(project, start):
    popens, marker_seen = start
    cli.cmd_start(argparse.Namespace(open=False))
    env = popens[0]["env"]
    assert env["DAGSTER_HOME"] == str(project / ".dagster")
    assert (project / ".dagster" / "dagster.yaml").is_file()
    assert marker_seen == [True], "open would not see that a start is under way"
    assert not (project / autostart.PID_FILE).exists()


@pytest.mark.parametrize("platform", ["win32", "linux"])
def test_start_under_pythonw_hides_dagster_on_windows_only(project, start, monkeypatch, platform):
    popens, _ = start
    monkeypatch.setattr(processes.sys, "platform", platform)
    monkeypatch.setattr(processes, "has_console", lambda: False)
    cli.cmd_start(argparse.Namespace(open=False, log="logs/datavloot-start.log"))
    sys.stdout.close()
    kwargs = popens[0]
    assert kwargs["creationflags"] == (processes.CREATE_NO_WINDOW if platform == "win32" else 0)
    assert kwargs["stdin"] == subprocess.DEVNULL and kwargs["stderr"] == subprocess.STDOUT
    assert pathlib.Path(kwargs["stdout"].name) == project / "logs" / "datavloot-start.log"
    log = (project / "logs" / "datavloot-start.log").read_text(encoding="utf-8")
    assert "Starting Dagster, with its state in" in log


@pytest.mark.parametrize("console", [True, False])
def test_start_from_a_terminal_hands_dagster_the_terminal(project, start, monkeypatch, console):
    """
    With a console Dagster shares it, as before. Without one (an IDE, a CI
    runner) Dagster gets a hidden console, and stdin set so that Popen hands
    down this process's output: else Dagster's output went to that hidden one.
    """
    popens, _ = start
    monkeypatch.setattr(processes.sys, "platform", "win32")
    monkeypatch.setattr(processes, "has_console", lambda: console)
    cli.cmd_start(argparse.Namespace(open=False))
    kwargs = popens[0]
    assert "stdout" not in kwargs and "stderr" not in kwargs
    if console:
        assert kwargs["creationflags"] == 0 and "stdin" not in kwargs
    else:
        assert kwargs["creationflags"] == processes.CREATE_NO_WINDOW
        assert kwargs["stdin"] == subprocess.DEVNULL


def test_start_stops_at_once_when_the_port_is_taken(project, start, monkeypatch):
    popens, _ = start
    monkeypatch.setattr(cli, "port_in_use", lambda port: True)
    with pytest.raises(SystemExit, match="port 8080, which the Crows Nest needs, is in use"):
        cli.cmd_start(argparse.Namespace(open=False, port=8080))
    assert popens == [], "Dagster started next to a Crows Nest that cannot"


# --------------------------------------------------------------------------
# live, on this Windows machine, in a temporary folder
# --------------------------------------------------------------------------

live_windows = pytest.mark.skipif(
    sys.platform != "win32" or not (shutil.which("powershell") or shutil.which("pwsh")),
    reason="needs Windows and PowerShell",
)


@live_windows
def test_live_a_real_shortcut_resolves(tmp_path, project):
    icon = autostart.write_windows_icon(autostart._FALLBACK_ICON, tmp_path / "icon.ico")
    link = tmp_path / "Start Menu" / "Keten Connect.lnk"
    autostart.write_windows_shortcuts([{
        "path": str(link),
        "target": autostart.python(gui=True),
        "arguments": " ".join(autostart.open_args()),
        "workdir": str(project),
        "description": "Open KetenConnect in the Crows Nest",
        "icon": str(icon),
    }])
    read = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"$l = (New-Object -ComObject WScript.Shell).CreateShortcut('{link}'); "
         "$l.TargetPath; $l.Arguments; $l.WorkingDirectory; $l.IconLocation"],
        capture_output=True, text=True, timeout=60,
    )
    target, arguments, workdir, icon_location = read.stdout.strip().splitlines()
    assert pathlib.Path(target).name.lower() == "pythonw.exe" and pathlib.Path(target).is_file()
    assert arguments == "-m datavloot_platform.cli open"
    assert pathlib.Path(workdir) == project
    assert icon_location == f"{icon},0"


@live_windows
def test_live_a_big_png_is_scaled_to_an_icon(tmp_path):
    big = tmp_path / "logo.png"
    big.write_bytes(make_png(600, 300))
    ico = autostart.write_windows_icon(big, tmp_path / "icon.ico").read_bytes()
    width, height = struct.unpack(">II", ico[22 + 16:22 + 24])
    assert (width, height) == (256, 256)
