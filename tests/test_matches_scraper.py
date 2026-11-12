import asyncio

import httpx
import pytest

from api.scrapers.matches import (
    _parse_results_page,
    _parse_single_match,
    vlr_live_score,
    vlr_upcoming_matches,
)
from utils.cache_manager import cache_manager
from utils.html_parsers import parse_html

UPCOMING_HTML = """
<html>
  <div class="js-home-matches-upcoming">
    <a class="wf-module-item">
      <div class="h-match-eta mod-upcoming">51m</div>
      <div class="h-match-team">
        <div class="h-match-team-name">Alpha</div>
      </div>
      <div class="h-match-team">
        <div class="h-match-team-name">Beta</div>
      </div>
    </a>
  </div>
</html>
"""


LIVE_HTML = """
<html>
  <div class="js-home-matches-upcoming">
    <a class="wf-module-item" href="/123">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team">
        <div class="h-match-team-name">Team One</div>
        <div class="h-match-team-score">12</div>
        <div class="h-match-team-rounds">
          <span class="mod-ct">6</span>
        </div>
      </div>
      <div class="h-match-team"></div>
    </a>
  </div>
</html>
"""


MATCH_DETAIL_HTML = "<html></html>"


MATCH_DETAIL_OK_HTML = """
<html>
  <div class="match-header-vs">
    <img src="//owcdn.net/img/team-one.png">
    <img src="//owcdn.net/img/team-two.png">
  </div>
  <div class="vm-stats-gamesnav-item js-map-switch mod-active mod-live">
    <div>2Haven</div>
  </div>
</html>
"""

MULTI_LIVE_HTML = """
<html>
  <div class="js-home-matches-upcoming">
    <a class="wf-module-item" href="/101">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">One</div><div class="h-match-team-score">1</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Two</div><div class="h-match-team-score">2</div></div>
    </a>
    <a class="wf-module-item" href="/102">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">Three</div><div class="h-match-team-score">3</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Four</div><div class="h-match-team-score">4</div></div>
    </a>
    <a class="wf-module-item" href="/103">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">Five</div><div class="h-match-team-score">5</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Six</div><div class="h-match-team-score">6</div></div>
    </a>
  </div>
</html>
"""


class FakeResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text
        self.content = text.encode("utf-8")
        self.headers: dict = {}


class FakeAsyncClient:
    def __init__(self, responses: dict[str, list[FakeResponse]]):
        self._responses = responses
        self.calls: list[tuple[str, int | None]] = []

    async def get(self, url: str, timeout=None, headers=None):
        self.calls.append((url, timeout))
        return self._responses[url].pop(0)


@pytest.mark.anyio
async def test_vlr_upcoming_matches_handles_missing_homepage_fields(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, UPCOMING_HTML)],
        }
    )

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)

    data = await vlr_upcoming_matches()

    assert data == {
        "data": {
            "status": 200,
            "segments": [
                {
                    "team1": "Alpha",
                    "team2": "Beta",
                    "flag1": "",
                    "flag2": "",
                    "time_until_match": "51m from now",
                    "match_series": "",
                    "match_event": "",
                    "unix_timestamp": "",
                    "match_page": "",
                    "match_id": "",
                }
            ],
        }
    }
    cache_manager.clear_all()


@pytest.mark.anyio
async def test_vlr_live_score_handles_missing_homepage_fields(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, LIVE_HTML)],
            "https://www.vlr.gg/123": [FakeResponse(200, MATCH_DETAIL_HTML)],
        }
    )

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)

    data = await vlr_live_score()

    assert data == {
        "data": {
            "status": 200,
            "segments": [
                {
                    "team1": "Team One",
                    "team2": "TBD",
                    "flag1": "",
                    "flag2": "",
                    "team1_logo": "",
                    "team2_logo": "",
                    "score1": "12",
                    "score2": "",
                    "team1_round_ct": "6",
                    "team1_round_t": "N/A",
                    "team2_round_ct": "N/A",
                    "team2_round_t": "N/A",
                    "map_number": "Unknown",
                    "current_map": "Unknown",
                    "time_until_match": "LIVE",
                    "match_event": "",
                    "match_series": "",
                    "unix_timestamp": "",
                        "match_page": "https://www.vlr.gg/123",
                        "match_id": "123",
                        "detail_status": "failed",
                    }
                ],
            "summary": {
                    "total_matches": 1,
                    "detail_fetched": 0,
                    "detail_failed": 1,
                },
            }
        }
    cache_manager.clear_all()


