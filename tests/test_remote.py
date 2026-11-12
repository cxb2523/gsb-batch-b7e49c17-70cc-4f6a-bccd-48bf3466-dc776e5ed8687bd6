"""
`datavloot new --from` and `datavloot update` (datavloot_platform/remote.py).

No network: both hosts are played by an httpx.MockTransport that serves tags
and zip archives built here, the way GitHub and GitLab build them (one
top-level folder named after the commit). The system's credential store is
replaced by a dict, so no test reads or writes a real one.

The tests that talk to a host need httpx, which the `lint` CI job does not
install; they skip there and run in the `crowsnest` job.
"""

import io
import json
import os
import pathlib
import zipfile

import pytest

from datavloot_platform import cli, remote

TOKEN = "glpat-test-0123456789abcdef"  # not a real token; searched for in files below

PROJECT_V1 = {
    "dbt_project.yml": "name: kc\n",
    "pyproject.toml": "[project]\nname = 'kc'\n\n[tool.dagster]\ncode_location_name = \"kc\"\n",
    "models/a.sql": "select 1\n",
    "models/old.sql": "select 'old'\n",
    "kc_platform/definitions.py": "defs = 1\n",
    "data/.gitkeep": "",
    ".env.example": "# Folder with the exports\nEXPORT_DIR=data\n\n# Password for the source\nSOURCE_PASSWORD=\n",
}
PROJECT_V2 = {
    **{k: v for k, v in PROJECT_V1.items() if k != "models/old.sql"},
    "models/a.sql": "select 2\n",
    "models/new.sql": "select 'new'\n",
    ".env.example": PROJECT_V1[".env.example"] + "\n# The region to load\nREGION=north\n",
}
# What the KetenConnect repository looks like: the project in a subfolder, the
# hand-made installers beside it.
REPO_EXTRAS = {"installeer.ps1": "# old installer\n", "README.md": "readme\n"}


def _repo(project: dict[str, str], subdir: str = "ketenconnect") -> dict[str, str]:
    files = {f"{subdir}/{k}" if subdir else k: v for k, v in project.items()}
    return {**files, **REPO_EXTRAS}


def make_zip(files: dict[str, str], top: str = "ketenconnect-demo-v1-0a1b2c") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{top}/", "")
        for name, content in files.items():
            zf.writestr(f"{top}/{name}" if top else name, content)
    return buf.getvalue()


# --- Fixtures ------------------------------------------------------------------


