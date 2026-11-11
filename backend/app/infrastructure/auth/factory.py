"""Arma el servicio de usuarios desde el entorno; solo se importa con autenticación Clerk."""
import os

from app.application.users import UserService
from app.infrastructure.auth.clerk_api import ClerkApi
from app.infrastructure.auth.tokens import ClerkTokenVerifier
from app.infrastructure.persistence.users import UserStore


def clerk_api_from_env():
    return ClerkApi(os.getenv("CLERK_SECRET_KEY", "").strip(),
                    os.getenv("CLERK_INVITATION_REDIRECT_URL", "").strip())


def user_service_from_env(database_url):
    verifier = ClerkTokenVerifier(os.getenv("CLERK_ISSUER", ""),
                                  os.getenv("CLERK_AUTHORIZED_PARTIES", "").split(","))
    return UserService(UserStore(database_url or ""), clerk_api_from_env(), verifier)
