"""Provider initialization for the scraper MCP server."""

from __future__ import annotations

import logging
import os

from scraper_mcp.providers import RequestsProvider, ScraperProvider

# Configure logging
logger = logging.getLogger(__name__)

# Initialize default provider (requests-based, no JS rendering)
# This is used by both the server and tools modules
default_provider: ScraperProvider = RequestsProvider()

# Playwright provider (lazily initialized)
_playwright_provider: ScraperProvider | None = None

# Check if Playwright is enabled via environment variable
PLAYWRIGHT_ENABLED = os.getenv("PLAYWRIGHT_ENABLED", "true").lower() in ("true", "1", "yes")


def get_playwright_provider() -> ScraperProvider | None:
    """Get the Playwright provider instance (lazy initialization).

    Returns:
        PlaywrightProvider instance if available and enabled, None otherwise
    """
    global _playwright_provider

    if not PLAYWRIGHT_ENABLED:
        return None

    if _playwright_provider is None:
        try:
            from scraper_mcp.providers import PlaywrightProvider, is_playwright_available

            if is_playwright_available():
                _playwright_provider = PlaywrightProvider()
                logger.info("Playwright provider initialized")
            else:
                logger.warning(
                    "Playwright not installed. JavaScript rendering disabled. "
                    "Install with: pip install playwright && playwright install chromium"
                )
        except ImportError:
            logger.warning("Playwright module not available")

    return _playwright_provider


def get_provider(url: str, render_js: bool = False) -> ScraperProvider:
    """Get the appropriate provider for a URL.

    Args:
        url: The URL to scrape
        render_js: If True, use Playwright for JavaScript rendering

    Returns:
        A scraper provider that supports the URL

    Raises:
        ValueError: If no provider supports the URL
        RuntimeError: If render_js=True but Playwright is not available
    """
    # If JavaScript rendering requested, try Playwright
    if render_js:
        playwright = get_playwright_provider()
        if playwright is None:
            raise RuntimeError(
                "JavaScript rendering requested but Playwright is not available. "
                "Install with: pip install playwright && playwright install chromium"
            )
        if playwright.supports_url(url):
            return playwright
        raise ValueError(f"Playwright provider does not support URL: {url}")

    # Default to requests-based provider
    if default_provider.supports_url(url):
        return default_provider

    raise ValueError(f"No provider supports URL: {url}")