class FakeRing:
    """Stands in for keyring, so no test touches the real credential store."""

    def __init__(self):
        self.stored: dict[tuple[str, str], str] = {}

    def get_password(self, service, key):
        return self.stored.get((service, key))

    def set_password(self, service, key, value):
        self.stored[(service, key)] = value


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    ring = FakeRing()
    monkeypatch.setattr(remote, "_keyring", lambda: ring)
    monkeypatch.setenv("DATAVLOOT_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.delenv(remote.TOKEN_ENV_VAR, raising=False)
    # uv is never run: `prepare` gets a runner that records the commands.
    monkeypatch.setattr(remote.shutil, "which", lambda name, *a, **k: f"/fake/{name}")
    return ring


class Host:
    """A GitHub or GitLab that serves `tags` ({tag: {path: content}}) as zip archives."""

    def __init__(self, kind, tags, token=None, host=None, repository="datavloot/ketenconnect-demo"):
        self.kind = kind
        self.tags = tags
        self.token = token  # None: a public repository
        self.host = host or ("github.com" if kind == "github" else "gitlab.com")
        self.repository = repository
        self.requests = []
        self.fail_archive = None  # an exception or a status code for the archive

    @property
    def url(self):
        return f"https://{self.host}/{self.repository}"

    def _authorized(self, request):
        if self.token is None:
            return True
        if self.kind == "github":
            return request.headers.get("Authorization") == f"Bearer {self.token}"
        return request.headers.get("PRIVATE-TOKEN") == self.token

    def handler(self, request):
        import httpx

        self.requests.append(request)
        path = request.url.raw_path.decode().split("?")[0]
        if self.kind == "github":
            base = f"/repos/{self.repository}"
            assert request.url.host == "api.github.com"
        else:
            base = f"/api/v4/projects/{self.repository.replace('/', '%2F')}"
            assert request.url.host == self.host
        if not path.startswith(base + "/"):
            return httpx.Response(404, json={"message": "Not Found"})
        if not self._authorized(request):
            # Both hosts answer a private repository without a token with 404,
            # and a wrong token with 401.
            has_token = "Authorization" in request.headers or "PRIVATE-TOKEN" in request.headers
            return httpx.Response(401 if has_token else 404, json={"message": "nope"})
        rest = path[len(base):]
        if rest in ("/tags", "/repository/tags"):
            return httpx.Response(200, json=[{"name": t} for t in self.tags])
        if self.kind == "github" and rest.startswith("/zipball/"):
            ref = rest[len("/zipball/"):]
        elif self.kind == "gitlab" and rest == "/repository/archive.zip":
            ref = request.url.params["sha"]
        else:
            return httpx.Response(404)
        if ref not in self.tags:
            return httpx.Response(404)
        if isinstance(self.fail_archive, Exception):
            raise self.fail_archive
        if self.fail_archive:
            return httpx.Response(self.fail_archive)
        return httpx.Response(200, content=make_zip(self.tags[ref], top=f"repo-{ref}-abc"))

    @property
    def transport(self):
        import httpx

        return httpx.MockTransport(self.handler)


@pytest.fixture
def httpx_available():
    pytest.importorskip("httpx")


def _answers(**values):
    """An `input` that answers each prompt by the variable name it starts with."""
    def ask(prompt):
        name = prompt.split(" ")[0].rstrip(":")
        return values[name]
    return ask


def _install(host, dest, ref=None, subdir=None, ask_token=None, **values):
    commands = []
    values = {"EXPORT_DIR": "", "SOURCE_PASSWORD": "pw", "REGION": "", **values}
    remote.install(
        dest, host.url, ref, subdir, transport=host.transport, ask_token=ask_token,
        ask=_answers(**values), ask_secret=_answers(**values),
        runner=lambda cmd: commands.append(cmd) or 0,
    )
    return commands


def _update(host, project, ref=None, **values):
    values = {"EXPORT_DIR": "", "SOURCE_PASSWORD": "pw", "REGION": "", **values}
    return remote.update(
        project, ref, transport=host.transport, ask_token=None,
        ask=_answers(**values), ask_secret=_answers(**values), runner=lambda cmd: 0,
    )


def _snapshot(root: pathlib.Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*")) if p.is_file()
    }


# --- The repository URL ---------------------------------------------------------------


@pytest.mark.parametrize("url, kind, host, repository", [
    ("https://github.com/datavloot/datavloot-toolkit", "github", "github.com", "datavloot/datavloot-toolkit"),
    ("https://github.com/datavloot/datavloot-toolkit.git", "github", "github.com", "datavloot/datavloot-toolkit"),
    ("https://github.com/datavloot/datavloot-toolkit/tree/main/x", "github", "github.com", "datavloot/datavloot-toolkit"),
    ("https://gitlab.com/datavloot/ketenconnect-demo/", "gitlab", "gitlab.com", "datavloot/ketenconnect-demo"),
    ("https://gitlab.com/group/sub/project/-/tree/main", "gitlab", "gitlab.com", "group/sub/project"),
    ("https://git.example.org/team/harbor.git", "gitlab", "git.example.org", "team/harbor"),
])
def test_parse_source(url, kind, host, repository):
    source = remote.parse_source(url)
    assert (source.kind, source.host, source.repository) == (kind, host, repository)


@pytest.mark.parametrize("url", ["gitlab.com/x/y", "https://gitlab.com/onlygroup", "C:\\dev\\harbor"])
def test_parse_source_rejects_what_is_not_a_repository(url):
    with pytest.raises(remote.RemoteError):
        remote.parse_source(url)


def test_gitlab_api_urls_encode_the_project_path():
    source = remote.parse_source("https://git.example.org/group/sub/harbor")
    assert source.tags_url() == "https://git.example.org/api/v4/projects/group%2Fsub%2Fharbor/repository/tags"
    assert source.archive_url("v1").endswith("/projects/group%2Fsub%2Fharbor/repository/archive.zip")
    assert source.archive_params("v1") == {"sha": "v1"}


# --- Choosing a tag ------------------------------------------------------------------------


def test_latest_tag_orders_by_semantic_version():
    assert remote.latest_tag(["v1.9.0", "v1.10.0", "v1.2.3"]) == "v1.10.0"
    assert remote.latest_tag(["1.0", "v1.0.1", "0.9.9"]) == "v1.0.1"


def test_latest_tag_ignores_tags_that_are_not_versions():
    assert remote.latest_tag(["nightly", "datavloot-v9.0.0", "v2.0.0", "release-3"]) == "v2.0.0"
    assert remote.latest_tag(["nightly", "main"]) is None


def test_a_pre_release_sorts_below_its_release():
    assert remote.latest_tag(["v2.0.0-rc.1", "v2.0.0", "v1.5.0"]) == "v2.0.0"
    assert remote.version_key("v2.0.0-rc.10") > remote.version_key("v2.0.0-rc.2")


def test_latest_is_a_release_when_there_is_one():
    """A v2.0.0-rc.1 tagged to try out must not reach installations by itself."""
    assert remote.latest_tag(["v2.0.0-rc.2", "v2.0.0-rc.10", "v1.5.0"]) == "v1.5.0"
    assert remote.latest_tag(["v2.0.0-rc.2", "v2.0.0-rc.10"]) == "v2.0.0-rc.10"


# --- Finding the project in the repository ------------------------------------------------


def _tree(root: pathlib.Path, files: dict[str, str]) -> pathlib.Path:
    for name, content in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(content, encoding="utf-8")
    return root


def test_the_project_is_found_in_its_subfolder(tmp_path):
    root = _tree(tmp_path, _repo(PROJECT_V1))
    path, found = remote.project_dir(root, None)
    assert (path, found) == (root / "ketenconnect", "ketenconnect")


def test_the_root_is_the_project_when_it_is_one(tmp_path):
    # A dbt package installed in the repository has a dbt_project.yml too.
    root = _tree(tmp_path, {**PROJECT_V1, "dbt_packages/pkg/dbt_project.yml": "", "dbt_packages/pkg/pyproject.toml": ""})
    assert remote.project_dir(root, None) == (root, "")


def test_installed_packages_are_not_candidates(tmp_path):
    root = _tree(tmp_path, {**_repo(PROJECT_V1), "ketenconnect/dbt_packages/p/dbt_project.yml": "",
                            "ketenconnect/dbt_packages/p/pyproject.toml": ""})
    assert remote.find_projects(root) == ["ketenconnect"]


def test_no_project_asks_for_path(tmp_path):
    root = _tree(tmp_path, REPO_EXTRAS)
    with pytest.raises(remote.RemoteError, match="no Datavloot project.*--path"):
        remote.project_dir(root, None)


def test_several_projects_are_listed(tmp_path):
    root = _tree(tmp_path, {**_repo(PROJECT_V1, "one"), **_repo(PROJECT_V1, "two/deep")})
    with pytest.raises(remote.RemoteError) as e:
        remote.project_dir(root, None)
    assert "--path" in str(e.value)
    assert "  one\n  two/deep" in str(e.value)
    assert remote.project_dir(root, "two/deep") == (root / "two" / "deep", "two/deep")


def test_path_must_be_a_project_in_the_repository(tmp_path):
    root = _tree(tmp_path / "repo", _repo(PROJECT_V1))
    with pytest.raises(remote.RemoteError, match="has no folder 'nope'"):
        remote.project_dir(root, "nope")
    with pytest.raises(remote.RemoteError, match="not a Datavloot project"):
        remote.project_dir(root, "ketenconnect/models")
    with pytest.raises(remote.RemoteError, match="outside the repository"):
        remote.project_dir(root, "../..")


def test_an_archive_cannot_write_outside_its_folder(tmp_path):
    archive = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("repo/ok.txt", "ok")
        zf.writestr("repo/../../escaped.txt", "evil")
    with pytest.raises(remote.RemoteError, match="outside its own folder"):
        remote._extract(archive, tmp_path / "out")
    assert not (tmp_path / "escaped.txt").exists()


# --- Installing ---------------------------------------------------------------------------


def test_install_from_a_private_gitlab_subfolder(httpx_available, tmp_path, isolated):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1), "v1.1.0": _repo(PROJECT_V2)}, token=TOKEN)
    dest = tmp_path / "kc"
    asked = []
    commands = _install(host, dest, ask_token=lambda reason: asked.append(reason) or TOKEN,
                        EXPORT_DIR="C:\\exports\\new", REGION="south")

    # The latest tag, only the project's own files, nothing from the repository root.
    assert (dest / "models" / "new.sql").is_file()
    assert not (dest / "installeer.ps1").exists()
    state = json.loads((dest / ".datavloot" / "install.json").read_text(encoding="utf-8"))
    assert state["ref"] == "v1.1.0"
    assert state["path"] == "ketenconnect"
    assert state["source"] == "https://gitlab.com/datavloot/ketenconnect-demo"
    assert set(state["files"]) == set(PROJECT_V2)

    # Asked for a token after the anonymous 404, and stored it for `update`.
    assert len(asked) == 1 and "Repository" in asked[0]
    assert isolated.stored == {("datavloot", "gitlab.com/datavloot/ketenconnect-demo"): TOKEN}
    assert any(r.headers.get("PRIVATE-TOKEN") == TOKEN for r in host.requests)

    # The steps install.ps1 takes, in the project.
    assert [c[1:] for c in commands] == [
        ["sync", "--python", "3.12"],
        ["run", "--no-sync", "dbt", "deps"],
        ["run", "--no-sync", "dbt", "parse"],
    ]


