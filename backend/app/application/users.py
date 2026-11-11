"""Sesiones, perfiles, invitaciones y sincronización con Clerk, sin HTTP ni SQL."""
from app.application.errors import ApplicationError, Conflict, Forbidden, NotFound, Unavailable
from app.domain.users import (AccountDeletedError, LastAdminError, Principal, identity_from_clerk)

PUBLIC_FIELDS = ("id", "clerk_user_id", "email", "display_name", "role", "is_active")


def public_profile(profile):
    return {field: profile[field] for field in PUBLIC_FIELDS}


class UserService:
    def __init__(self, store, clerk, verifier, log=None):
        self.store = store
        self.clerk = clerk
        self.verifier = verifier
        self.log = log

    def _storage(self, method, *args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (ApplicationError, LastAdminError, AccountDeletedError):
            raise
        except Exception:
            raise Unavailable("Registro de usuarios no disponible") from None

    def _audit(self, event_type, message, level="INFO"):
        # Solo identificadores internos: estos eventos se ven en /inference-logs.
        if self.log is not None:
            self.log.emit(event_type, message, level=level)

    def check_storage(self):
        self.store.check()

    # --- Sesión ------------------------------------------------------------
    def authenticate(self, token) -> Principal:
        claims = self.verifier.verify(token)
        profile = self._storage(self.store.get_by_clerk_id, claims["sub"])
        if profile is None:
            profile = self._provision(claims["sub"])
        if profile is None:
            raise Forbidden("Usuario sin perfil")
        if not profile["is_active"]:
            raise Forbidden("Usuario inactivo")
        return Principal(role=profile["role"], user_id=profile["id"])

    def _provision(self, clerk_user_id):
        # El webhook puede llegar minutos después si la API estaba dormida; el resultado es el mismo.
        user = self.clerk.get_user(clerk_user_id)
        identity = identity_from_clerk(user) if user else None
        if identity is None:
            return None
        event_at = user.get("updated_at") if isinstance(user.get("updated_at"), int) else 0
        outcome, profile = self._storage(self.store.sync, identity, event_at)
        self._report_sync(outcome, profile)
        return profile if outcome != "conflict" else None

    def _report_sync(self, outcome, profile):
        if outcome == "created":
            state = "activo" if profile["is_active"] else "inactivo, sin invitación"
            self._audit("user_provisioned", f"Perfil {profile['id']} creado ({profile['role']}, {state})")
        elif outcome == "conflict":
            self._audit("user_sync_conflict", "Evento de Clerk con un correo que ya usa otro perfil", level="WARNING")

    # --- Perfiles ----------------------------------------------------------
    def me(self, principal):
        profile = self._storage(self.store.get, principal.user_id)
        if profile is None:
            raise NotFound("Usuario no encontrado")
        return public_profile(profile)

    def list_users(self, *, limit, offset, role=None, active=None):
        page = self._storage(self.store.list, limit=limit, offset=offset, role=role, active=active)
        return {**page, "items": [public_profile(item) for item in page["items"]]}

    def _apply_change(self, method, user_id, value):
        try:
            profile = self._storage(method, user_id, value)
        except LastAdminError:
            raise Conflict("No se puede dejar el sistema sin un admin activo") from None
        except AccountDeletedError:
            raise Conflict("La cuenta fue eliminada en Clerk; hay que invitarla de nuevo") from None
        if profile is None:
            raise NotFound("Usuario no encontrado")
        return profile

    def set_role(self, actor, user_id, role):
        profile = self._apply_change(self.store.set_role, user_id, role)
        self._audit("user_role_changed", f"Perfil {user_id}: rol {role}, por {actor.user_id}")
        return public_profile(profile)

    def set_status(self, actor, user_id, is_active):
        profile = self._apply_change(self.store.set_status, user_id, is_active)
        self._audit("user_status_changed", f"Perfil {user_id}: {'activo' if is_active else 'inactivo'}, por {actor.user_id}")
        return public_profile(profile)

    def invite(self, actor, email, display_name, role):
        email = email.strip().lower()
        existing = self._storage(self.store.find_by_email, email)
        if existing is not None and not existing["deleted"]:
            raise Conflict("Ya existe una cuenta con ese correo")
        invitation_id = self.clerk.create_invitation(email, display_name, role)
        self._audit("user_invited", f"Invitación {invitation_id} con rol {role}, por {actor.user_id}")
        return {"invitation_id": invitation_id, "email": email, "role": role, "status": "pending"}

    # --- Webhook -----------------------------------------------------------
    def handle_webhook(self, event):
        kind = event.get("type") if isinstance(event, dict) else None
        if kind not in ("user.created", "user.updated", "user.deleted"):
            return "ignored"
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        event_at = event.get("timestamp") if isinstance(event.get("timestamp"), int) else 0
        if kind == "user.deleted":
            if not isinstance(data.get("id"), str) or not data["id"]:
                return "ignored"
            profile = self._storage(self.store.mark_deleted, data["id"], event_at)
            if profile is not None:
                self._audit("user_deleted", f"Perfil {profile['id']} desactivado: cuenta eliminada en Clerk")
            return "processed"
        identity = identity_from_clerk(data)
        if identity is None:
            # Reintentar no lo arreglaría: se responde 200 y queda registrado.
            self._audit("user_sync_conflict", "Evento de Clerk sin id o sin correo principal", level="WARNING")
            return "ignored"
        outcome, profile = self._storage(self.store.sync, identity, event_at)
        self._report_sync(outcome, profile)
        return "ignored" if outcome == "conflict" else "processed"
