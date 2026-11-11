"""Validación local de los tokens de sesión de Clerk."""
import jwt

from app.application.errors import Unauthorized, Unavailable

# Tolerancia para diferencias de reloj entre Clerk y el servidor.
LEEWAY_SECONDS = 5


def jwks_resolver(issuer):
    # Las claves conocidas quedan en caché: una caída breve de Clerk no bloquea sesiones vigentes.
    client = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True, timeout=5,
                             headers={"User-Agent": "sentrix-backend"})
    return lambda token: client.get_signing_key_from_jwt(token).key


class ClerkTokenVerifier:
    """Verifica firma, vigencia, emisor y `azp`. Clerk no incluye `aud` en sus tokens de sesión."""
    def __init__(self, issuer, authorized_parties, key_resolver=None):
        issuer = (issuer or "").strip().rstrip("/")
        parties = frozenset(party.strip().rstrip("/") for party in authorized_parties if party.strip())
        if not issuer.startswith("https://"):
            raise ValueError("CLERK_ISSUER debe ser la URL https de la instancia de Clerk")
        if not parties:
            raise ValueError("Configurar CLERK_AUTHORIZED_PARTIES con los orígenes del panel")
        self.issuer = issuer
        self.parties = parties
        self.key_resolver = key_resolver or jwks_resolver(issuer)

    def verify(self, token):
        try:
            key = self.key_resolver(token)
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=self.issuer, leeway=LEEWAY_SECONDS,
                                options={"require": ["exp", "nbf", "sub", "iss"], "verify_aud": False})
        except jwt.PyJWKClientConnectionError:
            raise Unavailable("Clerk no disponible") from None
        except jwt.PyJWTError:
            raise Unauthorized("Token inválido o vencido") from None
        if not claims.get("sub") or claims.get("azp") not in self.parties:
            raise Unauthorized("Token inválido o vencido")
        return claims
