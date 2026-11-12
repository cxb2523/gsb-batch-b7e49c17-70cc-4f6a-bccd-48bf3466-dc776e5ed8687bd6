"""SEO and technical analysis prompts for MCP server."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_seo_prompts(mcp: FastMCP) -> None:
    """Register SEO and technical analysis prompts on the MCP server.

    Args:
        mcp: The FastMCP server instance
    """

    @mcp.prompt(title="SEO Audit")
    def seo_audit(url: str) -> str:
        """Perform a comprehensive SEO audit of a webpage.

        Args:
            url: The URL to audit
        """
        return f"""Perform an SEO audit of {url}.

## Instructions
1. Get metadata: `scrape_url_html(urls=["{url}"], css_selector="head")`
2. Get content: `scrape_url(urls=["{url}"])`
3. Get links: `scrape_extract_links(urls=["{url}"])`

## Audit Checklist

### Meta Tags
- [ ] Title tag present and optimized (50-60 chars)
- [ ] Meta description present (150-160 chars)
- [ ] Canonical URL specified
- [ ] Robots meta tag appropriate

### Open Graph / Social
- [ ] og:title, og:description, og:image
- [ ] twitter:card, twitter:title, twitter:description

### Content Structure
- [ ] Single H1 tag
- [ ] Logical heading hierarchy (H1 > H2 > H3)
- [ ] Image alt text present
- [ ] Internal links present

### Technical
- [ ] HTTPS enabled
- [ ] Mobile-friendly indicators
- [ ] Page load considerations

## Output Format
### SEO Score: X/100

### Critical Issues (Fix Immediately)
- Issue 1

### Warnings (Should Fix)
- Warning 1

### Passed Checks
- Check 1

### Recommendations
1. Priority recommendation"""

    @mcp.prompt(title="Link Audit")
    def link_audit(url: str) -> str:
        """Analyze all links on a webpage.

        Args:
            url: The URL to audit links for
        """
        return f"""Audit all links on {url}.

## Instructions
1. Extract links: `scrape_extract_links(urls=["{url}"])`
2. Categorize and analyze

## Analysis Categories

### Internal Links
- Count and list
- Anchor text quality
- Navigation structure

### External Links
- Count and list
- Domains linked to
- rel="nofollow" usage

### Issues to Check
- Broken links (404s)
- Missing anchor text
- Excessive external links
- Orphan pages indicated

## Output Format
### Link Summary
| Type | Count | Issues |
|------|-------|--------|
| Internal | X | Y |
| External | X | Y |

### Internal Link Map
[Hierarchical list]

### External Links
| URL | Anchor Text | Rel |
|-----|-------------|-----|

### Recommendations
1. ..."""

    @mcp.prompt(title="Metadata Check")
    def metadata_check(url: str) -> str:
        """Review all meta tags and structured data on a webpage.

        Args:
            url: The URL to check metadata for
        """
        return f"""Check metadata for {url}.

## Instructions
1. Get meta tags: `scrape_url_html(urls=["{url}"], css_selector="meta, title, link[rel]")`
2. Analyze completeness and quality

## Metadata Categories

### Essential Meta Tags
- title, description, viewport, charset

### SEO Meta Tags
- robots, canonical, alternate

### Social Meta Tags
- Open Graph (og:*)
- Twitter Cards (twitter:*)

### Structured Data
- JSON-LD scripts
- Schema.org markup

## Output Format
### Metadata Report

#### Present Tags
| Tag | Value | Quality |
|-----|-------|---------|

#### Missing Tags
- Tag name: Why it matters

#### Recommendations
1. ..."""

    @mcp.prompt(title="Accessibility Check")
    def accessibility_check(url: str) -> str:
        """Perform a basic accessibility analysis of a webpage.

        Args:
            url: The URL to check accessibility for
        """
        return f"""Check accessibility for {url}.

## Instructions
1. Get content: `scrape_url(urls=["{url}"])`
2. Get structure: `scrape_url_html(urls=["{url}"], css_selector="img, a, button, input, form")`
3. Get headings: `scrape_url_html(urls=["{url}"], css_selector="h1, h2, h3, h4, h5, h6")`
4. Analyze against WCAG guidelines

## Accessibility Checklist

### Images
- [ ] All images have alt text
- [ ] Alt text is descriptive
- [ ] Decorative images marked appropriately

### Links
- [ ] Link text is descriptive (no "click here")
- [ ] Links are distinguishable
- [ ] Focus states visible

### Forms
- [ ] All inputs have labels
- [ ] Required fields marked
- [ ] Error messages clear

### Structure
- [ ] Proper heading hierarchy
- [ ] Skip navigation available
- [ ] Landmarks used (nav, main, footer)

### Color & Contrast
- [ ] Sufficient color contrast
- [ ] Information not conveyed by color alone

## Output Format
### Accessibility Score: X/100

### Critical Issues (WCAG A)
- Issue 1

### Important Issues (WCAG AA)
- Issue 1

### Best Practices (WCAG AAA)
- Issue 1

### Passed Checks
- Check 1

### Recommendations
1. Priority recommendation"""
