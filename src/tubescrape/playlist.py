from __future__ import annotations

import logging

from tubescrape._http import HTTPClient
from tubescrape._innertube import InnerTube
from tubescrape._parsers import ResponseParser
from tubescrape.models import PlaylistResult

logger = logging.getLogger('tubescrape.playlist')


class YouTubePlaylist:
    """Fetch YouTube playlist contents via the InnerTube browse API.

    Returns all videos in a playlist with pagination support.

    Args:
        http_client: HTTPClient instance for making requests.
    """

    def __init__(self, http_client: HTTPClient):
        self._http = http_client

    def get_playlist(
        self,
        playlist_id: str,
        max_results: int = 0,
    ) -> PlaylistResult:
        """Fetch videos from a YouTube playlist.

        Args:
            playlist_id: YouTube playlist ID (e.g. 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf').
            max_results: Maximum number of videos. Use 0 for all.

        Returns:
            PlaylistResult with playlist metadata and videos.
        """
        payload = InnerTube.build_playlist_payload(playlist_id)
        response = self._http.post(
            InnerTube.BROWSE_URL,
            json=payload,
            params={'prettyPrint': 'false'},
        )
        data = response.json()

        result, continuation = ResponseParser.parse_playlist_response(
            data, playlist_id,
        )
        page = 1
        logger.info(
            '[page %d] %d videos fetched (total: %d)',
            page, len(result.videos), len(result.videos),
        )

        all_videos = list(result.videos)

        while continuation:
            if max_results > 0 and len(all_videos) >= max_results:
                all_videos = all_videos[:max_results]
                break

            page += 1
            payload = InnerTube.build_playlist_payload(
                playlist_id, continuation=continuation,
            )

            try:
                response = self._http.post(
                    InnerTube.BROWSE_URL,
                    json=payload,
                    params={'prettyPrint': 'false'},
                )
                data = response.json()
            except Exception as exc:
                logger.warning(
                    '[page %d] Playlist continuation failed: %s', page, exc,
                )
                break

            videos, continuation = ResponseParser.parse_playlist_continuation(data)
            if not videos:
                logger.info('[page %d] No more videos, stopping', page)
                break

            all_videos.extend(videos)
            logger.info(
                '[page %d] %d videos fetched (total: %d)',
                page, len(videos), len(all_videos),
            )

        if max_results > 0:
            all_videos = all_videos[:max_results]

        logger.info(
            'Playlist complete: %d pages, %d total videos',
            page, len(all_videos),
        )
        return PlaylistResult(
            playlist_id=playlist_id,
            title=result.title,
            channel=result.channel,
            videos=all_videos,
        )

    async def aget_playlist(
        self,
        playlist_id: str,
        max_results: int = 0,
    ) -> PlaylistResult:
        """Async version of get_playlist."""
        payload = InnerTube.build_playlist_payload(playlist_id)
        response = await self._http.apost(
            InnerTube.BROWSE_URL,
            json=payload,
            params={'prettyPrint': 'false'},
        )
        data = response.json()

        result, continuation = ResponseParser.parse_playlist_response(
            data, playlist_id,
        )
        all_videos = list(result.videos)
        page = 1

        while continuation:
            if max_results > 0 and len(all_videos) >= max_results:
                all_videos = all_videos[:max_results]
                break

            page += 1
            payload = InnerTube.build_playlist_payload(
                playlist_id, continuation=continuation,
            )

            try:
                response = await self._http.apost(
                    InnerTube.BROWSE_URL,
                    json=payload,
                    params={'prettyPrint': 'false'},
                )
                data = response.json()
            except Exception as exc:
                logger.warning(
                    '[page %d] Playlist continuation failed: %s', page, exc,
                )
                break

            videos, continuation = ResponseParser.parse_playlist_continuation(data)
            if not videos:
                break

            all_videos.extend(videos)

        if max_results > 0:
            all_videos = all_videos[:max_results]

        return PlaylistResult(
            playlist_id=playlist_id,
            title=result.title,
            channel=result.channel,
            videos=all_videos,
        )
