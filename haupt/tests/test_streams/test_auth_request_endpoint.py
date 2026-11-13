import asyncio
from datetime import timedelta
import os
import pytest
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory
from rest_framework import status

from clipped.utils.tz import now
from haupt.streams.endpoints import auth_request as auth_request_module
from polyaxon import settings
from polyaxon._env_vars.keys import (
    ENV_KEYS_PROXY_LOCAL_PORT,
    ENV_KEYS_SECRET_INTERNAL_TOKEN,
)
from polyaxon._sandbox.auth import derive_sandbox_token
from polyaxon._utils.test_utils import patch_settings


pytestmark = pytest.mark.streams_mark


@pytest.fixture(autouse=True)
def patch_client_settings(tmp_path, monkeypatch):
    patch_settings(set_auth=False, set_client=True, set_cli=False, set_agent=False)
    settings.CLIENT_CONFIG.archives_root = str(tmp_path)
    settings.CLIENT_CONFIG.timezone = "UTC"
    monkeypatch.setattr(
        auth_request_module.dj_settings,
        "POLYAXON_SERVICE",
        "streams",
        raising=False,
    )


class AuthResponse:
    status = status.HTTP_200_OK


class AuthDeniedResponse:
    status = status.HTTP_403_FORBIDDEN


class AuthResponseContext:
    status = status.HTTP_200_OK

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def make_auth_request(
    uri="/services/v1/ns/owner/project/runs/uuid/8000/path",
    method="GET",
    auth="token abc",
    **extra,
):
    return RequestFactory().get(
        "/auth-request/v1/",
        HTTP_X_ORIGIN_URI=uri,
        HTTP_X_ORIGIN_METHOD=method,
        HTTP_AUTHORIZATION=auth,
        **extra,
    )


@pytest.mark.parametrize(
    "response,age,expected",
    [
        (True, timedelta(seconds=30), True),
        (True, timedelta(days=1, seconds=30), None),
        (True, timedelta(days=2, seconds=30), None),
        (False, timedelta(seconds=2), False),
        (False, timedelta(days=1, seconds=2), None),
        (True, timedelta(seconds=-30), None),
    ],
)
def test_auth_cache_expires_on_total_age(monkeypatch, response, age, expected):
    current = now().replace(microsecond=0)
    monkeypatch.setattr(auth_request_module, "now", lambda: current - age)
    asyncio.run(auth_request_module._persist_auth_cache("key", response=response))
    monkeypatch.setattr(auth_request_module, "now", lambda: current)

    assert asyncio.run(auth_request_module._check_auth_cache("key")) is expected


@pytest.mark.parametrize(
    "response,interval",
    [
        (True, 60),  # allow entries live for 60 seconds
        (False, 5),  # deny entries live for 5 seconds
    ],
)
def test_auth_cache_ttl_boundaries(monkeypatch, response, interval):
    current = now().replace(microsecond=0)

    def entry_at(age):
        key = "boundary-{}-{}".format(response, age.total_seconds())
        monkeypatch.setattr(auth_request_module, "now", lambda: current - age)
        asyncio.run(
            auth_request_module._persist_auth_cache(key, response=response)
        )
        monkeypatch.setattr(auth_request_module, "now", lambda: current)
        return asyncio.run(auth_request_module._check_auth_cache(key))

    # One second before the boundary it is still a hit
    assert entry_at(timedelta(seconds=interval - 1)) is response
    # Exactly at the boundary it expires and becomes a miss
    assert entry_at(timedelta(seconds=interval)) is None


def test_auth_request_cache_key_covers_every_auth_input(monkeypatch):
    seen = []

    async def check_auth_cache(request_cache):
        seen.append(request_cache)
        return None

    async def check_auth_service(headers):
        return AuthResponse()

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)

    def fire(**kwargs):
        asyncio.run(
            auth_request_module.auth_request(make_auth_request(**kwargs))
        )

    base_uri = "/services/v1/ns/owner/project/runs/uuid/8000/path"
    # Baseline request
    fire()
    # Change each auth-relevant input one at a time
    fire(uri=base_uri + "/other")  # path
    fire(method="POST")  # original method
    fire(auth="token other")  # Authorization header
    fire(HTTP_COOKIE="session=2")  # Cookie
    fire(HTTP_X_POLYAXON_SERVICE="cli")  # X-Polyaxon-Service
    fire(uri=base_uri + "?runs=u1")  # runs query param

    assert len(seen) == 7
    assert len(set(seen)) == 7


