from __future__ import annotations

import pytest

from tubescrape.models import Transcript, TranscriptSegment, VideoResult


@pytest.fixture
def sample_video() -> VideoResult:
    return VideoResult(
        video_id='dQw4w9WgXcQ',
        title='Rick Astley - Never Gonna Give You Up',
        channel='Rick Astley',
        channel_id='UCuAXFkgsw1L7xaCfnd5JJOw',
        duration='3:32',
        duration_seconds=212,
        published_text='15 years ago',
        url='https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )


@pytest.fixture
def sample_transcript() -> Transcript:
    return Transcript(
        video_id='dQw4w9WgXcQ',
        language='English',
        language_code='en',
        is_generated=True,
        segments=[
            TranscriptSegment(text='Never gonna give you up', start=0.0, duration=3.5),
            TranscriptSegment(text='Never gonna let you down', start=3.5, duration=3.0),
            TranscriptSegment(text='Never gonna run around and desert you', start=6.5, duration=4.0),
        ],
    )
