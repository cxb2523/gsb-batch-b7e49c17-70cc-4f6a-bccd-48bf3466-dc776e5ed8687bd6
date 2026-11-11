"""Dobles de Clerk y del registro de usuarios; las claves se generan al vuelo."""
import base64
import hashlib
import hmac
import json
import time
from dataclasses import replace
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from app.domain.users import AccountDeletedError, AdminExistsError, LastAdminError

ISSUER = "https://test-instance.clerk.accounts.dev"
ORIGIN = "https://sentrix-vercel-upload.vercel.app"
WEBHOOK_SECRET = "whsec_" + base64.b64encode(b"clave-de-prueba-del-webhook").decode()
PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_KEY = PRIVATE_KEY.public_key()


def make_token(sub="user_1", *, key=PRIVATE_KEY, issuer=ISSUER, azp=ORIGIN, expires_in=60, algorithm="RS256", **extra):
    now = int(time.time())
    claims = {"sub": sub, "iss": issuer, "iat": now, "nbf": now, "exp": now + expires_in, **extra}
    if azp is not None:
        claims["azp"] = azp
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": "test"})


def clerk_user(clerk_user_id="user_1", email="persona@sentrix.pe", *, invited=True, role="operator",
               display_name="Persona", updated_at=1000):
    metadata = {"sentrix": {"invited": True, "role": role, "display_name": display_name}} if invited else {}
    return {"id": clerk_user_id, "primary_email_address_id": "idn_1", "updated_at": updated_at,
            "email_addresses": [{"id": "idn_1", "email_address": email}], "first_name": "Nombre", "last_name": None,
            "public_metadata": metadata}


def signed_webhook(event, *, secret=WEBHOOK_SECRET, message_id="msg_1", timestamp=None):
    body = json.dumps(event).encode()
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signature = base64.b64encode(hmac.new(key, f"{message_id}.{timestamp}.".encode() + body, hashlib.sha256).digest())
    return body, {"svix-id": message_id, "svix-timestamp": timestamp, "svix-signature": "v1," + signature.decode()}


class FakeClerk:
    def __init__(self):
        self.users = {}
        self.invitations = []
        self.failure = None

    def get_user(self, clerk_user_id):
        if self.failure:
            raise self.failure
        return self.users.get(clerk_user_id)

    def find_user_by_email(self, email):
        return next((user for user in self.users.values() if user["email_addresses"][0]["email_address"] == email), None)

    def create_invitation(self, email, display_name, role):
        if self.failure:
            raise self.failure
        self.invitations.append({"email": email, "display_name": display_name, "role": role})
        return f"inv_{len(self.invitations)}"


class FakeUserStore:
    """Misma semántica que UserStore; las pruebas `postgres` comprueban la real."""
    def __init__(self):
        self.rows = {}
        self.failure = None

    def check(self):
        if self.failure:
            raise self.failure

    def add(self, clerk_user_id, email, role="operator", active=True):
        row = {"id": str(uuid4()), "clerk_user_id": clerk_user_id, "email": email, "display_name": None,
               "role": role, "is_active": active, "deleted": False, "event_at": 0}
        self.rows[row["id"]] = row
        return self._public(row)

    @staticmethod
    def _public(row):
        return {key: value for key, value in row.items() if key != "event_at"}

    def _find(self, field, value):
        if self.failure:
            raise self.failure
        return next((row for row in self.rows.values() if row[field] == value), None)

    def get(self, user_id):
        row = self._find("id", user_id)
        return self._public(row) if row else None

    def get_by_clerk_id(self, clerk_user_id):
        row = self._find("clerk_user_id", clerk_user_id)
        return self._public(row) if row else None

    def find_by_email(self, email):
        row = self._find("email", email)
        return self._public(row) if row else None

    def list(self, *, limit=20, offset=0, role=None, active=None):
        rows = [row for row in self.rows.values()
                if (role is None or row["role"] == role) and (active is None or row["is_active"] is active)]
        return {"items": [self._public(row) for row in rows[offset:offset + limit]], "total": len(rows),
                "limit": limit, "offset": offset}

    def sync(self, identity, event_at):
        row = self._find("clerk_user_id", identity.clerk_user_id)
        if row:
            if row["deleted"] or event_at <= row["event_at"]:
                return "stale", self._public(row)
            other = self._find("email", identity.email)
            if other and other is not row:
                return "conflict", self._public(row)
            row.update(email=identity.email, display_name=identity.display_name or row["display_name"], event_at=event_at)
            return "updated", self._public(row)
        previous = self._find("email", identity.email)
        if previous and not previous["deleted"]:
            return "conflict", None
        if previous is None:
            previous = {"id": str(uuid4()), "email": identity.email}
            self.rows[previous["id"]] = previous
        previous.update(clerk_user_id=identity.clerk_user_id, display_name=identity.display_name,
                        role=identity.invited_role, is_active=identity.invited, deleted=False, event_at=event_at)
        return "created", self._public(previous)

    def mark_deleted(self, clerk_user_id, event_at):
        row = self._find("clerk_user_id", clerk_user_id)
        if row is None or row["deleted"]:
            return None
        row.update(is_active=False, deleted=True, event_at=max(row["event_at"], event_at))
        return self._public(row)

    def _change(self, user_id, *, role=None, active=None):
        row = self._find("id", user_id)
        if row is None:
            return None
        if active and row["deleted"]:
            raise AccountDeletedError()
        new_role, new_active = role or row["role"], row["is_active"] if active is None else active
        if row["role"] == "admin" and row["is_active"] and (new_role != "admin" or not new_active):
            if not any(o is not row and o["role"] == "admin" and o["is_active"] for o in self.rows.values()):
                raise LastAdminError()
        row.update(role=new_role, is_active=new_active)
        return self._public(row)

    def set_role(self, user_id, role):
        return self._change(user_id, role=role)

    def set_status(self, user_id, active):
        return self._change(user_id, active=active)

    def promote_admin(self, identity, event_at, *, force=False):
        if not force and any(row["role"] == "admin" and row["is_active"] and row["clerk_user_id"] != identity.clerk_user_id
                             for row in self.rows.values()):
            raise AdminExistsError()
        self.sync(replace(identity, invited=True, invited_role="admin"), event_at)
        row = self._find("clerk_user_id", identity.clerk_user_id)
        row.update(role="admin", is_active=True, deleted=False)
        return self._public(row)