def test_auth_request_cache_is_bound_to_credentials(monkeypatch):
    calls = []

    async def check_auth_service(headers):
        calls.append(headers.get("Cookie"))
        if headers.get("Cookie") == "token=a":
            return AuthResponse()
        return AuthDeniedResponse()

    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)

    def request_status(**extra):
        request = make_auth_request(auth="", **extra)
        return asyncio.run(auth_request_module.auth_request(request)).status_code

    assert request_status(HTTP_COOKIE="token=a") == status.HTTP_200_OK
    assert request_status() == status.HTTP_403_FORBIDDEN
    assert request_status(HTTP_COOKIE="token=b") == status.HTTP_403_FORBIDDEN
    assert request_status(HTTP_COOKIE="token=a") == status.HTTP_200_OK
    assert (
        request_status(HTTP_COOKIE="token=a", HTTP_X_POLYAXON_SERVICE="cli")
        == status.HTTP_200_OK
    )
    # The repeated `token=a` request is the only cache hit
    assert calls == ["token=a", "", "token=b", "token=a"]


def test_auth_request_cache_is_bound_to_runs(monkeypatch):
    calls = []

    async def check_auth_service(headers):
        calls.append(headers.get("X-Origin-Uri"))
        return AuthResponse()

    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)

    uri = "/streams/v1/ns/owner/project/runs/multi/events/metric?runs={}"
    for runs in ["a", "b", "a", "b&runs="]:
        request = make_auth_request(uri=uri.format(runs))
        asyncio.run(auth_request_module.auth_request(request))

    # The repeated `runs=a` request is the only cache hit
    assert calls == [uri.format("a"), uri.format("b"), uri.format("b&runs=")]


def test_auth_cache_distinguishes_allow_deny_and_miss():
    asyncio.run(
        auth_request_module._persist_auth_cache(
            request_cache="cached-allow", response=True
        )
    )
    asyncio.run(
        auth_request_module._persist_auth_cache(
            request_cache="cached-deny", response=False
        )
    )

    assert asyncio.run(auth_request_module._check_auth_cache("cached-allow")) is True
    assert asyncio.run(auth_request_module._check_auth_cache("cached-deny")) is False
    assert asyncio.run(auth_request_module._check_auth_cache("missing")) is None


@pytest.mark.parametrize(
    "uri,expected",
    [
        # Forged family segments in the query string must not change the family
        (
            "/services/v1/ns/owner/project/runs/uuid/8000/path"
            "?next=/sandbox/v1/ns/owner/project/runs/uuid/ping",
            auth_request_module.URI_FAMILY_OTHER,
        ),
        (
            "/services/v1/ns/owner/project/runs/uuid/8000/path"
            "?next=/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main",
            auth_request_module.URI_FAMILY_OTHER,
        ),
        (
            "/streams/v1/ns/owner/project/runs/uuid/events?fake=/sandbox/v1/x",
            auth_request_module.URI_FAMILY_OTHER,
        ),
        # Forged family segment at the start of the URI: a naive
        # startswith on the full URI (instead of the path) would be fooled
        # because the whole string now starts with the family location.
        (
            "/sandbox/v1/ns/owner/project/runs/uuid?/k8s/v1/x",
            auth_request_module.URI_FAMILY_SANDBOX,
        ),
        (
            "/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main?sandbox/v1/x",
            auth_request_module.URI_FAMILY_K8S,
        ),
        # Query-only URI: the path itself is empty, so the family must be
        # OTHER even though the query carries a family location
        (
            "?sandbox/v1/ns/owner/project/runs/uuid/ping",
            auth_request_module.URI_FAMILY_OTHER,
        ),
        (
            "?k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main",
            auth_request_module.URI_FAMILY_OTHER,
        ),
        # The family is derived from the path only
        (
            "/sandbox/v1/ns/owner/project/runs/uuid/ping?next=/k8s/v1/x",
            auth_request_module.URI_FAMILY_SANDBOX,
        ),
        (
            "/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main?fake=/sandbox",
            auth_request_module.URI_FAMILY_K8S,
        ),
        (
            "/services/v1/ns/owner/project/runs/uuid/8000/path?runs=a&runs=b",
            auth_request_module.URI_FAMILY_OTHER,
        ),
    ],
)
def test_uri_family_uses_path_not_query_string(uri, expected):
    assert auth_request_module._get_uri_family(uri) == expected


