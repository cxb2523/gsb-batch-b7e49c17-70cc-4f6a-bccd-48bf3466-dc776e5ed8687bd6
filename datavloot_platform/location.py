"""
Checks on where a project lives.

Some locations let a project install and run, then break it later in ways that
do not point back at the location:

  - Sync folders (OneDrive, Dropbox, Google Drive, iCloud) and network drives do
    not reliably honour the OS file locks DuckDB and SQLite depend on. Two
    processes can then both believe they hold the database, or a sync client
    swaps the file underneath a writer. On Windows, Documents and Desktop are
    often redirected into OneDrive without the user knowing.
  - Windows refuses paths over 260 characters unless long paths are enabled.
    pip and uv still write the files, so the install succeeds; the failure comes
    later as a ModuleNotFoundError or a dbt write error that says nothing about
    path length.

Everything here only reads, and the CLI only warns: a wrong guess must never
stop someone from creating a project. Stdlib only, so the fast test tier can
import it without the optimist extra.
"""

import os
import pathlib
import sys

# Windows sets these to the OneDrive root(s), including folders redirected by
# Known Folder Move, whatever the folder happens to be called.
_ONEDRIVE_ENV_VARS = ("OneDrive", "OneDriveCommercial", "OneDriveConsumer")

# Root folder names of sync clients that set no variable, matched whole and
# case-insensitively, so a project called "dropbox-export" is not mistaken for
# a sync folder. Plus the account-suffixed forms ("OneDrive - Contoso",
# "Dropbox (Contoso)").
_SYNC_FOLDER_NAMES = frozenset({
    "onedrive", "dropbox", "google drive", "my drive",
    "icloud drive", "mobile documents", "com~apple~clouddocs",
})
_SYNC_FOLDER_PREFIXES = ("onedrive - ", "dropbox (")

# Linux file system types that live on another machine.
_NETWORK_FS_TYPES = frozenset({
    "nfs", "nfs4", "cifs", "smb3", "smbfs", "fuse.sshfs", "fuse.rclone", "9p", "afs",
})

_WINDOWS_MAX_PATH = 260  # including the terminating NUL, so 259 usable characters
_LONG_PATHS_URL = (
    "https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation"
)

# Measured, relative to the directory named: the deepest file in an environment
# with datavloot[optimist] installed (a dagster-webserver source map), and the
# deepest file dagster-dbt writes in a built project (an Elementary model under
# target/<project>_dbt_assets-<hash>/compiled/, which repeats the project name).
_ENV_DEPTH = 136
_PROJECT_TARGET_DEPTH = 134
# Headroom for dependencies that nest a little deeper in a later release.
_MARGIN = 10


def sync_folder(path: pathlib.Path, env=None) -> str | None:
    """The sync client's folder that contains `path`, as it is named on disk, or None."""
    env = os.environ if env is None else env

    for var in _ONEDRIVE_ENV_VARS:
        root = env.get(var)
        if root and _is_within(path, pathlib.Path(root)):
            return pathlib.Path(root).name

    parts = pathlib.Path(path).parts
    for i, part in enumerate(parts):
        name = part.lower()
        # macOS File Provider mounts every client under ~/Library/CloudStorage,
        # whatever the client: anything below it is synced.
        if name == "cloudstorage" and i > 0 and parts[i - 1].lower() == "library":
            return parts[i + 1] if i + 1 < len(parts) else part
        if name in _SYNC_FOLDER_NAMES or name.startswith(_SYNC_FOLDER_PREFIXES):
            return part
    return None


def network_location(path: pathlib.Path) -> str | None:
    """A description of the network location `path` is on, or None."""
    text = str(path)
    if text.startswith("\\\\") or (os.name == "nt" and text.startswith("//")):
        return "a network share"

    if os.name == "nt":
        drive = os.path.splitdrive(os.path.abspath(text))[0]
        if drive and _windows_drive_is_remote(drive + "\\"):
            return f"network drive {drive}"
    elif sys.platform.startswith("linux"):
        try:
            mounts = pathlib.Path("/proc/mounts").read_text(encoding="utf-8")
        except OSError:
            return None
        fstype = mount_fstype(path, mounts)
        if fstype in _NETWORK_FS_TYPES:
            return f"a network file system ({fstype})"
    # macOS: not detected. Network shares there mount under /Volumes alongside
    # local disks, and telling them apart needs statfs, which Python lacks.
    return None


