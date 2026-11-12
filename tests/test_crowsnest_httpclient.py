"""The Crows Nest's HTTP clients reuse one SSL context (#108)."""

import asyncio
import ssl

import pytest

httpx = pytest.importorskip("httpx")

from datavloot_platform.crowsnest import httpclient  # noqa: E402


def test_a_client_builds_no_ssl_context_of_its_own(monkeypatch):
    # Building one is what stalls the event loop on Windows with OpenSSL 3.0.
    def no_new_context(*a, **k):
        raise AssertionError("a client built its own SSL context")

    monkeypatch.setattr(ssl, "create_default_context", no_new_context)

    async def make_and_use():
        async with httpclient.async_client(1.0) as client:
            return client

    asyncio.run(make_and_use())


def test_the_shared_context_verifies_certificates():
    assert httpclient.SSL_CONTEXT.verify_mode == ssl.CERT_REQUIRED
    assert httpclient.SSL_CONTEXT.check_hostname
