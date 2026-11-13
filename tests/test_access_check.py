"""Tests for ProjectAuth.check_database_access and the admin access-check endpoint.

All tests build their own project configuration in a temporary data
directory (via the project_auth / shared_storage fixtures) — no real
credentials or external state are involved.
"""


class TestCheckDatabaseAccess:
    """Unit-level tests for ProjectAuth.check_database_access()."""

    def test_correct_password(self, project_auth):
        project_auth.set_database_password("proj", "db1", "secret", "read")
        result = project_auth.check_database_access("proj", "db1", "secret", "read")
        assert result["allowed"] is True
        assert result["reason"] == "password_ok"
        assert result["has_password"] is True
        assert result["write_protected"] is False

    def test_read_only(self, project_auth):
        project_auth.set_database_password("proj", "db1", "secret", "read")
        project_auth.set_database_password("proj", "db1", "writesecret", "write")
        project_auth.set_database_write_protected("proj", "db1", True)

        # Read with a correct password stays allowed, but the reason must
        # surface the read-only flag.
        read = project_auth.check_database_access("proj", "db1", "secret", "read")
        assert read["allowed"] is True
        assert read["reason"] == "read_only"
        assert read["write_protected"] is True

        # Write with a correct write password is denied by the flag.
        write = project_auth.check_database_access("proj", "db1", "writesecret", "write")
        assert write["allowed"] is False
        assert write["reason"] == "read_only"
        assert write["write_protected"] is True

    def test_wrong_password(self, project_auth):
        project_auth.set_database_password("proj", "db1", "secret", "read")
        result = project_auth.check_database_access("proj", "db1", "nope", "read")
        assert result["allowed"] is False
        assert result["reason"] == "invalid_password"
        assert result["has_password"] is True

    def test_open_access_no_password(self, project_auth):
        result = project_auth.check_database_access("proj", "db1", "", "read")
        assert result["allowed"] is True
        assert result["reason"] == "open_access"
        assert result["has_password"] is False
        assert result["write_protected"] is False

        # Open access applies to writes as well.
        write = project_auth.check_database_access("proj", "db1", "", "write")
        assert write["allowed"] is True
        assert write["reason"] == "open_access"

    def test_write_password_only(self, project_auth):
        project_auth.set_database_password("proj", "db1", "writesecret", "write")

        # Read without a password is denied — only a write password exists.
        denied = project_auth.check_database_access("proj", "db1", "", "read")
        assert denied["allowed"] is False
        assert denied["reason"] == "password_required"
        assert denied["has_password"] is True

        # A wrong password is denied too.
        wrong = project_auth.check_database_access("proj", "db1", "bad", "read")
        assert wrong["allowed"] is False
        assert wrong["reason"] == "invalid_password"

        # The write password implicitly grants read access.
        granted = project_auth.check_database_access("proj", "db1", "writesecret", "read")
        assert granted["allowed"] is True
        assert granted["reason"] == "write_grants_read"


class TestAccessCheckEndpoint:
    """Tests for GET /admin/projects/{p}/databases/{db}/access-check."""

    def _auth_header(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _setup_db(self, shared_storage, tmp_data, project="proj", database="db1"):
        shared_storage.create_project(project)
        shared_storage.create_database(project, database)

    def test_check_correct_password(
        self, fastapi_client, auth_token, shared_storage, tmp_data
    ):
        from webduck.auth.manager import ProjectAuth

        self._setup_db(shared_storage, tmp_data)
        ProjectAuth(tmp_data).set_database_password("proj", "db1", "secret", "read")

        resp = fastapi_client.get(
            "/admin/projects/proj/databases/db1/access-check",
            params={"password": "secret", "access_level": "read"},
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allowed"] is True
        assert data["reason"] == "password_ok"
        assert data["has_password"] is True
        assert data["write_protected"] is False

    def test_check_read_only(self, fastapi_client, auth_token, shared_storage, tmp_data):
        from webduck.auth.manager import ProjectAuth

        self._setup_db(shared_storage, tmp_data)
        auth = ProjectAuth(tmp_data)
        auth.set_database_password("proj", "db1", "writesecret", "write")
        auth.set_database_write_protected("proj", "db1", True)

        resp = fastapi_client.get(
            "/admin/projects/proj/databases/db1/access-check",
            params={"password": "writesecret", "access_level": "write"},
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allowed"] is False
        assert data["reason"] == "read_only"
        assert data["write_protected"] is True

    def test_check_wrong_password(
        self, fastapi_client, auth_token, shared_storage, tmp_data
    ):
        from webduck.auth.manager import ProjectAuth

        self._setup_db(shared_storage, tmp_data)
        ProjectAuth(tmp_data).set_database_password("proj", "db1", "secret", "read")

        resp = fastapi_client.get(
            "/admin/projects/proj/databases/db1/access-check",
            params={"password": "wrong"},
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allowed"] is False
        assert data["reason"] == "invalid_password"

    def test_check_open_access(self, fastapi_client, auth_token, shared_storage, tmp_data):
        self._setup_db(shared_storage, tmp_data)

        resp = fastapi_client.get(
            "/admin/projects/proj/databases/db1/access-check",
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allowed"] is True
        assert data["reason"] == "open_access"
        assert data["has_password"] is False

    def test_check_write_password_only(
        self, fastapi_client, auth_token, shared_storage, tmp_data
    ):
        from webduck.auth.manager import ProjectAuth

        self._setup_db(shared_storage, tmp_data)
        ProjectAuth(tmp_data).set_database_password("proj", "db1", "writesecret", "write")

        resp = fastapi_client.get(
            "/admin/projects/proj/databases/db1/access-check",
            params={"password": "writesecret", "access_level": "read"},
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allowed"] is True
        assert data["reason"] == "write_grants_read"

    def test_project_not_found(self, fastapi_client, auth_token):
        resp = fastapi_client.get(
            "/admin/projects/ghost/databases/db1/access-check",
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Project not found"

    def test_database_not_found(self, fastapi_client, auth_token, shared_storage):
        shared_storage.create_project("proj")
        resp = fastapi_client.get(
            "/admin/projects/proj/databases/ghost/access-check",
            headers=self._auth_header(auth_token),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Database not found"

    def test_unauthorized(self, fastapi_client):
        resp = fastapi_client.get("/admin/projects/proj/databases/db1/access-check")
        assert resp.status_code in (401, 403)
