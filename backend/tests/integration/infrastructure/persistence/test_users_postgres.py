"""UserStore real, en un esquema temporal, con la migración que se aplicará en Neon."""
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import pytest

from app.application.users import UserService
from app.domain.users import AccountDeletedError, AdminExistsError, ClerkIdentity, LastAdminError, identity_from_clerk
from tests.support.users import clerk_user

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[4] / "migrations" / "2026-11-08_usuarios.sql"


@pytest.fixture
def store():
    url = os.getenv("SENTRIX_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requiere SENTRIX_TEST_DATABASE_URL")
    url = url.replace("-pooler.", ".", 1)
    import psycopg
    from psycopg import sql
    from app.infrastructure.persistence.users import UserStore
    schema = "test_users_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    separator = "&" if "?" in url else "?"
    scoped = f"{url}{separator}options={quote(f'-csearch_path={schema}')}"
    try:
        with psycopg.connect(scoped, autocommit=True) as connection:
            # Dos veces: la migración debe ser idempotente.
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
        yield UserStore(scoped)
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def identity(clerk_id="user_1", email="persona@sentrix.pe", *, invited=True, role="operator", name="Persona"):
    return ClerkIdentity(clerk_id, email, name, invited, role)


def test_table_has_no_secrets_and_check_passes(store):
    store.check()
    columns = store._run(lambda c: c.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'").fetchall())
    names = {row["column_name"] for row in columns}
    assert "clerk_user_id" in names and not {name for name in names if "password" in name or "token" in name}


def test_missing_table_has_a_clear_message(store):
    store._run(lambda c: c.execute("DROP TABLE users"))
    with pytest.raises(RuntimeError, match="usuarios.sql"):
        store.check()


def test_role_check_constraint(store):
    import psycopg
    with pytest.raises(psycopg.errors.CheckViolation):
        store._run(lambda c: c.execute(
            "INSERT INTO users (clerk_user_id, email, role) VALUES ('x', 'x@x.pe', 'jefe')"))


def test_invited_profile_and_uninvited_profile(store):
    outcome, invited = store.sync(identity(role="admin"), 10)
    assert outcome == "created" and invited["role"] == "admin" and invited["is_active"] is True
    _, uninvited = store.sync(identity("user_2", "b@sentrix.pe", invited=False, role="admin"), 10)
    assert uninvited["is_active"] is False


def test_repeated_and_old_events_change_nothing(store):
    store.sync(identity(), 10)
    assert store.sync(identity(), 10)[0] == "stale"
    assert store.sync(identity(email="vieja@sentrix.pe"), 5)[0] == "stale"
    assert store.get_by_clerk_id("user_1")["email"] == "persona@sentrix.pe"
    assert store.list()["total"] == 1


def test_update_never_touches_role_or_status(store):
    _, profile = store.sync(identity(), 10)
    store.set_status(profile["id"], False)
    outcome, updated = store.sync(identity(email="nueva@sentrix.pe", role="admin"), 20)
    assert outcome == "updated" and updated["email"] == "nueva@sentrix.pe"
    assert updated["role"] == "operator" and updated["is_active"] is False


def test_concurrent_deliveries_do_not_duplicate(store):
    with ThreadPoolExecutor(8) as pool:
        outcomes = list(pool.map(lambda _: store.sync(identity(), 10)[0], range(8)))
    assert outcomes.count("created") == 1 and store.list()["total"] == 1


def test_email_of_another_active_profile_is_a_conflict(store):
    store.sync(identity(), 10)
    assert store.sync(identity("user_2"), 10) == ("conflict", None)
    store.sync(identity("user_3", "c@sentrix.pe"), 10)
    assert store.sync(identity("user_3", "persona@sentrix.pe"), 20)[0] == "conflict"


def test_deleted_profile_is_kept_and_can_be_reinvited(store):
    _, first = store.sync(identity(), 10)
    assert store.mark_deleted("user_1", 20)["is_active"] is False
    assert store.mark_deleted("user_1", 20) is None
    assert store.sync(identity(email="tarde@sentrix.pe"), 30)[0] == "stale"
    with pytest.raises(AccountDeletedError):
        store.set_status(first["id"], True)
    outcome, relinked = store.sync(identity("user_nuevo", role="admin"), 40)
    assert outcome == "created" and relinked["id"] == first["id"]
    assert relinked["clerk_user_id"] == "user_nuevo" and relinked["role"] == "admin" and relinked["is_active"] is True


def test_list_filters_and_paginates(store):
    for index in range(3):
        store.sync(identity(f"user_{index}", f"u{index}@sentrix.pe"), 10)
    store.sync(identity("user_a", "a@sentrix.pe", role="admin"), 10)
    store.sync(identity("user_i", "i@sentrix.pe", invited=False), 10)
    assert store.list(role="admin")["total"] == 1
    assert store.list(active=False)["total"] == 1
    assert store.list(active=True, role="operator", limit=2, offset=2)["total"] == 3
    assert len(store.list(active=True, role="operator", limit=2, offset=2)["items"]) == 1


def test_last_admin_is_protected_even_under_concurrency(store):
    _, first = store.sync(identity("user_1", "a@sentrix.pe", role="admin"), 10)
    _, second = store.sync(identity("user_2", "b@sentrix.pe", role="admin"), 10)
    with pytest.raises(LastAdminError):
        store.set_role(first["id"], "operator") and store.set_role(second["id"], "operator")
    store.set_role(first["id"], "admin")

    def demote(user_id):
        try:
            return store.set_status(user_id, False)
        except LastAdminError:
            return None
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(demote, [first["id"], second["id"]]))
    assert results.count(None) == 1
    assert store.list(role="admin", active=True)["total"] == 1


def test_missing_user_returns_none(store):
    assert store.set_role(str(uuid4()), "admin") is None
    assert store.set_status(str(uuid4()), False) is None
    assert store.get(str(uuid4())) is None


def test_promote_first_admin_is_idempotent_and_refuses_a_second(store):
    profile = store.promote_admin(identity("user_1", invited=False), 10)
    assert profile["role"] == "admin" and profile["is_active"] is True
    assert store.promote_admin(identity("user_1", invited=False), 10)["id"] == profile["id"]
    with pytest.raises(AdminExistsError):
        store.promote_admin(identity("user_2", "b@sentrix.pe", invited=False), 10)
    assert store.promote_admin(identity("user_2", "b@sentrix.pe", invited=False), 10, force=True)["role"] == "admin"


def test_repeated_webhook_through_the_service_does_not_duplicate(store):
    service = UserService(store, None, None)
    event = {"type": "user.created", "timestamp": 100, "data": clerk_user("user_w", "w@sentrix.pe", role="admin")}
    assert service.handle_webhook(event) == "processed"
    assert service.handle_webhook(event) == "processed"
    assert store.list()["total"] == 1
    assert store.get_by_clerk_id("user_w")["role"] == "admin"
    assert replace(identity_from_clerk(event["data"]), invited=False).clerk_user_id == "user_w"