@pytest.mark.anyio
async def test_vlr_live_score_limits_concurrent_detail_fetches_and_falls_back_on_timeout(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, MULTI_LIVE_HTML)],
        }
    )

    active_fetches = 0
    max_active_fetches = 0
    detail_timeouts: list[float | None] = []

    async def fake_fetch_with_retries(url, *, client=None, timeout=None, max_retries=3, request_delay=1.0):
        nonlocal active_fetches, max_active_fetches
        if url == "https://www.vlr.gg":
            return await client.get(url, timeout=timeout)

        active_fetches += 1
        max_active_fetches = max(max_active_fetches, active_fetches)
        detail_timeouts.append(timeout)
        try:
            # Yield so concurrent detail fetches have a chance to overlap;
            # without this the counter never leaves 1 and the bound is vacuous.
            await asyncio.sleep(0)
            if url.endswith("/102"):
                raise httpx.ReadTimeout("timed out")
            return FakeResponse(200, MATCH_DETAIL_HTML)
        finally:
            active_fetches -= 1

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)
    monkeypatch.setattr("api.scrapers.matches.fetch_with_retries", fake_fetch_with_retries)
    monkeypatch.setattr("api.scrapers.matches.LIVE_DETAIL_FETCH_CONCURRENCY", 2)
    monkeypatch.setattr("api.scrapers.matches.LIVE_DETAIL_FETCH_TIMEOUT", 7)

    data = await vlr_live_score()

    assert max_active_fetches == 2
    assert detail_timeouts == [7, 7, 7]
    assert [segment["match_page"] for segment in data["data"]["segments"]] == [
        "https://www.vlr.gg/101",
        "https://www.vlr.gg/102",
        "https://www.vlr.gg/103",
    ]
    # One timeout and two pages without parseable detail: every segment keeps
    # its placeholder values, none of the failures abort the whole call.
    for segment in data["data"]["segments"]:
        assert segment["detail_status"] == "failed"
        assert segment["team1_logo"] == ""
        assert segment["team2_logo"] == ""
        assert segment["current_map"] == "Unknown"
        assert segment["map_number"] == "Unknown"
    assert data["data"]["summary"] == {
        "total_matches": 3,
        "detail_fetched": 0,
        "detail_failed": 3,
    }
    cache_manager.clear_all()


PARTIAL_LIVE_HTML = """
<html>
  <div class="js-home-matches-upcoming">
    <a class="wf-module-item" href="/201">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">One</div><div class="h-match-team-score">1</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Two</div><div class="h-match-team-score">2</div></div>
    </a>
    <a class="wf-module-item" href="/202">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">Three</div><div class="h-match-team-score">3</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Four</div><div class="h-match-team-score">4</div></div>
    </a>
    <a class="wf-module-item" href="/203">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">Five</div><div class="h-match-team-score">5</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Six</div><div class="h-match-team-score">6</div></div>
    </a>
    <a class="wf-module-item" href="/204">
      <div class="h-match-eta mod-live">LIVE</div>
      <div class="h-match-team"><div class="h-match-team-name">Seven</div><div class="h-match-team-score">7</div></div>
      <div class="h-match-team"><div class="h-match-team-name">Eight</div><div class="h-match-team-score">8</div></div>
    </a>
  </div>
</html>
"""


