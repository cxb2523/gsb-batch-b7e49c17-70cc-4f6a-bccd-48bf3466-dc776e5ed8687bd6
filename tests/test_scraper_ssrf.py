import os
import socket
from urllib.parse import urlparse

import pytest

from src.satya.core import scraper as scraper_module
from src.satya.core import storage
from src.satya.core.scraper import Scraper, _is_safe_url

def test_safe_url_global_ip(monkeypatch):
    # Mock socket.getaddrinfo to return a globally routable IP structure
    # Based on memory: "mock socket.getaddrinfo in unit tests to return a known globally routable IP structure (e.g., [(2, 1, 6, '', ('93.184.216.34', 0))])"
    def mock_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(2, 1, 6, '', ('93.184.216.34', 0))]
    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    assert _is_safe_url("https://example.com") is True

def test_unsafe_url_local_ip(monkeypatch):
    # Mock to return a private IP
    def mock_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(2, 1, 6, '', ('127.0.0.1', 0))]
    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    assert _is_safe_url("https://localhost") is False

def test_unsafe_url_mixed_ips(monkeypatch):
    # Mock to return one global IP and one private IP
    def mock_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [
            (2, 1, 6, '', ('93.184.216.34', 0)),
            (2, 1, 6, '', ('192.168.1.1', 0))
        ]
    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    assert _is_safe_url("https://malicious-domain.com") is False

def test_invalid_scheme():
    assert _is_safe_url("ftp://example.com") is False

def test_empty_hostname():
    assert _is_safe_url("https://") is False


# ---------------------------------------------------------------------------
# Fetch-chain tests: DNS-rebinding pinning + per-hop redirect validation.
# All tests are offline: socket.getaddrinfo and requests.get are faked.
# ---------------------------------------------------------------------------

class FakeResponse:
    """Minimal stand-in for requests.Response (headers case-insensitive)."""

    def __init__(self, status_code=200, headers=None, text="", content=None):
        self.status_code = status_code
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.text = text
        self.content = content if content is not None else text.encode("utf-8")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP error {self.status_code}")


class FakeGitHandler:
    def __init__(self):
        self.commits = []

    def commit_and_push(self, file_paths, message):
        self.commits.append((list(file_paths), message))
        return True


def make_getaddrinfo(mapping):
    """Fake socket.getaddrinfo driven by a {hostname: ip} mapping."""
    def fake_getaddrinfo(host, port=None, *args, **kwargs):
        if host not in mapping:
            raise socket.gaierror(f"Name or service not known: {host}")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '',
                 (mapping[host], port if port is not None else 0))]
    return fake_getaddrinfo


@pytest.fixture
def scraper_env(tmp_path, monkeypatch):
    """A Scraper rooted at a tmp dir with a recording fake git handler."""
    storage.set_root(str(tmp_path))
    scraper = Scraper(repo_path=str(tmp_path))
    fake_git = FakeGitHandler()
    scraper.git_handler = fake_git
    yield scraper, fake_git
    storage.set_root(".")


def truth_files():
    if not os.path.isdir(storage.TRUTH_DIR):
        return []
    return os.listdir(storage.TRUTH_DIR)


def test_redirect_to_internal_ip_rejected(scraper_env, monkeypatch):
    """First hop resolves public, redirect target resolves private -> reject."""
    scraper, fake_git = scraper_env
    monkeypatch.setattr(socket, "getaddrinfo", make_getaddrinfo({
        "public.example.com": "93.184.216.34",
        "internal.example.com": "192.168.1.10",
    }))
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(302, {"Location": "http://internal.example.com/admin"})

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    assert scraper.fetch_and_save("http://public.example.com/", title="Leaked") is None
    # Only the first (public) hop was ever requested.
    assert calls == ["http://public.example.com/"]
    # Nothing written to the knowledge base, nothing committed.
    assert truth_files() == []
    assert fake_git.commits == []


