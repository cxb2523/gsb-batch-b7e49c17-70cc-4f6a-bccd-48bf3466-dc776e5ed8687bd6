"""Backend API de Clerk: invitaciones y consulta de usuarios."""
import httpx

from app.application.errors import Conflict, InvalidInput, Unavailable

INVITATION_DAYS = 7


class ClerkApi:
    def __init__(self, secret_key, redirect_url=None, *, transport=None):
        if not secret_key:
            raise ValueError("Configurar CLERK_SECRET_KEY")
        self.redirect_url = redirect_url or None
        self.client = httpx.Client(base_url="https://api.clerk.com/v1", timeout=10, transport=transport,
                                   headers={"Authorization": f"Bearer {secret_key}"})

    def _request(self, method, path, **kwargs):
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.HTTPError:
            raise Unavailable("Clerk no disponible") from None
        if response.status_code in (401, 403, 429) or response.status_code >= 500:
            raise Unavailable("Clerk no disponible")
        return response

    def create_invitation(self, email, display_name, role):
        # public_metadata pasa al usuario al aceptar; así llega el rol al webhook sin otra tabla.
        payload = {"email_address": email, "notify": True, "expires_in_days": INVITATION_DAYS,
                   "public_metadata": {"sentrix": {"invited": True, "role": role, "display_name": display_name}}}
        if self.redirect_url:
            payload["redirect_url"] = self.redirect_url
        response = self._request("POST", "/invitations", json=payload)
        if response.is_success:
            return response.json()["id"]
        try:
            errors = response.json().get("errors") or []
        except ValueError:
            errors = []
        codes = " ".join(str(error.get("code", "")) for error in errors if isinstance(error, dict))
        if response.status_code == 409 or "duplicate" in codes or "exists" in codes:
            raise Conflict("Ya existe una invitación o una cuenta con ese correo")
        raise InvalidInput("Clerk rechazó la invitación")

    def get_user(self, clerk_user_id):
        response = self._request("GET", f"/users/{clerk_user_id}")
        if response.status_code == 404:
            return None
        if not response.is_success:
            raise Unavailable("Clerk no disponible")
        return response.json()

    def find_user_by_email(self, email):
        response = self._request("GET", "/users", params={"email_address": email, "limit": 1})
        if not response.is_success:
            raise Unavailable("Clerk no disponible")
        users = response.json()
        return users[0] if users else None
