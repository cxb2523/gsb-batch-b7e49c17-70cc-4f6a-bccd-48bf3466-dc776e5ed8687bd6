"""A hardened aiohttp session for fetching attacker-influenced targets (§3.10).

Every in-process fetch of a scanned host — the takeover probe, the secret scanner —
goes through :func:`guarded_session`. It closes the SSRF hole described in
:mod:`core.netguard` with two independent controls:

1. **A filtering DNS resolver on the connector.** aiohttp resolves every host it
   connects to — the initial URL *and* every redirect hop — through the connector's
   resolver. This one drops any resolved address that :func:`is_forbidden_target_ip`
   rejects, so a name that resolves (or rebinds) to 169.254.169.254 / an RFC1918
   address simply has no address to connect to. This also closes the check-then-
   connect DNS-rebinding gap, because the filter runs at connect time, not earlier.

2. **Redirects off, plus an IP-literal precheck.** aiohttp bypasses the resolver for
   a bare-IP host, so the resolver alone would not stop ``http://10.0.0.1/``. With
   ``allow_redirects=False`` the only host we ever connect to is the one the caller
   passed, and :func:`assert_url_allowed` refuses that up front if it is a forbidden
   IP literal. Following redirects is not needed for takeover/secret detection and is
   the primary SSRF vector, so it stays off.

Notification webhooks (Discord/Slack/Telegram/generic) carry a *user-supplied* URL and
get a third, request-independent control — :func:`assert_destination_allowed` — which
runs before any HTTP work: a forbidden bare-IP host is refused outright, and a domain
is resolved first so that *any* forbidden answer (or a failure to resolve) blocks the
request without a single byte hitting the network.

aiohttp is imported lazily (it is a runtime-only dependency, absent from the test
venv); the guard logic in :mod:`core.netguard` is pure and independently tested.
"""

from __future__ import annotations

import asyncio
import socket
from collections.abc import Callable, Sequence
from urllib.parse import urlsplit

from core.netguard import is_forbidden_target_ip, is_ip_literal

#: A resolver maps a host name to the IP strings DNS returns for it. Injectable so the
#: preflight is unit-testable without touching the network (tests/unit/conftest.py
#: fails any test that really resolves a name).
Resolver = Callable[[str], Sequence[str]]


class ForbiddenTarget(Exception):
    """Raised when a fetch would reach a non-globally-routable address.

    Carries the structured facts a caller needs for an auditable rejection log:

    * ``host`` — the URL host that was refused (already lower-cased, no trailing dot,
      no IPv6 brackets), never the full URL so a query-string token can't leak;
    * ``hit_ip`` — the specific resolved address that matched the forbidden set
      (``None`` when the refusal is not address-based: empty host / DNS failure /
      an unparseable answer);
    * ``reason`` — a stable machine-readable cause code.
    """

    def __init__(self, message: str, *, host: str, hit_ip: str | None = None,
                 reason: str = "forbidden_address") -> None:
        super().__init__(message)
        self.host = host
        self.hit_ip = hit_ip
        self.reason = reason


def _default_resolver(host: str) -> list[str]:
    """Resolve *host* via the stdlib and return the distinct address strings.

    Blocking socket work; callers that need it off the event loop run it in a worker
    thread (see :func:`guarded_post`).
    """
    infos = socket.getaddrinfo(host, None)
    addresses: set[str] = set()
    for info in infos:
        addresses.add(str(info[4][0]))
    return list(addresses)


def assert_url_allowed(url: str) -> None:
    """Refuse a URL whose host is a forbidden IP literal (the resolver's blind spot)."""
    host = urlsplit(url).hostname or ""
    if host and is_ip_literal(host) and is_forbidden_target_ip(host):
        raise ForbiddenTarget(
            f"refusing to fetch a non-public address: {host}", host=host, hit_ip=host
        )


