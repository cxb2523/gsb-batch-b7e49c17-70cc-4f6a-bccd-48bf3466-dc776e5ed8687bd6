"""
Optional token auth for the Crows Nest.

Off unless CROWSNEST_AUTH_TOKEN is set, so the laptop case is unchanged. When it
is set, both a script (Bearer) and a browser (Basic, via the native prompt) can
authenticate without the dashboard knowing anything about auth.
"""

import base64
import os

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402

TOKEN = "s3cret-token"


def _client() -> TestClient:
    cn_config.reset_config()
    from datavloot_platform.crowsnest.server import create_app
    return TestClient(create_app())


def _make_db(path) -> str:
    """A real (empty) warehouse, so a 503 cannot masquerade as an auth result."""
    import duckdb
    duckdb.connect(str(path)).close()
    return str(path)


@pytest.fixture
def secured(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", _make_db(tmp_path / "p.duckdb"))
    monkeypatch.setenv("CROWSNEST_AUTH_TOKEN", TOKEN)
    yield _client()
    cn_config.reset_config()


@pytest.fixture
def open_server(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", _make_db(tmp_path / "p.duckdb"))
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    yield _client()
    cn_config.reset_config()


def basic(user: str, password: str) -> dict:
    raw = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {raw}"}


# --------------------------------------------------------------------------

def test_no_token_configured_means_no_auth(open_server):
    """The default laptop experience must not change."""
    assert open_server.get("/api/query/tables").status_code == 200


def test_requests_without_credentials_are_refused(secured):
    r = secured.get("/api/query/tables")
    assert r.status_code == 401


def test_a_401_invites_the_browser_to_prompt(secured):
    """Without WWW-Authenticate the browser shows a bare error instead of a login."""
    r = secured.get("/api/query/tables")
    assert r.headers.get("www-authenticate", "").lower().startswith("basic")


def test_bearer_token_is_accepted(secured):
    r = secured.get("/api/query/tables", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200, r.text


def test_basic_auth_is_accepted_with_any_username(secured):
    """This is the path a browser takes after its native prompt."""
    for user in ("", "anything", "evka"):
        r = secured.get("/api/query/tables", headers=basic(user, TOKEN))
        assert r.status_code == 200, f"username {user!r} was refused"


@pytest.mark.parametrize("headers", [
    {"Authorization": "Bearer wrong"},
    {"Authorization": "Basic " + base64.b64encode(b"u:wrong").decode()},
    {"Authorization": "Basic not-base64!!"},
    {"Authorization": "Bearer"},
    {"Authorization": "Weird abc"},
    {"Authorization": ""},
])
def test_bad_credentials_are_refused(secured, headers):
    assert secured.get("/api/query/tables", headers=headers).status_code == 401


def test_the_dashboard_itself_is_protected(secured):
    """Serving the UI to anyone while its data needs a token is not a boundary."""
    assert secured.get("/").status_code == 401


def test_health_stays_public_for_uptime_checks(secured):
    assert secured.get("/api/health").status_code == 200


def test_the_query_endpoint_is_protected(secured):
    r = secured.post("/api/query/execute", json={"sql": "SELECT 1"})
    assert r.status_code == 401
    ok = secured.post(
        "/api/query/execute",
        json={"sql": "SELECT 1"},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert ok.status_code == 200, ok.text