def test_the_token_never_lands_in_the_project(httpx_available, tmp_path):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)}, token=TOKEN)
    dest = tmp_path / "kc"
    _install(host, dest, ask_token=lambda reason: TOKEN)
    for path in dest.rglob("*"):
        if path.is_file():
            assert TOKEN.encode() not in path.read_bytes(), path


def test_install_from_github_uses_a_bearer_token_and_the_zipball(httpx_available, tmp_path, monkeypatch):
    host = Host("github", {"v0.1.0": PROJECT_V1, "v0.2.0": PROJECT_V2}, token=TOKEN,
                repository="datavloot/harbor")
    monkeypatch.setenv(remote.TOKEN_ENV_VAR, TOKEN)
    dest = tmp_path / "harbor"
    _install(host, dest, ref="v0.1.0")
    assert (dest / "models" / "old.sql").is_file()
    archive = [r for r in host.requests if "zipball" in str(r.url)]
    assert archive and archive[0].url.path == "/repos/datavloot/harbor/zipball/v0.1.0"
    assert archive[0].headers["Authorization"] == f"Bearer {TOKEN}"
    assert json.loads((dest / ".datavloot" / "install.json").read_text())["path"] == ""


def test_install_from_a_self_hosted_gitlab(httpx_available, tmp_path):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)}, host="git.example.org")
    _install(host, tmp_path / "kc")
    assert {r.url.host for r in host.requests} == {"git.example.org"}


