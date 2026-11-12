"""Scraper providers for different scraping backends."""

from scraper_mcp.providers.base import ScrapeResult, ScraperProvider
from scraper_mcp.providers.playwright_provider import (
    PlaywrightProvider,
    get_browser_pool,
    get_playwright_provider,
    is_playwright_available,
    shutdown_browser_pool,
)
from scraper_mcp.providers.requests_provider import RequestsProvider

__all__ = [
    "PlaywrightProvider",
    "RequestsProvider",
    "ScrapeResult",
    "ScraperProvider",
    "get_browser_pool",
    "get_playwright_provider",
    "is_playwright_available",
    "shutdown_browser_pool",
]
