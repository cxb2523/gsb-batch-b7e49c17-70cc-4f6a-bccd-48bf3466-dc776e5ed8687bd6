"""
Warnings about where a project lives: sync folders, network drives, and paths
too long for Windows.

The detection runs against injected environments, mount tables and long-path
settings rather than the machine's own, so every case is checked on every
platform -- the OneDrive and MAX_PATH cases matter most on Windows, but CI
must not depend on a Windows runner to prove them.
"""

import argparse
import os
import pathlib

import pytest

from datavloot_platform import cli, location

ONEDRIVE_VARS = ("OneDrive", "OneDriveCommercial", "OneDriveConsumer")


@pytest.fixture
def no_sync_env(monkeypatch):
    """A machine with no OneDrive variables, whatever the test host has set."""
    for var in ONEDRIVE_VARS:
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def long_paths(monkeypatch):
    """Set whether long paths are enabled, as Windows would report it."""
    def set_enabled(enabled: bool):
        monkeypatch.setattr(location, "long_paths_enabled", lambda: enabled)
    set_enabled(True)
    return set_enabled


# --- sync folders -------------------------------------------------------------

def test_onedrive_is_found_through_its_environment_variable(tmp_path):
    """Known Folder Move puts Documents inside OneDrive under any folder name."""
    root = tmp_path / "Company Files"
    env = {"OneDriveCommercial": str(root)}
    assert location.sync_folder(root / "Documents" / "sales", env) == "Company Files"


@pytest.mark.parametrize(
    "folder",
    [
        "OneDrive",
        "OneDrive - Contoso",
        "Dropbox",
        "Dropbox (Contoso)",
        "My Drive",
        "Mobile Documents",
        # macOS File Provider mounts every client under ~/Library/CloudStorage.
        "Library/CloudStorage/OneDrive-Contoso",
        "Library/CloudStorage/SomeNewClient",
    ],
)
def test_sync_folders_are_found_by_name(tmp_path, folder):
    assert location.sync_folder(tmp_path / folder / "sales", env={}) is not None


def test_an_ordinary_folder_is_not_a_sync_folder(tmp_path):
    assert location.sync_folder(tmp_path / "dev" / "sales", env={}) is None


@pytest.mark.parametrize("folder", ["dropbox-export-analysis", "onedrive-migration", "Box"])
def test_a_folder_that_only_mentions_a_service_is_not_one(tmp_path, folder):
    """Match whole folder names, so a project about Dropbox is not flagged."""
    assert location.sync_folder(tmp_path / folder / "sales", env={}) is None


# --- network drives -----------------------------------------------------------

MOUNTS = """\
/dev/sda1 / ext4 rw,relatime 0 0
server:/export /mnt/team nfs4 rw,relatime 0 0
/dev/sdb1 /mnt/team/local ext4 rw,relatime 0 0
//nas/share /mnt/my\\040share cifs rw 0 0
"""


@pytest.mark.parametrize(
    "path, fstype",
    [
        ("/home/me/sales", "ext4"),
        ("/mnt/team/sales", "nfs4"),
        ("/mnt/team/local/sales", "ext4"),  # the most specific mount wins
        ("/mnt/my share/sales", "cifs"),    # \040 is an escaped space
    ],
)
def test_the_mount_containing_a_path_is_found(path, fstype):
    assert location.mount_fstype(pathlib.Path(path), MOUNTS) == fstype


def test_a_unc_path_is_a_network_share():
    assert location.network_location(pathlib.Path("\\\\server\\share\\sales")) == "a network share"


# --- Windows path length ------------------------------------------------------

def test_room_needed_covers_the_venv_and_dbt_output():
    """Both measured depths count; a long project name pushes dbt's output deeper."""
    short = location.room_needed_below_project("a")
    long_name = location.room_needed_below_project("x" * 40)
    assert short >= len(".venv") + 1 + location._ENV_DEPTH
    assert long_name > short


def test_a_short_path_fits_and_a_deep_one_does_not():
    needed = location.room_needed_below_project("sales")
    assert location.fits_windows_max_path(pathlib.Path("C:/dev/sales"), needed)
    assert not location.fits_windows_max_path(pathlib.Path("C:/" + "d" * 120 + "/sales"), needed)


def test_a_deep_path_warns_when_long_paths_are_off(tmp_path, long_paths):
    long_paths(False)
    deep = tmp_path / ("d" * 150) / "sales"
    warnings = location.project_warnings(deep, "sales", env={})
    assert len(warnings) == 1
    assert "characters" in warnings[0] and "enable long paths" in warnings[0]


def test_a_deep_path_is_fine_when_long_paths_are_on(tmp_path, long_paths):
    deep = tmp_path / ("d" * 150) / "sales"
    assert location.project_warnings(deep, "sales", env={}) == []


def test_a_deep_environment_warns_when_long_paths_are_off(long_paths):
    long_paths(False)
    assert location.environment_warnings("C:/" + "e" * 120) != []
    assert location.environment_warnings("C:/Python312") == []


@pytest.mark.skipif(os.name != "nt", reason="reads the Windows registry")
def test_the_long_paths_setting_can_be_read():
    assert isinstance(location.long_paths_enabled(), bool)


# --- the CLI ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def no_extension_download(monkeypatch):
    """`new` also installs DuckDB extensions; keep that off the network here."""
    monkeypatch.setattr(cli, "_preinstall_extensions", lambda dest: None)


def test_new_in_onedrive_warns_and_still_creates_the_project(
    tmp_path, monkeypatch, capsys, long_paths
):
    root = tmp_path / "OneDrive - Contoso"
    monkeypatch.setenv("OneDrive", str(root))
    dest = root / "Documents" / "sales"

    cli.cmd_new(argparse.Namespace(path=str(dest)))

    err = capsys.readouterr().err
    assert "Warning:" in err and "OneDrive" in err
    assert "dev" in err, "the warning should suggest a local location"
    assert (dest / "dbt_project.yml").is_file(), "a warning must never stop the scaffold"


def test_new_in_an_ordinary_folder_prints_no_warning(tmp_path, capsys, no_sync_env, long_paths):
    cli.cmd_new(argparse.Namespace(path=str(tmp_path / "dev" / "sales")))
    assert "Warning:" not in capsys.readouterr().err
