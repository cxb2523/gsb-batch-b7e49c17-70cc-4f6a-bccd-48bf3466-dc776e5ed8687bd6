from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tubescrape import __version__
from tubescrape.api.deps import close_youtube, set_youtube
from tubescrape.api.routes import channel, playlist, search, transcript
from tubescrape.api.schemas import ErrorResponse, HealthResponse
from tubescrape.client import YouTube
from tubescrape.exceptions import (
    RateLimitError,
    RequestError,
    TranscriptsDisabledError,
    TranscriptsNotAvailableError,
    TranslationNotAvailableError,
    VideoUnavailableError,
    YouTubeError,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage YouTube client lifecycle."""
    yield
    await close_youtube()


def create_app(
    proxy: str | None = None,
    title: str = 'TubeScrape API',
) -> FastAPI:
    """Create and configure the FastAPI application.

    Args:
        proxy: Optional proxy URL for YouTube requests.
        title: API title shown in docs.

    Returns:
        Configured FastAPI application.
    """
    app = FastAPI(
        title=title,
        version=__version__,
        description='YouTube scraping API: search videos, browse channels, fetch transcripts.',
        lifespan=lifespan,
    )

    if proxy:
        set_youtube(YouTube(proxy=proxy))

    # Routes
    app.include_router(search.router, prefix='/api/v1', tags=['search'])
    app.include_router(channel.router, prefix='/api/v1', tags=['channel'])
    app.include_router(playlist.router, prefix='/api/v1', tags=['playlist'])
    app.include_router(transcript.router, prefix='/api/v1', tags=['transcript'])

    # Health check
    @app.get('/health', response_model=HealthResponse, tags=['health'])
    async def health():
        return HealthResponse(version=__version__)

    # Exception handlers
    @app.exception_handler(VideoUnavailableError)
    async def video_unavailable_handler(request: Request, exc: VideoUnavailableError):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(error='video_unavailable', detail=str(exc)).model_dump(),
        )

    @app.exception_handler(TranscriptsNotAvailableError)
    async def transcripts_not_available_handler(
        request: Request, exc: TranscriptsNotAvailableError,
    ):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error='transcripts_not_available', detail=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(TranscriptsDisabledError)
    async def transcripts_disabled_handler(
        request: Request, exc: TranscriptsDisabledError,
    ):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error='transcripts_disabled', detail=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(TranslationNotAvailableError)
    async def translation_not_available_handler(
        request: Request, exc: TranslationNotAvailableError,
    ):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error='translation_not_available', detail=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(RateLimitError)
    async def rate_limit_handler(request: Request, exc: RateLimitError):
        return JSONResponse(
            status_code=429,
            content=ErrorResponse(error='rate_limited', detail=str(exc)).model_dump(),
        )

    @app.exception_handler(RequestError)
    async def request_error_handler(request: Request, exc: RequestError):
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(error='upstream_error', detail=str(exc)).model_dump(),
        )

    @app.exception_handler(YouTubeError)
    async def youtube_error_handler(request: Request, exc: YouTubeError):
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(error='youtube_error', detail=str(exc)).model_dump(),
        )

    return app
