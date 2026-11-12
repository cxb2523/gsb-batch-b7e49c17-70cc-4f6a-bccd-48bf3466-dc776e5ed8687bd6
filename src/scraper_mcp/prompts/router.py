"""Prompt registration for MCP server."""

from __future__ import annotations

from typing import TYPE_CHECKING

from scraper_mcp.prompts.analysis import register_analysis_prompts
from scraper_mcp.prompts.research import register_research_prompts
from scraper_mcp.prompts.seo import register_seo_prompts

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_prompts(mcp: FastMCP) -> None:
    """Register all MCP prompts on the server.

    Prompts provide reusable, parameterized prompt templates that help
    LLMs interact with the scraper tools effectively.

    Args:
        mcp: The FastMCP server instance
    """
    # Analysis prompts: analyze_webpage, summarize_content, extract_data, compare_pages
    register_analysis_prompts(mcp)

    # SEO prompts: seo_audit, link_audit, metadata_check, accessibility_check
    register_seo_prompts(mcp)

    # Research prompts: research_topic, fact_check, competitive_analysis, news_roundup
    register_research_prompts(mcp)
