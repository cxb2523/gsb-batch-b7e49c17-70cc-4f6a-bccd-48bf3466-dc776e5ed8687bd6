"""Content analysis prompts for MCP server."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_analysis_prompts(mcp: FastMCP) -> None:
    """Register content analysis prompts on the MCP server.

    Args:
        mcp: The FastMCP server instance
    """

    @mcp.prompt(title="Analyze Webpage")
    def analyze_webpage(url: str, focus: str = "main_content") -> str:
        """Generate a structured analysis of a webpage.

        Args:
            url: The URL to analyze
            focus: Analysis focus area (main_content, navigation, metadata, media, forms)
        """
        return f"""Analyze the webpage at {url}.

## Instructions
1. Scrape the page: `scrape_url(urls=["{url}"])`
2. Review the markdown content
3. Focus your analysis on: **{focus}**

## Analysis Structure
Provide findings in this format:

### Page Overview
- URL: {url}
- Main purpose/topic
- Target audience

### Content Analysis ({focus})
- Key sections identified
- Main messages/themes
- Notable elements (CTAs, forms, media)

### Technical Observations
- Page structure quality
- Content organization
- Any issues noticed

## Focus Options
- `main_content`: Primary page content
- `navigation`: Site structure and links
- `metadata`: SEO tags and meta info
- `media`: Images, videos, embeds
- `forms`: Input fields and actions"""

    @mcp.prompt(title="Summarize Content")
    def summarize_content(url: str, length: str = "medium", style: str = "informative") -> str:
        """Generate a content summary with specified length and style.

        Args:
            url: The URL to summarize
            length: Summary length (short, medium, long)
            style: Writing style (informative, technical, casual)
        """
        lengths = {
            "short": "2-3 sentences",
            "medium": "1-2 paragraphs",
            "long": "comprehensive multi-paragraph",
        }
        return f"""Summarize the content at {url}.

## Instructions
1. Scrape: `scrape_url(urls=["{url}"], css_selector="article, main, .content")`
2. Generate a {lengths.get(length, lengths["medium"])} summary
3. Style: {style}

## Output Format
### Summary ({length})
[Your summary here]

### Key Points
- Point 1
- Point 2
- Point 3

### Source
- URL: {url}
- Scraped: [timestamp]"""

    @mcp.prompt(title="Extract Data")
    def extract_data(url: str, data_type: str = "general", selector: str = "") -> str:
        """Extract specific types of data from a webpage.

        Args:
            url: The URL to extract data from
            data_type: Type of data (contact, pricing, dates, products, people, general)
            selector: Optional CSS selector to target specific elements
        """
        selector_hint = f', css_selector="{selector}"' if selector else ""
        return f"""Extract {data_type} data from {url}.

## Instructions
1. Scrape: `scrape_url(urls=["{url}"]{selector_hint})`
2. Identify and extract: **{data_type}**

## Data Types
- `contact`: emails, phones, addresses
- `pricing`: prices, plans, costs
- `dates`: events, schedules, deadlines
- `products`: names, descriptions, specs
- `people`: names, titles, bios
- `general`: key facts and figures

## Output Format
### Extracted {data_type.title()} Data
| Field | Value | Confidence |
|-------|-------|------------|
| ... | ... | high/medium/low |

### Source Context
[Where this data was found on the page]"""

    @mcp.prompt(title="Compare Pages")
    def compare_pages(urls: str) -> str:
        """Compare content across multiple webpages.

        Args:
            urls: Comma-separated list of URLs to compare
        """
        url_list = [u.strip() for u in urls.split(",")]
        scrape_calls = "\n".join([f'- `scrape_url(urls=["{u}"])`' for u in url_list])
        url_bullets = "\n".join([f"- {u}" for u in url_list])

        return f"""Compare the following pages:
{url_bullets}

## Instructions
1. Scrape each page:
{scrape_calls}

2. Analyze each page's content
3. Compare across dimensions below

## Comparison Dimensions
- **Content**: Topics, depth, quality
- **Structure**: Organization, navigation
- **Purpose**: Goals, target audience
- **Features**: Unique elements, CTAs

## Output Format
### Summary Table
| Dimension | {" | ".join([f"Page {i + 1}" for i in range(len(url_list))])} |
|-----------|{"|".join(["---" for _ in url_list])}|

### Key Differences
[Bullet points]

### Key Similarities
[Bullet points]

### Recommendation
[Which page is better for what purpose]"""