def _assert_failed_placeholders(segment):
    """A failed detail fetch keeps the documented placeholder values."""
    assert segment["detail_status"] == "failed"
    assert segment["team1_logo"] == ""
    assert segment["team2_logo"] == ""
    assert segment["current_map"] == "Unknown"
    assert segment["map_number"] == "Unknown"


@pytest.mark.anyio
async def test_vlr_live_score_reports_per_match_detail_status_with_partial_failures(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, PARTIAL_LIVE_HTML)],
        }
    )

    async def fake_fetch_with_retries(url, *, client=None, timeout=None, max_retries=3, request_delay=1.0):
        if url == "https://www.vlr.gg":
            return await client.get(url, timeout=timeout)
        if url.endswith("/202"):
            # Failure mode 1: the request itself raises.
            raise httpx.ReadTimeout("timed out")
        if url.endswith("/203"):
            # Failure mode 2: upstream answers with an error status.
            return FakeResponse(503, "<html>Service Unavailable</html>")
        if url.endswith("/204"):
            # Failure mode 3: a 200 page that contains no parseable detail.
            return FakeResponse(200, MATCH_DETAIL_HTML)
        # /201: a fully parseable detail page.
        return FakeResponse(200, MATCH_DETAIL_OK_HTML)

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)
    monkeypatch.setattr("api.scrapers.matches.fetch_with_retries", fake_fetch_with_retries)

    data = await vlr_live_score()

    segments = data["data"]["segments"]
    assert len(segments) == 4

    fetched = segments[0]
    assert fetched["match_id"] == "201"
    assert fetched["detail_status"] == "fetched"
    assert fetched["team1_logo"] == "https://owcdn.net/img/team-one.png"
    assert fetched["team2_logo"] == "https://owcdn.net/img/team-two.png"
    assert fetched["current_map"] == "Haven"
    assert fetched["map_number"] == "2"
    # Homepage-derived fields remain untouched by the detail enrichment.
    assert fetched["team1"] == "One"
    assert fetched["score1"] == "1"
    assert fetched["match_page"] == "https://www.vlr.gg/201"

    for failed in segments[1:]:
        _assert_failed_placeholders(failed)
    assert [segment["match_id"] for segment in segments[1:]] == ["202", "203", "204"]

    summary = data["data"]["summary"]
    assert summary == {
        "total_matches": 4,
        "detail_fetched": 1,
        "detail_failed": 3,
    }
    assert summary["detail_fetched"] + summary["detail_failed"] == summary["total_matches"]
    cache_manager.clear_all()


@pytest.mark.anyio
async def test_vlr_live_score_all_details_succeed(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, MULTI_LIVE_HTML)],
            "https://www.vlr.gg/101": [FakeResponse(200, MATCH_DETAIL_OK_HTML)],
            "https://www.vlr.gg/102": [FakeResponse(200, MATCH_DETAIL_OK_HTML)],
            "https://www.vlr.gg/103": [FakeResponse(200, MATCH_DETAIL_OK_HTML)],
        }
    )

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)

    data = await vlr_live_score()

    segments = data["data"]["segments"]
    assert len(segments) == 3
    for segment in segments:
        assert segment["detail_status"] == "fetched"
        assert segment["team1_logo"] == "https://owcdn.net/img/team-one.png"
        assert segment["team2_logo"] == "https://owcdn.net/img/team-two.png"
        assert segment["current_map"] == "Haven"
        assert segment["map_number"] == "2"

    summary = data["data"]["summary"]
    assert summary == {
        "total_matches": 3,
        "detail_fetched": 3,
        "detail_failed": 0,
    }
    assert summary["detail_fetched"] + summary["detail_failed"] == summary["total_matches"]
    cache_manager.clear_all()


