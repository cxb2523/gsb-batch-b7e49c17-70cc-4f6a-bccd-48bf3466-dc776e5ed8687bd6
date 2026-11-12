from unittest.mock import patch

import pytest

from server.core.executor import CommandResult
from server.services import users as users_service


@pytest.mark.asyncio
async def test_get_users_and_legacy_alias(auth_client):
    res1 = await auth_client.get("/api/users")
    assert res1.status_code == 200
    data1 = res1.json()
    assert "human_users" in data1
    assert "metrics" in data1

    res2 = await auth_client.get("/api/device/users")
    assert res2.status_code == 200
    data2 = res2.json()
    assert "human_users" in data2
    assert "metrics" in data2


@pytest.mark.asyncio
async def test_ssh_keys_crud(auth_client, regular_session):
    with patch("server.api.users.get_user_ssh_keys", return_value=["ssh-ed25519 AAAAC3Nza mock@key"]):
        res1 = await auth_client.get(f"/api/users/{regular_session.username}/ssh-keys")
        assert res1.status_code == 200
        assert len(res1.json()["keys"]) == 1

        res2 = await auth_client.get(f"/api/device/users/{regular_session.username}/ssh-keys")
        assert res2.status_code == 200
        assert len(res2.json()["keys"]) == 1


@pytest.mark.asyncio
async def test_session_terminate_admin_gate(auth_client, admin_client):
    res_forbidden = await auth_client.post("/api/users/session/terminate", json={"tty": "pts/2"})
    assert res_forbidden.status_code == 403

    with patch("server.api.users.run_sudo_async", return_value=(0, "", "")):
        res_ok = await admin_client.post("/api/users/session/terminate", json={"tty": "pts/2"})
        assert res_ok.status_code == 200
        assert res_ok.json()["success"] is True


@pytest.mark.asyncio
async def test_change_password(auth_client, regular_session, mock_executor):
    mock_executor.set_default(CommandResult(0, "", ""))
    res = await auth_client.post(
        f"/api/users/{regular_session.username}/password",
        json={"new_password": "brand_new_secret_pwd"},
    )
    assert res.status_code == 200
    assert res.json()["success"] is True


