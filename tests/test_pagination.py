"""Tests for pagination with rate-limit-aware throttling."""

from __future__ import annotations

import logging
import time
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from scrapebadger._internal.client import BaseClient
from scrapebadger._internal.config import ClientConfig
from scrapebadger._internal.pagination import paginate


@pytest.fixture
def config() -> ClientConfig:
    return ClientConfig(api_key="test_key", max_retries=1)


@pytest.fixture
def base_client(config: ClientConfig) -> BaseClient:
    return BaseClient(config)


def _make_page(
    items: list[dict[str, Any]],
    next_cursor: str | None = None,
    *,
    remaining: int = 300,
    limit: int = 300,
    reset_at: int | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    reset_ts = reset_at if reset_at is not None else int(time.time()) + 60
    data: dict[str, Any] = {"data": items}
    if next_cursor:
        data["next_cursor"] = next_cursor
    headers = {
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Reset": str(reset_ts),
    }
    return data, headers


class TestPaginateBasic:
    """Tests for basic pagination behaviour (no throttling)."""

    async def test_single_page_no_cursor(self, base_client: BaseClient) -> None:
        """Yields all items from a single page when there is no next_cursor."""
        page, headers = _make_page([{"id": "1"}, {"id": "2"}])
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert base_client.get_with_headers.call_count == 1

    async def test_multiple_pages_follow_cursor(self, base_client: BaseClient) -> None:
        """Follows next_cursor across multiple pages."""
        page1, h1 = _make_page([{"id": "1"}], next_cursor="cur1")
        page2, h2 = _make_page([{"id": "2"}], next_cursor="cur2")
        page3, h3 = _make_page([{"id": "3"}])

        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2), (page3, h3)]
        )

        results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}, {"id": "3"}]
        # second call must include cursor=cur1
        _, kwargs = base_client.get_with_headers.call_args_list[1]
        assert kwargs["params"]["cursor"] == "cur1"

    async def test_max_pages_limits_fetching(self, base_client: BaseClient) -> None:
        """Stops after max_pages regardless of next_cursor."""
        page, headers = _make_page([{"id": "1"}], next_cursor="cur")
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        results = [
            item async for item in paginate(base_client, "/v1/test", {}, lambda x: x, max_pages=2)
        ]

        assert len(results) == 2
        assert base_client.get_with_headers.call_count == 2

    async def test_max_items_limits_yielding(self, base_client: BaseClient) -> None:
        """Stops yielding once max_items is reached."""
        page1, h1 = _make_page([{"id": "1"}, {"id": "2"}, {"id": "3"}], next_cursor="c")
        page2, h2 = _make_page([{"id": "4"}])
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        results = [
            item async for item in paginate(base_client, "/v1/test", {}, lambda x: x, max_items=2)
        ]

        assert len(results) == 2
        assert results == [{"id": "1"}, {"id": "2"}]

    async def test_empty_data_field_stops_iteration(self, base_client: BaseClient) -> None:
        """Treats empty data list as last page."""
        page, headers = _make_page([], next_cursor="ghost")
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == []

    async def test_echoed_cursor_stops_iteration(self, base_client: BaseClient) -> None:
        """Stops when the backend echoes the same cursor it was given (SCR-52).

        A non-advancing cursor would otherwise re-fetch the page just yielded,
        causing the 'repeats first page' loop. Only two pages are mocked, so a
        third call would raise StopIteration and fail this test.
        """
        page1, h1 = _make_page([{"id": "1"}], next_cursor="c")
        page2, h2 = _make_page([{"id": "2"}], next_cursor="c")  # echoes "c"
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert base_client.get_with_headers.call_count == 2

    async def test_item_parser_is_applied(self, base_client: BaseClient) -> None:
        """Applies item_parser to each raw dict."""
        page, headers = _make_page([{"value": 1}, {"value": 2}])
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        results = [
            item async for item in paginate(base_client, "/v1/test", {}, lambda x: x["value"] * 10)
        ]

        assert results == [10, 20]


