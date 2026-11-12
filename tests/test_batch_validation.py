"""Tests for per-item validation in batch scraping tools.

Covers mixed batches containing valid URLs, unsupported-protocol URLs,
malformed addresses, and invalid CSS selectors. Each item must produce an
independent, checkable result without affecting the rest of the batch.
"""

from __future__ import annotations

from typing import Any

import pytest

from scraper_mcp.providers import ScrapeResult
from scraper_mcp.tools import service as tools_service
from scraper_mcp.tools.router import (
    scrape_extract_links,
    scrape_url,
    scrape_url_html,
    scrape_url_text,
)

TEST_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="description" content="Batch validation test page">
    <title>Batch Test Page</title>
    <script>console.log('must be stripped in text mode');</script>
    <style>.x { color: red; }</style>
</head>
<body>
    <h1>Batch Heading</h1>
    <p class="content">Body paragraph text.</p>
    <a href="/relative/path">Relative Link</a>
    <a href="https://external.example/abs">Absolute Link</a>
</body>
</html>
"""

VALID_URL_1 = "https://ok1.example/page"
VALID_URL_2 = "http://ok2.example/other"
FTP_URL = "ftp://files.example/resource"
MALFORMED_URL = "not a url at all"

MIXED_URLS = [VALID_URL_1, FTP_URL, MALFORMED_URL, VALID_URL_2]

BAD_SELECTOR = "div["
NO_MATCH_SELECTOR = ".does-not-exist"


class FakeProvider:
    """Fake scraper provider returning self-made HTML without network access."""

    def __init__(self, html: str = TEST_HTML, final_url: str | None = None) -> None:
        self.html = html
        self.final_url = final_url
        self.requested_urls: list[str] = []

    async def scrape(self, url: str, **kwargs: Any) -> ScrapeResult:
        self.requested_urls.append(url)
        return ScrapeResult(
            url=self.final_url or url,
            content=self.html,
            status_code=200,
            content_type="text/html",
            metadata={"elapsed_ms": 1.0},
        )

    def supports_url(self, url: str) -> bool:
        return url.startswith(("http://", "https://"))


@pytest.fixture
def fake_provider(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    """Patch provider selection so batch tools use a fake provider."""
    provider = FakeProvider()
    monkeypatch.setattr(tools_service, "get_provider", lambda url, render_js=False: provider)
    monkeypatch.setattr(tools_service, "default_provider", provider)
    return provider


def results_by_url(response: Any) -> dict[str, Any]:
    """Index batch results by URL for easy per-item assertions."""
    return {item.url: item for item in response.results}


class TestMixedBatchUrlValidation:
    """A batch mixing valid, unsupported-protocol, and malformed URLs."""

    async def test_mixed_batch_counts_and_per_item_errors(
        self, fake_provider: FakeProvider
    ) -> None:
        response = await scrape_url(MIXED_URLS)

        assert response.total == len(MIXED_URLS)
        assert response.successful == 2
        assert response.failed == 2
        assert len(response.results) == len(MIXED_URLS)

        items = results_by_url(response)

        # Valid URLs succeeded with real data
        assert items[VALID_URL_1].success is True
        assert items[VALID_URL_1].data is not None
        assert items[VALID_URL_2].success is True

        # Unsupported protocol: error names the scheme and the supported ones
        ftp_item = items[FTP_URL]
        assert ftp_item.success is False
        assert ftp_item.data is None
        assert ftp_item.error is not None
        assert "ftp" in ftp_item.error
        assert "http" in ftp_item.error  # points at supported schemes

        # Malformed address: error says the address could not be parsed
        bad_item = items[MALFORMED_URL]
        assert bad_item.success is False
        assert bad_item.data is None
        assert bad_item.error is not None
        assert "could not be parsed" in bad_item.error

        # The two failure causes are distinguishable
        assert ftp_item.error != bad_item.error

    async def test_invalid_urls_are_never_scraped(self, fake_provider: FakeProvider) -> None:
        await scrape_url(MIXED_URLS)

        # Only genuinely valid URLs reached the provider
        assert sorted(fake_provider.requested_urls) == sorted([VALID_URL_1, VALID_URL_2])

    async def test_all_invalid_batch_does_not_raise(self, fake_provider: FakeProvider) -> None:
        response = await scrape_url([FTP_URL, MALFORMED_URL])

        assert response.total == 2
        assert response.successful == 0
        assert response.failed == 2
        assert fake_provider.requested_urls == []

    async def test_empty_batch(self, fake_provider: FakeProvider) -> None:
        response = await scrape_url([])

        assert response.total == 0
        assert response.successful == 0
        assert response.failed == 0


class TestCssSelectorValidation:
    """Invalid CSS selectors fail only their own item, never the batch."""

    async def test_invalid_selector_fails_item_with_selector_in_error(
        self, fake_provider: FakeProvider
    ) -> None:
        response = await scrape_url([VALID_URL_1], css_selector=BAD_SELECTOR)

        assert response.total == 1
        assert response.successful == 0
        assert response.failed == 1

        item = response.results[0]
        assert item.success is False
        assert item.error is not None
        assert BAD_SELECTOR in item.error

    async def test_invalid_selector_does_not_trigger_scrape(
        self, fake_provider: FakeProvider
    ) -> None:
        await scrape_url([VALID_URL_1], css_selector=BAD_SELECTOR)

        assert fake_provider.requested_urls == []

    async def test_invalid_selector_error_does_not_bubble_and_url_errors_win(
        self, fake_provider: FakeProvider
    ) -> None:
        # Bad selector plus a mixed batch: no exception, each item keeps
        # its own failure reason (URL validation reported for bad URLs).
        response = await scrape_url_html([VALID_URL_1, FTP_URL], css_selector=BAD_SELECTOR)

        assert response.total == 2
        assert response.failed == 2

        items = results_by_url(response)
        assert BAD_SELECTOR in (items[VALID_URL_1].error or "")
        assert "ftp" in (items[FTP_URL].error or "")

    async def test_valid_selector_without_match_is_success(
        self, fake_provider: FakeProvider
    ) -> None:
        response = await scrape_url_html([VALID_URL_1], css_selector=NO_MATCH_SELECTOR)

        assert response.total == 1
        assert response.successful == 1
        assert response.failed == 0

        item = response.results[0]
        assert item.success is True
        assert item.data is not None
        assert item.data.content == ""
        assert item.data.metadata["elements_matched"] == 0
        assert item.data.metadata["css_selector_applied"] == NO_MATCH_SELECTOR


class TestAllToolsMixedBatch:
    """All four batch tools survive mixed input without raising."""

    @pytest.mark.parametrize(
        "tool",
        [scrape_url, scrape_url_html, scrape_url_text, scrape_extract_links],
    )
    async def test_mixed_urls_never_raise(self, tool: Any, fake_provider: FakeProvider) -> None:
        response = await tool(MIXED_URLS)

        assert response.total == len(MIXED_URLS)
        assert response.successful == 2
        assert response.failed == 2

        items = results_by_url(response)
        assert items[VALID_URL_1].success is True
        assert items[VALID_URL_2].success is True
        assert items[FTP_URL].success is False
        assert "ftp" in (items[FTP_URL].error or "")
        assert items[MALFORMED_URL].success is False
        assert "could not be parsed" in (items[MALFORMED_URL].error or "")

    @pytest.mark.parametrize(
        "tool",
        [scrape_url, scrape_url_html, scrape_url_text, scrape_extract_links],
    )
    async def test_bad_selector_never_raises(self, tool: Any, fake_provider: FakeProvider) -> None:
        response = await tool([VALID_URL_1, VALID_URL_2], css_selector=BAD_SELECTOR)

        assert response.total == 2
        assert response.successful == 0
        assert response.failed == 2
        for item in response.results:
            assert item.success is False
            assert BAD_SELECTOR in (item.error or "")


class TestSuccessSemanticsPreserved:
    """Successful items keep their existing per-tool semantics."""

    async def test_markdown_mode_converts_and_includes_page_metadata(
        self, fake_provider: FakeProvider
    ) -> None:
        response = await scrape_url([VALID_URL_1])

        item = response.results[0]
        assert item.success is True
        assert item.data is not None
        assert "Batch Heading" in item.data.content
        assert "<h1>" not in item.data.content
        assert item.data.metadata["page_metadata"]["title"] == "Batch Test Page"

    async def test_text_mode_strips_default_tags(self, fake_provider: FakeProvider) -> None:
        response = await scrape_url_text([VALID_URL_1])

        item = response.results[0]
        assert item.success is True
        assert item.data is not None
        assert "Body paragraph text." in item.data.content
        assert "must be stripped" not in item.data.content

    async def test_html_mode_returns_raw_content(self, fake_provider: FakeProvider) -> None:
        response = await scrape_url_html([VALID_URL_1])

        item = response.results[0]
        assert item.success is True
        assert item.data is not None
        assert "<h1>Batch Heading</h1>" in item.data.content

    async def test_links_mode_resolves_relative_links_against_final_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        final_url = "https://final.example/landing"
        provider = FakeProvider(final_url=final_url)
        monkeypatch.setattr(tools_service, "get_provider", lambda url, render_js=False: provider)
        monkeypatch.setattr(tools_service, "default_provider", provider)

        response = await scrape_extract_links([VALID_URL_1])

        item = response.results[0]
        assert item.success is True
        assert item.data is not None
        resolved = {link["url"] for link in item.data.links}
        assert "https://final.example/relative/path" in resolved
        assert "https://external.example/abs" in resolved
        assert item.data.count == len(item.data.links)
