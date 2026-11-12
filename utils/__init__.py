"""Utility modules for awesome-scraping."""

from utils.github import extract_repo_info, fetch_repo_data
from utils.markdown import generate_markdown_table, load_categories, update_readme
from utils.storage import (
    FETCH_FAILED_AT_KEY,
    FETCH_FAILED_FLAG,
    FETCH_FAILED_KEY,
    backup_urls_json,
    build_fetch_failed_entry,
    filter_blacklisted_urls,
    load_blacklist,
    load_urls_json,
    update_urls_json,
)
from utils.urlutils import normalize_url, parse_github_repo, repo_name_from_url

__all__ = [
    "extract_repo_info",
    "fetch_repo_data",
    "filter_blacklisted_urls",
    "generate_markdown_table",
    "load_blacklist",
    "load_categories",
    "load_urls_json",
    "update_readme",
    "backup_urls_json",
    "update_urls_json",
    "build_fetch_failed_entry",
    "normalize_url",
    "parse_github_repo",
    "repo_name_from_url",
    "FETCH_FAILED_KEY",
    "FETCH_FAILED_AT_KEY",
    "FETCH_FAILED_FLAG",
]