def mount_fstype(path: pathlib.Path, mounts: str) -> str | None:
    """The file system type of the mount containing `path`, from /proc/mounts text."""
    target = os.path.abspath(str(path))
    best, best_type = "", None
    for line in mounts.splitlines():
        fields = line.split()
        if len(fields) < 3:
            continue
        # /proc/mounts escapes spaces in mount points as \040.
        mount_point = fields[1].replace("\\040", " ")
        if _is_within(pathlib.Path(target), pathlib.Path(mount_point)) and len(mount_point) > len(best):
            best, best_type = mount_point, fields[2]
    return best_type


def long_paths_enabled() -> bool:
    """Whether Windows accepts paths over 260 characters. Always True elsewhere."""
    if os.name != "nt":
        return True
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem"
        ) as key:
            return winreg.QueryValueEx(key, "LongPathsEnabled")[0] == 1
    except OSError:
        return False


def room_needed_below_project(project_name: str) -> int:
    """Characters a project needs below its own directory, including a .venv in it."""
    return max(
        len(".venv") + 1 + _ENV_DEPTH,
        _PROJECT_TARGET_DEPTH + len(project_name),
    ) + _MARGIN


def fits_windows_max_path(path: pathlib.Path, needed_below: int) -> bool:
    """Whether `path` leaves room for `needed_below` more characters under MAX_PATH."""
    return len(str(path)) + 1 + needed_below < _WINDOWS_MAX_PATH


def project_warnings(path: pathlib.Path, project_name: str, env=None) -> list[str]:
    """Warnings about creating or running a project at `path`."""
    warnings = []
    suggestion = _suggested_location(project_name)

    folder = sync_folder(path, env)
    if folder:
        warnings.append(
            f"'{path}' is inside a synced folder ({folder}). Sync clients do not "
            "honour the file locks DuckDB relies on, which can lock you out of the database or "
            "corrupt it. Keep the project in a local folder that is not synced, "
            f"for example {suggestion}."
        )

    network = network_location(path)
    if network:
        warnings.append(
            f"'{path}' is on {network}. Network file systems do not reliably honour "
            "the file locks DuckDB relies on. Keep the project on a local disk, "
            f"for example {suggestion}."
        )

    if not long_paths_enabled():
        needed = room_needed_below_project(project_name)
        if not fits_windows_max_path(path, needed):
            warnings.append(
                f"'{path}' is {len(str(path))} characters long. Windows limits paths "
                f"to {_WINDOWS_MAX_PATH} characters unless long paths are enabled, and "
                f"a project needs about {needed} characters below its folder for its "
                "virtual environment and dbt output. Files past the limit still "
                "install, then fail to import or write. Use a shorter path, for "
                f"example {suggestion}, or enable long paths: {_LONG_PATHS_URL}"
            )
    return warnings


def environment_warnings(prefix: str | None = None) -> list[str]:
    """Warnings about the Python environment this process runs in."""
    prefix = sys.prefix if prefix is None else prefix
    needed = _ENV_DEPTH + _MARGIN
    if long_paths_enabled() or fits_windows_max_path(pathlib.Path(prefix), needed):
        return []
    return [
        f"This Python environment is at '{prefix}' ({len(prefix)} characters). "
        f"Windows limits paths to {_WINDOWS_MAX_PATH} characters unless long paths "
        f"are enabled, and some installed packages sit {_ENV_DEPTH} characters deep "
        "in it, so they cannot be imported. Recreate the environment in a shorter "
        f"path, or enable long paths: {_LONG_PATHS_URL}"
    ]


def _is_within(path: pathlib.Path, root: pathlib.Path) -> bool:
    # realpath, not abspath: it also expands Windows 8.3 short names (STANVE~1),
    # so the same folder compares equal however each side was spelled.
    a = os.path.normcase(os.path.realpath(str(path)))
    b = os.path.normcase(os.path.realpath(str(root)))
    try:
        return os.path.commonpath([a, b]) == b
    except ValueError:  # different drives on Windows
        return False


def _windows_drive_is_remote(root: str) -> bool:
    import ctypes

    drive_remote = 4  # DRIVE_REMOTE from GetDriveTypeW
    return ctypes.windll.kernel32.GetDriveTypeW(root) == drive_remote


def _suggested_location(project_name: str) -> str:
    if os.name == "nt":
        return f"{os.environ.get('SystemDrive', 'C:')}\\dev\\{project_name}"
    return f"~/dev/{project_name}"
