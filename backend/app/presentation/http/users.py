"""Perfil de la sesión, gestión de usuarios y webhook de Clerk."""
import asyncio
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.presentation.http.security import current_principal, require_admin

UserRole = Literal["admin", "operator"]


class InvitationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    display_name: str = Field(min_length=1, max_length=120)
    role: UserRole


class RoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: UserRole


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: StrictBool


def auth_router(service):
    router = APIRouter(prefix="/auth", tags=["Autenticación"])

    @router.get("/me")
    def me(request: Request):
        return service.me(current_principal(request))

    @router.post("/invitations", status_code=201, dependencies=[Depends(require_admin)])
    def invite(body: InvitationRequest, request: Request):
        return service.invite(current_principal(request), body.email, body.display_name, body.role)

    return router


def users_router(service):
    router = APIRouter(prefix="/users", tags=["Usuarios"], dependencies=[Depends(require_admin)])

    @router.get("")
    def list_users(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                   role: UserRole | None = None, active: bool | None = None):
        return service.list_users(limit=limit, offset=offset, role=role, active=active)

    @router.patch("/{user_id}/role")
    def set_role(user_id: UUID, body: RoleUpdate, request: Request):
        return service.set_role(current_principal(request), str(user_id), body.role)

    @router.patch("/{user_id}/status")
    def set_status(user_id: UUID, body: StatusUpdate, request: Request):
        return service.set_status(current_principal(request), str(user_id), body.is_active)

    return router


def webhooks_router(service, verifier):
    router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

    @router.post("/clerk")
    async def clerk_webhook(request: Request):
        # La firma cubre los bytes exactos: hay que leer el cuerpo sin interpretarlo antes.
        event = verifier.verify(await request.body(), request.headers)
        return {"status": await asyncio.to_thread(service.handle_webhook, event)}

    return router
