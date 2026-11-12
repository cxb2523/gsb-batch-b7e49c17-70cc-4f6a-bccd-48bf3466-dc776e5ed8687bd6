from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from tubescrape.api.deps import get_youtube
from tubescrape.api.schemas import PlaylistResponse
from tubescrape.client import YouTube

router = APIRouter()


@router.get('/playlist/{playlist_id}', response_model=PlaylistResponse)
async def get_playlist(
    playlist_id: str,
    max_results: int = Query(0, ge=0, description='Maximum videos (0 for all)'),
    yt: YouTube = Depends(get_youtube),
) -> PlaylistResponse:
    """Fetch videos from a YouTube playlist."""
    result = await yt.aget_playlist(playlist_id, max_results=max_results)
    return PlaylistResponse(
        playlist_id=result.playlist_id,
        title=result.title,
        channel=result.channel,
        videos=[v.to_dict() for v in result.videos],
        url=result.url,
    )
