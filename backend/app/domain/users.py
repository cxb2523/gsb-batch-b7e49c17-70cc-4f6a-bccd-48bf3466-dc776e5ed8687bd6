"""Perfiles y roles del panel. Clerk guarda las contraseñas; aquí solo hay identidad y permisos."""
from dataclasses import dataclass

USER_ROLES = ("admin", "operator")


class LastAdminError(Exception):
    """El cambio dejaría al sistema sin ningún admin activo."""


class AdminExistsError(Exception):
    """Ya hay un admin activo y no se pidió crear otro."""


class AccountDeletedError(Exception):
    """La cuenta ya no existe en Clerk: no se puede reactivar."""


class EmailConflictError(Exception):
    """El correo pertenece a otro perfil vigente."""


@dataclass(frozen=True)
class Principal:
    """Quién hace la solicitud. `service` es la clave compartida, sin persona detrás."""
    role: str
    user_id: str | None = None
    service: bool = False


SERVICE = Principal(role="admin", service=True)


@dataclass(frozen=True)
class ClerkIdentity:
    clerk_user_id: str
    email: str
    display_name: str | None
    invited: bool
    invited_role: str


def _text(value):
    return value.strip() or None if isinstance(value, str) else None


def _mapping(value):
    return value if isinstance(value, dict) else {}


def identity_from_clerk(user: dict) -> ClerkIdentity | None:
    """Traduce un usuario de Clerk; None si no tiene id o correo principal válidos."""
    clerk_user_id = _text(user.get("id"))
    primary = user.get("primary_email_address_id")
    addresses = user.get("email_addresses") if isinstance(user.get("email_addresses"), list) else []
    email = next((_text(item.get("email_address")) for item in addresses
                  if isinstance(item, dict) and item.get("id") == primary), None)
    if not clerk_user_id or not email:
        return None
    # La marca de invitación solo la escribe FastAPI. Se puede editar a mano en el Dashboard de Clerk:
    # un formato inesperado cuenta como cuenta sin invitación, no como error.
    metadata = _mapping(_mapping(user.get("public_metadata")).get("sentrix"))
    role = metadata.get("role")
    names = " ".join(part for part in (_text(user.get("first_name")), _text(user.get("last_name"))) if part)
    return ClerkIdentity(clerk_user_id=clerk_user_id, email=email.lower(),
                         display_name=_text(metadata.get("display_name")) or names or None,
                         invited=metadata.get("invited") is True,
                         invited_role=role if role in USER_ROLES else "operator")
