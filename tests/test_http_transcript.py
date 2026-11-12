"""Tests for HTTPClient transcript proxy pool isolation and retry behavior."""

from __future__ import annotations

import httpx
import pytest

import tubescrape._http as http_module
from tubescrape._http import HTTPClient
from tubescrape.exceptions import RequestError

URL = 'https://www.youtube.com/youtubei/v1/player'


@pytest.fixture(autouse=True)
def no_real_backoff(monkeypatch):
    """Stub out backoff delays so tests never actually sleep.

    Returns the list of attempted backoff calls (attempt indices) so tests
    can assert how often backoff was triggered.
    """
    calls: list[int] = []

    def fake_backoff(attempt: int) -> float:
        calls.append(attempt)
        return 0.0

    monkeypatch.setattr(HTTPClient, '_backoff_delay', staticmethod(fake_backoff))
    return calls


def _patch_sync_clients(monkeypatch, responses: list) -> list:
    """Replace httpx.Client with a fake recording the proxy per instance.

    Returns the list of proxies passed to each created client, in order.
    """
    created: list = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.is_closed = False
            created.append(kwargs.get('proxy'))

        @staticmethod
        def _next_response() -> httpx.Response:
            outcome = responses.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        def post(self, url, json=None, **kwargs):
            return self._next_response()

        def get(self, url, **kwargs):
            return self._next_response()

        def close(self):
            self.is_closed = True

    monkeypatch.setattr(http_module.httpx, 'Client', FakeClient)
    return created


def _patch_async_clients(monkeypatch, responses: list) -> list:
    """Replace httpx.AsyncClient with a fake recording the proxy per instance."""
    created: list = []

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            self.is_closed = False
            created.append(kwargs.get('proxy'))

        @staticmethod
        async def _next_response() -> httpx.Response:
            outcome = responses.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        async def post(self, url, json=None, **kwargs):
            return await self._next_response()

        async def get(self, url, **kwargs):
            return await self._next_response()

        async def aclose(self):
            self.is_closed = True

    monkeypatch.setattr(http_module.httpx, 'AsyncClient', FakeAsyncClient)
    return created


# ── Transcript pool rotation ──


def test_transcript_post_rotates_pool_after_429(monkeypatch, no_real_backoff):
    """Two transcript proxies: first returns 429, retry must use the second."""
    created = _patch_sync_clients(
        monkeypatch,
        [httpx.Response(429), httpx.Response(200, json={'ok': True})],
    )
    client = HTTPClient(
        proxies=['http://normal-1:8001'],
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=3,
    )

    response = client.transcript_post(URL, json={'videoId': 'x'})

    assert response.status_code == 200
    # Each attempt drew the next proxy from the transcript pool, in order
    assert created == ['http://t1:9001', 'http://t2:9002']
    # Backoff ran once between the two attempts, without real sleeping
    assert no_real_backoff == [0]
    # Normal proxy rotation and client cache untouched
    assert client._proxy_index == 0
    assert client._sync_client is None


def test_transcript_get_rotates_pool_after_429(monkeypatch, no_real_backoff):
    created = _patch_sync_clients(
        monkeypatch,
        [httpx.Response(429), httpx.Response(200, text='<transcript/>')],
    )
    client = HTTPClient(
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=3,
    )

    response = client.transcript_get('https://www.youtube.com/api/timedtext')

    assert response.status_code == 200
    assert created == ['http://t1:9001', 'http://t2:9002']
    assert client._proxy_index == 0
    assert client._sync_client is None


async def test_transcript_apost_rotates_pool_after_429(monkeypatch, no_real_backoff):
    created = _patch_async_clients(
        monkeypatch,
        [httpx.Response(429), httpx.Response(200, json={'ok': True})],
    )
    client = HTTPClient(
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=3,
    )

    response = await client.transcript_apost(URL, json={'videoId': 'x'})

    assert response.status_code == 200
    assert created == ['http://t1:9001', 'http://t2:9002']
    assert client._proxy_index == 0
    assert client._async_client is None


async def test_transcript_aget_rotates_pool_after_429(monkeypatch, no_real_backoff):
    created = _patch_async_clients(
        monkeypatch,
        [httpx.Response(429), httpx.Response(200, text='<transcript/>')],
    )
    client = HTTPClient(
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=3,
    )

    response = await client.transcript_aget('https://www.youtube.com/api/timedtext')

    assert response.status_code == 200
    assert created == ['http://t1:9001', 'http://t2:9002']
    assert client._proxy_index == 0
    assert client._async_client is None


# ── Fallback to the normal channel ──


def test_transcript_post_falls_back_to_normal_post(monkeypatch):
    """Without transcript proxies, transcript_post must use the normal post."""
    calls = []

    def fake_post(self, url, json=None, **kwargs):
        calls.append((url, json))
        return httpx.Response(200, json={'ok': True})

    def fail_make_client(self):  # pragma: no cover - must never run
        raise AssertionError('transcript client must not be built without transcript proxies')

    monkeypatch.setattr(HTTPClient, 'post', fake_post)
    monkeypatch.setattr(HTTPClient, '_make_transcript_client_sync', fail_make_client)

    client = HTTPClient(proxies=['http://normal-1:8001'])
    assert not client.has_transcript_proxies

    response = client.transcript_post(URL, json={'videoId': 'x'})

    assert response.status_code == 200
    assert calls == [(URL, {'videoId': 'x'})]


