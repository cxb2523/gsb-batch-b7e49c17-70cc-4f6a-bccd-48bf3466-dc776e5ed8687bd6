from __future__ import annotations

from tubescrape.formatters._base import Formatter
from tubescrape.models import Transcript


class TextFormatter(Formatter):
    """Plain text formatter — joins all segments into readable text."""

    def format(self, transcript: Transcript) -> str:
        return self.format_segments(transcript)

    def format_segments(self, transcript: Transcript) -> str:
        return ' '.join(segment.text for segment in transcript.segments)
