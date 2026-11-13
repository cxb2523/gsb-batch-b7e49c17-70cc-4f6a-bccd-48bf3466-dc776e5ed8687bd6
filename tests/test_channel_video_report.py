"""Tests for ``MediaDownloader.get_channel_videos_report``.

The report method must show, per candidate URL, which parser ran, whether it
succeeded, and how many links it produced, while deduplicating video IDs both
within and across candidates. Pages are built locally and the HTTP layer is
mocked, so no network access happens.
"""

from unittest.mock import MagicMock, patch

from media_downloader.media_downloader import MediaDownloader

USER_URL = "https://www.youtube.com/user/sample_channel/videos"
C_URL = "https://www.youtube.com/c/sample_channel/videos"


def _response(content: bytes) -> MagicMock:
    resp = MagicMock()
    resp.content = content
    return resp


def _watch(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _ids(links) -> list[str]:
    """Video IDs the report's dedup logic derives from each parsed link."""
    identity = MediaDownloader._channel_video_identity
    return [identity(link) for link in links]


def test_report_normal_hit_first_candidate():
    """The user URL hits; the report records the attempt and queues the links."""
    # The canonical parser splits on spaces and rewrites the href token, so each
    # anchor is written as a standalone token ending in the closing quote.
    page = (
        b'href="/watch?v=aaaaaaaaaaa" '
        b'href="/watch?v=bbbbbbbbbbb" '
        b'href="/watch?v=aaaaaaaaaaa"'
    )
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        return_value=_response(page),
    ) as mock_get:
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel", limit=1)

    assert report.hit is True
    assert report.selected_url == USER_URL
    # The repeated ID inside the one page is dropped, keeping page order.
    assert _ids(report.links) == ["aaaaaaaaaaa"]
    assert len(report.candidates) == 2
    first, second = report.candidates
    assert first.url == USER_URL
    assert first.parser == "_canonical_channel_video_links"
    assert first.success is True
    assert first.raw_count == 3
    assert first.unique_count == 2
    assert first.error is None
    assert second.url == C_URL
    assert second.parser == "_alternate_channel_video_links"
    assert second.success is True
    # Both candidates are always tried so the report stays complete.
    assert mock_get.call_count == 2
    # The selected batch is appended to self.links, honoring the limit.
    assert _ids(downloader.links) == ["aaaaaaaaaaa"]
    assert report.to_dict()["links"] == report.links
    # Without a limit the full deduplicated batch is reported and queued.
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        return_value=_response(page),
    ):
        full_report = MediaDownloader().get_channel_videos_report("sample_channel")
    assert _ids(full_report.links) == ["aaaaaaaaaaa", "bbbbbbbbbbb"]


def test_report_candidate_fallback_and_cross_candidate_dedup():
    """An empty user page falls through to the c URL; shared IDs merge once."""
    user_page = b"no watch anchors here"
    c_page = (
        b"https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg "
        b"https://i.ytimg.com/vi/ddddddddddd/hqdefault.jpg "
        b"https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg"
    )
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        side_effect=[_response(user_page), _response(c_page)],
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is True
    assert report.selected_url == C_URL
    assert report.links == [_watch("ccccccccccc"), _watch("ddddddddddd")]

    first, second = report.candidates
    assert first.success is True
    assert first.raw_count == 0
    assert first.unique_count == 0
    assert second.success is True
    assert second.parser == "_alternate_channel_video_links"
    # Two raw thumbnail matches after the in-page duplicate drops to two IDs.
    assert second.raw_count == 3
    assert second.unique_count == 2
    assert downloader.links == report.links