def test_tags_are_read_from_every_page(httpx_available, tmp_path):
    import httpx

    def handler(request):
        if request.url.path.endswith("/tags"):
            if request.url.params.get("page") == "2":
                return httpx.Response(200, json=[{"name": "v3.0.0"}])
            return httpx.Response(
                200, json=[{"name": "v1.0.0"}],
                headers={"Link": '<https://api.github.com/repos/o/r/tags?page=2>; rel="next"'},
            )
        raise AssertionError(request.url)

    source = remote.parse_source("https://github.com/o/r")
    with remote._client(httpx.MockTransport(handler)) as client:
        assert remote.list_tags(client, source, None) == ["v1.0.0", "v3.0.0"]


def test_the_env_example_is_asked_for(httpx_available, tmp_path):
    from dotenv import dotenv_values

    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)})
    dest = tmp_path / "kc"
    prompts, secrets = [], []

    def ask(prompt):
        prompts.append(prompt)
        return "C:\\exports\\new #1"

    def ask_secret(prompt):
        secrets.append(prompt)
        return "s3cret'\\x"

    remote.install(dest, host.url, transport=host.transport, ask_token=None,
                   ask=ask, ask_secret=ask_secret, runner=lambda cmd: 0)

    assert prompts == ["EXPORT_DIR [data]: "]
    assert secrets == ["SOURCE_PASSWORD (input is hidden): "]
    text = (dest / ".env").read_text(encoding="utf-8")
    assert "# Folder with the exports\n" in text
    # Read back by python-dotenv, as the project reads it: exactly as typed.
    assert dotenv_values(dest / ".env") == {
        "EXPORT_DIR": "C:\\exports\\new #1",
        "SOURCE_PASSWORD": "s3cret'\\x",
    }


