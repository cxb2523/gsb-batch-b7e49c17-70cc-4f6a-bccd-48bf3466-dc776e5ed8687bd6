"""
Installing a project from a tagged release of a GitHub or GitLab repository,
and rolling an installation forward or back to another tag.

One person maintains a project in a repository; others run it on their own
machine and only use the Crows Nest. Those machines need neither git nor a
working copy: an installation is the files of one tag, fetched as a zip
archive over HTTPS, plus the machine's own data and settings.

`datavloot new --from` writes the files of a tag and records them, with their
hashes, in `.datavloot/install.json`. `datavloot update` replaces exactly those
files with the files of another tag. Everything the record does not list is
the machine's own (`.env`, `data/`, `lake/`, `.venv`, logs, dbt output,
notebooks someone made) and is never touched.

A private repository needs a read-only token. It is kept in the system's
credential store (keyring), or, without one, in a file in the user's config
directory, never in the project: the project directory is what people zip and
pass around.

httpx and keyring come with the optimist extra and are imported where they are
used, so the parts that need neither (the record, `.env`, choosing a tag) can
be tested without them.
"""

from __future__ import annotations

import dataclasses
import datetime
import getpass
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
from typing import Callable, Iterable

STATE_DIR = ".datavloot"
STATE_FILE = "install.json"
STATE_VERSION = 1

# The service name entries are stored under in the system's credential store.
KEYRING_SERVICE = "datavloot"

# A token given this way is used before a stored one, so an installation can be
# scripted without a prompt. It is then stored like a typed one.
TOKEN_ENV_VAR = "DATAVLOOT_TOKEN"

# Never installed from an archive, so a repository that holds one by mistake
# cannot overwrite the settings or the record of an installation.
_NEVER_INSTALLED = {".env"}

# Directories that hold someone else's project files, not this one's: a
# dbt_project.yml in an installed dbt package is not a candidate.
_NOT_SEARCHED = {".git", ".venv", "venv", "node_modules", "dbt_packages", "target", "__pycache__"}

# Names of `.env` keys whose value is asked for without echoing it.
_SECRET_MARKERS = ("TOKEN", "PASSWORD", "SECRET", "KEY")

_TOKEN_HELP = (
    "GitLab needs a project access token or personal access token with the "
    "read_api scope (a deploy token does not work for the API this uses); "
    "GitHub a fine-grained personal access token with Contents: read on the repository."
)

_PER_PAGE = 100
_MAX_PAGES = 20


class RemoteError(Exception):
    """A failure to report to the user as it is: the message says what to do."""


# --- The repository ----------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Source:
    """A repository on GitHub or on a GitLab instance (gitlab.com or self-hosted)."""

    url: str  # as the user would type it, without .git and a trailing slash
    kind: str  # "github" or "gitlab"
    host: str
    repository: str  # owner/name, or group/subgroup/name on GitLab

    @property
    def key(self) -> str:
        """What the token is stored under: one per repository, never per tag."""
        return f"{self.host}/{self.repository}"

    @property
    def api(self) -> str:
        if self.kind == "github":
            return "https://api.github.com"
        return f"https://{self.host}/api/v4"

    def tags_url(self) -> str:
        if self.kind == "github":
            return f"{self.api}/repos/{self.repository}/tags"
        return f"{self.api}/projects/{_project_id(self.repository)}/repository/tags"

    def tags_params(self) -> dict[str, str | int]:
        if self.kind == "github":
            return {"per_page": _PER_PAGE}
        return {"per_page": _PER_PAGE, "order_by": "version"}

    def archive_url(self, ref: str) -> str:
        if self.kind == "github":
            return f"{self.api}/repos/{self.repository}/zipball/{urllib.parse.quote(ref, safe='')}"
        return f"{self.api}/projects/{_project_id(self.repository)}/repository/archive.zip"

    def archive_params(self, ref: str) -> dict[str, str]:
        return {} if self.kind == "github" else {"sha": ref}

    def headers(self, token: str | None) -> dict[str, str]:
        if not token:
            return {}
        if self.kind == "github":
            return {"Authorization": f"Bearer {token}"}
        return {"PRIVATE-TOKEN": token}


