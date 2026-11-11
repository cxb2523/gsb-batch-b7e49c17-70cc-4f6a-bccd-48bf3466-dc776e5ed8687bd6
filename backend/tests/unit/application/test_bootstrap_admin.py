"""Comando que crea el primer admin."""
from app.tools.bootstrap_admin import run as bootstrap_admin
from tests.support.users import FakeClerk, FakeUserStore, clerk_user


def test_bootstrap_admin_flow():
    store, clerk = FakeUserStore(), FakeClerk()
    assert bootstrap_admin("a@sentrix.pe", store, clerk)[0] == 1
    clerk.users["user_1"] = clerk_user("user_1", "a@sentrix.pe", invited=False)
    code, message = bootstrap_admin("A@sentrix.pe", store, clerk)
    assert code == 0 and "a@sentrix.pe" not in message
    assert store.get_by_clerk_id("user_1")["role"] == "admin"
    assert bootstrap_admin("a@sentrix.pe", store, clerk)[0] == 0
    clerk.users["user_2"] = clerk_user("user_2", "b@sentrix.pe", invited=False)
    assert bootstrap_admin("b@sentrix.pe", store, clerk)[0] == 1
    assert bootstrap_admin("b@sentrix.pe", store, clerk, force=True)[0] == 0
