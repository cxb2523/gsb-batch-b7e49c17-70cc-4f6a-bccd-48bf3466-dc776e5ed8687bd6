from __future__ import annotations

import json

from tubescrape.formatters._base import Formatter
from tubescrape.models import Transcript


class JSONFormatter(Formatter):
    """JSON formatter — outputs transcript as structured JSON."""

    def format(self, transcript: Transcript) -> str:
        return json.dumps(transcript.to_dict(), indent=2, ensure_ascii=False)

    def format_segments(self, transcript: Transcript) -> str:
        return json.dumps(
            [s.to_dict() for s in transcript.segments],
            indent=2,
            ensure_ascii=False,
        )
