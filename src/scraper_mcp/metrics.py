"""Metrics tracking for the scraper server."""

from __future__ import annotations

import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now() -> datetime:
    """Get current UTC time with timezone info.

    This ensures consistent timestamp handling regardless of server timezone.
    JavaScript will correctly parse ISO strings with timezone and convert
    to the user's local timezone via toLocaleString().
    """
    return datetime.now(UTC)


@dataclass
class RequestMetrics:
    """Metrics for a single request."""

    url: str
    timestamp: datetime
    success: bool
    status_code: int | None = None
    elapsed_ms: float | None = None
    attempts: int = 1
    error: str | None = None

    # Request identification and type
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    request_type: str = "scraper"  # "scraper" | "perplexity"
    cache_key: str | None = None  # For scraper: enables cache lookup

    # Perplexity-specific data (None for scraper requests)
    perplexity_data: dict[str, Any] | None = None  # {model, full_prompt, content, citations, usage}


@dataclass
class ServerMetrics:
    """Global server metrics."""

    start_time: datetime = field(default_factory=utc_now)
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_retries: int = 0
    recent_requests: deque[RequestMetrics] = field(default_factory=lambda: deque(maxlen=100))
    recent_errors: deque[RequestMetrics] = field(default_factory=lambda: deque(maxlen=50))

    def record_request(
        self,
        url: str,
        success: bool,
        status_code: int | None = None,
        elapsed_ms: float | None = None,
        attempts: int = 1,
        error: str | None = None,
        request_type: str = "scraper",
        cache_key: str | None = None,
        perplexity_data: dict[str, Any] | None = None,
    ) -> RequestMetrics:
        """Record a request in the metrics.

        Args:
            url: The URL that was requested
            success: Whether the request was successful
            status_code: HTTP status code if available
            elapsed_ms: Time taken in milliseconds
            attempts: Number of attempts made (1 = no retries)
            error: Error message if failed
            request_type: Type of request ("scraper" or "perplexity")
            cache_key: Cache key for scraper requests (enables cache lookup)
            perplexity_data: Full response data for Perplexity requests

        Returns:
            The created RequestMetrics object
        """
        self.total_requests += 1

        if success:
            self.successful_requests += 1
        else:
            self.failed_requests += 1

        # Track retries (attempts - 1)
        if attempts > 1:
            self.total_retries += attempts - 1

        # Create metrics record
        metrics = RequestMetrics(
            url=url,
            timestamp=utc_now(),
            success=success,
            status_code=status_code,
            elapsed_ms=elapsed_ms,
            attempts=attempts,
            error=error,
            request_type=request_type,
            cache_key=cache_key,
            perplexity_data=perplexity_data,
        )

        # Add to recent requests
        self.recent_requests.append(metrics)

        # Add to recent errors if failed
        if not success:
            self.recent_errors.append(metrics)

        return metrics

    def get_uptime_seconds(self) -> float:
        """Get server uptime in seconds."""
        return (utc_now() - self.start_time).total_seconds()

    def get_success_rate(self) -> float:
        """Get success rate as percentage."""
        if self.total_requests == 0:
            return 0.0
        return (self.successful_requests / self.total_requests) * 100

    def to_dict(self) -> dict[str, Any]:
        """Convert metrics to dictionary for JSON serialization."""
        uptime_seconds = self.get_uptime_seconds()

        return {
            "status": "healthy",
            "uptime": {
                "seconds": uptime_seconds,
                "formatted": self._format_uptime(uptime_seconds),
            },
            "start_time": self.start_time.isoformat(),
            "requests": {
                "total": self.total_requests,
                "successful": self.successful_requests,
                "failed": self.failed_requests,
                "success_rate": round(self.get_success_rate(), 2),
            },
            "retries": {
                "total": self.total_retries,
                "average_per_request": (
                    round(self.total_retries / self.total_requests, 2)
                    if self.total_requests > 0
                    else 0.0
                ),
            },
            "recent_requests": [
                {
                    "request_id": r.request_id,
                    "url": r.url,
                    "timestamp": r.timestamp.isoformat(),
                    "success": r.success,
                    "status_code": r.status_code,
                    "elapsed_ms": r.elapsed_ms,
                    "attempts": r.attempts,
                    "error": r.error,
                    "request_type": r.request_type,
                }
                for r in list(self.recent_requests)[::-1]  # All requests, newest first
            ],
            "recent_errors": [
                {
                    "request_id": r.request_id,
                    "url": r.url,
                    "timestamp": r.timestamp.isoformat(),
                    "status_code": r.status_code,
                    "attempts": r.attempts,
                    "error": r.error,
                    "request_type": r.request_type,
                }
                for r in list(self.recent_errors)[::-1]  # All errors, newest first
            ],
        }

    @staticmethod
    def _format_uptime(seconds: float) -> str:
        """Format uptime in human-readable format."""
        if seconds < 60:
            return f"{int(seconds)}s"
        elif seconds < 3600:
            minutes = int(seconds / 60)
            secs = int(seconds % 60)
            return f"{minutes}m {secs}s"
        elif seconds < 86400:
            hours = int(seconds / 3600)
            minutes = int((seconds % 3600) / 60)
            return f"{hours}h {minutes}m"
        else:
            days = int(seconds / 86400)
            hours = int((seconds % 86400) / 3600)
            return f"{days}d {hours}h"


# Global metrics instance
_metrics = ServerMetrics()


def get_metrics() -> ServerMetrics:
    """Get the global metrics instance."""
    return _metrics


def record_request(
    url: str,
    success: bool,
    status_code: int | None = None,
    elapsed_ms: float | None = None,
    attempts: int = 1,
    error: str | None = None,
    request_type: str = "scraper",
    cache_key: str | None = None,
    perplexity_data: dict[str, Any] | None = None,
) -> RequestMetrics:
    """Record a request in the global metrics.

    Args:
        url: The URL that was requested
        success: Whether the request was successful
        status_code: HTTP status code if available
        elapsed_ms: Time taken in milliseconds
        attempts: Number of attempts made (1 = no retries)
        error: Error message if failed
        request_type: Type of request ("scraper" or "perplexity")
        cache_key: Cache key for scraper requests
        perplexity_data: Full response data for Perplexity requests

    Returns:
        The created RequestMetrics object
    """
    return _metrics.record_request(
        url,
        success,
        status_code,
        elapsed_ms,
        attempts,
        error,
        request_type,
        cache_key,
        perplexity_data,
    )


def get_request_by_id(request_id: str) -> RequestMetrics | None:
    """Find a request by its ID.

    Args:
        request_id: The UUID of the request

    Returns:
        RequestMetrics if found, None otherwise
    """
    for r in _metrics.recent_requests:
        if r.request_id == request_id:
            return r
    return None