def _project_id(repository: str) -> str:
    # GitLab takes a project's path in place of its id, with every slash encoded.
    return urllib.parse.quote(repository, safe="")


def parse_source(url: str) -> Source:
    """
    The repository a URL points at.

    github.com is GitHub; every other host is taken to be GitLab, so a
    self-hosted GitLab works without configuration. A URL copied from a
    GitLab page (`.../-/tree/main`) or with `.git` is cut back to the project.
    """
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise RemoteError(
            f"'{url}' is not a repository URL. Use the address of the repository's "
            "page, for example https://gitlab.com/<group>/<project>."
        )
    host = parsed.netloc.lower()
    path = parsed.path.split("/-/", 1)[0].strip("/")
    if path.endswith(".git"):
        path = path[: -len(".git")]
    parts = [p for p in path.split("/") if p]
    kind = "github" if host in ("github.com", "www.github.com") else "gitlab"
    if kind == "github":
        host = "github.com"
        parts = parts[:2]
    if len(parts) < 2:
        raise RemoteError(
            f"'{url}' does not name a repository: expected https://{host}/<owner>/<name>."
        )
    repository = "/".join(parts)
    return Source(url=f"https://{host}/{repository}", kind=kind, host=host, repository=repository)


# --- Tags --------------------------------------------------------------------

