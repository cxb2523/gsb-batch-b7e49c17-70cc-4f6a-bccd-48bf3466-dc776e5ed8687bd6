"""
Optional token authentication for the Crows Nest.

Off by default: on a laptop the server binds to localhost and a password would be
friction with no benefit. Set CROWSNEST_AUTH_TOKEN and every request must present
it -- which is what makes the Crows Nest safe to put on a VM, the deployment the
README points at.

Two ways to present it, so both a browser and a script work without the frontend
needing to know anything about auth:

    Authorization: Bearer <token>           scripts, curl, fetch()
    Authorization: Basic  <base64 u:token>  browsers, via the native prompt

The Basic form is why a 401 carries WWW-Authenticate: the browser then asks for
credentials itself and repeats them on every subsequent request, including the
XHRs the dashboard makes. Any username is accepted; the password is the token.
"""

import base64
import binascii
import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# Left open so a reverse proxy or uptime check can see the server is alive
# without holding the token.
_PUBLIC_PATHS = frozenset({"/api/health"})


def get_auth_token() -> str | None:
    """The configured token, or None when auth is disabled."""
    return os.environ.get("CROWSNEST_AUTH_TOKEN") or None


def _presented_token(header: str | None) -> str | None:
    """Pull a token out of an Authorization header, whichever scheme was used."""
    if not header:
        return None

    scheme, _, value = header.partition(" ")
    value = value.strip()
    if not value:
        return None

    scheme = scheme.lower()
    if scheme == "bearer":
        return value
    if scheme == "basic":
        try:
            decoded = base64.b64decode(value, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            return None
        _, sep, password = decoded.partition(":")
        return password if sep else None
    return None


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """Require the configured token on every request, when one is configured."""

    async def dispatch(self, request, call_next):
        expected = get_auth_token()
        if expected is None or request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        presented = _presented_token(request.headers.get("authorization"))
        # compare_digest rather than == so a wrong token cannot be recovered by
        # timing how long the comparison took.
        if presented is not None and hmac.compare_digest(presented, expected):
            return await call_next(request)

        return JSONResponse(
            {"detail": "Missing or invalid credentials."},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Crows Nest"'},
        )
