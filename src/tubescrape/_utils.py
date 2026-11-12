from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


class URLParser:
    """Extract video IDs and channel IDs from various YouTube URL formats.

    All methods are static — no instance state needed.

    Supported video URL formats:
        https://www.youtube.com/watch?v=dQw4w9WgXcQ
        https://youtu.be/dQw4w9WgXcQ
        https://www.youtube.com/embed/dQw4w9WgXcQ
        https://www.youtube.com/v/dQw4w9WgXcQ
        https://www.youtube.com/shorts/dQw4w9WgXcQ
        https://www.youtube.com/live/dQw4w9WgXcQ
        dQw4w9WgXcQ  (plain ID)

    Supported channel URL formats:
        https://www.youtube.com/channel/UCxxxxxx
        https://www.youtube.com/@handle
        https://www.youtube.com/c/ChannelName
        https://www.youtube.com/user/Username
        UCxxxxxx  (plain ID)
    """

    # YouTube video IDs are exactly 11 characters: [A-Za-z0-9_-]
    _VIDEO_ID_PATTERN: re.Pattern = re.compile(r'^[A-Za-z0-9_-]{11}$')

    # Channel IDs start with UC and are 24 characters
    _CHANNEL_ID_PATTERN: re.Pattern = re.compile(r'^UC[A-Za-z0-9_-]{22}$')

    # Path patterns for video extraction
    _VIDEO_PATH_PATTERNS: tuple[re.Pattern, ...] = (
        re.compile(r'^/(?:embed|v|shorts|live)/([A-Za-z0-9_-]{11})'),
    )

    @staticmethod
    def extract_video_id(url_or_id: str) -> str:
        """Extract a video ID from a URL or return the ID if already plain.

        Args:
            url_or_id: YouTube video URL or plain video ID.

        Returns:
            11-character video ID string.

        Raises:
            ValueError: If the input cannot be parsed as a video ID.
        """
        url_or_id = url_or_id.strip()

        # Plain ID
        if URLParser._VIDEO_ID_PATTERN.match(url_or_id):
            return url_or_id

        try:
            parsed = urlparse(url_or_id)
        except Exception as exc:
            raise ValueError(f'Invalid video URL or ID: {url_or_id}') from exc

        host = (parsed.hostname or '').lower().replace('www.', '')

        # youtu.be/ID
        if host == 'youtu.be':
            video_id = parsed.path.lstrip('/')
            if URLParser._VIDEO_ID_PATTERN.match(video_id):
                return video_id

        # youtube.com/watch?v=ID
        if host in ('youtube.com', 'm.youtube.com', 'music.youtube.com'):
            # /watch?v=ID
            if parsed.path == '/watch':
                qs = parse_qs(parsed.query)
                v = qs.get('v', [None])[0]
                if v and URLParser._VIDEO_ID_PATTERN.match(v):
                    return v

            # /embed/ID, /v/ID, /shorts/ID, /live/ID
            for pattern in URLParser._VIDEO_PATH_PATTERNS:
                match = pattern.match(parsed.path)
                if match:
                    return match.group(1)

        raise ValueError(f'Could not extract video ID from: {url_or_id}')

    @staticmethod
    def extract_channel_id(url_or_id: str) -> str | None:
        """Extract a channel ID from a URL, or return the ID if already plain.

        For @handle and /c/ and /user/ URLs, returns a special prefixed
        string that indicates resolution is needed (e.g. '@handle').
        These must be resolved by fetching the channel page.

        Args:
            url_or_id: YouTube channel URL, @handle, or plain channel ID.

        Returns:
            Channel ID string (UC...) or handle string (@handle, /c/Name, /user/Name)
            that needs further resolution.

        Raises:
            ValueError: If the input cannot be parsed.
        """
        url_or_id = url_or_id.strip()

        # Plain channel ID (UC + 22 chars)
        if URLParser._CHANNEL_ID_PATTERN.match(url_or_id):
            return url_or_id

        # @handle without URL
        if url_or_id.startswith('@'):
            return url_or_id

        try:
            parsed = urlparse(url_or_id)
        except Exception as exc:
            raise ValueError(f'Invalid channel URL or ID: {url_or_id}') from exc

        host = (parsed.hostname or '').lower().replace('www.', '')

        if host not in ('youtube.com', 'm.youtube.com', ''):
            raise ValueError(f'Not a YouTube URL: {url_or_id}')

        path = parsed.path.rstrip('/')

        # /channel/UCxxxxxxx
        match = re.match(r'^/channel/(UC[A-Za-z0-9_-]{22})', path)
        if match:
            return match.group(1)

        # /@handle
        match = re.match(r'^/(@[A-Za-z0-9_.]+)', path)
        if match:
            return match.group(1)

        # /c/ChannelName
        match = re.match(r'^/c/([^/]+)', path)
        if match:
            return f'/c/{match.group(1)}'

        # /user/Username
        match = re.match(r'^/user/([^/]+)', path)
        if match:
            return f'/user/{match.group(1)}'

        raise ValueError(f'Could not extract channel ID from: {url_or_id}')

    @staticmethod
    def extract_playlist_id(url_or_id: str) -> str:
        """Extract a playlist ID from a URL or return the ID if already plain.

        Args:
            url_or_id: YouTube playlist URL or plain playlist ID.

        Returns:
            Playlist ID string (e.g. 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf').

        Raises:
            ValueError: If the input cannot be parsed as a playlist ID.
        """
        url_or_id = url_or_id.strip()

        # Plain playlist ID (starts with PL, OL, UU, LL, FL, or RD)
        if re.match(r'^(PL|OL|UU|LL|FL|RD)[A-Za-z0-9_-]+$', url_or_id):
            return url_or_id

        try:
            parsed = urlparse(url_or_id)
        except Exception as exc:
            raise ValueError(f'Invalid playlist URL or ID: {url_or_id}') from exc

        host = (parsed.hostname or '').lower().replace('www.', '')
        if host in ('youtube.com', 'm.youtube.com', 'music.youtube.com'):
            qs = parse_qs(parsed.query)
            playlist_id = qs.get('list', [None])[0]
            if playlist_id:
                return playlist_id

        raise ValueError(f'Could not extract playlist ID from: {url_or_id}')

    @staticmethod
    def is_url(value: str) -> bool:
        """Check if a string looks like a URL (has scheme or known domain)."""
        value = value.strip()
        if value.startswith(('http://', 'https://', 'youtu.be/')):
            return True
        return 'youtube.com' in value
