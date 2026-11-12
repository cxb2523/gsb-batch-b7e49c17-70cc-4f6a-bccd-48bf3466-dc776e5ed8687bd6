"""Twitter Trends API client.

Provides methods for fetching trending topics and trend locations.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from scrapebadger._internal.pagination import PaginatedResponse
from scrapebadger.twitter.models import Location, PlaceTrends, Trend, TrendCategory

if TYPE_CHECKING:
    from scrapebadger._internal.client import BaseClient


class TrendsClient:
    """Client for Twitter trends endpoints.

    Provides async methods for fetching trending topics, place-specific trends,
    and available trend locations.

    Example:
        ```python
        async with ScrapeBadger(api_key="key") as client:
            # Get global trends
            trends = await client.twitter.trends.get_trends()
            for trend in trends.data:
                print(f"{trend.name}: {trend.tweet_count or 'N/A'} tweets")

            # Get trends for a specific location
            us_trends = await client.twitter.trends.get_place_trends(23424977)

            # Get available locations
            locations = await client.twitter.trends.get_available_locations()
        ```
    """

    def __init__(self, client: BaseClient) -> None:
        """Initialize trends client.

        Args:
            client: The base HTTP client.
        """
        self._client = client

    async def get_trends(
        self,
        *,
        category: TrendCategory = TrendCategory.TRENDING,
        count: int = 20,
    ) -> PaginatedResponse[Trend]:
        """Get trending topics.

        Args:
            category: Category of trends (TRENDING, FOR_YOU, NEWS, SPORTS, ENTERTAINMENT).
            count: Number of trends to fetch (1-100).

        Returns:
            Paginated response containing trending topics.

        Example:
            ```python
            # Get general trending topics
            trends = await client.twitter.trends.get_trends()

            # Get news trends
            trends = await client.twitter.trends.get_trends(
                category=TrendCategory.NEWS
            )

            for trend in trends.data:
                count = f"{trend.tweet_count:,}" if trend.tweet_count else "N/A"
                print(f"{trend.name}: {count} tweets")
            ```
        """
        response = await self._client.get(
            "/v1/twitter/trends/",
            params={"category": category.value, "count": count},
        )
        data = [Trend.model_validate(item) for item in response.get("data", []) or []]
        return PaginatedResponse(data=data)

    async def get_place_trends(self, woeid: int) -> PlaceTrends:
        """Get trends for a specific location.

        Args:
            woeid: Where On Earth ID for the location.
                Common WOEIDs:
                - 1: Worldwide
                - 23424977: United States
                - 23424975: United Kingdom
                - 23424856: Japan
                - 23424829: Germany

        Returns:
            PlaceTrends containing location info and trends.

        Raises:
            NotFoundError: If the WOEID is invalid.

        Example:
            ```python
            # Get US trends
            us_trends = await client.twitter.trends.get_place_trends(23424977)
            print(f"Trends in {us_trends.name}:")
            for trend in us_trends.trends:
                print(f"  - {trend.name}")

            # Get worldwide trends
            global_trends = await client.twitter.trends.get_place_trends(1)
            ```
        """
        response = await self._client.get(f"/v1/twitter/trends/place/{woeid}")
        return PlaceTrends.model_validate(response)

    async def get_available_locations(self) -> PaginatedResponse[Location]:
        """Get all locations where trends are available.

        Returns:
            Paginated response containing available trend locations.

        Example:
            ```python
            locations = await client.twitter.trends.get_available_locations()

            # Filter by country
            us_locations = [
                loc for loc in locations.data
                if loc.country_code == "US"
            ]
            print(f"Found {len(us_locations)} US locations")

            # Get countries only
            countries = [
                loc for loc in locations.data
                if loc.place_type == "Country"
            ]
            ```
        """
        response = await self._client.get("/v1/twitter/trends/locations")
        data = [Location.model_validate(item) for item in response.get("data", []) or []]
        return PaginatedResponse(data=data)