def test_redirect_to_public_ip_succeeds(scraper_env, monkeypatch):
    """Redirect to another globally-routable host is followed and saved."""
    scraper, fake_git = scraper_env
    monkeypatch.setattr(socket, "getaddrinfo", make_getaddrinfo({
        "public.example.com": "93.184.216.34",
        "cdn.example.com": "151.101.1.69",
    }))
    responses = {
        "http://public.example.com/start": FakeResponse(
            302, {"Location": "https://cdn.example.com/final"}),
        "https://cdn.example.com/final": FakeResponse(
            200, text="<html><body>hello truth</body></html>"),
    }

    def fake_get(url, **kwargs):
        assert url in responses, f"unexpected URL requested: {url}"
        return responses[url]

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    result = scraper.fetch_and_save("http://public.example.com/start", title="My Page")
    assert result == "My_Page.md"
    assert truth_files() == ["My_Page.md"]
    with open(os.path.join(storage.TRUTH_DIR, "My_Page.md"), encoding="utf-8") as f:
        content = f.read()
    assert "Source: http://public.example.com/start" in content
    assert len(fake_git.commits) == 1
    assert fake_git.commits[0][1] == "Added Truth Source: My Page"


def test_relative_redirect_resolved_with_urljoin(scraper_env, monkeypatch):
    """A relative Location header is joined against the current URL."""
    scraper, _ = scraper_env
    monkeypatch.setattr(socket, "getaddrinfo", make_getaddrinfo({
        "public.example.com": "93.184.216.34",
    }))
    responses = {
        "http://public.example.com/a/b": FakeResponse(302, {"Location": "../c"}),
        "http://public.example.com/c": FakeResponse(200, text="done"),
    }

    def fake_get(url, **kwargs):
        assert url in responses, f"unexpected URL requested: {url}"
        return responses[url]

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    assert scraper.fetch_and_save("http://public.example.com/a/b", title="Rel") == "Rel.md"


def test_too_many_redirects_rejected(scraper_env, monkeypatch):
    """More than 5 redirect hops -> None, no file written."""
    scraper, fake_git = scraper_env
    monkeypatch.setattr(socket, "getaddrinfo", make_getaddrinfo({
        "public.example.com": "93.184.216.34",
    }))
    request_count = {"n": 0}

    def fake_get(url, **kwargs):
        request_count["n"] += 1
        return FakeResponse(302, {"Location": "/next"})

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    assert scraper.fetch_and_save("http://public.example.com/0", title="Loop") is None
    # Initial request + 5 followed hops; the 6th redirect is rejected.
    assert request_count["n"] == 6
    assert truth_files() == []
    assert fake_git.commits == []


def test_unsafe_targets_rejected_without_any_request(scraper_env, monkeypatch):
    """Non-global IPs and non-http(s) URLs are refused before connecting."""
    scraper, fake_git = scraper_env
    monkeypatch.setattr(socket, "getaddrinfo", make_getaddrinfo({
        "internal.example.com": "10.0.0.5",
        "metadata.example.com": "169.254.169.254",
        "loopback.example.com": "127.0.0.1",
        "public.example.com": "93.184.216.34",
    }))

    def fake_get(url, **kwargs):
        raise AssertionError(f"requests.get must not be called for unsafe URL: {url}")

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    bad_urls = [
        "ftp://public.example.com/file",      # unsupported scheme
        "file:///etc/passwd",                 # unsupported scheme
        "https://",                           # empty hostname
        "http://internal.example.com/",       # private IP
        "http://metadata.example.com/latest", # link-local (cloud metadata)
        "http://loopback.example.com/",       # loopback
    ]
    for bad in bad_urls:
        assert scraper.fetch_and_save(bad, title="Bad") is None, bad

    assert truth_files() == []
    assert fake_git.commits == []


def test_dns_rebinding_pinned_to_validated_ip(scraper_env, monkeypatch):
    """DNS answers public first, private second (rebinding). The actual
    connection must still land on the validated public IP because resolution
    is pinned for the duration of the request."""
    scraper, _ = scraper_env
    resolve_count = {"n": 0}

    def rebinding_getaddrinfo(host, port=None, *args, **kwargs):
        resolve_count["n"] += 1
        ip = "93.184.216.34" if resolve_count["n"] == 1 else "192.168.1.10"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '',
                 (ip, port if port is not None else 0))]

    monkeypatch.setattr(socket, "getaddrinfo", rebinding_getaddrinfo)
    connected_ips = []

    def fake_get(url, **kwargs):
        # Simulate urllib3 resolving the host again at connect time.
        host = urlparse(url).hostname
        connected_ips.append(socket.getaddrinfo(host, 80)[0][4][0])
        return FakeResponse(200, text="ok")

    monkeypatch.setattr(scraper_module.requests, "get", fake_get)

    assert scraper.fetch_and_save("http://public.example.com/", title="Pinned") == "Pinned.md"
    # The connection used the validated public IP, not the rebound private one.
    assert connected_ips == ["93.184.216.34"]