_VERSION = re.compile(
    r"^[vV]?(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)(?:\.(?P<patch>0|[1-9]\d*))?"
    r"(?:-(?P<pre>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


def version_key(tag: str) -> tuple | None:
    """
    A sort key that orders tags as semantic versions, or None for a tag that is not one.

    A leading v is allowed and a missing patch counts as 0, since both are
    common in tags. A pre-release sorts below its release, as semver orders it.
    """
    m = _VERSION.match(tag)
    if not m:
        return None
    core = (int(m["major"]), int(m["minor"]), int(m["patch"] or 0))
    pre = m["pre"]
    if pre is None:
        # A release sorts above every pre-release of the same version.
        return (*core, 1, ())
    identifiers = tuple(
        (0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split(".")
    )
    return (*core, 0, identifiers)


def latest_tag(tags: Iterable[str]) -> str | None:
    """
    The highest tag by semantic version, ignoring tags that are not versions.

    A pre-release only when there is no release at all: an installation that
    asks for "the latest" should not land on a v2.0.0-rc.1 a maintainer tagged
    to try out. `--ref` still installs one on purpose.
    """
    versions = [(key, tag) for tag in tags if (key := version_key(tag)) is not None]
    releases = [(key, tag) for key, tag in versions if key[3] == 1]
    pool = releases or versions
    return max(pool)[1] if pool else None


# --- Talking to the host -----------------------------------------------------


def _client(transport=None):
    import httpx

    # trust_env (the default) lets HTTPS_PROXY and the system's CA settings apply.
    return httpx.Client(transport=transport, follow_redirects=True, timeout=60)


def _check(response, source: Source, token: str | None, what: str) -> None:
    """Turn an HTTP failure into a message that says what to do. Never includes the token."""
    status = response.status_code
    if status < 400:
        return
    if status in (401, 403):
        if token:
            raise AuthError(
                f"{source.host} refused the token for {source.repository} (HTTP {status}): "
                f"it is invalid, has expired, or has no access to this repository. "
                f"{_TOKEN_HELP}"
            )
        raise AuthError(
            f"{source.host} refused access to {source.repository} (HTTP {status}) without "
            f"a token. {_TOKEN_HELP}"
        )
    if status == 404:
        if what == "tags":
            access = (
                " or this token has no access to it" if token
                else ". If it is private, a token is needed"
            )
            raise NotFound(
                f"Repository {source.url} not found (HTTP 404). Check the URL{access}."
            )
        raise NotFound(f"{what} not found in {source.url} (HTTP 404).")
    raise RemoteError(f"{source.host} answered HTTP {status} when asked for {what}.")


class AuthError(RemoteError):
    pass


class NotFound(RemoteError):
    pass


def _offline(source: Source, error: Exception) -> RemoteError:
    return RemoteError(
        f"Cannot reach {source.host} ({type(error).__name__}). Check the internet "
        "connection; behind a proxy, set HTTPS_PROXY and run this again."
    )


def list_tags(client, source: Source, token: str | None) -> list[str]:
    """Every tag of the repository, following the hosts' pagination."""
    import httpx

    tags: list[str] = []
    url: str | None = source.tags_url()
    params: dict | None = source.tags_params()
    for _ in range(_MAX_PAGES):
        if url is None:
            break
        try:
            response = client.get(url, params=params, headers=source.headers(token))
        except httpx.TransportError as e:
            raise _offline(source, e) from None
        _check(response, source, token, "tags")
        tags += [t["name"] for t in response.json()]
        # Both hosts put the next page in a Link header, with its parameters.
        url = response.links.get("next", {}).get("url")
        params = None
    return tags


def download(client, source: Source, ref: str, token: str | None, dest: pathlib.Path) -> None:
    """Stream the archive of `ref` to `dest`."""
    import httpx

    try:
        with client.stream(
            "GET", source.archive_url(ref), params=source.archive_params(ref),
            headers=source.headers(token),
        ) as response:
            _check(response, source, token, f"Tag '{ref}'")
            with open(dest, "wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
    except httpx.TransportError as e:
        raise _offline(source, e) from None


# --- The token ---------------------------------------------------------------


def _keyring():
    """The keyring module when it has a usable backend, else None."""
    try:
        import keyring
        from keyring.backends import fail
    except Exception:
        return None
    try:
        if isinstance(keyring.get_keyring(), fail.Keyring):
            return None
    except Exception:
        return None
    return keyring


def config_dir() -> pathlib.Path:
    """Where Datavloot keeps per-user settings outside any project."""
    override = os.environ.get("DATAVLOOT_CONFIG_DIR")
    if override:
        return pathlib.Path(override)
    if os.name == "nt":
        return pathlib.Path(os.environ.get("APPDATA") or pathlib.Path.home()) / "datavloot"
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / "datavloot"
    base = os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config"
    return pathlib.Path(base) / "datavloot"


def _token_file() -> pathlib.Path:
    return config_dir() / "tokens.json"


def _read_token_file() -> dict[str, str]:
    try:
        return json.loads(_token_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_token(source: Source) -> str | None:
    ring = _keyring()
    if ring is not None:
        try:
            token = ring.get_password(KEYRING_SERVICE, source.key)
            if token:
                return token
        except Exception:
            pass
    return _read_token_file().get(source.key)


def store_token(source: Source, token: str) -> str:
    """Store the token for later updates. Return where it went, to tell the user."""
    ring = _keyring()
    if ring is not None:
        try:
            ring.set_password(KEYRING_SERVICE, source.key, token)
            return "the system's credential store"
        except Exception:
            pass
    path = _token_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tokens = _read_token_file()
    tokens[source.key] = token
    # Created with owner-only permissions, rather than tightened after writing,
    # so the token is never readable by others even for a moment. On Windows the
    # mode is ignored; the file sits in the profile, which only its owner can read.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)
    if os.name != "nt":
        os.chmod(path, 0o600)
    return f"{path} (no system credential store is available; only your account can read it)"


def _interactive() -> bool:
    """
    Whether someone can answer a prompt.

    On Windows isatty() is also true for NUL (`< nul`, a scheduled task), and
    getpass reads the console itself rather than stdin, so a prompt there
    would wait forever. Only a real console has a console mode.
    """
    if not sys.stdin or not sys.stdin.isatty():
        return False
    if os.name != "nt":
        return True
    try:
        import ctypes
        import msvcrt

        handle = msvcrt.get_osfhandle(sys.stdin.fileno())
        mode = ctypes.c_uint32()
        return bool(ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)))
    except Exception:
        return False


def _ask_token_interactively(reason: str) -> str | None:
    if not _interactive():
        return None
    print(f"\n{reason}\n{_TOKEN_HELP}", file=sys.stderr)
    try:
        token = getpass.getpass("Token (input is hidden, Enter to stop): ").strip()
    except (EOFError, KeyboardInterrupt):
        return None
    return token or None


# --- Fetching a tag ----------------------------------------------------------


@dataclasses.dataclass
class Fetched:
    """A tag downloaded and unpacked into a temporary directory."""

    ref: str
    root: pathlib.Path  # the unpacked repository
    tmp: pathlib.Path  # remove when done
    token: str | None
    token_is_new: bool

    def cleanup(self) -> None:
        _rmtree(self.tmp)


def fetch(
    source: Source,
    ref: str | None,
    *,
    transport=None,
    ask_token: Callable[[str], str | None] | None = _ask_token_interactively,
) -> Fetched:
    """
    Pick the tag, download its archive and unpack it, without touching any project.

    Tries the token from the environment, then the stored one, then none. When
    the host refuses, or a repository looks missing without a token (both hosts
    hide private repositories behind a 404), asks for a token once.
    """
    env_token = os.environ.get(TOKEN_ENV_VAR) or None
    token = env_token or load_token(source)
    token_is_new = env_token is not None and env_token != load_token(source)

    with _client(transport) as client:
        try:
            tags = list_tags(client, source, token)
        except (AuthError, NotFound) as e:
            new = ask_token(str(e)) if ask_token else None
            if not new:
                raise
            token, token_is_new = new, True
            tags = list_tags(client, source, token)

        if ref is None:
            ref = latest_tag(tags)
            if ref is None:
                shown = ", ".join(tags[:10]) or "none"
                raise RemoteError(
                    f"{source.url} has no tag that is a version (like v1.2.0), so there "
                    f"is no latest one. Tags found: {shown}. Name one with --ref."
                )
        elif ref not in tags:
            raise NotFound(
                f"Tag '{ref}' not found in {source.url}. "
                f"Available: {_describe_tags(tags)}."
            )

        tmp = pathlib.Path(tempfile.mkdtemp(prefix="dv-"))
        try:
            archive = tmp / "archive.zip"
            download(client, source, ref, token, archive)
            root = _extract(archive, tmp / "x")
            archive.unlink()
        except BaseException:
            _rmtree(tmp)
            raise
    return Fetched(ref=ref, root=root, tmp=tmp, token=token, token_is_new=token_is_new)


def _describe_tags(tags: list[str]) -> str:
    if not tags:
        return "no tags"
    ordered = sorted(tags, key=lambda t: (version_key(t) is not None, version_key(t) or ()), reverse=True)
    more = f" and {len(tags) - 10} more" if len(tags) > 10 else ""
    return ", ".join(ordered[:10]) + more


def _extract(archive: pathlib.Path, dest: pathlib.Path) -> pathlib.Path:
    """
    Unpack the archive into `dest` and return the repository's root in it.

    Both hosts wrap the repository in one top-level directory named after the
    commit, which is left out. A member whose name would land outside `dest`
    (an absolute path, a drive, `..`) stops the extraction: the archive is not
    one either host would make.
    """
    dest.mkdir(parents=True)
    base = os.path.realpath(dest)
    try:
        with zipfile.ZipFile(archive) as zf:
            for member in zf.infolist():
                name = member.filename.replace("\\", "/")
                target = os.path.realpath(os.path.join(base, name))
                if (
                    name.startswith("/")
                    or re.match(r"^[A-Za-z]:", name)
                    or os.path.commonpath([base, target]) != base
                ):
                    raise RemoteError(
                        f"The archive holds a file outside its own folder ({member.filename!r}); "
                        "nothing was installed."
                    )
                zf.extract(member, base)
    except zipfile.BadZipFile:
        raise RemoteError("The download is not a zip archive; nothing was installed.") from None
    entries = list(dest.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


# --- Finding the project in the repository -----------------------------------


def _is_project(path: pathlib.Path) -> bool:
    return (path / "dbt_project.yml").is_file() and (path / "pyproject.toml").is_file()


def find_projects(root: pathlib.Path) -> list[str]:
    """Every directory below `root` that holds a Datavloot project, as POSIX paths."""
    found = []
    for dirpath, dirnames, _ in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in _NOT_SEARCHED)
        path = pathlib.Path(dirpath)
        if _is_project(path):
            found.append(path.relative_to(root).as_posix())
    return found


def project_dir(root: pathlib.Path, subdir: str | None) -> tuple[pathlib.Path, str]:
    """
    The directory in the repository that holds the project, and its path.

    The root when it is a project itself; otherwise the one directory that is.
    `subdir` (--path) settles it when there is none or there are several.
    """
    if subdir:
        clean = subdir.replace("\\", "/").strip("/")
        path = (root / clean).resolve()
        if os.path.commonpath([str(root.resolve()), str(path)]) != str(root.resolve()):
            raise RemoteError(f"--path '{subdir}' points outside the repository.")
        if not path.is_dir():
            raise RemoteError(f"The repository has no folder '{clean}' (--path).")
        if not _is_project(path):
            raise RemoteError(
                f"'{clean}' in the repository is not a Datavloot project: it needs both "
                "dbt_project.yml and pyproject.toml."
            )
        return path, clean
    if _is_project(root):
        return root, ""
    found = find_projects(root)
    if len(found) == 1:
        return root / found[0], found[0]
    if not found:
        raise RemoteError(
            "The repository holds no Datavloot project: no folder has both "
            "dbt_project.yml and pyproject.toml. Name the folder with --path."
        )
    listed = "\n".join(f"  {p}" for p in found)
    raise RemoteError(
        f"The repository holds several projects. Choose one with --path:\n{listed}"
    )


# --- The record of an installation -------------------------------------------


def _sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def project_files(project: pathlib.Path) -> dict[str, str]:
    """The files of the project in a fetched tag, with their hashes, by POSIX path."""
    files = {}
    for path in sorted(project.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(project).as_posix()
        if rel in _NEVER_INSTALLED or rel.split("/", 1)[0] == STATE_DIR:
            continue
        files[rel] = _sha256(path)
    return files


def state_path(project: pathlib.Path) -> pathlib.Path:
    return project / STATE_DIR / STATE_FILE


def read_state(project: pathlib.Path) -> dict:
    path = state_path(project)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RemoteError(
            f"'{project}' is not an installation made with `datavloot new --from`: it "
            f"has no {STATE_DIR}/{STATE_FILE}. Run `datavloot update` in the project's "
            "folder, or install it with `datavloot new <folder> --from <repository>`."
        ) from None
    except ValueError as e:
        raise RemoteError(f"{path} cannot be read ({e}).") from None
    return state


def write_state(project: pathlib.Path, state: dict) -> None:
    path = state_path(project)
    path.parent.mkdir(exist_ok=True)
    # Written to a temporary file and moved into place, so an interrupted write
    # never leaves a record that lists half the files.
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _new_state(source: Source, subdir: str, auto: bool, ref: str, files: dict[str, str]) -> dict:
    return {
        "version": STATE_VERSION,
        "source": source.url,
        "kind": source.kind,
        "host": source.host,
        "repository": source.repository,
        "path": subdir,
        "path_detected": auto,
        "ref": ref,
        "installed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "files": files,
    }


@dataclasses.dataclass
class Changes:
    written: list[str]
    removed: list[str]
    changed_locally: list[str]  # listed files someone changed; overwritten anyway
    replaced_unlisted: list[str]  # files of the machine's own that a new tag also has


def apply_files(
    dest: pathlib.Path, source_dir: pathlib.Path,
    old: dict[str, str], new: dict[str, str],
) -> Changes:
    """
    Make the listed files in `dest` those of `source_dir`, leaving the rest alone.

    `old` lists what the previous tag installed; files in it that the new tag
    does not have are removed, with any directory that leaves empty. Anything
    in neither list is the machine's own and is not touched.
    """
    changed, removed, replaced = [], [], []
    for rel, digest in old.items():
        path = dest / rel
        if path.is_file() and _sha256(path) != digest:
            changed.append(rel)

    for rel in sorted(set(old) - set(new)):
        path = dest / rel
        if path.is_file() or path.is_symlink():
            _unlink(path)
            removed.append(rel)
            _remove_empty_parents(path.parent, dest)

    written = []
    for rel in new:
        target = dest / rel
        if rel not in old and target.is_file() and _sha256(target) != new[rel]:
            replaced.append(rel)
        if target.is_file() and _sha256(target) == new[rel]:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            _unlink(target)
        shutil.copy2(source_dir / rel, target)
        written.append(rel)
    return Changes(written, removed, changed, replaced)


def _unlink(path: pathlib.Path) -> None:
    try:
        path.unlink()
    except PermissionError:
        # A read-only file (git marks some so on Windows) cannot be deleted there
        # until the flag is cleared.
        os.chmod(path, stat.S_IWRITE)
        path.unlink()


def _remove_empty_parents(path: pathlib.Path, stop: pathlib.Path) -> None:
    while path != stop and path.is_dir() and not any(path.iterdir()):
        path.rmdir()
        path = path.parent


def _rmtree(path: pathlib.Path) -> None:
    def onerror(func, p, _):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onerror=onerror)


# --- .env ----------------------------------------------------------------------


@dataclasses.dataclass
class EnvVar:
    name: str
    default: str
    description: str

    @property
    def secret(self) -> bool:
        upper = self.name.upper()
        return any(marker in upper for marker in _SECRET_MARKERS)


_ASSIGNMENT = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    # An unquoted value ends at a comment.
    return re.split(r"\s+#", value, maxsplit=1)[0].strip()


def parse_env_example(text: str) -> list[EnvVar]:
    """
    The variables a `.env.example` declares, with the comment lines above each as its description.

    A blank line ends a description, so a heading comment set apart from the
    variables does not attach to the first of them.
    """
    variables, comments = [], []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            comments = []
        elif stripped.startswith("#"):
            comments.append(stripped.lstrip("#").strip())
        elif m := _ASSIGNMENT.match(line):
            variables.append(EnvVar(m[1], _unquote(m[2]), " ".join(c for c in comments if c)))
            comments = []
    return variables


def env_keys(text: str) -> set[str]:
    return {m[1] for line in text.splitlines() if (m := _ASSIGNMENT.match(line))}


def _quote(value: str) -> str:
    """
    A value as python-dotenv reads it back unchanged.

    Unquoted where possible: python-dotenv keeps the backslashes of an unquoted
    value as they are, so a Windows path needs no escaping, where inside double
    quotes C:\\new would get a newline. Single quotes when the value has a #,
    surrounding spaces or a leading quote, with the two escapes python-dotenv
    undoes there.
    """
    if value == value.strip() and "#" not in value and not value.startswith(("'", '"')):
        return value
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def fill_env(
    project: pathlib.Path,
    ask: Callable[[str], str] = input,
    ask_secret: Callable[[str], str] = getpass.getpass,
) -> list[str]:
    """
    Ask for every variable `.env.example` declares and `.env` lacks, and add them to `.env`.

    Values already in `.env` are never asked again, so an update asks only for
    what a new version added. Return the names that were added.
    """
    example = project / ".env.example"
    if not example.is_file():
        return []
    env = project / ".env"
    existing = env.read_text(encoding="utf-8") if env.is_file() else ""
    have = env_keys(existing)
    missing = [v for v in parse_env_example(example.read_text(encoding="utf-8")) if v.name not in have]
    if not missing:
        return []

    print(f"\nThis project needs {len(missing)} setting(s) for .env. "
          "Press Enter to take the value in brackets.")
    lines = []
    for var in missing:
        print()
        if var.description:
            print(f"  {var.description}")
        try:
            if var.secret:
                if ask_secret is getpass.getpass and not _interactive():
                    raise EOFError  # see _interactive: it would wait forever
                value = ask_secret(f"{var.name} (input is hidden): ")
            else:
                shown = f" [{var.default}]" if var.default else ""
                value = ask(f"{var.name}{shown}: ").strip() or var.default
        except EOFError:
            raise RemoteError(
                f"No answer for {var.name}: there is no terminal to ask in. Add the "
                f"missing settings to {env} by hand (see .env.example) and run this again."
            ) from None
        if var.description:
            lines.append(f"# {var.description}")
        lines.append(f"{var.name}={_quote(value)}")

    block = "\n".join(lines) + "\n"
    if existing and not existing.endswith("\n"):
        existing += "\n"
    env.write_text(existing + ("\n" if existing else "") + block, encoding="utf-8")
    return [v.name for v in missing]


# --- After the files: the environment and dbt ------------------------------------


def _python_args(project: pathlib.Path) -> list[str]:
    # install.ps1 and install.sh use 3.12, the version every dependency has wheels
    # for; a project that names its own in .python-version gets that one.
    if (project / ".python-version").is_file():
        return []
    return ["--python", "3.12"]


def prepare(project: pathlib.Path, runner: Callable[..., int] | None = None) -> None:
    """
    Give the project its environment and dbt packages, and compile it: the steps
    install.ps1 and install.sh take after creating the demo.

    `uv sync --locked` when the project has a uv.lock: an installation should get
    the versions its maintainer tested, and a lock that does not match
    pyproject.toml is a mistake to fix in the repository, not on each machine.
    """
    uv = shutil.which("uv")
    if uv is None:
        raise RemoteError(
            "uv is not installed, and the project needs it for its own Python and "
            "packages. Install it (https://docs.astral.sh/uv/getting-started/installation/), "
            f"then run in {project}:\n  uv sync\n  uv run dbt deps\n  uv run dbt parse"
        )
    sync = [uv, "sync", *_python_args(project)]
    if (project / "uv.lock").is_file():
        sync.append("--locked")
    steps = [
        ("Installing Python and the project's packages", sync),
        ("Installing the dbt packages", [uv, "run", "--no-sync", "dbt", "deps"]),
        ("Compiling the dbt project", [uv, "run", "--no-sync", "dbt", "parse"]),
    ]
    # A virtual environment this command happens to run in is not the project's;
    # uv would warn about it on every step.
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    run = runner or (lambda cmd: subprocess.run(cmd, cwd=project, env=env).returncode)
    for what, cmd in steps:
        print(f"\n==> {what}", flush=True)
        code = run(cmd)
        if code != 0:
            # On Windows a running Dagster or Crows Nest holds files in .venv
            # open, and uv cannot replace them.
            running = (
                " If Dagster or the Crows Nest runs from this folder, close it first."
                if cmd is sync else ""
            )
            raise RemoteError(
                f"{what} failed (exit code {code}); the output above says why.{running} "
                f"The files are in place: fix the cause, then run `{' '.join(['uv', *cmd[1:]])}` "
                f"and the steps after it in {project}."
            )


# --- The commands --------------------------------------------------------------


def _is_empty_dir(path: pathlib.Path) -> bool:
    return path.is_dir() and not any(path.iterdir())


def install(
    dest: pathlib.Path,
    url: str,
    ref: str | None = None,
    subdir: str | None = None,
    *,
    transport=None,
    ask_token=_ask_token_interactively,
    ask=input,
    ask_secret=getpass.getpass,
    runner=None,
) -> dict:
    """`datavloot new <dest> --from <url>`. Return the record it wrote."""
    if dest.exists() and not _is_empty_dir(dest):
        raise RemoteError(
            f"'{dest}' already exists and is not empty; nothing in it was changed. "
            "Choose a new folder, or run `datavloot update` in an existing installation."
        )
    source = parse_source(url)
    print(f"Fetching {source.url}…", flush=True)
    fetched = fetch(source, ref, transport=transport, ask_token=ask_token)
    try:
        project, found = project_dir(fetched.root, subdir)
        files = project_files(project)
        created = not dest.exists()
        dest.mkdir(parents=True, exist_ok=True)
        try:
            apply_files(dest, project, {}, files)
        except BaseException:
            # Nothing of the user's is in a folder this command created or found empty.
            if created:
                _rmtree(dest)
            else:
                for child in dest.iterdir():
                    if child.is_dir():
                        _rmtree(child)
                    else:
                        _unlink(child)
            raise
        state = _new_state(source, found, subdir is None, fetched.ref, files)
        write_state(dest, state)
    finally:
        fetched.cleanup()

    where = f" (folder {found})" if found else ""
    print(f"Installed {source.url} at {fetched.ref}{where} in '{dest}'.")
    if fetched.token and fetched.token_is_new:
        print(f"The token is stored in {store_token(source, fetched.token)}, for `datavloot update`.")

    fill_env(dest, ask, ask_secret)
    prepare(dest, runner)
    return state


def update(
    project: pathlib.Path,
    ref: str | None = None,
    *,
    transport=None,
    ask_token=_ask_token_interactively,
    ask=input,
    ask_secret=getpass.getpass,
    runner=None,
) -> tuple[str, str] | None:
    """
    `datavloot update`: put the files of another tag in place of the installed ones.

    The new tag is downloaded and unpacked first; when that fails, nothing in
    the project has changed. Return (from, to), or None when it is already there.
    """
    state = read_state(project)
    source = parse_source(state["source"])
    current = state["ref"]
    print(f"Installed: {source.url} at {current}. Looking for {ref or 'the latest tag'}…", flush=True)
    fetched = fetch(source, ref, transport=transport, ask_token=ask_token)
    try:
        if fetched.ref == current:
            print(f"Already at {current}; nothing to update.")
            return None
        subdir = None if state.get("path_detected") else state.get("path") or None
        new_project, found = project_dir(fetched.root, subdir)
        files = project_files(new_project)
        changes = apply_files(project, new_project, state.get("files", {}), files)
        write_state(project, _new_state(source, found, subdir is None, fetched.ref, files))
    finally:
        fetched.cleanup()

    for rel in changes.changed_locally:
        print(f"Warning: {rel} was changed on this machine; replaced by the version from "
              f"{fetched.ref}.", file=sys.stderr)
    for rel in changes.replaced_unlisted:
        print(f"Warning: {rel} was not part of {current} but is in {fetched.ref}; the local "
              "file was replaced.", file=sys.stderr)
    print(f"Updated from {current} to {fetched.ref}: {len(changes.written)} file(s) written, "
          f"{len(changes.removed)} removed.")
    if fetched.token and fetched.token_is_new:
        print(f"The token is stored in {store_token(source, fetched.token)}.")

    fill_env(project, ask, ask_secret)
    prepare(project, runner)
    return current, fetched.ref


# --- Starting the run after an update ---------------------------------------------

_RELOAD_MUTATION = """
mutation {
  reloadWorkspace {
    __typename
    ... on PythonError { message }
  }
}
"""


def code_location_name(project: pathlib.Path) -> str | None:
    """`code_location_name` from [tool.dagster] in pyproject.toml, read without tomllib (3.10)."""
    try:
        text = (project / "pyproject.toml").read_text(encoding="utf-8")
    except OSError:
        return None
    section = re.search(r"^\[tool\.dagster\]\s*$(.*?)(?=^\[|\Z)", text, re.M | re.S)
    if not section:
        return None
    m = re.search(r'^\s*code_location_name\s*=\s*["\']([^"\']+)["\']', section[1], re.M)
    return m[1] if m else None


def run_after_update(project: pathlib.Path, graphql_url: str, start_run: bool) -> str:
    """
    Rebuild the tables with the new models, through a Dagster that is already running.

    Starting or restarting Dagster and the Crows Nest is not this command's job.
    When this project's Dagster runs, its code is reloaded so the run uses the
    new models; otherwise the message says how to start it. Never raises.
    """
    import httpx

    from datavloot_platform import cli

    start = "uv run datavloot start --run" if start_run else "uv run datavloot start"
    not_running = (
        f"Dagster is not running. Start Dagster and the Crows Nest in {project} with:\n"
        f"  {start}"
        + ("\nThe --run starts a run of every asset, so the tables match the new models."
           if start_run else "")
    )
    try:
        resp = httpx.post(graphql_url, json={"query": cli._READINESS_QUERY}, timeout=5)
        workspace = resp.json()["data"]["workspaceOrError"]
    except Exception:
        return not_running

    restart = (
        "Dagster and the Crows Nest are running with the previous version. Restart them "
        f"(close them, then `uv run datavloot start` in {project}) to load the new one."
    )
    names = {e.get("name") for e in workspace.get("locationEntries", [])}
    expected = code_location_name(project)
    if expected is None or expected not in names:
        return (
            f"The Dagster at {graphql_url} runs another project ({', '.join(sorted(n for n in names if n)) or 'unknown'}), "
            f"so no run was started. Start this one in {project} with:\n  {start}"
        )
    if not start_run:
        return restart
    try:
        resp = httpx.post(graphql_url, json={"query": _RELOAD_MUTATION}, timeout=300)
        result = resp.json()["data"]["reloadWorkspace"]
        if result.get("__typename") == "PythonError":
            return f"Dagster could not reload the new version: {result.get('message')}\n{restart}"
    except Exception as e:  # noqa: BLE001 -- see the docstring
        return f"Dagster could not reload the new version: {e}\n{restart}"
    return f"{cli._materialize_all(graphql_url)}\n{restart}"