def test_check_auth_service_requests_json(monkeypatch):
    captured = {}

    class ClientSession:
        def __init__(self, **kwargs):
            captured["session_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers):
            captured["url"] = url
            captured["headers"] = headers
            return AuthResponseContext()

    monkeypatch.setattr(auth_request_module.aiohttp, "ClientSession", ClientSession)
    monkeypatch.setenv(ENV_KEYS_PROXY_LOCAL_PORT, "8000")

    response = asyncio.run(
        auth_request_module._check_auth_service(
            {"Accept": "text/event-stream", "Authorization": "token abc"}
        )
    )

    assert response.status == status.HTTP_200_OK
    assert captured == {
        "session_kwargs": {"trust_env": True},
        "url": "http://localhost:8000/auth/v1/",
        "headers": {
            "Authorization": "token abc",
            "Accept": "application/json",
        },
    }


def test_auth_request_rejects_cached_deny(monkeypatch):
    async def check_auth_cache(request_cache):
        return False

    async def fail_check_auth_service(headers):
        raise AssertionError("cached deny must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("cached deny must not persist a new cache entry")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )

    response = asyncio.run(auth_request_module.auth_request(make_auth_request()))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.content == b"Auth request failed (cached)"


def test_auth_request_allows_cached_allow(monkeypatch):
    async def check_auth_cache(request_cache):
        return True

    async def fail_check_auth_service(headers):
        raise AssertionError("cached allow must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("cached allow must not persist a new cache entry")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )

    response = asyncio.run(auth_request_module.auth_request(make_auth_request()))

    assert response.status_code == status.HTTP_200_OK


def test_auth_request_caches_regular_auth_allow(monkeypatch):
    persisted = []

    async def check_auth_cache(request_cache):
        return None

    async def check_auth_service(headers):
        return AuthResponse()

    async def persist_auth_cache(request_cache, response):
        persisted.append(response)

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)
    monkeypatch.setattr(auth_request_module, "_persist_auth_cache", persist_auth_cache)

    response = asyncio.run(auth_request_module.auth_request(make_auth_request()))

    assert response.status_code == status.HTTP_200_OK
    assert persisted == [True]


def test_auth_request_caches_regular_auth_deny(monkeypatch):
    persisted = []

    async def check_auth_cache(request_cache):
        return None

    async def check_auth_service(headers):
        return AuthDeniedResponse()

    async def persist_auth_cache(request_cache, response):
        persisted.append(response)

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)
    monkeypatch.setattr(auth_request_module, "_persist_auth_cache", persist_auth_cache)

    response = asyncio.run(auth_request_module.auth_request(make_auth_request()))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.content == b"Auth request failed"
    assert persisted == [False]


def test_auth_request_non_streams_cache_miss_does_not_persist_allow(monkeypatch):
    async def check_auth_cache(request_cache):
        return None

    async def fail_check_auth_service(headers):
        raise AssertionError("non-streams auth request must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("non-streams cache miss must not persist auth cache")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )
    monkeypatch.setattr(
        auth_request_module.dj_settings,
        "POLYAXON_SERVICE",
        "api",
        raising=False,
    )

    response = asyncio.run(auth_request_module.auth_request(make_auth_request()))

    assert response.status_code == status.HTTP_200_OK


def test_auth_request_sandbox_cached_allow_returns_token(monkeypatch):
    async def check_auth_cache(request_cache):
        return True

    async def fail_check_auth_service(headers):
        raise AssertionError("cached sandbox allow must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("cached sandbox allow must not persist auth cache")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )

    with patch.dict("os.environ", {ENV_KEYS_SECRET_INTERNAL_TOKEN: "internal-token"}):
        response = asyncio.run(
            auth_request_module.auth_request(
                make_auth_request(uri="/sandbox/v1/ns/owner/project/runs/uuid/ping")
            )
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["SANDBOX_TOKEN"] == derive_sandbox_token(
        "internal-token", "uuid"
    )


def test_auth_request_sandbox_cache_miss_persists_allow_and_returns_token(monkeypatch):
    persisted = []

    async def check_auth_cache(request_cache):
        return None

    async def check_auth_service(headers):
        return AuthResponse()

    async def persist_auth_cache(request_cache, response):
        persisted.append(response)

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)
    monkeypatch.setattr(auth_request_module, "_persist_auth_cache", persist_auth_cache)

    with patch.dict("os.environ", {ENV_KEYS_SECRET_INTERNAL_TOKEN: "internal-token"}):
        response = asyncio.run(
            auth_request_module.auth_request(
                make_auth_request(uri="/sandbox/v1/ns/owner/project/runs/uuid/ping")
            )
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["SANDBOX_TOKEN"] == derive_sandbox_token(
        "internal-token", "uuid"
    )
    assert persisted == [True]


def test_auth_request_sandbox_cached_deny_stops_before_token(monkeypatch):
    async def check_auth_cache(request_cache):
        return False

    async def fail_check_auth_service(headers):
        raise AssertionError("cached sandbox deny must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("cached sandbox deny must not persist auth cache")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(uri="/sandbox/v1/ns/owner/project/runs/uuid/ping")
        )
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.content == b"Auth request failed (cached)"


def test_auth_request_sandbox_deny_persists_auth_deny(monkeypatch):
    persisted = []

    async def check_auth_cache(request_cache):
        return None

    async def check_auth_service(headers):
        return AuthDeniedResponse()

    async def persist_auth_cache(request_cache, response):
        persisted.append(response)

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)
    monkeypatch.setattr(auth_request_module, "_persist_auth_cache", persist_auth_cache)

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(uri="/sandbox/v1/ns/owner/project/runs/uuid/ping")
        )
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.content == b"Auth request failed"
    assert persisted == [False]


def test_auth_request_sandbox_rejects_invalid_path_before_cache(monkeypatch):
    async def fail_check_auth_cache(request_cache):
        raise AssertionError("invalid sandbox path must not read auth cache")

    async def fail_check_auth_service(headers):
        raise AssertionError("invalid sandbox path must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("invalid sandbox path must not persist auth cache")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", fail_check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(uri="/sandbox/v1/ns/owner/project/runs/uuid/")
        )
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.content == b"A valid sandbox path param is required"


def test_auth_request_k8s_cached_allow_returns_dynamic_headers(monkeypatch, run_pods):
    async def check_auth_cache(request_cache):
        return True

    async def fail_check_auth_service(headers):
        raise AssertionError("cached k8s allow must not call auth service")

    async def fail_persist_auth_cache(request_cache, response):
        raise AssertionError("cached k8s allow must not persist auth cache")

    async def reverse_k8s(path):
        assert (
            path
            == "api/v1/namespaces/ns/pods/pod/exec?command=/bin/bash&container=main"
        )
        return HttpResponse(
            status=status.HTTP_200_OK,
            headers={
                "K8S_URI": "https://k8s.local/exec",
                "K8S_TOKEN": "k8s-token",
            },
        )

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(
        auth_request_module, "_check_auth_service", fail_check_auth_service
    )
    monkeypatch.setattr(
        auth_request_module, "_persist_auth_cache", fail_persist_auth_cache
    )
    monkeypatch.setattr(auth_request_module, "reverse_k8s", reverse_k8s)

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(
                uri=(
                    "/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main"
                    "?command=/bin/bash"
                )
            )
        )
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["K8S_URI"] == "https://k8s.local/exec"
    assert response.headers["K8S_TOKEN"] == "k8s-token"


def test_auth_request_k8s_cache_miss_persists_allow_and_returns_dynamic_headers(
    monkeypatch, run_pods
):
    persisted = []

    async def check_auth_cache(request_cache):
        return None

    async def check_auth_service(headers):
        return AuthResponse()

    async def persist_auth_cache(request_cache, response):
        persisted.append(response)

    async def reverse_k8s(path):
        assert (
            path
            == "api/v1/namespaces/ns/pods/pod/exec?command=/bin/bash&container=main"
        )
        return HttpResponse(
            status=status.HTTP_200_OK,
            headers={
                "K8S_URI": "https://k8s.local/exec",
                "K8S_TOKEN": "k8s-token",
            },
        )

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)
    monkeypatch.setattr(auth_request_module, "_persist_auth_cache", persist_auth_cache)
    monkeypatch.setattr(auth_request_module, "reverse_k8s", reverse_k8s)

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(
                uri=(
                    "/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main"
                    "?command=/bin/bash"
                )
            )
        )
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["K8S_URI"] == "https://k8s.local/exec"
    assert response.headers["K8S_TOKEN"] == "k8s-token"
    assert persisted == [True]


