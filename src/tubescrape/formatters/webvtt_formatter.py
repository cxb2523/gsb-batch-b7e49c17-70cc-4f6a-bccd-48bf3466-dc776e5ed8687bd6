from __future__ import annotations

from tubescrape.formatters._base import Formatter
from tubescrape.models import Transcript


class WebVTTFormatter(Formatter):
    """WebVTT subtitle format.

    Output format:
        WEBVTT

        00:00:00.000 --> 00:00:05.000
        Hello world

        00:00:05.000 --> 00:00:08.500
        Second line
    """

    def format(self, transcript: Transcript) -> str:
        return 'WEBVTT\n\n' + self.format_segments(transcript)

    def format_segments(self, transcript: Transcript) -> str:
        lines: list[str] = []

        for segment in transcript.segments:
            start = self._format_timestamp(segment.start)
            end = self._format_timestamp(segment.start + segment.duration)
            lines.append(f'{start} --> {end}')
            lines.append(segment.text)
            lines.append('')

        return '\n'.join(lines)

    @staticmethod
    def _format_timestamp(seconds: float) -> str:
        """Format seconds as WebVTT timestamp: HH:MM:SS.mmm"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return '%02d:%02d:%02d.%03d' % (hours, minutes, secs, millis)
