"""Firma de los webhooks de Clerk."""
import time

import pytest

from app.application.errors import Unauthorized
from app.infrastructure.auth.webhooks import WebhookVerifier
from tests.support.users import WEBHOOK_SECRET, signed_webhook


def test_accepts_a_signed_event():
    body, headers = signed_webhook({"type": "user.created"})
    assert WebhookVerifier(WEBHOOK_SECRET).verify(body, headers) == {"type": "user.created"}


def test_matches_the_published_svix_example():
    verifier = WebhookVerifier("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", clock=lambda: 1614265330)
    headers = {"svix-id": "msg_p5jXN8AQM9LWM0D4loKWxJek", "svix-timestamp": "1614265330",
               "svix-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="}
    assert verifier.verify(b'{"test": 2432232314}', headers) == {"test": 2432232314}


def test_accepts_when_one_of_several_signatures_matches():
    body, headers = signed_webhook({"type": "user.created"})
    headers["svix-signature"] = "v1,otra " + headers["svix-signature"]
    assert WebhookVerifier(WEBHOOK_SECRET).verify(body, headers)["type"] == "user.created"


def test_rejects_altered_body():
    body, headers = signed_webhook({"type": "user.created"})
    with pytest.raises(Unauthorized):
        WebhookVerifier(WEBHOOK_SECRET).verify(body + b" ", headers)


def test_rejects_old_deliveries():
    body, headers = signed_webhook({"type": "user.created"}, timestamp=int(time.time()) - 301)
    with pytest.raises(Unauthorized):
        WebhookVerifier(WEBHOOK_SECRET).verify(body, headers)


@pytest.mark.parametrize("missing", ["svix-id", "svix-timestamp", "svix-signature"])
def test_rejects_missing_headers(missing):
    body, headers = signed_webhook({"type": "user.created"})
    del headers[missing]
    with pytest.raises(Unauthorized):
        WebhookVerifier(WEBHOOK_SECRET).verify(body, headers)


@pytest.mark.parametrize("secret", ["", "whsec_"])
def test_requires_a_secret(secret):
    with pytest.raises(ValueError):
        WebhookVerifier(secret)
