from __future__ import annotations

import pytest

from tubescrape._utils import URLParser


class TestExtractVideoId:
    """Test video ID extraction from various URL formats."""

    def test_plain_id(self):
        assert URLParser.extract_video_id('dQw4w9WgXcQ') == 'dQw4w9WgXcQ'

    def test_watch_url(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_watch_url_with_extra_params(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PL123'
        ) == 'dQw4w9WgXcQ'

    def test_short_url(self):
        assert URLParser.extract_video_id('https://youtu.be/dQw4w9WgXcQ') == 'dQw4w9WgXcQ'

    def test_embed_url(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/embed/dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_v_url(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/v/dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_shorts_url(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/shorts/dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_live_url(self):
        assert URLParser.extract_video_id(
            'https://www.youtube.com/live/dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_mobile_url(self):
        assert URLParser.extract_video_id(
            'https://m.youtube.com/watch?v=dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_music_url(self):
        assert URLParser.extract_video_id(
            'https://music.youtube.com/watch?v=dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_no_www(self):
        assert URLParser.extract_video_id(
            'https://youtube.com/watch?v=dQw4w9WgXcQ'
        ) == 'dQw4w9WgXcQ'

    def test_whitespace_stripped(self):
        assert URLParser.extract_video_id('  dQw4w9WgXcQ  ') == 'dQw4w9WgXcQ'

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_video_id('not-a-valid-id')

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_video_id('')

    def test_random_url_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_video_id('https://google.com')


class TestExtractChannelId:
    """Test channel ID extraction from various URL formats."""

    def test_plain_channel_id(self):
        assert URLParser.extract_channel_id(
            'UCmeeY9kzNswUpbYyJntb3Aw'
        ) == 'UCmeeY9kzNswUpbYyJntb3Aw'

    def test_channel_url(self):
        assert URLParser.extract_channel_id(
            'https://www.youtube.com/channel/UCmeeY9kzNswUpbYyJntb3Aw'
        ) == 'UCmeeY9kzNswUpbYyJntb3Aw'

    def test_handle_plain(self):
        assert URLParser.extract_channel_id('@lexfridman') == '@lexfridman'

    def test_handle_url(self):
        assert URLParser.extract_channel_id(
            'https://www.youtube.com/@lexfridman'
        ) == '@lexfridman'

    def test_c_url(self):
        result = URLParser.extract_channel_id(
            'https://www.youtube.com/c/ProgrammingWithMosh'
        )
        assert result == '/c/ProgrammingWithMosh'

    def test_user_url(self):
        result = URLParser.extract_channel_id(
            'https://www.youtube.com/user/schaaborern'
        )
        assert result == '/user/schaaborern'

    def test_trailing_slash(self):
        assert URLParser.extract_channel_id(
            'https://www.youtube.com/channel/UCmeeY9kzNswUpbYyJntb3Aw/'
        ) == 'UCmeeY9kzNswUpbYyJntb3Aw'

    def test_whitespace_stripped(self):
        assert URLParser.extract_channel_id(
            '  UCmeeY9kzNswUpbYyJntb3Aw  '
        ) == 'UCmeeY9kzNswUpbYyJntb3Aw'

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_channel_id('https://google.com/something')


class TestExtractPlaylistId:
    """Test playlist ID extraction from various URL formats."""

    def test_plain_id(self):
        assert URLParser.extract_playlist_id(
            'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
        ) == 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

    def test_playlist_url(self):
        assert URLParser.extract_playlist_id(
            'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
        ) == 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

    def test_watch_url_with_list(self):
        assert URLParser.extract_playlist_id(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
        ) == 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

    def test_ol_prefix(self):
        assert URLParser.extract_playlist_id('OLAKxxxxxx') == 'OLAKxxxxxx'

    def test_rd_prefix(self):
        assert URLParser.extract_playlist_id('RDdQw4w9WgXcQ') == 'RDdQw4w9WgXcQ'

    def test_whitespace_stripped(self):
        assert URLParser.extract_playlist_id(
            '  PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf  '
        ) == 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_playlist_id('not-a-playlist')

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_playlist_id('')

    def test_random_url_raises(self):
        with pytest.raises(ValueError):
            URLParser.extract_playlist_id('https://google.com')


class TestIsUrl:
    def test_https(self):
        assert URLParser.is_url('https://www.youtube.com/watch?v=abc')

    def test_http(self):
        assert URLParser.is_url('http://youtube.com')

    def test_youtu_be(self):
        assert URLParser.is_url('youtu.be/abc')

    def test_plain_id(self):
        assert not URLParser.is_url('dQw4w9WgXcQ')

    def test_handle(self):
        assert not URLParser.is_url('@lexfridman')
