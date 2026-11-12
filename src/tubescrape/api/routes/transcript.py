from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from tubescrape.api.deps import get_youtube
from tubescrape.api.schemas import TranscriptLanguageResponse, TranscriptResponse
from tubescrape.client import YouTube

router = APIRouter()


@router.get('/transcript/{video_id}', response_model=None)
async def get_transcript(
    video_id: str,
    lang: str = Query('en', description='Preferred language code'),
    translate_to: str | None = Query(
        None, description='Translate to this language code',
    ),
    format: str = Query('json', description='Output format (json, text, srt, vtt)'),
    timestamps: bool = Query(True, description='Include timestamps in response'),
    yt: YouTube = Depends(get_youtube),
) -> TranscriptResponse | PlainTextResponse:
    """Fetch transcript for a YouTube video."""
    languages = [lang] if lang else None
    result = await yt.aget_transcript(
        video_id,
        languages=languages,
        timestamps=timestamps,
        translate_to=translate_to,
    )

    if format.lower() in ('text', 'srt', 'vtt', 'webvtt'):
        formatted = YouTube.format_transcript(result, fmt=format)
        return PlainTextResponse(content=formatted)

    return TranscriptResponse(
        video_id=result.video_id,
        language=result.language,
        language_code=result.language_code,
        is_generated=result.is_generated,
        segments=[s.to_dict() for s in result.segments],
        translation_language=result.translation_language,
        text=result.text,
    )


@router.get(
    '/transcript/{video_id}/languages',
    response_model=list[TranscriptLanguageResponse],
)
async def list_transcript_languages(
    video_id: str,
    yt: YouTube = Depends(get_youtube),
) -> list[TranscriptLanguageResponse]:
    """List available transcript languages for a video."""
    entries = await yt.alist_transcripts(video_id)
    return [
        TranscriptLanguageResponse(
            language=e.language,
            language_code=e.language_code,
            is_generated=e.is_generated,
            is_translatable=e.is_translatable,
        )
        for e in entries
    ]