class TestPaginateRateLimitThrottling:
    """Tests for rate-limit-aware throttling behaviour."""

    async def test_no_sleep_when_remaining_above_threshold(self, base_client: BaseClient) -> None:
        """Does NOT sleep when remaining is above 20% of limit."""
        # 100/300 = 33% > 20% — should not throttle
        page, headers = _make_page([{"id": "1"}], next_cursor=None, remaining=100, limit=300)
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        with patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep:
            results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}]
        mock_sleep.assert_not_called()

    async def test_sleep_when_remaining_below_20_percent(self, base_client: BaseClient) -> None:
        """Sleeps between pages when remaining drops below 20% of limit."""
        reset_ts = int(time.time()) + 60

        # Page 1 triggers throttle (remaining=10, limit=300 → 3.3% < 20%)
        page1, h1 = _make_page(
            [{"id": "1"}], next_cursor="c", remaining=10, limit=300, reset_at=reset_ts
        )
        page2, h2 = _make_page([{"id": "2"}], remaining=5, limit=300, reset_at=reset_ts)
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        with patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep:
            results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        # sleep must be called at least once
        assert mock_sleep.call_count >= 1
        # delay must be positive
        delay_arg = mock_sleep.call_args_list[0][0][0]
        assert delay_arg > 0

    async def test_warning_logged_when_throttling(
        self, base_client: BaseClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Emits a warning log through the 'scrapebadger' logger when throttling."""
        reset_ts = int(time.time()) + 60
        page1, h1 = _make_page(
            [{"id": "1"}], next_cursor="c", remaining=5, limit=300, reset_at=reset_ts
        )
        page2, h2 = _make_page([{"id": "2"}], remaining=5, limit=300, reset_at=reset_ts)
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        with (
            patch("scrapebadger._internal.pagination.asyncio.sleep"),
            caplog.at_level(logging.WARNING, logger="scrapebadger"),
        ):
            results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert any("throttling" in record.message.lower() for record in caplog.records)
        assert any(record.name == "scrapebadger" for record in caplog.records)

    async def test_warning_message_contains_rate_limit_info(
        self, base_client: BaseClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Warning message includes remaining/limit and resets-in info."""
        reset_ts = int(time.time()) + 45
        page1, h1 = _make_page(
            [{"id": "1"}], next_cursor="c", remaining=12, limit=300, reset_at=reset_ts
        )
        page2, h2 = _make_page([{"id": "2"}], remaining=12, limit=300, reset_at=reset_ts)
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        with (
            patch("scrapebadger._internal.pagination.asyncio.sleep"),
            caplog.at_level(logging.WARNING, logger="scrapebadger"),
        ):
            [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        warning_msgs = [r.message for r in caplog.records if r.levelno == logging.WARNING]
        assert warning_msgs, "Expected at least one WARNING log"
        msg = warning_msgs[0]
        assert "12/300" in msg  # remaining/limit

    async def test_missing_rate_limit_headers_no_throttle(self, base_client: BaseClient) -> None:
        """Gracefully handles responses with no rate-limit headers (no sleep)."""
        page: dict[str, Any] = {"data": [{"id": "1"}]}
        headers: dict[str, str] = {}  # no rate limit headers
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        with patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep:
            results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}]
        mock_sleep.assert_not_called()

    async def test_exactly_at_threshold_no_throttle(self, base_client: BaseClient) -> None:
        """Does not throttle when remaining equals exactly 20% of limit."""
        # 60/300 = 20% — boundary, should NOT throttle (strictly below 20%)
        page, headers = _make_page([{"id": "1"}], remaining=60, limit=300)
        base_client.get_with_headers = AsyncMock(return_value=(page, headers))  # type: ignore[method-assign]

        with patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep:
            results = [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}]
        mock_sleep.assert_not_called()

    async def test_one_below_threshold_throttles(self, base_client: BaseClient) -> None:
        """Throttles when remaining is one below 20% of limit."""
        reset_ts = int(time.time()) + 60
        page1, h1 = _make_page(
            [{"id": "1"}], next_cursor="c", remaining=59, limit=300, reset_at=reset_ts
        )
        page2, h2 = _make_page([{"id": "2"}], remaining=59, limit=300, reset_at=reset_ts)
        base_client.get_with_headers = AsyncMock(  # type: ignore[method-assign]
            side_effect=[(page1, h1), (page2, h2)]
        )

        with patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep:
            [item async for item in paginate(base_client, "/v1/test", {}, lambda x: x)]

        assert mock_sleep.call_count >= 1


