"""Perfiles de usuario en PostgreSQL. La tabla la crea la migración, no el arranque."""
from dataclasses import replace

import psycopg

from app.domain.users import AccountDeletedError, AdminExistsError, EmailConflictError, LastAdminError
from app.infrastructure.persistence.database import connect

# Serializa los cambios que pueden dejar al sistema sin admin.
ADMIN_LOCK = 734821907


def _profile(row):
    return {"id": str(row["id"]), "clerk_user_id": row["clerk_user_id"], "email": row["email"],
            "display_name": row["display_name"], "role": row["role"], "is_active": row["is_active"],
            "deleted": row["deleted_at"] is not None}


def _bool(value):
    # PostgresConnection convierte los bool a int y PostgreSQL no los acepta en columnas BOOLEAN.
    return "TRUE" if value else "FALSE"


class UserStore:
    def __init__(self, url):
        url = str(url)
        if not url.startswith(("postgresql://", "postgres://")):
            raise ValueError("La autenticación con Clerk requiere SENTRIX_DATABASE_URL (PostgreSQL)")
        self.url = url

    def _run(self, operation):
        connection = connect(self.url)
        try:
            with connection:
                return operation(connection)
        finally:
            connection.close()

    def check(self):
        """Falla si la migración de usuarios no se aplicó."""
        try:
            self._run(lambda c: c.execute("SELECT 1 FROM users LIMIT 1").fetchone())
        except psycopg.errors.UndefinedTable:
            raise RuntimeError("Falta la tabla users: aplicar backend/migrations/2026-11-08_usuarios.sql") from None

    def _one(self, column, value):
        cast = "::uuid" if column == "id" else ""
        row = self._run(lambda c: c.execute(f"SELECT * FROM users WHERE {column} = ?{cast}", (value,)).fetchone())
        return _profile(row) if row else None

    def get(self, user_id):
        return self._one("id", user_id)

    def get_by_clerk_id(self, clerk_user_id):
        return self._one("clerk_user_id", clerk_user_id)

    def find_by_email(self, email):
        return self._one("email", email.strip().lower())

    def list(self, *, limit=20, offset=0, role=None, active=None):
        clauses, values = [], []
        if role is not None:
            clauses.append("role = ?")
            values.append(role)
        if active is not None:
            clauses.append("is_active = ?::boolean")
            values.append("true" if active else "false")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""

        def query(c):
            total = c.execute("SELECT COUNT(*) AS total FROM users" + where, values).fetchone()["total"]
            rows = c.execute("SELECT * FROM users" + where + " ORDER BY created_at, id LIMIT ? OFFSET ?",
                             (*values, limit, offset)).fetchall()
            return {"items": [_profile(row) for row in rows], "total": total, "limit": limit, "offset": offset}
        return self._run(query)

    @staticmethod
    def _sync(c, identity, event_at):
        """Aplica un usuario de Clerk. Devuelve (created|updated|stale|conflict, perfil) o (None, None) si hay carrera."""
        row = c.execute("SELECT * FROM users WHERE clerk_user_id = ? FOR UPDATE", (identity.clerk_user_id,)).fetchone()
        if row is not None:
            if row["deleted_at"] is not None or event_at <= row["clerk_event_at"]:
                return "stale", _profile(row)
            taken = c.execute("SELECT 1 FROM users WHERE email = ? AND id <> ?::uuid",
                              (identity.email, str(row["id"]))).fetchone()
            if taken:
                return "conflict", _profile(row)
            # Rol y estado no se tocan: después de crear el perfil, manda Neon.
            updated = c.execute("""UPDATE users SET email = ?, display_name = COALESCE(?, display_name),
                clerk_event_at = ?, updated_at = now() WHERE id = ?::uuid RETURNING *""",
                (identity.email, identity.display_name, event_at, str(row["id"]))).fetchone()
            return "updated", _profile(updated)
        previous = c.execute("SELECT * FROM users WHERE email = ? FOR UPDATE", (identity.email,)).fetchone()
        if previous is not None:
            if previous["deleted_at"] is None:
                return "conflict", None
            relinked = c.execute(f"""UPDATE users SET clerk_user_id = ?, display_name = ?, role = ?,
                is_active = {_bool(identity.invited)}, deleted_at = NULL, clerk_event_at = ?, updated_at = now()
                WHERE id = ?::uuid RETURNING *""", (identity.clerk_user_id, identity.display_name,
                identity.invited_role, event_at, str(previous["id"]))).fetchone()
            return "created", _profile(relinked)
        inserted = c.execute(f"""INSERT INTO users (clerk_user_id, email, display_name, role, is_active, clerk_event_at)
            VALUES (?, ?, ?, ?, {_bool(identity.invited)}, ?) ON CONFLICT DO NOTHING RETURNING *""",
            (identity.clerk_user_id, identity.email, identity.display_name, identity.invited_role,
             event_at)).fetchone()
        return ("created", _profile(inserted)) if inserted else (None, None)

    def sync(self, identity, event_at):
        """Idempotente por clerk_user_id; dos entregas simultáneas no duplican el perfil."""
        for _ in range(3):
            try:
                outcome, profile = self._run(lambda c: self._sync(c, identity, event_at))
            except psycopg.errors.UniqueViolation:
                continue
            if outcome is not None:
                return outcome, profile
        return "conflict", None

    def mark_deleted(self, clerk_user_id, event_at):
        row = self._run(lambda c: c.execute("""UPDATE users SET is_active = FALSE, deleted_at = now(),
            clerk_event_at = GREATEST(clerk_event_at, ?::bigint), updated_at = now()
            WHERE clerk_user_id = ? AND deleted_at IS NULL RETURNING *""", (event_at, clerk_user_id)).fetchone())
        return _profile(row) if row else None

    def _change(self, user_id, *, role=None, active=None):
        def operation(c):
            c.execute(f"SELECT pg_advisory_xact_lock({ADMIN_LOCK})")
            row = c.execute("SELECT * FROM users WHERE id = ?::uuid FOR UPDATE", (user_id,)).fetchone()
            if row is None:
                return None
            if active and row["deleted_at"] is not None:
                raise AccountDeletedError()
            new_role = role or row["role"]
            new_active = row["is_active"] if active is None else active
            if row["role"] == "admin" and row["is_active"] and (new_role != "admin" or not new_active):
                others = c.execute("""SELECT COUNT(*) AS total FROM users
                    WHERE role = 'admin' AND is_active AND id <> ?::uuid""", (user_id,)).fetchone()["total"]
                if others == 0:
                    raise LastAdminError()
            updated = c.execute(f"""UPDATE users SET role = ?, is_active = {_bool(new_active)}, updated_at = now()
                WHERE id = ?::uuid RETURNING *""", (new_role, user_id)).fetchone()
            return _profile(updated)
        return self._run(operation)

    def set_role(self, user_id, role):
        return self._change(user_id, role=role)

    def set_status(self, user_id, active):
        return self._change(user_id, active=active)

    def promote_admin(self, identity, event_at, *, force=False):
        """Primer admin. Idempotente para la misma cuenta; se niega si ya hay otro, salvo `force`."""
        def operation(c):
            c.execute(f"SELECT pg_advisory_xact_lock({ADMIN_LOCK})")
            others = c.execute("""SELECT COUNT(*) AS total FROM users
                WHERE role = 'admin' AND is_active AND clerk_user_id <> ?""",
                (identity.clerk_user_id,)).fetchone()["total"]
            if others and not force:
                raise AdminExistsError()
            outcome, _ = self._sync(c, replace(identity, invited=True, invited_role="admin"), event_at)
            if outcome in (None, "conflict"):
                raise EmailConflictError()
            row = c.execute("""UPDATE users SET role = 'admin', is_active = TRUE, deleted_at = NULL, updated_at = now()
                WHERE clerk_user_id = ? RETURNING *""", (identity.clerk_user_id,)).fetchone()
            return _profile(row)
        return self._run(operation)