def test_env_defaults_and_plain_windows_paths(tmp_path):
    from dotenv import dotenv_values

    (tmp_path / ".env.example").write_text(
        "# Heading, not a description\n\n# Where\nDIR=data # trailing comment\nPLAIN=\n",
        encoding="utf-8",
    )
    added = remote.fill_env(tmp_path, ask=_answers(DIR="", PLAIN="\\\\server\\share\\new"),
                            ask_secret=_answers())
    assert added == ["DIR", "PLAIN"]
    assert dotenv_values(tmp_path / ".env") == {"DIR": "data", "PLAIN": "\\\\server\\share\\new"}
    assert remote.parse_env_example((tmp_path / ".env.example").read_text())[0].description == "Where"


def test_no_terminal_for_env_says_what_to_do(tmp_path):
    (tmp_path / ".env.example").write_text("NEEDED=\n", encoding="utf-8")

    def no_terminal(prompt):
        raise EOFError

    with pytest.raises(remote.RemoteError, match="NEEDED.*by hand"):
        remote.fill_env(tmp_path, ask=no_terminal, ask_secret=no_terminal)


# --- Errors ---------------------------------------------------------------------------------


def test_a_non_empty_folder_is_never_overwritten(tmp_path):
    dest = tmp_path / "kc"
    dest.mkdir()
    (dest / "mine.txt").write_text("keep", encoding="utf-8")
    with pytest.raises(remote.RemoteError, match="not empty; nothing in it was changed"):
        remote.install(dest, "https://gitlab.com/a/b", ask_token=None)
    assert _snapshot(dest) == {"mine.txt": b"keep"}


def test_an_empty_folder_is_used(httpx_available, tmp_path):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)})
    dest = tmp_path / "kc"
    dest.mkdir()
    _install(host, dest)
    assert (dest / "dbt_project.yml").is_file()


def test_an_invalid_token(httpx_available, tmp_path, isolated):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)}, token=TOKEN)
    isolated.stored[("datavloot", "gitlab.com/datavloot/ketenconnect-demo")] = "expired-token-value"
    with pytest.raises(remote.AuthError) as e:
        _install(host, tmp_path / "kc")
    message = str(e.value)
    assert "invalid, has expired" in message and "read_api" in message
    assert "expired-token-value" not in message
    assert not (tmp_path / "kc").exists()


def test_a_new_token_replaces_a_refused_one(httpx_available, tmp_path, isolated):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)}, token=TOKEN)
    key = ("datavloot", "gitlab.com/datavloot/ketenconnect-demo")
    isolated.stored[key] = "expired-token-value"
    _install(host, tmp_path / "kc", ask_token=lambda reason: TOKEN)
    assert isolated.stored[key] == TOKEN


def test_an_unknown_repository(httpx_available, tmp_path):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)})
    host.repository = "datavloot/other"  # the URL asked for; the host serves ketenconnect-demo
    with pytest.raises(remote.NotFound, match="Repository https://gitlab.com/datavloot/other not found"):
        remote.install(tmp_path / "kc", host.url, transport=Host("gitlab", {}).transport, ask_token=None)