def _offline_client(handler: Any) -> BaseClient:
    """Build a real BaseClient backed by an in-process MockTransport.

    No network access and no real API key are involved: every request is
    answered by ``handler`` inside the test process.
    """
    config = ClientConfig(
        api_key="offline_test_key",
        base_url="https://api.test.scrapebadger.com",
        max_retries=0,
    )
    client = BaseClient(config)
    client._client = httpx.AsyncClient(
        base_url=config.base_url,
        transport=httpx.MockTransport(handler),
    )
    return client


def _rate_headers(remaining: int | str, limit: int | str, reset: int | str) -> dict[str, str]:
    return {
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Reset": str(reset),
    }


def _paged_handler(pages: dict[str | None, dict[str, Any]]) -> Any:
    """Serve ``pages`` keyed by the ``cursor`` query parameter.

    The handler asserts when an unexpected cursor is requested, so a bug that
    fetches one page too many fails loudly instead of silently succeeding.
    """
    requests: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursor = request.url.params.get("cursor")
        requests.append(cursor)
        if cursor not in pages:
            msg = f"unexpected request for cursor {cursor!r}; fetched {requests}"
            raise AssertionError(msg)
        page = pages[cursor]
        return httpx.Response(
            200,
            json=page["body"],
            headers=page.get("headers", {}),
        )

    handler.requested_cursors = requests  # type: ignore[attr-defined]
    return handler


