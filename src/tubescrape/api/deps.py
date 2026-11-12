from __future__ import annotations

from tubescrape.client import YouTube

_youtube_client: YouTube | None = None


def get_youtube() -> YouTube:
    """Get or create the shared YouTube client instance."""
    global _youtube_client
    if _youtube_client is None:
        _youtube_client = YouTube()
    return _youtube_client


def set_youtube(client: YouTube) -> None:
    """Set the shared YouTube client instance."""
    global _youtube_client
    _youtube_client = client


async def close_youtube() -> None:
    """Close the shared YouTube client."""
    global _youtube_client
    if _youtube_client is not None:
        await _youtube_client.aclose()
        _youtube_client = None