def assert_destination_allowed(url: str, *, resolver: Resolver | None = None) -> None:
    """Fail-closed destination check that completes before any HTTP request is made.

    * Non-http(s) scheme → :class:`ForbiddenTarget` (``unsupported_scheme``).
    * Empty/missing host → :class:`ForbiddenTarget` (``empty_host``).
    * Bare IP literal → refused directly when :func:`is_forbidden_target_ip` rejects
      it. Bracketed IPv6 literals are recognised; case and a trailing dot are
      normalised away (``urlsplit`` lower-cases and strips brackets; the FQDN dot is
      removed explicitly).
    * Domain name → resolved via *resolver* (stdlib :func:`socket.getaddrinfo` by
      default). If *any* returned address is forbidden the URL is refused with that
      address attached; a resolution error, an empty answer, or an answer containing
      an unparseable entry all fail closed (``resolve_failed`` / ``empty_resolution``
      / a forbidden hit) — never degrading into "send anyway".

    Raises :class:`ForbiddenTarget` carrying the refused host and the hit IP/reason.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        # Fail closed: this transport only ever speaks http(s); a file:///ftp:///…
        # URL must never reach a socket through the notification path.
        raise ForbiddenTarget(
            f"refusing to fetch non-http(s) URL scheme: {parts.scheme!r}",
            host=parts.hostname or "",
            reason="unsupported_scheme",
        )
    # ``hostname`` lower-cases and removes IPv6 brackets; the trailing FQDN dot is
    # stripped explicitly so "EXAMPLE.COM." and "example.com" are the same verdict
    # and the same canonical host in audit logs.
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise ForbiddenTarget(
            "refusing to fetch a URL with no host", host="", reason="empty_host"
        )

    if is_ip_literal(host) and is_forbidden_target_ip(host):
        raise ForbiddenTarget(
            f"refusing to fetch a non-public address: {host}",
            host=host,
            hit_ip=host,
            reason="forbidden_ip_literal",
        )
    if is_ip_literal(host):
        # A parseable, globally-routable IP literal needs no DNS resolution.
        return

    resolve = resolver or _default_resolver
    try:
        addresses = list(resolve(host))
    except (socket.gaierror, OSError) as exc:
        raise ForbiddenTarget(
            f"refusing to fetch {host!r}: DNS resolution failed: {exc}",
            host=host,
            reason="resolve_failed",
        ) from exc
    if not addresses:
        raise ForbiddenTarget(
            f"refusing to fetch {host!r}: DNS returned no addresses",
            host=host,
            reason="empty_resolution",
        )

    for ip in addresses:
        # Fail closed even on a malformed resolver answer rather than trusting it.
        if is_forbidden_target_ip(ip):
            raise ForbiddenTarget(
                f"refusing to fetch {host!r}: resolves to non-public address {ip}",
                host=host,
                hit_ip=ip,
                reason="forbidden_resolved_address",
            )


def _filtering_resolver():  # pragma: no cover - needs aiohttp + real DNS
    """An aiohttp resolver that strips forbidden IPs from every resolution."""
    import aiohttp

    base = aiohttp.AsyncResolver() if _has_aiodns() else aiohttp.ThreadedResolver()

    class _Guarded(aiohttp.abc.AbstractResolver):
        async def resolve(self, host, port=0, family=0):
            hosts = await base.resolve(host, port, family)
            safe = [h for h in hosts if not is_forbidden_target_ip(h["host"])]
            if not safe:
                raise ForbiddenTarget(
                    f"{host} resolves only to non-public addresses",
                    host=host,
                    reason="forbidden_resolved_address",
                )
            return safe

        async def close(self):
            await base.close()

    return _Guarded()


def _has_aiodns() -> bool:  # pragma: no cover
    try:
        import aiodns  # noqa: F401

        return True
    except ImportError:
        return False


def guarded_session(**kwargs):  # pragma: no cover - needs aiohttp
    """An ``aiohttp.ClientSession`` that cannot be steered to an internal address.

    Redirects are disabled by default (the main SSRF vector) and the connector uses
    the filtering resolver. Pass ``allow_redirects``/``connector`` only if you truly
    mean to override the guard.
    """
    import aiohttp

    kwargs.setdefault("connector", aiohttp.TCPConnector(resolver=_filtering_resolver()))
    return aiohttp.ClientSession(**kwargs)


async def guarded_post(  # pragma: no cover - needs aiohttp
    url: str, payload: dict, *, timeout: float = 15.0
) -> int:
    """POST *payload* as JSON to *url* through the SSRF-safe guarded session.

    Used for outbound webhooks (Discord/Slack/generic/Telegram), whose URL is
    user-supplied. :func:`assert_destination_allowed` runs first and resolves the
    host before any HTTP work — a bare forbidden IP, a name that resolves to a
    non-public address (metadata/RFC1918/loopback), or a DNS failure all raise
    :class:`ForbiddenTarget` without opening a socket. The filtering resolver then
    blocks a connect-time DNS rebind, and redirects stay off so a 302 can't hop to an
    internal address. Returns the HTTP status; raises :class:`ForbiddenTarget` if the
    destination is not globally routable.
    """
    import aiohttp

    # Blocking getaddrinfo goes to a worker thread so the event loop stays free.
    await asyncio.to_thread(assert_destination_allowed, url)
    async with guarded_session() as session:
        async with session.post(
            url,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=timeout),
            allow_redirects=False,
        ) as resp:
            return resp.status