def test_auth_request_k8s_cached_allow_rejects_pod_outside_run(monkeypatch, run_pods):
    run_pods["pods"] = [("pod", "other-run", ["main"])]

    async def check_auth_cache(request_cache):
        return True

    async def fail_reverse_k8s(path):
        raise AssertionError("invalid k8s target must not be forwarded")

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "reverse_k8s", fail_reverse_k8s)

    response = asyncio.run(
        auth_request_module.auth_request(
            make_auth_request(
                uri="/k8s/v1/ns/owner/project/runs/uuid/k8s_exec/pod/main"
            )
        )
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_auth_cache_expired_and_future_entries_are_removed(monkeypatch):
    current = now().replace(microsecond=0)

    # An allow entry older than 60s and a deny entry stamped in the future
    stale_key, future_key = "stale-allow", "future-deny"
    monkeypatch.setattr(auth_request_module, "now", lambda: current - timedelta(days=1))
    asyncio.run(auth_request_module._persist_auth_cache(stale_key, response=True))
    asyncio.run(auth_request_module._persist_auth_cache(future_key, response=False))

    stale_path = auth_request_module._get_auth_cache_path(stale_key)
    future_path = auth_request_module._get_auth_cache_path(future_key)
    assert os.path.isfile(stale_path)
    assert os.path.isfile(future_path)

    monkeypatch.setattr(auth_request_module, "now", lambda: current)

    # Expired entry is a miss and gets cleaned up
    assert asyncio.run(auth_request_module._check_auth_cache(stale_key)) is None
    assert not os.path.isfile(stale_path)

    # A timestamp in the future is treated as a miss and gets cleaned up
    assert asyncio.run(auth_request_module._check_auth_cache(future_key)) is None
    assert not os.path.isfile(future_path)


def test_auth_request_ignores_query_params_other_than_runs(monkeypatch):
    calls = []

    async def check_auth_service(headers):
        calls.append(headers.get("X-Origin-Uri"))
        return AuthResponse()

    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)

    base = "/streams/v1/ns/owner/project/runs/uuid/events/metric"
    # Only non-auth query params change: the cache key must stay identical
    for suffix in ["?foo=1", "?foo=2", "?bar=anything&foo=1", ""]:
        asyncio.run(
            auth_request_module.auth_request(
                make_auth_request(uri=base + suffix)
            )
        )

    # Only the first request reaches the auth service, the rest are cache hits
    assert calls == [base + "?foo=1"]


def test_auth_request_runs_blank_and_duplicate_values_get_distinct_cache(monkeypatch):
    keys = []

    async def check_auth_cache(request_cache):
        keys.append(request_cache)
        return None

    async def check_auth_service(headers):
        return AuthResponse()

    monkeypatch.setattr(auth_request_module, "_check_auth_cache", check_auth_cache)
    monkeypatch.setattr(auth_request_module, "_check_auth_service", check_auth_service)

    base = "/streams/v1/ns/owner/project/runs/multi/events/metric"
    uris = [
        base,  # no runs param -> None
        base + "?runs=",  # blank runs value -> ['']
        base + "?runs=a",  # single value
        base + "?runs=a&runs=b",  # repeated values keep order
        base + "?runs=b&runs=a",  # same values, different order
    ]
    for uri in uris:
        asyncio.run(
            auth_request_module.auth_request(make_auth_request(uri=uri))
        )

    # Every distinct runs shape (incl. blank/absent/repeated) gets its own key
    assert len(keys) == len(set(keys)) == len(uris)
