"""Twitter Geo API client.

Provides methods for fetching geographic place information.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from scrapebadger._internal.pagination import PaginatedResponse
from scrapebadger.twitter.models import Place

if TYPE_CHECKING:
    from scrapebadger._internal.client import BaseClient


class GeoClient:
    """Client for Twitter geo/places endpoints.

    Provides async methods for fetching place details and searching
    for geographic locations.

    Example:
        ```python
        async with ScrapeBadger(api_key="key") as client:
            # Search for places
            places = await client.twitter.geo.search(query="San Francisco")

            # Search by coordinates
            places = await client.twitter.geo.search(lat=37.7749, long=-122.4194)

            # Get place details
            place = await client.twitter.geo.get_detail("5a110d312052166f")
        ```
    """

    def __init__(self, client: BaseClient) -> None:
        """Initialize geo client.

        Args:
            client: The base HTTP client.
        """
        self._client = client

    async def get_detail(self, place_id: str) -> Place:
        """Get details for a specific place.

        Args:
            place_id: The Twitter place ID.

        Returns:
            The place details.

        Raises:
            NotFoundError: If the place doesn't exist.

        Example:
            ```python
            place = await client.twitter.geo.get_detail("5a110d312052166f")
            print(f"{place.full_name}")
            print(f"Type: {place.place_type}")
            print(f"Country: {place.country}")
            ```
        """
        response = await self._client.get(f"/v1/twitter/geo/places/{place_id}")
        return Place.model_validate(response)

    async def search(
        self,
        *,
        lat: float | None = None,
        long: float | None = None,
        query: str | None = None,
        ip: str | None = None,
        granularity: str | None = None,
        max_results: int | None = None,
    ) -> PaginatedResponse[Place]:
        """Search for geographic places.

        At least one of lat/long, query, or ip must be provided.

        Args:
            lat: Latitude coordinate.
            long: Longitude coordinate.
            query: Free-form text search query (e.g., "San Francisco").
            ip: IP address for location lookup.
            granularity: Result granularity ("neighborhood", "city", "admin", "country").
            max_results: Maximum number of results (1-100).

        Returns:
            Paginated response containing matching places.

        Raises:
            ValidationError: If no search parameters are provided.

        Example:
            ```python
            # Search by name
            places = await client.twitter.geo.search(query="San Francisco")
            for place in places.data:
                print(f"{place.full_name} ({place.place_type})")

            # Search by coordinates
            places = await client.twitter.geo.search(
                lat=37.7749,
                long=-122.4194,
                granularity="city"
            )

            # Search by IP
            places = await client.twitter.geo.search(ip="8.8.8.8")
            ```
        """
        response = await self._client.get(
            "/v1/twitter/geo/search",
            params={
                "lat": lat,
                "long": long,
                "query": query,
                "ip": ip,
                "granularity": granularity,
                "max_results": max_results,
            },
        )
        data = [Place.model_validate(item) for item in response.get("data", []) or []]
        return PaginatedResponse(data=data)
