from __future__ import annotations

from abc import ABC, abstractmethod

from tubescrape.models import Transcript


class Formatter(ABC):
    """Abstract base class for transcript formatters."""

    @abstractmethod
    def format(self, transcript: Transcript) -> str:
        """Format a transcript into a string representation.

        Args:
            transcript: Transcript object to format.

        Returns:
            Formatted string.
        """

    @abstractmethod
    def format_segments(self, transcript: Transcript) -> str:
        """Format only the segments portion of a transcript.

        Args:
            transcript: Transcript object containing segments.

        Returns:
            Formatted string of segments only.
        """
