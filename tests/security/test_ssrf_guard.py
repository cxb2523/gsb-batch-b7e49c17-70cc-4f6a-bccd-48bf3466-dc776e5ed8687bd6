"""SSRF guard for in-process fetches (§3.10) — ExactSurface must not be steered inward.

The takeover probe and secret scanner fetch attacker-influenced targets. Without
this, an in-scope host returning ``302 -> http://169.254.169.254/`` would make
ExactSurface fetch the cloud metadata endpoint and scan the IAM credentials it returns as
a "secret". These pin the socket-level backstop that forbids any non-public target.
"""

from __future__ import annotations

import socket

import pytest

from core.netguard import is_forbidden_target_ip, is_ip_literal
from modules.safe_http import ForbiddenTarget, assert_destination_allowed, assert_url_allowed


@pytest.mark.parametrize(
    "ip",
    [
        "169.254.169.254",  # cloud metadata — the crown-jewel target
        "127.0.0.1",
        "10.0.0.1",
        "172.16.5.5",
        "192.168.1.1",
        "100.64.0.1",  # CGNAT
        "0.0.0.0",
        "::1",  # IPv6 loopback
        "fd00::1",  # IPv6 unique-local
        "fe80::1",  # IPv6 link-local
        "not-an-ip",  # unparseable → fail closed
    ],
)
def test_internal_and_bogus_ips_are_forbidden(ip):
    assert is_forbidden_target_ip(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])
def test_public_ips_are_allowed(ip):
    assert is_forbidden_target_ip(ip) is False


def test_ip_literal_detection():
    assert is_ip_literal("10.0.0.1")
    assert is_ip_literal("[::1]")
    assert not is_ip_literal("example.com")


def test_a_forbidden_ip_literal_url_is_refused():
    for url in (
        "http://169.254.169.254/latest/meta-data/",
        "https://127.0.0.1:8080/admin",
        "http://10.0.0.5/",
    ):
        with pytest.raises(ForbiddenTarget):
            assert_url_allowed(url)


def test_a_public_url_passes_the_precheck():
    # hostnames are validated at connect time by the resolver, not here — the
    # precheck only rejects forbidden IP *literals*, and must not false-positive.
    assert_url_allowed("https://app.customer.com/main.js")
    assert_url_allowed("http://93.184.216.34/")  # a public IP literal is fine


# -- request-independent destination preflight (notification webhooks, §3.10) --------
def _resolver(mapping: dict):
    """Build an injected resolver (no real DNS — see tests/unit/conftest.py)."""

    def resolve(host: str):
        return list(mapping[host])

    return resolve


def test_preflight_refuses_forbidden_bare_ip_literals_without_resolving():
    def boom(host):  # must never be called for an IP-literal host
        raise AssertionError("IP literals must not be resolved")

    for url in (
        "http://169.254.169.254/latest/meta-data/",
        "https://127.0.0.1:8080/admin",
        "http://10.0.0.5/",
        "http://[::1]/",  # bracketed IPv6 loopback
        "http://[fd00::1]/",  # bracketed IPv6 unique-local
    ):
        with pytest.raises(ForbiddenTarget) as info:
            assert_destination_allowed(url, resolver=boom)
        assert info.value.hit_ip and is_forbidden_target_ip(info.value.hit_ip)
        assert info.value.reason == "forbidden_ip_literal"


def test_preflight_allows_public_ip_literal():
    def boom(host):
        raise AssertionError("a public IP literal needs no resolution")

    assert_destination_allowed("http://93.184.216.34/path", resolver=boom)


def test_preflight_refuses_domain_with_any_forbidden_resolved_address():
    # One public and one internal answer: a single forbidden hit must block the URL.
    resolve = _resolver({"hooks.evil.example": ["203.0.113.9", "169.254.169.254"]})
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://hooks.evil.example/x", resolver=resolve)
    assert info.value.host == "hooks.evil.example"
    assert info.value.hit_ip == "169.254.169.254" or is_forbidden_target_ip(info.value.hit_ip)
    assert info.value.reason == "forbidden_resolved_address"


def test_preflight_refuses_domain_resolving_to_private_ipv6():
    resolve = _resolver({"int.example": ["2606:4700:4700::1111", "fe80::1"]})
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://int.example/", resolver=resolve)
    assert info.value.hit_ip == "fe80::1"


def test_preflight_allows_domain_that_resolves_only_to_public_addresses():
    resolve = _resolver({"hooks.discord.example": ["162.159.135.232", "162.159.136.232"]})
    assert_destination_allowed("https://hooks.discord.example/hook", resolver=resolve)


def test_preflight_fails_closed_on_dns_error():
    def raise_gaierror(host):
        raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://gone.example/", resolver=raise_gaierror)
    assert info.value.host == "gone.example"
    assert info.value.hit_ip is None
    assert info.value.reason == "resolve_failed"


def test_preflight_fails_closed_on_empty_resolution():
    resolve = _resolver({"empty.example": []})
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://empty.example/", resolver=resolve)
    assert info.value.reason == "empty_resolution"
    assert info.value.hit_ip is None


def test_preflight_fails_closed_on_unparseable_resolver_answer():
    # An answer the ipaddress module can't parse is forbidden by netguard
    # (fail-closed), so it must block rather than be trusted.
    resolve = _resolver({"weird.example": ["not-an-ip"]})
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://weird.example/", resolver=resolve)
    assert info.value.hit_ip == "not-an-ip"


def test_preflight_rejects_empty_host():
    for url in ("http:///path", "https://?x=1"):
        with pytest.raises(ForbiddenTarget) as info:
            assert_destination_allowed(url, resolver=_resolver({}))
        assert info.value.host == ""
        assert info.value.reason == "empty_host"


def test_preflight_rejects_non_http_schemes():
    # A non-http(s) URL must fail closed regardless of how harmless its host looks.
    for url in ("ftp://10.0.0.1/x", "file:///etc/passwd", "gopher://example.com/"):
        with pytest.raises(ForbiddenTarget) as info:
            assert_destination_allowed(url, resolver=_resolver({}))
        assert info.value.reason == "unsupported_scheme"


def test_preflight_normalises_case_trailing_dot_and_brackets():
    # urlsplit.hostname lower-cases, strips the trailing dot and IPv6 brackets.
    resolve = _resolver({"hooks.example": ["10.1.2.3"]})
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("https://HOOKS.EXAMPLE./x", resolver=resolve)
    assert info.value.host == "hooks.example"
    assert info.value.hit_ip == "10.1.2.3"

    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed("http://[2001:DB8::1]/", resolver=_resolver({}))
    assert info.value.host == "2001:db8::1"  # lower-cased, brackets removed


def test_preflight_exception_never_carries_query_string():
    # A webhook URL may hold a token in its query; the exception's host field must be
    # the bare host so logging it cannot leak the token.
    secret = "ghp_supersecrettoken"
    url = f"https://169.254.169.254/hook?token={secret}"
    with pytest.raises(ForbiddenTarget) as info:
        assert_destination_allowed(url, resolver=_resolver({}))
    assert info.value.host == "169.254.169.254"
    assert secret not in str(info.value)


def test_preflight_checks_every_call_not_just_once():
    # The same host can legitimately be checked repeatedly; no cached verdict.
    calls = {"n": 0}

    def resolve(host):
        calls["n"] += 1
        return ["8.8.8.8"] if calls["n"] == 1 else ["127.0.0.1"]

    assert_destination_allowed("https://rebind.example/", resolver=resolve)
    with pytest.raises(ForbiddenTarget):
        assert_destination_allowed("https://rebind.example/", resolver=resolve)
    assert calls["n"] == 2
