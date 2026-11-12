"""Tests for SDK exceptions."""

from __future__ import annotations

from scrapebadger._internal.exceptions import (
    AuthenticationError,
    InsufficientCreditsError,
    NotFoundError,
    RateLimitError,
    ScrapeBadgerError,
    ServerError,
    ValidationError,
)


class TestScrapeBadgerError:
    """Tests for base ScrapeBadgerError."""

    def test_basic_error(self) -> None:
        """Test basic error creation."""
        error = ScrapeBadgerError("Something went wrong")
        assert str(error) == "Something went wrong"
        assert error.message == "Something went wrong"
        assert error.status_code is None
        assert error.response_data == {}

    def test_error_with_status_code(self) -> None:
        """Test error with status code."""
        error = ScrapeBadgerError("Error", status_code=400)
        assert str(error) == "[400] Error"
        assert error.status_code == 400

    def test_error_with_response_data(self) -> None:
        """Test error with response data."""
        data = {"detail": "More info"}
        error = ScrapeBadgerError("Error", response_data=data)
        assert error.response_data == data

    def test_repr(self) -> None:
        """Test string representation."""
        error = ScrapeBadgerError("Error", status_code=400)
        assert "ScrapeBadgerError" in repr(error)
        assert "Error" in repr(error)
        assert "400" in repr(error)


class TestAuthenticationError:
    """Tests for AuthenticationError."""

    def test_default_message(self) -> None:
        """Test default error message."""
        error = AuthenticationError()
        assert "Invalid or missing API key" in str(error)
        assert error.status_code == 401

    def test_custom_message(self) -> None:
        """Test custom error message."""
        error = AuthenticationError("API key revoked")
        assert "API key revoked" in str(error)

    def test_inheritance(self) -> None:
        """Test error inheritance."""
        error = AuthenticationError()
        assert isinstance(error, ScrapeBadgerError)


class TestRateLimitError:
    """Tests for RateLimitError."""

    def test_default_values(self) -> None:
        """Test default error values."""
        error = RateLimitError()
        assert "Rate limit exceeded" in str(error)
        assert error.status_code == 429
        assert error.limit is None
        assert error.remaining is None
        assert error.reset_at is None
        assert error.retry_after is None
        assert error.tier is None

    def test_with_rate_limit_info(self) -> None:
        """Test error with rate limit info."""
        error = RateLimitError(
            limit=300,
            remaining=0,
            reset_at=1703123456,
            retry_after=45,
            tier="basic",
        )
        assert error.limit == 300
        assert error.remaining == 0
        assert error.reset_at == 1703123456
        assert error.retry_after == 45
        assert error.tier == "basic"


class TestInsufficientCreditsError:
    """Tests for InsufficientCreditsError."""

    def test_default_message(self) -> None:
        """Test default error message."""
        error = InsufficientCreditsError()
        assert "Insufficient credits" in str(error)
        assert error.status_code == 402


class TestNotFoundError:
    """Tests for NotFoundError."""

    def test_default_message(self) -> None:
        """Test default error message."""
        error = NotFoundError()
        assert "Resource not found" in str(error)
        assert error.status_code == 404


class TestValidationError:
    """Tests for ValidationError."""

    def test_default_message(self) -> None:
        """Test default error message."""
        error = ValidationError()
        assert "Invalid request parameters" in str(error)
        assert error.status_code == 422


class TestServerError:
    """Tests for ServerError."""

    def test_default_message(self) -> None:
        """Test default error message."""
        error = ServerError()
        assert "Server error" in str(error)
        assert error.status_code == 500
