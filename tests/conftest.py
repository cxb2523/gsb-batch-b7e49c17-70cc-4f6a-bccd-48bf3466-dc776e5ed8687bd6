"""Pytest configuration and fixtures for ScrapeBadger SDK tests."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock

import pytest

from scrapebadger import ScrapeBadger
from scrapebadger._internal.client import BaseClient
from scrapebadger._internal.config import ClientConfig

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator


@pytest.fixture
def api_key() -> str:
    """Return a test API key."""
    return "test_api_key_12345"


@pytest.fixture
def config(api_key: str) -> ClientConfig:
    """Return a test client configuration."""
    return ClientConfig(
        api_key=api_key,
        base_url="https://api.test.scrapebadger.com",
        timeout=30.0,
        max_retries=1,
    )


@pytest.fixture
def mock_base_client(config: ClientConfig) -> BaseClient:
    """Return a mock base client."""
    client = BaseClient(config)
    client.get = AsyncMock()  # type: ignore[method-assign]
    client.post = AsyncMock()  # type: ignore[method-assign]
    return client


@pytest.fixture
async def client(api_key: str) -> AsyncGenerator[ScrapeBadger, None]:
    """Return a test ScrapeBadger client."""
    async with ScrapeBadger(
        api_key=api_key,
        base_url="https://api.test.scrapebadger.com",
    ) as client:
        yield client


# Sample response data for tests


@pytest.fixture
def sample_user_data() -> dict[str, Any]:
    """Return sample user data."""
    return {
        "id": "44196397",
        "username": "elonmusk",
        "name": "Elon Musk",
        "description": "Mars & Cars, Chips & Dips",
        "location": "Mars",
        "followers_count": 150000000,
        "following_count": 500,
        "tweet_count": 30000,
        "verified": True,
        "is_blue_verified": True,
        "created_at": "2009-06-02T20:12:29.000Z",
        "profile_image_url": "https://pbs.twimg.com/profile_images/example.jpg",
    }


@pytest.fixture
def sample_tweet_data() -> dict[str, Any]:
    """Return sample tweet data."""
    return {
        "id": "1234567890123456789",
        "text": "This is a test tweet about Python programming!",
        "created_at": "2024-01-15T12:00:00.000Z",
        "user_id": "44196397",
        "username": "elonmusk",
        "user_name": "Elon Musk",
        "favorite_count": 50000,
        "retweet_count": 10000,
        "reply_count": 5000,
        "quote_count": 1000,
        "view_count": 1000000,
        "lang": "en",
        "possibly_sensitive": False,
        "is_quote_status": False,
        "is_retweet": False,
    }


@pytest.fixture
def sample_list_data() -> dict[str, Any]:
    """Return sample list data."""
    return {
        "id": "1234567890",
        "name": "Tech Leaders",
        "description": "CEOs and founders of major tech companies",
        "member_count": 50,
        "subscriber_count": 10000,
        "mode": "public",
        "user_id": "44196397",
        "username": "elonmusk",
        "created_at": "2020-01-01T00:00:00.000Z",
    }


@pytest.fixture
def sample_community_data() -> dict[str, Any]:
    """Return sample community data."""
    return {
        "id": "1234567890",
        "name": "Python Developers",
        "description": "A community for Python enthusiasts",
        "member_count": 50000,
        "is_member": True,
        "role": "member",
        "is_nsfw": False,
        "join_policy": "Open",
        "rules": [
            {"id": "1", "name": "Be respectful", "description": "Treat others with respect"},
            {"id": "2", "name": "Stay on topic", "description": "Keep discussions Python-related"},
        ],
    }


@pytest.fixture
def sample_trend_data() -> dict[str, Any]:
    """Return sample trend data."""
    return {
        "name": "#Python",
        "url": "https://twitter.com/search?q=%23Python",
        "query": "#Python",
        "tweet_count": 50000,
        "domain_context": "Technology",
    }


@pytest.fixture
def sample_place_data() -> dict[str, Any]:
    """Return sample place data."""
    return {
        "id": "5a110d312052166f",
        "name": "San Francisco",
        "full_name": "San Francisco, CA",
        "country": "United States",
        "country_code": "US",
        "place_type": "city",
    }
