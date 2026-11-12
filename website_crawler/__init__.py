"""Reusable Python client for the website-crawler-api skill."""

from .client import (
    BatchNotCreated,
    CREDITS_PER_PAGE,
    DEFAULT_BASE_URL,
    DEFAULT_BILLING_URL,
    IDEMPOTENCY_KEY_TTL_SECONDS,
    KNOWN_STOPPED_REASONS,
    JobHandle,
    JobReport,
    MapResult,
    PageCounts,
    PageResult,
    ScavioError,
    TERMINAL_STATUSES,
    WebsiteCrawlerClient,
)

__all__ = [
    "WebsiteCrawlerClient",
    "MapResult",
    "JobHandle",
    "JobReport",
    "PageResult",
    "PageCounts",
    "ScavioError",
    "BatchNotCreated",
    "DEFAULT_BASE_URL",
    "DEFAULT_BILLING_URL",
    "TERMINAL_STATUSES",
    "KNOWN_STOPPED_REASONS",
    "CREDITS_PER_PAGE",
    "IDEMPOTENCY_KEY_TTL_SECONDS",
]
