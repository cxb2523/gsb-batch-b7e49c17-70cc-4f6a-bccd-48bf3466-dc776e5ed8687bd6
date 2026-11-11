"""Criterios de aceptación del contrato de autenticación, por HTTP."""
import asyncio
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.application.users import UserService
from app.infrastructure.auth.tokens import ClerkTokenVerifier
from tests.support.coordination import FakeCoordinationStore
from tests.support.users import (ISSUER, ORIGIN, PUBLIC_KEY, WEBHOOK_SECRET, FakeClerk, FakeUserStore, clerk_user,
                                 make_token, signed_webhook)

KEY = {"X-API-Key": "test-control-key"}
PUBLIC = {"/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc", "/webhooks/clerk"}
BACKEND = Path(__file__).resolve().parents[4]


def bearer(sub):
    return {"Authorization": "Bearer " + make_token(sub)}


def build(monkeypatch, mode):
    from app.bootstrap import create_app
    monkeypatch.setenv("SENTRIX_AUTH_MODE", mode)
    monkeypatch.setenv("CLERK_WEBHOOK_SECRET", WEBHOOK_SECRET)
    store, clerk = FakeUserStore(), FakeClerk()
    verifier = ClerkTokenVerifier(ISSUER, [ORIGIN], key_resolver=lambda token: PUBLIC_KEY)
    app = create_app(mode="mock", transport="rtsp", user_service=UserService(store, clerk, verifier))

    async def idle_reader(session):
        await asyncio.Event().wait()

    monkeypatch.setattr(app.state.video_receiver, "_read_loop", idle_reader)
    return app, store, clerk


@pytest.fixture
def system(configured, monkeypatch):
    app, store, clerk = build(monkeypatch, "clerk")
    admin = store.add("user_admin", "admin@sentrix.pe", "admin")
    operator = store.add("user_operator", "operador@sentrix.pe", "operator")
    with TestClient(app) as client:
        yield SimpleNamespace(app=app, store=store, clerk=clerk, client=client, admin=admin, operator=operator,
                              as_admin=bearer("user_admin"), as_operator=bearer("user_operator"))


CAMERA = {"source_id": "cam2", "name": "Dos", "stream_path": "cam2"}


def api_routes(app):
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), re.sub(r"\{[^}]+\}", "x", path), path


def test_every_route_requires_a_session_except_the_public_ones(system):
    checked = 0
    for method, url, template in api_routes(system.app):
        if template in PUBLIC:
            continue
        checked += 1
        assert system.client.request(method, url).status_code == 401, (method, url)
        assert system.client.request(method, url, headers=KEY).status_code == 401, (method, url)
    assert checked >= 20


@pytest.mark.parametrize("token", [make_token("user_admin", expires_in=-60), make_token("user_admin", azp="https://x.example"), "basura"],
                         ids=["vencido", "azp", "basura"])
