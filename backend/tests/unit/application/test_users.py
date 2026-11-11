"""Reglas de sesión, invitación y sincronización con dobles en memoria."""
import pytest

from app.application.errors import Conflict, Forbidden, NotFound, Unavailable
from app.application.users import UserService, public_profile
from app.domain.users import Principal, identity_from_clerk
from tests.support.users import FakeClerk, FakeUserStore, clerk_user


class Verifier:
    def verify(self, token):
        return {"sub": token}


class Log:
    def __init__(self):
        self.events = []

    def emit(self, event_type, message, **kwargs):
        self.events.append((event_type, message))


@pytest.fixture
def parts():
    store, clerk, log = FakeUserStore(), FakeClerk(), Log()
    return store, clerk, log, UserService(store, clerk, Verifier(), log)


ACTOR = Principal(role="admin", user_id="actor-id")


def test_identity_uses_primary_email_and_invitation_metadata():
    identity = identity_from_clerk(clerk_user(email=" Persona@Sentrix.PE ", role="admin"))
    assert identity.email == "persona@sentrix.pe" and identity.invited and identity.invited_role == "admin"
    assert identity.display_name == "Persona"


def test_identity_ignores_invalid_invited_role():
    assert identity_from_clerk(clerk_user(role="jefe")).invited_role == "operator"


def test_identity_without_invitation_is_not_invited():
    identity = identity_from_clerk(clerk_user(invited=False))
    assert not identity.invited and identity.invited_role == "operator" and identity.display_name == "Nombre"


def test_identity_without_primary_email_is_none():
    assert identity_from_clerk({**clerk_user(), "primary_email_address_id": "otro"}) is None


@pytest.mark.parametrize("metadata", ["texto", ["lista"], {"sentrix": "texto"}, {"sentrix": ["lista"]},
                                      {"sentrix": {"invited": "si", "role": ["admin"], "display_name": 5}}])
def test_unexpected_metadata_counts_as_not_invited(metadata):
    identity = identity_from_clerk({**clerk_user(invited=False), "public_metadata": metadata})
    assert not identity.invited and identity.invited_role == "operator" and identity.display_name == "Nombre"


@pytest.mark.parametrize("change", [{"id": 5}, {"id": "  "}, {"email_addresses": "texto"}, {"email_addresses": ["texto"]},
                                    {"email_addresses": [{"id": "idn_1", "email_address": 5}]}])
def test_unusable_identity_is_none(change):
    assert identity_from_clerk({**clerk_user(), **change}) is None


def test_malformed_webhook_is_acknowledged_without_failing(parts):
    store, _, log, service = parts
    created = {"type": "user.created", "timestamp": 5, "data": {**clerk_user(), "email_addresses": [{"id": "idn_1", "email_address": 5}]}}
    assert service.handle_webhook(created) == "ignored" and log.events[-1][0] == "user_sync_conflict"
    assert service.handle_webhook({"type": "user.deleted", "timestamp": 5, "data": {"id": 5}}) == "ignored"
    assert store.list()["total"] == 0


def test_unexpected_metadata_on_first_login_is_forbidden_not_a_failure(parts):
    store, clerk, _, service = parts
    clerk.users["user_1"] = {**clerk_user(invited=False), "public_metadata": {"sentrix": "texto"}}
    with pytest.raises(Forbidden):
        service.authenticate("user_1")
    assert store.get_by_clerk_id("user_1")["is_active"] is False


def test_active_profile_authenticates(parts):
    store, _, _, service = parts
    profile = store.add("user_1", "a@b.pe", "operator")
    assert service.authenticate("user_1") == Principal(role="operator", user_id=profile["id"])


def test_inactive_profile_is_forbidden(parts):
    store, _, _, service = parts
    store.add("user_1", "a@b.pe", active=False)
    with pytest.raises(Forbidden):
        service.authenticate("user_1")


def test_first_login_before_webhook_creates_the_profile(parts):
    _, clerk, log, service = parts
    clerk.users["user_1"] = clerk_user(role="admin")
    assert service.authenticate("user_1").role == "admin"
    assert log.events[0][0] == "user_provisioned"


def test_account_without_invitation_stays_inactive(parts):
    store, clerk, _, service = parts
    clerk.users["user_1"] = clerk_user(invited=False)
    with pytest.raises(Forbidden):
        service.authenticate("user_1")
    assert store.get_by_clerk_id("user_1")["is_active"] is False


def test_unknown_account_is_forbidden(parts):
    _, _, _, service = parts
    with pytest.raises(Forbidden):
        service.authenticate("nadie")


def test_storage_failure_is_unavailable(parts):
    store, _, _, service = parts
    store.failure = RuntimeError("Neon caído")
    with pytest.raises(Unavailable):
        service.authenticate("user_1")


def test_clerk_failure_on_first_login_is_unavailable(parts):
    _, clerk, _, service = parts
    clerk.failure = Unavailable("Clerk no disponible")
    with pytest.raises(Unavailable):
        service.authenticate("user_1")


def test_invitation_normalizes_email_and_audits_without_it(parts):
    _, clerk, log, service = parts
    result = service.invite(ACTOR, " Ana@Sentrix.PE ", "Ana", "admin")
    assert result == {"invitation_id": "inv_1", "email": "ana@sentrix.pe", "role": "admin", "status": "pending"}
    assert clerk.invitations[0]["email"] == "ana@sentrix.pe"
    assert "ana@" not in log.events[0][1]


def test_invitation_conflicts_with_existing_account_but_not_with_deleted_one(parts):
    store, clerk, _, service = parts
    store.add("user_1", "a@b.pe")
    with pytest.raises(Conflict):
        service.invite(ACTOR, "a@b.pe", "Ana", "operator")
    assert clerk.invitations == []
    store.mark_deleted("user_1", 1)
    assert service.invite(ACTOR, "a@b.pe", "Ana", "operator")["status"] == "pending"


def test_changes_report_missing_users_and_last_admin(parts):
    store, _, _, service = parts
    with pytest.raises(NotFound):
        service.set_role(ACTOR, "falta", "admin")
    admin = store.add("user_1", "a@b.pe", "admin")
    with pytest.raises(Conflict):
        service.set_status(ACTOR, admin["id"], False)
    with pytest.raises(Conflict):
        service.set_role(ACTOR, admin["id"], "operator")


def test_public_profile_hides_internal_fields():
    profile = {"id": "1", "clerk_user_id": "u", "email": "e", "display_name": None, "role": "admin",
               "is_active": True, "deleted": False}
    assert "deleted" not in public_profile(profile)


@pytest.mark.parametrize("event", [{}, {"type": "session.created", "data": {}}, {"type": "user.deleted", "data": {}}, "texto"])
def test_irrelevant_events_are_ignored(parts, event):
    assert parts[3].handle_webhook(event) == "ignored"


def test_event_without_email_is_acknowledged_and_recorded(parts):
    store, _, log, service = parts
    event = {"type": "user.created", "timestamp": 5, "data": {"id": "user_1", "email_addresses": []}}
    assert service.handle_webhook(event) == "ignored"
    assert store.list()["total"] == 0 and log.events[0][0] == "user_sync_conflict"


def test_webhook_storage_failure_asks_for_a_retry(parts):
    store, _, _, service = parts
    store.failure = RuntimeError("Neon caído")
    with pytest.raises(Unavailable):
        service.handle_webhook({"type": "user.created", "timestamp": 5, "data": clerk_user()})