@pytest.mark.anyio
async def test_vlr_live_score_detail_parse_exception_keeps_placeholders(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, LIVE_HTML)],
            "https://www.vlr.gg/123": [FakeResponse(200, MATCH_DETAIL_OK_HTML)],
        }
    )

    real_parse_html = parse_html

    def parse_html_side_effect(text):
        parsed = real_parse_html(text)
        # Only the detail page carries the match-header selector; make its
        # parsing blow up while the homepage still parses normally.
        if parsed.css_first(".match-header-vs") is not None:
            raise ValueError("malformed detail html")
        return parsed

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)
    monkeypatch.setattr("api.scrapers.matches.parse_html", parse_html_side_effect)

    data = await vlr_live_score()

    segment = data["data"]["segments"][0]
    _assert_failed_placeholders(segment)
    # Homepage-derived data is still served.
    assert segment["team1"] == "Team One"
    assert segment["match_id"] == "123"
    assert data["data"]["summary"] == {
        "total_matches": 1,
        "detail_fetched": 0,
        "detail_failed": 1,
    }
    cache_manager.clear_all()


@pytest.mark.anyio
async def test_vlr_live_score_zero_live_matches_has_zero_summary(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, UPCOMING_HTML)],
        }
    )

    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)

    data = await vlr_live_score()

    assert data["data"]["segments"] == []
    assert data["data"]["summary"] == {
        "total_matches": 0,
        "detail_fetched": 0,
        "detail_failed": 0,
    }
    cache_manager.clear_all()


UPCOMING_WITH_ID_HTML = """
<html>
  <div class="js-home-matches-upcoming">
    <a class="wf-module-item" href="/430123/sentinels-vs-fnatic">
      <div class="h-match-eta mod-upcoming">51m</div>
      <div class="h-match-team">
        <div class="h-match-team-name">Sentinels</div>
      </div>
      <div class="h-match-team">
        <div class="h-match-team-name">Fnatic</div>
      </div>
    </a>
  </div>
</html>
"""

RESULTS_HTML = """
<html>
  <a class="wf-module-item match-item" href="/430123/sentinels-vs-fnatic">
    <div class="match-item-time">2:30 PM</div>
    <div class="match-item-vs">
      <div class="match-item-vs-team">
        <div class="match-item-vs-team-name">
          <div class="text-of"><span class="flag mod-us"></span>Sentinels</div>
        </div>
        <div class="match-item-vs-team-score">2</div>
      </div>
      <div class="match-item-vs-team mod-winner">
        <div class="match-item-vs-team-name">
          <div class="text-of"><span class="flag mod-eu"></span>Fnatic</div>
        </div>
        <div class="match-item-vs-team-score">1</div>
      </div>
    </div>
    <div class="ml-eta">2h</div>
    <div class="match-item-event-series">Grand Final</div>
    <div class="match-item-event">
      <div class="match-item-event-series">Grand Final</div>
      VCT Champions
    </div>
    <div class="match-item-icon">
      <img src="//owcdn.net/img/icon.png">
    </div>
  </a>
</html>
"""


@pytest.mark.anyio
async def test_vlr_upcoming_matches_extracts_match_id(monkeypatch):
    cache_manager.clear_all()
    client = FakeAsyncClient(
        {
            "https://www.vlr.gg": [FakeResponse(200, UPCOMING_WITH_ID_HTML)],
        }
    )
    monkeypatch.setattr("api.scrapers.matches.get_http_client", lambda: client)

    data = await vlr_upcoming_matches()
    segments = data["data"]["segments"]
    assert len(segments) == 1
    assert segments[0]["match_id"] == "430123"
    assert segments[0]["team1"] == "Sentinels"
    assert segments[0]["team2"] == "Fnatic"
    cache_manager.clear_all()


def test_parse_single_match_extracts_match_id():
    html = parse_html(RESULTS_HTML)
    item = html.css_first("a.wf-module-item")
    match_data = _parse_single_match(item, "2026-02-09", 1)
    assert match_data is not None
    assert match_data["match_id"] == "430123"


def test_parse_results_page_extracts_match_id():
    html = parse_html(RESULTS_HTML)
    results = _parse_results_page(html, 1)
    assert len(results) == 1
    assert results[0]["match_id"] == "430123"