def test_transcript_get_falls_back_to_normal_get(monkeypatch):
    calls = []

    def fake_get(self, url, **kwargs):
        calls.append(url)
        return httpx.Response(200, text='ok')

    def fail_make_client(self):  # pragma: no cover - must never run
        raise AssertionError('transcript client must not be built without transcript proxies')

    monkeypatch.setattr(HTTPClient, 'get', fake_get)
    monkeypatch.setattr(HTTPClient, '_make_transcript_client_sync', fail_make_client)

    client = HTTPClient()
    response = client.transcript_get('https://www.youtube.com/watch')

    assert response.status_code == 200
    assert calls == ['https://www.youtube.com/watch']


async def test_transcript_async_falls_back_to_normal_channel(monkeypatch):
    calls = []

    async def fake_apost(self, url, json=None, **kwargs):
        calls.append(('post', url))
        return httpx.Response(200, json={'ok': True})

    async def fake_aget(self, url, **kwargs):
        calls.append(('get', url))
        return httpx.Response(200, text='ok')

    monkeypatch.setattr(HTTPClient, 'apost', fake_apost)
    monkeypatch.setattr(HTTPClient, 'aget', fake_aget)

    client = HTTPClient()
    await client.transcript_apost(URL, json={})
    await client.transcript_aget('https://www.youtube.com/watch')

    assert calls == [('post', URL), ('get', 'https://www.youtube.com/watch')]


# ── Exhausted retries ──


def test_transcript_post_error_identifies_transcript_failure(monkeypatch, no_real_backoff):
    """After all retries fail, the RequestError names the transcript request
    and preserves the last failure reason."""
    created = _patch_sync_clients(
        monkeypatch,
        [httpx.Response(429)] * 4,  # max_retries=3 -> 4 attempts, all rate-limited
    )
    client = HTTPClient(
        proxies=['http://normal-1:8001'],
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=3,
    )

    with pytest.raises(RequestError) as exc_info:
        client.transcript_post(URL, json={'videoId': 'x'})

    message = str(exc_info.value)
    assert 'Transcript' in message
    assert '4 attempts' in message
    # Last error reason (RateLimitError's message) is preserved
    assert 'Rate limited' in message
    # Pool wrapped around: t1, t2, t1, t2
    assert created == [
        'http://t1:9001', 'http://t2:9002', 'http://t1:9001', 'http://t2:9002',
    ]
    # Backoff ran between attempts (3 times for 4 attempts)
    assert no_real_backoff == [0, 1, 2]
    # Normal proxy rotation untouched even by a failing transcript request
    assert client._proxy_index == 0
    assert client._sync_client is None


async def test_transcript_aget_error_identifies_transcript_failure(
    monkeypatch, no_real_backoff,
):
    created = _patch_async_clients(
        monkeypatch,
        [httpx.Response(429)] * 2,  # max_retries=1 -> 2 attempts
    )
    client = HTTPClient(
        transcript_proxies=['http://t1:9001', 'http://t2:9002'],
        max_retries=1,
    )

    with pytest.raises(RequestError) as exc_info:
        await client.transcript_aget('https://www.youtube.com/api/timedtext')

    message = str(exc_info.value)
    assert 'Transcript' in message
    assert 'Rate limited' in message
    assert created == ['http://t1:9001', 'http://t2:9002']
    assert client._proxy_index == 0


# ── Isolation of the normal proxy rotation ──


def test_transcript_request_does_not_disturb_normal_rotation(monkeypatch, no_real_backoff):
    """Interleaved transcript requests must not move the normal proxy
    rotation position nor reset the cached normal client."""
    created = _patch_sync_clients(
        monkeypatch,
        [
            httpx.Response(200, json={'n': 1}),  # normal post
            httpx.Response(200, json={'t': 1}),  # transcript post
            httpx.Response(200, json={'n': 2}),  # normal post again
        ],
    )
    client = HTTPClient(
        proxies=['http://n1:8001', 'http://n2:8002'],
        transcript_proxies=['http://t1:9001'],
    )

    client.post(URL, json={})
    normal_client = client._sync_client
    index_before = client._proxy_index

    client.transcript_post(URL, json={})

    assert client._proxy_index == index_before
    assert client._sync_client is normal_client

    client.post(URL, json={})
    # Normal channel kept using its own cached client/pool throughout
    assert created == ['http://n1:8001', 'http://t1:9001']


def test_transcript_proxy_selection_never_touches_normal_pool():
    """With no transcript proxies configured, selecting a transcript proxy
    must not consume the normal pool's rotation."""
    client = HTTPClient(proxies=['http://n1:8001', 'http://n2:8002'])

    assert client._current_transcript_proxy is None
    assert client._proxy_index == 0
