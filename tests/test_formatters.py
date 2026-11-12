from __future__ import annotations

import json

from tubescrape.formatters import get_formatter
from tubescrape.models import Transcript, TranscriptSegment


def _make_transcript() -> Transcript:
    return Transcript(
        video_id='test123',
        language='English',
        language_code='en',
        is_generated=True,
        segments=[
            TranscriptSegment(text='Hello world', start=0.0, duration=5.0),
            TranscriptSegment(text='Second line', start=5.0, duration=3.5),
        ],
    )


class TestTextFormatter:
    def test_format(self):
        fmt = get_formatter('text')
        result = fmt.format(_make_transcript())
        assert result == 'Hello world Second line'


class TestJSONFormatter:
    def test_format(self):
        fmt = get_formatter('json')
        result = fmt.format(_make_transcript())
        data = json.loads(result)
        assert data['video_id'] == 'test123'
        assert len(data['segments']) == 2
        assert data['segments'][0]['text'] == 'Hello world'


class TestSRTFormatter:
    def test_format(self):
        fmt = get_formatter('srt')
        result = fmt.format(_make_transcript())
        lines = result.strip().split('\n')
        assert lines[0] == '1'
        assert lines[1] == '00:00:00,000 --> 00:00:05,000'
        assert lines[2] == 'Hello world'
        assert lines[4] == '2'
        assert lines[5] == '00:00:05,000 --> 00:00:08,500'


class TestWebVTTFormatter:
    def test_format(self):
        fmt = get_formatter('vtt')
        result = fmt.format(_make_transcript())
        assert result.startswith('WEBVTT')
        assert '00:00:00.000 --> 00:00:05.000' in result
        assert 'Hello world' in result


class TestGetFormatter:
    def test_valid_names(self):
        for name in ('text', 'txt', 'json', 'srt', 'vtt', 'webvtt'):
            fmt = get_formatter(name)
            assert fmt is not None

    def test_invalid_name(self):
        try:
            get_formatter('invalid')
            assert False, 'Should have raised ValueError'
        except ValueError as e:
            assert 'Unknown formatter' in str(e)