@pytest.mark.asyncio
async def test_update_user_groups(admin_client, monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr(
        "server.api.users.parse_all_passwd_users",
        lambda: [{"name": "alice", "is_human": True}],
    )
    monkeypatch.setattr(
        "server.api.users.parse_groups",
        lambda: [{"name": "wheel", "gid": 10, "members": []}],
    )
    monkeypatch.setattr(
        "server.api.users.get_user_groups",
        lambda username: ["wheel"],
    )
    monkeypatch.setattr(
        "server.api.users.run_sudo_async",
        AsyncMock(return_value=(0, "", "")),
    )

    res = await admin_client.post(
        "/api/users/alice/groups",
        json={"groups": ["wheel"]},
    )
    assert res.status_code == 200
    assert res.json()["success"] is True


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_success(auth_client, regular_session, tmp_path):
    """Content-based deletion removes the matching key, including option-prefixed ones."""
    option_key = 'command="/usr/bin/backup",no-pty ssh-ed25519 AAAAC3backupKey backup@server'
    plain_key = "ssh-rsa AAAAB3NzaC1yc2E standard@server"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"{option_key}\n{plain_key}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await auth_client.post(
            f"/api/users/{regular_session.username}/ssh-keys/delete",
            json={"key": "ssh-ed25519 AAAAC3backupKey"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "removed" in body["message"]

    remaining = key_file.read_text(encoding="utf-8").splitlines()
    assert remaining == [plain_key]


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_legacy_alias(auth_client, regular_session, tmp_path):
    """The legacy /api/device alias exposes the same content-based delete route."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"{key_line}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await auth_client.post(
            f"/api/device/users/{regular_session.username}/ssh-keys/delete",
            json={"key": key_line},
        )

    assert res.status_code == 200
    assert res.json()["success"] is True
    assert key_file.read_text(encoding="utf-8") == ""


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_bare_type_rejected(auth_client, regular_session, tmp_path):
    """A bare key type without base64 data returns 400 and leaves the file untouched."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"{key_line}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await auth_client.post(
            f"/api/users/{regular_session.username}/ssh-keys/delete",
            json={"key": "ssh-ed25519"},
        )

    assert res.status_code == 400
    assert key_file.read_text(encoding="utf-8") == f"{key_line}\n"


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_missing_key_returns_400(auth_client, regular_session):
    """An empty or missing key payload is rejected with 400 before touching the service."""
    res = await auth_client.post(
        f"/api/users/{regular_session.username}/ssh-keys/delete",
        json={},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_no_match_returns_400(auth_client, regular_session, tmp_path):
    """Content present in no key returns 400 without modifying the file."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"{key_line}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await auth_client.post(
            f"/api/users/{regular_session.username}/ssh-keys/delete",
            json={"key": "ssh-ed25519 AAAAC3DoesNotExist ghost@nowhere"},
        )

    assert res.status_code == 400
    assert key_file.read_text(encoding="utf-8") == f"{key_line}\n"


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_forbidden_for_other_user(auth_client):
    """A non-elevated caller cannot delete another user's keys; the service is never reached."""
    with patch.object(users_service, "delete_user_ssh_key") as mock_delete:
        res = await auth_client.post(
            "/api/users/someoneelse/ssh-keys/delete",
            json={"key": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"},
        )

    assert res.status_code == 403
    mock_delete.assert_not_called()


@pytest.mark.asyncio
async def test_delete_ssh_key_by_content_elevated_admin_allowed(admin_client, tmp_path):
    """An elevated admin may delete another user's key by content."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"{key_line}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await admin_client.post(
            "/api/users/someoneelse/ssh-keys/delete",
            json={"key": key_line},
        )

    assert res.status_code == 200
    assert res.json()["success"] is True
    assert key_file.read_text(encoding="utf-8") == ""


@pytest.mark.asyncio
async def test_delete_ssh_key_by_line_number_success(auth_client, regular_session, tmp_path):
    """Line-number deletion removes the key at the real line number, not its array position."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    other_line = "ssh-rsa AAAAB3NzaC1yc2E other@host"
    # Key sits on line 2 because of the leading comment and blank line
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(f"# administrative note\n\n{key_line}\n{other_line}\n", encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        res = await auth_client.delete(
            f"/api/users/{regular_session.username}/ssh-keys/2",
        )

    assert res.status_code == 200
    assert res.json()["success"] is True
    assert key_line not in key_file.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_delete_ssh_key_by_line_number_rejects_comment_and_out_of_range(
    auth_client, regular_session, tmp_path
):
    """Line numbers pointing at comment lines or beyond EOF return 400 without modifying the file."""
    key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG mock@test"
    original = f"# administrative note\n{key_line}\n"
    key_file = tmp_path / "authorized_keys"
    key_file.write_text(original, encoding="utf-8")

    with patch.object(users_service, "get_user_ssh_path", return_value=str(key_file)):
        # Line 0 is a comment, not a parsed key
        comment_res = await auth_client.delete(
            f"/api/users/{regular_session.username}/ssh-keys/0",
        )
        assert comment_res.status_code == 400

        # Line 99 is beyond end of file
        range_res = await auth_client.delete(
            f"/api/users/{regular_session.username}/ssh-keys/99",
        )
        assert range_res.status_code == 400

    assert key_file.read_text(encoding="utf-8") == original


@pytest.mark.asyncio
async def test_delete_ssh_key_by_line_number_forbidden_for_other_user(auth_client):
    """The line-number route enforces the same self/elevated-admin gate (403)."""
    with patch.object(users_service, "delete_user_ssh_key") as mock_delete:
        res = await auth_client.delete("/api/users/someoneelse/ssh-keys/0")

    assert res.status_code == 403
    mock_delete.assert_not_called()
