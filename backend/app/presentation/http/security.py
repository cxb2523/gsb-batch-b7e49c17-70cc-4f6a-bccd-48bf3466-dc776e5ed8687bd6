"""Control de acceso: clave compartida entre servicios y sesiones de usuario de Clerk."""
import asyncio
import os
import secrets

from fastapi import Request
from fastapi.openapi.utils import get_openapi
from starlette.responses import JSONResponse

from app.application.errors import (ApplicationError, Conflict, Forbidden, InvalidInput, InvalidOffer,
                                    NotFound, Unauthorized, Unavailable)
from app.domain.users import SERVICE

STATUS = {InvalidInput: 422, InvalidOffer: 400, NotFound: 404, Conflict: 409, Unavailable: 503,
          Unauthorized: 401, Forbidden: 403}
# La clave no representa a una persona: nunca administra usuarios.
KEY_FORBIDDEN_PREFIXES = ("/auth/", "/users")


def error_status(error):
    return STATUS.get(type(error), 500)


def _header(scope, wanted):
    return next((value for name, value in scope["headers"] if name.lower() == wanted), b"")


def _valid_key(scope):
    expected = os.getenv("SENTRIX_CONTROL_API_KEY", "")
    provided = _header(scope, b"x-api-key")
    return bool(expected and provided and secrets.compare_digest(provided, expected.encode("utf-8")))


def _set_principal(scope, principal):
    scope.setdefault("state", {})["principal"] = principal


class ApiKeyGuard:
    PUBLIC_PATHS = {"/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or scope["path"] in self.PUBLIC_PATHS:
            return await self.app(scope, receive, send)
        if not _valid_key(scope):
            return await JSONResponse({"detail": "API key invalida"}, status_code=401)(scope, receive, send)
        _set_principal(scope, SERVICE)
        await self.app(scope, receive, send)


class ClerkGuard:
    """Toda ruta exige sesión salvo las públicas; una ruta olvidada queda cerrada, no abierta."""
    PUBLIC_PATHS = ApiKeyGuard.PUBLIC_PATHS | {"/webhooks/clerk"}  # El webhook se valida por su firma.

    def __init__(self, app, authenticate, allow_api_key=False):
        self.app = app
        self.authenticate = authenticate
        self.allow_api_key = allow_api_key

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or scope["path"] in self.PUBLIC_PATHS:
            return await self.app(scope, receive, send)
        authorization = _header(scope, b"authorization").decode("latin-1")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            try:
                principal = await asyncio.to_thread(self.authenticate, token.strip())
            except ApplicationError as error:
                return await JSONResponse({"detail": str(error)}, status_code=error_status(error))(scope, receive, send)
            except Exception:
                return await JSONResponse({"detail": "Autenticación no disponible"}, status_code=503)(scope, receive, send)
        elif self.allow_api_key and _valid_key(scope) and not scope["path"].startswith(KEY_FORBIDDEN_PREFIXES):
            principal = SERVICE
        else:
            return await JSONResponse({"detail": "Sesión requerida"}, status_code=401)(scope, receive, send)
        _set_principal(scope, principal)
        await self.app(scope, receive, send)


def current_principal(request: Request):
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise Unauthorized("Sesión requerida")
    return principal


def is_admin(request: Request):
    return current_principal(request).role == "admin"


def require_admin(request: Request):
    if not is_admin(request):
        raise Forbidden("Requiere rol admin")


def document_api_key(app, mode="api_key"):
    """Permitir usar Authorize en Swagger para las rutas protegidas."""
    schemes = {}
    if mode in ("api_key", "both"):
        schemes["ControlApiKey"] = {"type": "apiKey", "in": "header", "name": "X-API-Key"}
    if mode in ("both", "clerk"):
        schemes["ClerkSession"] = {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}

    def openapi():
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
        schema.setdefault("components", {}).setdefault("securitySchemes", {}).update(schemes)
        for path, operations in schema["paths"].items():
            if path in ClerkGuard.PUBLIC_PATHS:
                continue
            for operation in operations.values():
                if isinstance(operation, dict) and "responses" in operation:
                    operation["security"] = [{name: []} for name in schemes]
        app.openapi_schema = schema
        return schema
    app.openapi = openapi
