"""Research workflow prompts for MCP server."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_research_prompts(mcp: FastMCP) -> None:
    """Register research workflow prompts on the MCP server.

    Args:
        mcp: The FastMCP server instance
    """

    @mcp.prompt(title="Research Topic")
    def research_topic(topic: str, depth: str = "standard") -> str:
        """Conduct multi-source research on a topic.

        Args:
            topic: The topic to research
            depth: Research depth (quick, standard, deep)
        """
        return f"""Research: {topic}

## Instructions
1. Search: `perplexity(messages=[{{"role": "user", "content": "{topic}"}}])`
2. Deeper analysis: `perplexity_reason(query="Analyze {topic} with multiple perspectives")`
3. Scrape key sources from citations for detailed content

## Research Depth: {depth}
- `quick`: Perplexity search only
- `standard`: Search + scrape top 3 sources
- `deep`: Search + scrape all sources + cross-reference

## Output Format
### Executive Summary
[2-3 sentence overview]

### Key Findings
1. Finding with [source]
2. Finding with [source]

### Source Analysis
| Source | Key Points | Credibility |
|--------|------------|-------------|

### Areas of Consensus
- Point 1

### Areas of Disagreement
- Point 1

### Further Research Needed
- Question 1

### Citations
1. [Source URL]"""

    @mcp.prompt(title="Fact Check")
    def fact_check(claim: str, sources: str = "3") -> str:
        """Verify a claim across multiple sources.

        Args:
            claim: The claim to verify
            sources: Number of sources to consult
        """
        return f"""Fact check: "{claim}"

## Instructions
1. Search for verification: `perplexity_reason(query="Is it true that {claim}? Provide evidence.")`
2. Scrape {sources} sources from citations for primary evidence
3. Cross-reference findings

## Verification Process
1. Identify the specific claim
2. Find authoritative sources
3. Check for consensus or disagreement
4. Note any nuances or context

## Output Format
### Verdict: [TRUE / FALSE / PARTIALLY TRUE / UNVERIFIED]

### Claim Analysis
- Original claim: "{claim}"
- Interpretation: [How we understood it]

### Evidence For
- Evidence 1 [Source]

### Evidence Against
- Evidence 1 [Source]

### Context & Nuance
[Important qualifications]

### Confidence Level: [HIGH / MEDIUM / LOW]

### Sources Consulted
1. [URL] - [Credibility rating]"""

    @mcp.prompt(title="Competitive Analysis")
    def competitive_analysis(urls: str) -> str:
        """Analyze competitor websites.

        Args:
            urls: Comma-separated list of competitor URLs
        """
        url_list = [u.strip() for u in urls.split(",")]
        url_bullets = "\n".join([f"- {u}" for u in url_list])

        return f"""Analyze competitors:
{url_bullets}

## Instructions
1. Scrape each competitor's homepage and key pages
2. Extract: `scrape_url(urls={url_list})`
3. Get metadata: `scrape_url_html(urls={url_list}, css_selector="head")`

## Analysis Framework

### Positioning
- Value proposition
- Target audience
- Key differentiators

### Content Strategy
- Topics covered
- Content depth
- Update frequency

### Features & Offerings
- Products/services
- Pricing (if visible)
- Unique features

### User Experience
- Navigation structure
- Call-to-actions
- Trust signals

## Output Format
### Competitor Matrix
| Aspect | {" | ".join([f"Competitor {i + 1}" for i in range(len(url_list))])} |
|--------|{"|".join(["---" for _ in url_list])}|
| Positioning | | |
| Strengths | | |
| Weaknesses | | |

### Key Insights
1. Insight

### Opportunities
- Gap in market

### Threats
- Competitive advantage to watch"""

    @mcp.prompt(title="News Roundup")
    def news_roundup(topic: str, timeframe: str = "recent") -> str:
        """Gather recent news and updates on a topic.

        Args:
            topic: The topic to gather news about
            timeframe: Time period (recent, today, this_week, this_month)
        """
        timeframe_desc = {
            "recent": "the most recent",
            "today": "from today",
            "this_week": "from this week",
            "this_month": "from this month",
        }
        return f"""Gather {timeframe_desc.get(timeframe, "recent")} news about: {topic}

## Instructions
1. Search: `perplexity(messages=[{{"role": "user", "content": "Latest news: {topic}"}}])`
2. Analyze: `perplexity_reason(query="Key developments and trends in {topic}")`
3. Scrape top news sources from citations for full articles

## Output Format
### News Summary
[Overview of {timeframe} developments]

### Top Stories
1. **[Headline]** - [Source]
   - Summary: [2-3 sentences]
   - Published: [Date]
   - Impact: [Why it matters]

2. **[Headline]** - [Source]
   - Summary: [2-3 sentences]
   - Published: [Date]
   - Impact: [Why it matters]

### Trend Analysis
- Emerging themes
- Key players mentioned
- Market implications

### What to Watch
- Upcoming events
- Expected announcements
- Potential developments

### Sources
1. [Source URL] - [Publication name]"""