def test_an_unknown_tag_lists_the_available_ones(httpx_available, tmp_path):
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1), "v1.1.0": _repo(PROJECT_V2)})
    with pytest.raises(remote.NotFound, match="Tag 'v9' not found.*Available: v1.1.0, v1.0.0"):
        _install(host, tmp_path / "kc", ref="v9")


def test_no_version_tags(httpx_available, tmp_path):
    host = Host("gitlab", {"nightly": _repo(PROJECT_V1)})
    with pytest.raises(remote.RemoteError, match="no tag that is a version.*--ref"):
        _install(host, tmp_path / "kc")


def test_no_internet(httpx_available, tmp_path):
    import httpx

    def offline(request):
        raise httpx.ConnectError("getaddrinfo failed")

    with pytest.raises(remote.RemoteError, match="Cannot reach gitlab.com.*internet connection"):
        remote.install(tmp_path / "kc", "https://gitlab.com/a/b",
                       transport=httpx.MockTransport(offline), ask_token=None)
    assert not (tmp_path / "kc").exists()


def test_update_needs_an_installation(tmp_path):
    with pytest.raises(remote.RemoteError, match="not an installation made with `datavloot new --from`"):
        remote.update(tmp_path)


def test_new_rejects_ref_without_from(tmp_path):
    import argparse

    with pytest.raises(SystemExit, match="--from"):
        cli.cmd_new(argparse.Namespace(path=str(tmp_path / "x"), source=None, ref="v1", subdir=None))


# --- Updating -------------------------------------------------------------------------------


@pytest.fixture
def installed(httpx_available, tmp_path):
    """v1.0.0 installed, then used: settings, data, a lake and a notebook of the machine's own."""
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1), "v2.0.0": _repo(PROJECT_V2)}, token=TOKEN)
    dest = tmp_path / "kc"
    _install(host, dest, ref="v1.0.0", ask_token=lambda reason: TOKEN, EXPORT_DIR="mine")
    _tree(dest, {
        "data/export.xlsx": "export",
        "lake/catalog.sqlite": "lake",
        "notebooks/mine.py": "my notebook",
        ".venv/pyvenv.cfg": "venv",
        "target/manifest.json": "{}",
    })
    return host, dest


def test_update_keeps_local_state_and_replaces_the_code(installed, capsys):
    host, dest = installed
    env_before = (dest / ".env").read_text(encoding="utf-8")
    (dest / "models" / "a.sql").write_text("select 'changed here'\n", encoding="utf-8")

    asked = []
    result = remote.update(dest, transport=host.transport, ask_token=None,
                           ask=lambda p: asked.append(p) or "", ask_secret=_answers(),
                           runner=lambda cmd: 0)

    assert result == ("v1.0.0", "v2.0.0")
    assert (dest / "models" / "a.sql").read_text() == "select 2\n"
    assert (dest / "models" / "new.sql").is_file()
    assert not (dest / "models" / "old.sql").exists()
    for kept in ("data/export.xlsx", "lake/catalog.sqlite", "notebooks/mine.py",
                 ".venv/pyvenv.cfg", "target/manifest.json"):
        assert (dest / kept).is_file(), kept
    # Only the variable v2 added was asked for; the rest of .env is as it was.
    assert asked == ["REGION [north]: "]
    env_after = (dest / ".env").read_text(encoding="utf-8")
    assert env_after.startswith(env_before) and "REGION=north" in env_after

    err = capsys.readouterr().err
    assert "models/a.sql was changed on this machine" in err
    state = json.loads((dest / ".datavloot" / "install.json").read_text(encoding="utf-8"))
    assert state["ref"] == "v2.0.0" and set(state["files"]) == set(PROJECT_V2)


def test_update_goes_back_to_an_older_tag(installed):
    host, dest = installed
    _update(host, dest, "v2.0.0")
    assert _update(host, dest, "v1.0.0") == ("v2.0.0", "v1.0.0")
    assert (dest / "models" / "old.sql").read_text() == "select 'old'\n"
    assert not (dest / "models" / "new.sql").exists()
    assert (dest / "models" / "a.sql").read_text() == "select 1\n"
    assert (dest / "data" / "export.xlsx").is_file()


