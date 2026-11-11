"""Firma de los webhooks de Clerk (formato Svix): HMAC-SHA256 de `id.timestamp.cuerpo`."""
import base64
import binascii
import hashlib
import hmac
import json
import time

from app.application.errors import Unauthorized


class WebhookVerifier:
    def __init__(self, secret, tolerance=300, clock=time.time):
        value = (secret or "").strip().removeprefix("whsec_")
        try:
            self.key = base64.b64decode(value, validate=True)
        except binascii.Error:
            raise ValueError("CLERK_WEBHOOK_SECRET inválido") from None
        if not self.key:
            raise ValueError("Configurar CLERK_WEBHOOK_SECRET")
        self.tolerance = tolerance
        self.clock = clock

    def verify(self, body: bytes, headers) -> dict:
        message_id, timestamp, signatures = (headers.get(name) for name in
                                             ("svix-id", "svix-timestamp", "svix-signature"))
        try:
            sent_at = int(timestamp or "")
        except ValueError:
            raise Unauthorized("Firma de webhook inválida") from None
        # La ventana de tiempo impide reutilizar una entrega capturada.
        if not message_id or not signatures or abs(self.clock() - sent_at) > self.tolerance:
            raise Unauthorized("Firma de webhook inválida")
        digest = hmac.new(self.key, f"{message_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()
        expected = base64.b64encode(digest)
        for candidate in signatures.split():
            version, _, value = candidate.partition(",")
            if version == "v1" and hmac.compare_digest(value.encode(), expected):
                try:
                    return json.loads(body)
                except ValueError:
                    break
        raise Unauthorized("Firma de webhook inválida")
