"""
HTTP clients for the Crows Nest's own requests to Dagster and Marimo.

A new `httpx.AsyncClient` builds an SSL context unless it is given one, and
loading the CA bundle into it takes 0.1 to 0.5 s on Windows with OpenSSL 3.0.
On the event loop that holds up every other request (#108). So the context is
built once, when this module is imported, before the server starts, and every
client reuses it.
"""

from __future__ import annotations

import httpx

# Built the way httpx builds its default, so SSL_CERT_FILE and SSL_CERT_DIR still count.
SSL_CONTEXT = httpx.create_ssl_context()


def async_client(timeout: float | httpx.Timeout) -> httpx.AsyncClient:
    """An `httpx.AsyncClient` that reuses the shared SSL context."""
    return httpx.AsyncClient(timeout=timeout, verify=SSL_CONTEXT)