class TestPaginateOfflineTransport:
    """End-to-end pagination tests over httpx.MockTransport (no network)."""

    async def test_cursor_stall_stops_without_refetching(self) -> None:
        """A backend echoing the supplied cursor is not asked for another page."""
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "cursor-a"},
                    "headers": _rate_headers(300, 300, int(time.time()) + 60),
                },
                "cursor-a": {
                    # Echoes the cursor it was given — the classic repeat-page bug.
                    "body": {"data": [{"id": "2"}], "next_cursor": "cursor-a"},
                    "headers": _rate_headers(299, 300, int(time.time()) + 60),
                },
            }
        )

        async with _offline_client(handler) as client:
            results = [item async for item in paginate(client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert handler.requested_cursors == [None, "cursor-a"]

    @pytest.mark.parametrize(
        "headers",
        [
            {},  # all three missing
            {"X-RateLimit-Remaining": "0", "X-RateLimit-Limit": "10"},  # reset missing
            {
                "X-RateLimit-Remaining": "",
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Reset": "1000",
            },  # empty remaining
            {
                "X-RateLimit-Remaining": "not-a-number",
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Reset": "1000",
            },  # non-numeric remaining
            {
                "X-RateLimit-Remaining": "  ",
                "X-RateLimit-Limit": "abc",
                "X-RateLimit-Reset": "1000",
            },  # blank/non-numeric limit
        ],
    )
    async def test_malformed_rate_limit_headers_do_not_throttle_or_raise(
        self,
        headers: dict[str, str],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Missing/empty/non-numeric headers are treated as 'no throttling'."""
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "c"},
                    "headers": headers,
                },
                "c": {"body": {"data": [{"id": "2"}]}, "headers": headers},
            }
        )

        with (
            patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep,
            caplog.at_level(logging.WARNING, logger="scrapebadger"),
        ):
            async with _offline_client(handler) as client:
                results = [item async for item in paginate(client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        mock_sleep.assert_not_called()
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]

    async def test_max_items_exactly_filling_page_does_not_fetch_extra_page(self) -> None:
        """max_items is enforced before the next request, even at a page boundary."""
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}, {"id": "2"}], "next_cursor": "c"},
                    "headers": _rate_headers(300, 300, int(time.time()) + 60),
                },
                # This page must never be requested.
                "c": {"body": {"data": [{"id": "3"}]}},
            }
        )

        async with _offline_client(handler) as client:
            results = [
                item
                async for item in paginate(client, "/v1/test", {}, lambda x: x, max_items=2)
            ]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert handler.requested_cursors == [None]

    async def test_max_items_below_page_size_truncates_mid_page(self) -> None:
        """A partially consumed page still fetches exactly the pages needed."""
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}, {"id": "2"}], "next_cursor": "c1"},
                    "headers": _rate_headers(300, 300, int(time.time()) + 60),
                },
                "c1": {
                    "body": {"data": [{"id": "3"}, {"id": "4"}], "next_cursor": "c2"},
                    "headers": _rate_headers(299, 300, int(time.time()) + 60),
                },
                "c2": {"body": {"data": [{"id": "5"}]}},
            }
        )

        async with _offline_client(handler) as client:
            results = [
                item
                async for item in paginate(client, "/v1/test", {}, lambda x: x, max_items=3)
            ]

        assert results == [{"id": "1"}, {"id": "2"}, {"id": "3"}]
        assert handler.requested_cursors == [None, "c1"]

    async def test_max_pages_stops_fetching(self) -> None:
        """max_pages caps requests independently of max_items."""
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "c1"},
                    "headers": _rate_headers(300, 300, int(time.time()) + 60),
                },
                "c1": {"body": {"data": [{"id": "2"}], "next_cursor": "c2"}},
            }
        )

        async with _offline_client(handler) as client:
            results = [
                item async for item in paginate(client, "/v1/test", {}, lambda x: x, max_pages=2)
            ]

        assert results == [{"id": "1"}, {"id": "2"}]
        assert handler.requested_cursors == [None, "c1"]

    async def test_exhausted_quota_waits_for_window_reset(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """remaining=0 sleeps for the whole remaining window, then continues."""
        now = 1_000_000.0
        reset_ts = int(now) + 40
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "c"},
                    "headers": _rate_headers(0, 100, reset_ts),
                },
                "c": {"body": {"data": [{"id": "2"}]}, "headers": _rate_headers(0, 100, reset_ts)},
            }
        )

        with (
            patch("scrapebadger._internal.pagination.time.time", return_value=now),
            patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep,
            caplog.at_level(logging.WARNING, logger="scrapebadger"),
        ):
            async with _offline_client(handler) as client:
                results = [item async for item in paginate(client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        mock_sleep.assert_called_once_with(40.0)
        warning = next(r for r in caplog.records if r.levelno == logging.WARNING)
        assert "0/100" in warning.message
        assert "40s" in warning.message

    async def test_low_quota_delay_is_window_per_remaining(self) -> None:
        """Positive remaining spreads the window evenly over remaining requests."""
        now = 1_000_000.0
        reset_ts = int(now) + 10
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "c"},
                    "headers": _rate_headers(2, 100, reset_ts),
                },
                "c": {"body": {"data": [{"id": "2"}]}, "headers": _rate_headers(1, 100, reset_ts)},
            }
        )

        with (
            patch("scrapebadger._internal.pagination.time.time", return_value=now),
            patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep,
        ):
            async with _offline_client(handler) as client:
                results = [item async for item in paginate(client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        mock_sleep.assert_called_once_with(5.0)

    async def test_throttle_delay_never_below_minimum(self) -> None:
        """A nearly expired window still yields the 0.05 s floor."""
        now = 1_000_000.0
        reset_ts = int(now)  # window expires now
        handler = _paged_handler(
            {
                None: {
                    "body": {"data": [{"id": "1"}], "next_cursor": "c"},
                    "headers": _rate_headers(0, 100, reset_ts),
                },
                "c": {"body": {"data": [{"id": "2"}]}, "headers": _rate_headers(0, 100, reset_ts)},
            }
        )

        with (
            patch("scrapebadger._internal.pagination.time.time", return_value=now),
            patch("scrapebadger._internal.pagination.asyncio.sleep") as mock_sleep,
        ):
            async with _offline_client(handler) as client:
                results = [item async for item in paginate(client, "/v1/test", {}, lambda x: x)]

        assert results == [{"id": "1"}, {"id": "2"}]
        mock_sleep.assert_called_once_with(0.05)
