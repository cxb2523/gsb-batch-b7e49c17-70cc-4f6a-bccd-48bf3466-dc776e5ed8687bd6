"""Cliente de la Backend API de Clerk con respuestas simuladas."""
import json

import httpx
import pytest

from app.application.errors import Conflict, InvalidInput, Unavailable
from app.infrastructure.auth.clerk_api import ClerkApi


def api(handler, redirect="https://panel.example/aceptar"):
    return ClerkApi("sk_test_x", redirect, transport=httpx.MockTransport(handler))


def test_invitation_carries_role_in_public_metadata():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content), auth=request.headers["authorization"], path=request.url.path)
        return httpx.Response(200, json={"id": "inv_1"})

    assert api(handler).create_invitation("a@b.pe", "Ana", "admin") == "inv_1"
    assert seen["path"] == "/v1/invitations" and seen["auth"] == "Bearer sk_test_x"
    assert seen["email_address"] == "a@b.pe" and seen["redirect_url"] == "https://panel.example/aceptar"
    assert seen["public_metadata"] == {"sentrix": {"invited": True, "role": "admin", "display_name": "Ana"}}


@pytest.mark.parametrize("status,code", [(400, "duplicate_record"), (422, "form_identifier_exists"), (409, "otro")])
def test_duplicates_are_conflicts(status, code):
    client = api(lambda request: httpx.Response(status, json={"errors": [{"code": code}]}))
    with pytest.raises(Conflict):
        client.create_invitation("a@b.pe", "Ana", "operator")


def test_other_rejections_are_invalid_input():
    client = api(lambda request: httpx.Response(422, json={"errors": [{"code": "form_param_format_invalid"}]}))
    with pytest.raises(InvalidInput):
        client.create_invitation("a@b.pe", "Ana", "operator")


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_clerk_failures_are_unavailable(status):
    client = api(lambda request: httpx.Response(status, json={}))
    with pytest.raises(Unavailable):
        client.create_invitation("a@b.pe", "Ana", "operator")


def test_network_errors_are_unavailable():
    def handler(request):
        raise httpx.ConnectError("sin red")
    with pytest.raises(Unavailable):
        api(handler).get_user("user_1")


def test_get_user_and_lookup():
    def handler(request):
        if request.url.path == "/v1/users/falta":
            return httpx.Response(404, json={})
        if request.url.path == "/v1/users":
            assert request.url.params["email_address"] == "a@b.pe"
            return httpx.Response(200, json=[{"id": "user_1"}])
        return httpx.Response(200, json={"id": "user_1"})

    client = api(handler)
    assert client.get_user("falta") is None
    assert client.get_user("user_1") == {"id": "user_1"}
    assert client.find_user_by_email("a@b.pe") == {"id": "user_1"}
