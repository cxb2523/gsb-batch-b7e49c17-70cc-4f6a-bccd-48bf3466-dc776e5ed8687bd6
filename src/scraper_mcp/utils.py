"""Utility functions for HTML processing."""

from __future__ import annotations

from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from markdownify import markdownify

SUPPORTED_URL_SCHEMES = ("http", "https")


def validate_url(url: str) -> str | None:
    """Validate a URL for scraping.

    Args:
        url: The URL to validate

    Returns:
        None if the URL is a valid http/https URL, otherwise an error message
        describing why the URL cannot be scraped. The message distinguishes
        between an unsupported protocol (e.g. ftp://) and an address that
        cannot be parsed at all.
    """
    if not isinstance(url, str) or not url.strip():
        return f"Invalid URL {url!r}: address could not be parsed"

    try:
        parsed = urlparse(url)
        # Accessing .port raises ValueError for malformed ports
        _ = parsed.port
    except ValueError:
        return f"Invalid URL '{url}': address could not be parsed"

    scheme = parsed.scheme.lower()
    if scheme and scheme not in SUPPORTED_URL_SCHEMES:
        return (
            f"Unsupported URL scheme '{parsed.scheme}' in '{url}': "
            f"only http and https are supported"
        )

    if scheme not in SUPPORTED_URL_SCHEMES or not parsed.netloc:
        return f"Invalid URL '{url}': address could not be parsed"

    return None


def validate_css_selector(css_selector: str) -> None:
    """Validate CSS selector syntax.

    Args:
        css_selector: The CSS selector to validate

    Raises:
        ValueError: If the CSS selector syntax is invalid. The message
            always contains the original selector text.
    """
    try:
        BeautifulSoup("", "lxml").select(css_selector)
    except Exception as e:
        raise ValueError(f"Invalid CSS selector '{css_selector}': {e}") from e


def html_to_markdown(html: str, strip_tags: list[str] | None = None) -> str:
    """Convert HTML to markdown format.

    Args:
        html: The HTML content to convert
        strip_tags: List of HTML tags to strip (e.g., ['script', 'style'])

    Returns:
        Markdown formatted text
    """
    # Parse HTML
    soup = BeautifulSoup(html, "lxml")

    # Strip unwanted tags
    if strip_tags:
        for tag in strip_tags:
            for element in soup.find_all(tag):
                element.decompose()

    # Convert to markdown
    markdown = markdownify(str(soup), heading_style="ATX")
    return markdown.strip()


def html_to_text(html: str, strip_tags: list[str] | None = None) -> str:
    """Extract plain text from HTML.

    Args:
        html: The HTML content to process
        strip_tags: List of HTML tags to strip (e.g., ['script', 'style'])

    Returns:
        Plain text content
    """
    # Parse HTML
    soup = BeautifulSoup(html, "lxml")

    # Strip unwanted tags
    default_strip_tags = ["script", "style", "meta", "link", "noscript"]
    tags_to_strip = strip_tags if strip_tags is not None else default_strip_tags

    for tag in tags_to_strip:
        for element in soup.find_all(tag):
            element.decompose()

    # Extract text
    text = soup.get_text(separator="\n", strip=True)

    # Clean up multiple newlines
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    return "\n".join(lines)


def extract_links(html: str, base_url: str | None = None) -> list[dict[str, str]]:
    """Extract all links from HTML.

    Args:
        html: The HTML content to process
        base_url: Optional base URL for resolving relative links

    Returns:
        List of dictionaries containing link information
    """
    soup = BeautifulSoup(html, "lxml")
    links: list[dict[str, str]] = []

    for link in soup.find_all("a", href=True):
        href = link.get("href")
        if not isinstance(href, str):
            continue

        title = link.get("title")
        resolved_url = urljoin(base_url, href) if base_url else href
        links.append(
            {
                "url": resolved_url,
                "text": link.get_text(strip=True),
                "title": title if isinstance(title, str) else "",
            }
        )

    return links


def extract_metadata(html: str) -> dict[str, str]:
    """Extract metadata from HTML (title, description, etc.).

    Args:
        html: The HTML content to process

    Returns:
        Dictionary containing metadata
    """
    soup = BeautifulSoup(html, "lxml")
    metadata: dict[str, str] = {}

    # Extract title
    if soup.title:
        metadata["title"] = soup.title.string or ""

    # Extract meta tags
    for meta in soup.find_all("meta"):
        name = meta.get("name") or meta.get("property")
        content = meta.get("content")

        if isinstance(name, str) and isinstance(content, str):
            metadata[name] = content

    return metadata


def filter_html_by_selector(html: str, css_selector: str) -> tuple[str, int]:
    """Filter HTML content using CSS selector.

    Args:
        html: The HTML content to filter
        css_selector: CSS selector to match elements
                     (e.g., "meta", "img, video", "a[href]", ".article-content")

    Returns:
        Tuple of (filtered HTML string, count of matched elements).
        Returns ("", 0) if no elements match.

    Raises:
        ValueError: If the CSS selector syntax is invalid

    Examples:
        >>> filter_html_by_selector(html, "meta")
        # Returns all <meta> tags

        >>> filter_html_by_selector(html, "img, video")
        # Returns all <img> and <video> tags

        >>> filter_html_by_selector(html, ".article-content")
        # Returns elements with class="article-content"

        >>> filter_html_by_selector(html, 'meta[property^="og:"]')
        # Returns Open Graph meta tags
    """
    try:
        soup = BeautifulSoup(html, "lxml")

        # Select elements matching the CSS selector
        elements = soup.select(css_selector)

        # If no elements found, return empty string
        if not elements:
            return "", 0

        # Reconstruct HTML from matched elements
        # Create a minimal HTML structure to contain the filtered elements
        filtered_parts = []
        for element in elements:
            # Convert element to string, preserving structure
            filtered_parts.append(str(element))

        # Join all matched elements
        filtered_html = "\n".join(filtered_parts)

        return filtered_html, len(elements)

    except Exception as e:
        raise ValueError(f"Invalid CSS selector '{css_selector}': {e}") from e