def test_update_to_the_installed_tag_does_nothing(installed):
    host, dest = installed
    before = _snapshot(dest)
    assert _update(host, dest, "v1.0.0") is None
    assert _snapshot(dest) == before


def test_a_failed_download_leaves_the_installation_untouched(installed):
    import httpx

    host, dest = installed
    before = _snapshot(dest)
    for failure in (httpx.ConnectError("connection reset"), 500):
        host.fail_archive = failure
        with pytest.raises(remote.RemoteError):
            _update(host, dest)
        assert _snapshot(dest) == before


def test_an_expired_token_on_update_leaves_the_installation_untouched(installed, isolated):
    host, dest = installed
    before = _snapshot(dest)
    host.token = "a-newer-token"
    with pytest.raises(remote.AuthError, match="invalid, has expired"):
        _update(host, dest)
    assert _snapshot(dest) == before


def test_update_uses_the_stored_token(installed, monkeypatch):
    host, dest = installed
    # No prompt and no environment variable: only the credential store has it.
    monkeypatch.delenv(remote.TOKEN_ENV_VAR, raising=False)
    assert _update(host, dest)[1] == "v2.0.0"


def test_the_token_file_when_there_is_no_credential_store(httpx_available, tmp_path, monkeypatch):
    monkeypatch.setattr(remote, "_keyring", lambda: None)
    host = Host("gitlab", {"v1.0.0": _repo(PROJECT_V1)}, token=TOKEN)
    dest = tmp_path / "kc"
    _install(host, dest, ask_token=lambda reason: TOKEN)
    token_file = tmp_path / "config" / "tokens.json"
    assert json.loads(token_file.read_text()) == {"gitlab.com/datavloot/ketenconnect-demo": TOKEN}
    if os.name != "nt":
        assert token_file.stat().st_mode & 0o777 == 0o600
    assert remote.load_token(remote.parse_source(host.url)) == TOKEN


# --- After an update --------------------------------------------------------------------------


def test_code_location_name(tmp_path):
    _tree(tmp_path, {"pyproject.toml": PROJECT_V1["pyproject.toml"]})
    assert remote.code_location_name(tmp_path) == "kc"


def test_run_after_update_without_dagster(httpx_available, tmp_path, monkeypatch):
    import httpx

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "post", refuse)
    message = remote.run_after_update(tmp_path, "http://localhost:3000/graphql", True)
    assert "not running" in message and "uv run datavloot start --run" in message
    message = remote.run_after_update(tmp_path, "http://localhost:3000/graphql", False)
    assert "--run" not in message


def test_run_after_update_leaves_another_project_alone(httpx_available, tmp_path, monkeypatch):
    import httpx

    _tree(tmp_path, {"pyproject.toml": PROJECT_V1["pyproject.toml"]})
    calls = []

    def post(url, json, timeout):
        calls.append(json["query"])
        return httpx.Response(200, json={"data": {"workspaceOrError": {
            "__typename": "Workspace", "locationEntries": [{"name": "noaa"}]}}})

    monkeypatch.setattr(httpx, "post", post)
    message = remote.run_after_update(tmp_path, "http://localhost:3000/graphql", True)
    assert "runs another project (noaa)" in message
    assert len(calls) == 1  # no reload, no run


def test_run_after_update_reloads_and_starts_a_run(httpx_available, tmp_path, monkeypatch):
    import httpx

    _tree(tmp_path, {"pyproject.toml": PROJECT_V1["pyproject.toml"]})
    queries = []

    def post(url, json, timeout):
        queries.append(json["query"])
        if "reloadWorkspace" in json["query"]:
            return httpx.Response(200, json={"data": {"reloadWorkspace": {"__typename": "Workspace"}}})
        return httpx.Response(200, json={"data": {"workspaceOrError": {
            "__typename": "Workspace", "locationEntries": [{"name": "kc"}]}}})

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(cli, "_materialize_all", lambda url: "Started a run.")
    message = remote.run_after_update(tmp_path, "http://localhost:3000/graphql", True)
    assert "Started a run." in message and "Restart them" in message
    assert any("reloadWorkspace" in q for q in queries)
