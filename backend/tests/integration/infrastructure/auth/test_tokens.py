"""Validación de tokens de sesión con claves locales, sin llamar a Clerk."""
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.application.errors import Unauthorized, Unavailable
from app.infrastructure.auth.tokens import ClerkTokenVerifier
from tests.support.users import ISSUER, ORIGIN, PUBLIC_KEY, make_token


@pytest.fixture
def verifier():
    return ClerkTokenVerifier(ISSUER, [ORIGIN], key_resolver=lambda token: PUBLIC_KEY)


def test_accepts_a_valid_token_without_aud(verifier):
    assert verifier.verify(make_token("user_9"))["sub"] == "user_9"


@pytest.mark.parametrize("token", [
    make_token(expires_in=-60),
    make_token(issuer="https://otra.clerk.accounts.dev"),
    make_token(azp="https://sitio-ajeno.example"),
    make_token(azp=None),
    make_token(key=rsa.generate_private_key(public_exponent=65537, key_size=2048)),
    make_token(sub=""),
    "no-es-un-token",
], ids=["vencido", "emisor", "azp-ajeno", "sin-azp", "firma", "sin-sub", "basura"])
def test_rejects_invalid_tokens(verifier, token):
    with pytest.raises(Unauthorized):
        verifier.verify(token)


def test_rejects_tokens_that_do_not_use_rs256(verifier):
    forged = jwt.encode({"sub": "x", "iss": ISSUER, "azp": ORIGIN, "exp": 9999999999, "nbf": 0}, "secreto-largo-de-prueba-para-hs256-x", algorithm="HS256")
    with pytest.raises(Unauthorized):
        verifier.verify(forged)


def test_unreachable_jwks_is_unavailable_not_unauthorized():
    def unreachable(token):
        raise jwt.PyJWKClientConnectionError("sin red")
    with pytest.raises(Unavailable):
        ClerkTokenVerifier(ISSUER, [ORIGIN], key_resolver=unreachable).verify(make_token())


@pytest.mark.parametrize("issuer,parties", [("", [ORIGIN]), ("http://inseguro.example", [ORIGIN]), (ISSUER, [""])])
def test_requires_explicit_configuration(issuer, parties):
    with pytest.raises(ValueError):
        ClerkTokenVerifier(issuer, parties, key_resolver=lambda token: PUBLIC_KEY)