def test_report_parser_exception_continues_round():
    """A parser raising on the user URL is recorded; the c URL still resolves."""
    user_page = b'href="/watch?v=broken000000"'
    c_page = b"https://i.ytimg.com/vi/eeeeeeeeeee/hqdefault.jpg"
    with (
        patch(
            "media_downloader.media_downloader.safe_metadata_get",
            side_effect=[_response(user_page), _response(c_page)],
        ),
        patch.object(
            MediaDownloader,
            "_canonical_channel_video_links",
            side_effect=ValueError("simulated parser failure"),
        ),
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is True
    assert report.selected_url == C_URL
    assert report.links == [_watch("eeeeeeeeeee")]

    first, second = report.candidates
    assert first.success is False
    assert first.raw_count == 0
    assert first.unique_count == 0
    assert first.error == "ValueError"
    assert second.success is True
    assert second.unique_count == 1
    assert downloader.links == [_watch("eeeeeeeeeee")]


def test_report_fetch_exception_continues_round():
    """A fetch failure on the user URL is recorded without aborting the round."""
    c_page = b"https://i.ytimg.com/vi/fffffffffff/hqdefault.jpg"
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        side_effect=[ConnectionError("network down"), _response(c_page)],
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is True
    assert report.selected_url == C_URL
    first, second = report.candidates
    assert first.success is False
    assert first.error == "ConnectionError"
    assert second.success is True
    assert report.links == [_watch("fffffffffff")]


def test_report_all_empty_is_miss_without_raising():
    """Every candidate yielding nothing returns an empty, flagged report."""
    empty = _response(b"nothing of interest")
    with patch(
        "media_downloader.media_downloader.safe_metadata_get", return_value=empty
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is False
    assert report.selected_url is None
    assert report.links == []
    assert len(report.candidates) == 2
    assert all(candidate.success for candidate in report.candidates)
    assert all(candidate.raw_count == 0 for candidate in report.candidates)
    assert downloader.links == []


def test_report_all_failing_is_miss_without_raising():
    """Every candidate raising returns a miss rather than propagating."""
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        side_effect=RuntimeError("boom"),
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is False
    assert report.selected_url is None
    assert report.links == []
    assert len(report.candidates) == 2
    assert all(candidate.success is False for candidate in report.candidates)
    assert all(candidate.error == "RuntimeError" for candidate in report.candidates)
    assert downloader.links == []


def test_report_does_not_reappend_existing_links():
    """IDs already queued on self.links are never appended a second time."""
    existing = _watch("ggggggggggg")
    page = b'href="/watch?v=ggggggggggg" href="/watch?v=hhhhhhhhhhh"'
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        return_value=_response(page),
    ):
        downloader = MediaDownloader(links=[existing])
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is True
    # The report only carries the newly discovered links, in page order.
    assert _ids(report.links) == ["hhhhhhhhhhh"]
    assert _ids(downloader.links) == ["ggggggggggg", "hhhhhhhhhhh"]


def test_report_hit_with_only_already_queued_links():
    """A resolved page whose IDs are all queued still hits and appends nothing."""
    existing = _watch("ggggggggggg")
    page = b'href="/watch?v=ggggggggggg" href="/watch?v=ggggggggggg"'
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        return_value=_response(page),
    ):
        downloader = MediaDownloader(links=[existing])
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.hit is True
    assert report.selected_url == USER_URL
    assert report.links == []
    assert report.candidates[0].raw_count == 2
    assert report.candidates[0].unique_count == 1
    # No duplicate append: the pre-existing link stays the only entry.
    assert downloader.links == [existing]


def test_report_cross_candidate_dedup_keeps_first_position():
    """The same ID on both candidate pages survives only at its first slot."""
    user_page = b'{"videoId":"iiiiiiiiiii"},{"videoId":"jjjjjjjjjjj"}'
    c_page = (
        b"https://i.ytimg.com/vi/jjjjjjjjjjj/hqdefault.jpg "
        b"https://i.ytimg.com/vi/kkkkkkkkkkk/hqdefault.jpg"
    )
    with patch(
        "media_downloader.media_downloader.safe_metadata_get",
        side_effect=[_response(user_page), _response(c_page)],
    ):
        downloader = MediaDownloader()
        report = downloader.get_channel_videos_report("sample_channel")

    assert report.selected_url == USER_URL
    assert report.links == [
        _watch("iiiiiiiiiii"),
        _watch("jjjjjjjjjjj"),
        _watch("kkkkkkkkkkk"),
    ]
    first, second = report.candidates
    # The c candidate still parsed its two thumbnails, but one was already seen.
    assert first.unique_count == 2
    assert second.unique_count == 2
    assert downloader.links == report.links
