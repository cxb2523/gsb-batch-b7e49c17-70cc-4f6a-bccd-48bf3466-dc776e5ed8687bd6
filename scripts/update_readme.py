#!/usr/bin/env python3
"""Scrape GitHub repository data and update README with a markdown table."""

import os
import sys

# Add project root to path for utils import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import (
    backup_urls_json,
    build_fetch_failed_entry,
    extract_repo_info,
    fetch_repo_data,
    filter_blacklisted_urls,
    generate_markdown_table,
    load_blacklist,
    load_urls_json,
    update_readme,
    update_urls_json,
)
from utils.markdown import load_categories


def scrape_repos(
    urls_data: list[dict],
    token: str | None = None,
    fetcher=fetch_repo_data,
    failure_builder=build_fetch_failed_entry,
) -> list[dict]:
    """Fetch fresh data for every entry.

    Successful fetches produce complete entries. Failed fetches keep the old
    record's ``url`` and ``name`` and add an explicit failure marker plus the
    failure timestamp, so the README row can still be rendered without
    displaying fabricated stars or a version.

    Args:
        urls_data: Entries loaded from urls.json (already blacklist-filtered)
        token: Optional GitHub API token
        fetcher: Callable returning a complete repo dict or None on failure
        failure_builder: Callable building the marked failure entry

    Returns:
        New list of repository dictionaries
    """
    repos = []
    for item in urls_data:
        url = item.get("url", "")
        repo_info = extract_repo_info(url)
        if not repo_info:
            print(f"Invalid GitHub URL: {url}")
            continue

        owner, repo = repo_info
        print(f"Fetching data for {owner}/{repo}...")
        data = fetcher(owner, repo, token)
        if data:
            repos.append(data)
        else:
            failed_entry = failure_builder(item)
            print(
                f"Fetch failed for {owner}/{repo}; keeping old record "
                f"with failure marker ({failed_entry['fetch_failed_at']})"
            )
            repos.append(failed_entry)

    return repos


def run_pipeline(
    urls_path: str = "urls.json",
    blacklist_path: str = "blacklist.txt",
    readme_path: str = "README.md",
    categories_path: str = "categories.json",
    history_dir: str = "history",
    token: str | None = None,
    fetcher=fetch_repo_data,
    failure_builder=build_fetch_failed_entry,
    do_backup: bool = True,
) -> dict:
    """Run the full scrape-and-render pipeline.

    Returns a small summary dict (useful for tests and CI logs) containing the
    number of blacklisted removals and their URLs.
    """
    # Load URLs from urls.json
    urls_data = load_urls_json(urls_path)

    # Load blacklist and filter out blacklisted URLs (normalized comparison)
    blacklist = load_blacklist(blacklist_path)
    urls_data, removed = filter_blacklisted_urls(urls_data, blacklist)
    print(
        f"Blacklist removed {len(removed)} entr(ies): "
        f"{[item.get('url', '') for item in removed]}"
    )

    # Backup current urls.json to history
    if do_backup:
        backup_urls_json(urls_path, history_dir)

    repos = scrape_repos(
        urls_data,
        token=token,
        fetcher=fetcher,
        failure_builder=failure_builder,
    )

    # Write updated urls.json with fetched data / failure markers
    update_urls_json(repos, urls_path)

    # Load categories for generating category tables
    categories = load_categories(categories_path)
    if categories:
        print(f"Loaded {len(categories)} categories from categories.json")
    else:
        print("No categories.json found, generating tables without categories")

    # Generate tables and update README
    tables = generate_markdown_table(repos, categories)
    update_readme(tables, categories, readme_path)

    return {
        "removed_count": len(removed),
        "removed_urls": [item.get("url", "") for item in removed],
        "repo_count": len(repos),
        "failed_count": sum(1 for r in repos if r.get("fetch_failed")),
    }


def main() -> None:
    """Main function to orchestrate the scraping and README update."""
    token = os.environ.get("GITHUB_TOKEN")
    run_pipeline(token=token)


if __name__ == "__main__":
    main()
