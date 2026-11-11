"""Crea el primer admin a partir de una cuenta ya creada en Clerk.

Uso, desde backend/: python -m app.tools.bootstrap_admin --email persona@dominio.com
Lee SENTRIX_DATABASE_URL y CLERK_SECRET_KEY de backend/.env. Escribe en la base indicada.
"""
import argparse
import os
import sys
from pathlib import Path

from app.application.errors import ApplicationError
from app.domain.users import AdminExistsError, EmailConflictError, identity_from_clerk


def run(email, store, clerk, *, force=False):
    """Devuelve (código de salida, mensaje) sin mostrar el correo ni credenciales."""
    try:
        user = clerk.find_user_by_email(email.strip().lower())
    except ApplicationError as error:
        return 1, str(error)
    if user is None:
        return 1, "No existe una cuenta con ese correo en Clerk. Créala primero en el Dashboard."
    identity = identity_from_clerk(user)
    if identity is None:
        return 1, "La cuenta de Clerk no tiene correo principal."
    event_at = user.get("updated_at") if isinstance(user.get("updated_at"), int) else 0
    try:
        profile = store.promote_admin(identity, event_at, force=force)
    except AdminExistsError:
        return 1, "Ya hay un admin activo. Usa --force solo si perdiste el acceso a esa cuenta."
    except EmailConflictError:
        return 1, "Ese correo ya pertenece a otro perfil vigente."
    return 0, f"Admin listo: perfil {profile['id']}"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Crea el primer admin de SentriX")
    parser.add_argument("--email", required=True)
    parser.add_argument("--force", action="store_true", help="Crear otro admin aunque ya exista uno")
    args = parser.parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    from app.infrastructure.auth.factory import clerk_api_from_env
    from app.infrastructure.persistence.users import UserStore
    code, message = run(args.email, UserStore(os.getenv("SENTRIX_DATABASE_URL", "")), clerk_api_from_env(), force=args.force)
    print(message, file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
