from __future__ import annotations

from tubescrape.formatters._base import Formatter
from tubescrape.formatters.json_formatter import JSONFormatter
from tubescrape.formatters.srt_formatter import SRTFormatter
from tubescrape.formatters.text_formatter import TextFormatter
from tubescrape.formatters.webvtt_formatter import WebVTTFormatter

FORMATTERS: dict[str, type[Formatter]] = {
    'json': JSONFormatter,
    'text': TextFormatter,
    'txt': TextFormatter,
    'srt': SRTFormatter,
    'webvtt': WebVTTFormatter,
    'vtt': WebVTTFormatter,
}


def get_formatter(name: str) -> Formatter:
    """Get a formatter instance by name.

    Args:
        name: Formatter name ('json', 'text', 'txt', 'srt', 'webvtt', 'vtt').

    Returns:
        Formatter instance.

    Raises:
        ValueError: If the formatter name is not recognized.
    """
    formatter_cls = FORMATTERS.get(name.lower())
    if formatter_cls is None:
        available = ', '.join(sorted(FORMATTERS.keys()))
        raise ValueError(
            f'Unknown formatter: {name!r}. Available: {available}'
        )
    return formatter_cls()


__all__ = [
    'Formatter',
    'JSONFormatter',
    'SRTFormatter',
    'TextFormatter',
    'WebVTTFormatter',
    'get_formatter',
    'FORMATTERS',
]