def test_invalid_tokens_are_401(system, token):
    assert system.client.get("/cameras", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_me_returns_the_contract_fields(system):
    response = system.client.get("/auth/me", headers=system.as_operator)
    assert response.status_code == 200
    assert response.json() == {"id": system.operator["id"], "clerk_user_id": "user_operator",
                               "email": "operador@sentrix.pe", "display_name": None, "role": "operator", "is_active": True}


@pytest.mark.parametrize("who", ["as_operator", "as_admin"])
def test_both_roles_register_edit_and_monitor(system, who):
    client, headers = system.client, getattr(system, who)
    assert client.post("/cameras", json=CAMERA, headers=headers).status_code == 201
    assert client.put("/cameras/cam2", json={**CAMERA, "name": "Editada"}, headers=headers).json()["name"] == "Editada"
    assert client.post("/sources/start", json={"source_id": "cam2"}, headers=headers).status_code == 200
    assert client.get("/sources/cam2/status", headers=headers).status_code == 200
    assert client.delete("/sources/cam2", headers=headers).json()["status"] == "stopped"
    for path in ("/cameras", "/cameras/cam2", "/sources", "/detections", "/alerts", "/inference-logs", "/auth/me"):
        assert client.get(path, headers=headers).status_code == 200, path


def test_operator_cannot_do_admin_actions(system):
    client, headers = system.client, system.as_operator
    assert client.delete("/cameras/camara1", headers=headers).status_code == 403
    assert client.get("/users", headers=headers).status_code == 403
    assert client.patch(f"/users/{system.admin['id']}/role", json={"role": "operator"}, headers=headers).status_code == 403
    assert client.patch(f"/users/{system.admin['id']}/status", json={"is_active": False}, headers=headers).status_code == 403
    assert client.post("/auth/invitations", json={"email": "a@b.pe", "display_name": "A", "role": "operator"}, headers=headers).status_code == 403
    assert client.post("/predict", json={}, headers=headers).status_code == 403
    assert system.clerk.invitations == []
    assert client.get("/cameras/camara1", headers=headers).status_code == 200


def test_operator_cannot_toggle_a_camera_by_editing_it(system):
    client = system.client
    client.post("/cameras", json=CAMERA, headers=system.as_admin)
    body = {**CAMERA, "enabled": False}
    assert client.put("/cameras/cam2", json=body, headers=system.as_operator).status_code == 403
    assert client.get("/cameras/cam2", headers=system.as_operator).json()["enabled"] is True
    # Enviar el mismo valor no es un cambio.
    assert client.put("/cameras/cam2", json={**CAMERA, "enabled": True}, headers=system.as_operator).status_code == 200
    assert client.put("/cameras/cam2", json=body, headers=system.as_admin).json()["enabled"] is False
    assert client.put("/cameras/cam2", json={**CAMERA, "enabled": True}, headers=system.as_operator).status_code == 403


def test_admin_can_do_everything(system):
    client, headers = system.client, system.as_admin
    client.post("/cameras", json=CAMERA, headers=headers)
    assert client.delete("/cameras/cam2", headers=headers).json()["deleted"] is True
    assert client.post("/predict", json={}, headers=headers).status_code == 422  # Pasa el permiso; falla la validación.
    created = client.post("/auth/invitations", json={"email": "Nueva@Sentrix.pe", "display_name": "Nueva", "role": "operator"}, headers=headers)
    assert created.status_code == 201
    assert created.json() == {"invitation_id": "inv_1", "email": "nueva@sentrix.pe", "role": "operator", "status": "pending"}
    page = client.get("/users", params={"limit": 1, "offset": 0, "role": "operator", "active": True}, headers=headers).json()
    assert page["total"] == 1 and page["limit"] == 1 and page["items"][0]["id"] == system.operator["id"]
    user = system.operator["id"]
    assert client.patch(f"/users/{user}/role", json={"role": "admin"}, headers=headers).json()["role"] == "admin"
    assert client.patch(f"/users/{user}/status", json={"is_active": False}, headers=headers).json()["is_active"] is False


def test_deactivating_blocks_a_token_that_is_still_valid(system):
    client, token = system.client, system.as_operator
    assert client.get("/cameras", headers=token).status_code == 200
    assert client.patch(f"/users/{system.operator['id']}/status", json={"is_active": False}, headers=system.as_admin).status_code == 200
    assert client.get("/cameras", headers=token).status_code == 403
    assert client.get("/auth/me", headers=token).status_code == 403
    assert client.patch(f"/users/{system.operator['id']}/status", json={"is_active": True}, headers=system.as_admin).status_code == 200
    assert client.get("/cameras", headers=token).status_code == 200


def test_role_change_applies_to_the_next_request(system):
    client = system.client
    assert client.delete("/cameras/camara1", headers=system.as_operator).status_code == 403
    client.patch(f"/users/{system.operator['id']}/role", json={"role": "admin"}, headers=system.as_admin)
    assert client.delete("/cameras/camara1", headers=system.as_operator).status_code == 200


def test_error_codes(system):
    client, headers = system.client, system.as_admin
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.patch(f"/users/{missing}/role", json={"role": "admin"}, headers=headers).status_code == 404
    assert client.patch("/users/no-es-uuid/role", json={"role": "admin"}, headers=headers).status_code == 422
    assert client.patch(f"/users/{missing}/role", json={"role": "jefe"}, headers=headers).status_code == 422
    assert client.patch(f"/users/{missing}/status", json={"is_active": "no"}, headers=headers).status_code == 422
    assert client.post("/auth/invitations", json={"email": "sin-arroba", "display_name": "A", "role": "operator"}, headers=headers).status_code == 422
    assert client.post("/auth/invitations", json={"email": "operador@sentrix.pe", "display_name": "A", "role": "operator"}, headers=headers).status_code == 409
    assert client.patch(f"/users/{system.admin['id']}/role", json={"role": "operator"}, headers=headers).status_code == 409
    assert client.get("/users", params={"limit": 0}, headers=headers).status_code == 422


def test_unavailable_services_are_503(system):
    from app.application.errors import Unavailable
    system.clerk.failure = Unavailable("Clerk no disponible")
    assert system.client.post("/auth/invitations", json={"email": "a@b.pe", "display_name": "A", "role": "operator"}, headers=system.as_admin).status_code == 503
    system.store.failure = RuntimeError("Neon caído")
    assert system.client.get("/cameras", headers=system.as_admin).status_code == 503


def post_webhook(system, event, **kwargs):
    body, headers = signed_webhook(event, **kwargs)
    return system.client.post("/webhooks/clerk", content=body, headers=headers)


def test_webhook_needs_a_valid_signature_not_a_session(system):
    event = {"type": "user.created", "timestamp": 10, "data": clerk_user("user_n", "n@sentrix.pe")}
    assert post_webhook(system, event).json() == {"status": "processed"}
    assert system.client.post("/webhooks/clerk", json=event).status_code == 401
    body, headers = signed_webhook(event, secret="whsec_b3RyYS1jbGF2ZQ==")
    assert system.client.post("/webhooks/clerk", content=body, headers=headers).status_code == 401


def test_repeated_webhook_does_not_duplicate_and_invited_user_can_enter(system):
    before = system.store.list()["total"]
    event = {"type": "user.created", "timestamp": 10, "data": clerk_user("user_n", "n@sentrix.pe", role="admin")}
    for _ in range(3):
        assert post_webhook(system, event).status_code == 200
    assert system.store.list()["total"] == before + 1
    assert system.client.get("/auth/me", headers=bearer("user_n")).json()["role"] == "admin"


def test_webhook_cannot_change_role_or_reactivate(system):
    user = system.store.add("user_n", "n@sentrix.pe", "operator", active=False)
    event = {"type": "user.updated", "timestamp": 10, "data": clerk_user("user_n", "otro@sentrix.pe", role="admin")}
    post_webhook(system, event)
    row = system.store.get(user["id"])
    assert row["email"] == "otro@sentrix.pe" and row["role"] == "operator" and row["is_active"] is False


def test_user_deleted_blocks_access_and_keeps_the_profile(system):
    post_webhook(system, {"type": "user.deleted", "timestamp": 10, "data": {"id": "user_operator", "deleted": True}})
    assert system.store.get(system.operator["id"])["is_active"] is False
    assert system.client.get("/cameras", headers=system.as_operator).status_code == 403


def test_no_secrets_in_audit_responses_or_logs(system, caplog):
    client = system.client
    token = system.as_admin["Authorization"].split()[1]
    client.post("/auth/invitations", json={"email": "secreta@sentrix.pe", "display_name": "S", "role": "operator"}, headers=system.as_admin)
    client.patch(f"/users/{system.operator['id']}/role", json={"role": "admin"}, headers=system.as_admin)
    post_webhook(system, {"type": "user.created", "timestamp": 10, "data": clerk_user("user_n", "correo@sentrix.pe")})
    logs = client.get("/inference-logs", headers=system.as_admin, params={"limit": 100}).text
    assert {"user_invited", "user_role_changed", "user_provisioned"} <= set(re.findall(r"user_[a-z_]+", logs))
    for secret in ("secreta@sentrix.pe", "correo@sentrix.pe", token):
        assert secret not in logs and secret not in caplog.text
    profile = client.get("/auth/me", headers=system.as_admin).text.lower()
    assert "password" not in profile and "token" not in profile


def test_migration_defines_no_password_or_token_column():
    sql = (BACKEND / "migrations" / "2026-11-08_usuarios.sql").read_text(encoding="utf-8")
    columns = re.findall(r"^\s{4}([a-z_]+) [A-Z]", sql, flags=re.MULTILINE)
    assert "clerk_user_id" in columns and not [name for name in columns if "password" in name or "token" in name]


def test_default_mode_is_unchanged(configured):
    from app.bootstrap import create_app
    app = create_app(mode="mock", transport="rtsp")
    assert app.state.auth_mode == "api_key"
    with TestClient(app) as client:
        assert client.get("/cameras", headers=KEY).status_code == 200
        assert client.get("/cameras", headers=bearer("x")).status_code == 401
        assert client.get("/users", headers=KEY).status_code == 404
        assert client.delete("/cameras/falta", headers=KEY).status_code == 404  # La clave conserva su acceso.


def test_transition_mode_accepts_both_but_the_key_never_manages_users(configured, monkeypatch):
    app, store, _ = build(monkeypatch, "both")
    store.add("user_operator", "o@sentrix.pe", "operator")
    with TestClient(app) as client:
        assert client.get("/cameras", headers=KEY).status_code == 200
        assert client.get("/cameras", headers=bearer("user_operator")).status_code == 200
        assert client.delete("/cameras/falta", headers=KEY).status_code == 404
        assert client.delete("/cameras/falta", headers=bearer("user_operator")).status_code == 403
        assert client.get("/users", headers=KEY).status_code == 401
        assert client.get("/auth/me", headers=KEY).status_code == 401
        assert client.get("/cameras").status_code == 401


def test_workers_keep_using_the_key(configured, monkeypatch):
    from app.bootstrap import create_app
    monkeypatch.setenv("SENTRIX_AUTH_MODE", "clerk")
    app = create_app(mode="mock", transport="rtsp", role="worker", coordination_store=FakeCoordinationStore())
    assert app.state.auth_mode == "api_key"
    templates = [template for _, _, template in api_routes(app)]
    assert "/cameras" in templates and not any(template.startswith(("/users", "/auth")) for template in templates)


def test_invalid_mode_is_rejected(configured, monkeypatch):
    from app.bootstrap import create_app
    monkeypatch.setenv("SENTRIX_AUTH_MODE", "abierto")
    with pytest.raises(ValueError):
        create_app(mode="mock", transport="rtsp")


def test_startup_stops_and_keeps_the_real_cause(configured, monkeypatch):
    app, store, _ = build(monkeypatch, "clerk")
    store.failure = ConnectionError("Neon no responde")
    with pytest.raises(ConnectionError, match="Neon no responde"):
        with TestClient(app):
            pass


def test_api_key_is_only_required_while_it_is_accepted(configured, monkeypatch):
    from app.bootstrap import create_app
    monkeypatch.delenv("SENTRIX_CONTROL_API_KEY")
    with pytest.raises(ValueError, match="SENTRIX_CONTROL_API_KEY"):
        create_app(mode="mock", transport="rtsp")
    build(monkeypatch, "clerk")


def test_swagger_documents_the_session(system):
    schema = system.client.get("/openapi.json").json()
    assert schema["paths"]["/cameras"]["get"]["security"] == [{"ClerkSession": []}]
    assert "security" not in schema["paths"]["/webhooks/clerk"]["post"]


def test_preflight_allows_patch_with_authorization(system):
    response = system.client.options(f"/users/{system.admin['id']}/role", headers={
        "Origin": ORIGIN, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "Authorization,Content-Type"})
    assert response.status_code == 200 and response.headers["Access-Control-Allow-Origin"] == ORIGIN
