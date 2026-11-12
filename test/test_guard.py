"""The fetch rules of py_bandcamp.guard, checked on their own with fake responses and fake HTML.

Nothing here touches the network: responses are local stand-ins with canned headers and bodies, and the pages are
short synthetic fragments. The same checks are what py_bandcamp.arr.Site.fetch and Site.save run (see
tests_arr/test_arr.py), so each rule is verified once, here, at the level any caller can use it.
"""
import http.client
import time

import pytest

from py_bandcamp import guard


def message(**headers):
    msg = http.client.HTTPMessage()
    for name, value in headers.items():
        msg[name.replace("_", "-")] = value
    return msg


class FakeResponse:
    """A stand-in for an HTTP response: canned headers plus a body served in pieces of at most `n` bytes."""

    def __init__(self, body=b"", headers=None):
        self.headers = headers if headers is not None else message()
        self._body = body
        self._pos = 0
        self.reads = 0

    def read1(self, n):
        self.reads += 1
        piece, self._pos = self._body[self._pos:self._pos + n], self._pos + n
        return piece


class NeverRead(FakeResponse):
    def read1(self, n):
        raise AssertionError("the body was read although the headers already settled it")


CHALLENGE_PAGE = "<html><title>Just a moment...</title><div>Verify you are human</div></html>"
FASTLY_PAGE = ('<html><head><link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css" rel="stylesheet" />'
               "<title>Client Challenge</title></head><body>JavaScript is disabled in your browser.</body></html>")
RELEASE_PAGE = '<html><div data-tralbum="{}"></div><div id="license">captcha-free</div></html>'
SEARCH_PAGE = '<html><ul class="result-items"><li class="searchresult">Access Denied Captcha</li></ul></html>'


class TestTrusted:
    @pytest.mark.parametrize("url", ["https://bandcamp.com/", "https://x.bandcamp.com/album/y",
                                     "https://a-b-1.bandcamp.com/track/z?from=search"])
    def test_bandcamp_https_addresses_are_trusted(self, url):
        assert guard.trusted(url)
        assert guard.trusted(url, stream=True)

    def test_bcbits_is_trusted_for_audio_only(self):
        assert guard.trusted("https://t4.bcbits.com/stream/a?x=1", stream=True)
        assert not guard.trusted("https://t4.bcbits.com/stream/a?x=1")

    @pytest.mark.parametrize("url", ["http://x.bandcamp.com/album/y", "https://bandcamp.com.evil.example/album/lp",
                                     "https://evilbandcamp.com/album/lp", "https://x.bandcamp.com.evil.example/",
                                     "ftp://x.bandcamp.com/a", "file:///etc/passwd", "", None])
    def test_plain_http_lookalikes_and_other_schemes_are_refused(self, url):
        assert not guard.trusted(url)
        assert not guard.trusted(url, stream=True)

    @pytest.mark.parametrize("url", ["https://evil.com\\@x.bandcamp.com/", "https://x.bandcamp.com\\.evil.com/",
                                     "https://evil.com @x.bandcamp.com/", "https://evil.com\t@x.bandcamp.com/",
                                     "https://evil.com\n@x.bandcamp.com/", "https://evil.com\x00@x.bandcamp.com/",
                                     "https://evil.com\x7f@x.bandcamp.com/", "https://x.bandcamp.com/a b"])
    def test_authorities_dressed_up_with_separators_are_refused(self, url):
        assert not guard.trusted(url)
        assert not guard.trusted(url, stream=True)
        assert not guard.trusted(url, extra=["evil.com"])

    def test_extra_hosts_may_use_plain_http(self):
        assert guard.trusted("http://127.0.0.1:5000/a", extra=["127.0.0.1:5000"])
        assert guard.trusted("https://artist.example/album/x", extra=["artist.example"])
        assert not guard.trusted("http://127.0.0.1:5000/a")
        assert not guard.trusted("http://127.0.0.1:5001/a", extra=["127.0.0.1:5000"])


class TestCheckTrusted:
    def test_the_host_of_a_trusted_address_is_returned(self):
        assert guard.check_trusted("https://x.bandcamp.com/album/y") == "x.bandcamp.com"
        assert guard.check_trusted("http://127.0.0.1:5000/a", extra=["127.0.0.1:5000"]) == "127.0.0.1:5000"

    def test_an_untrusted_address_raises_with_the_host_in_the_message(self):
        with pytest.raises(guard.Untrusted) as hit:
            guard.check_trusted("https://bandcamp.com.evil.example/album/lp")
        assert "bandcamp.com.evil.example" in str(hit.value)
        assert "extra hosts" in str(hit.value)
        assert hit.value.host == "bandcamp.com.evil.example"

    def test_a_stream_address_is_judged_by_the_stream_rules(self):
        assert guard.check_trusted("https://t4.bcbits.com/stream/a", stream=True) == "t4.bcbits.com"
        with pytest.raises(guard.Untrusted):
            guard.check_trusted("https://t4.bcbits.com/stream/a")


class TestRedirects:
    def test_a_relative_location_resolves_against_the_hop(self):
        assert guard.redirect_target("https://x.bandcamp.com/a/b", "/c") == "https://x.bandcamp.com/c"
        assert guard.redirect_target("https://x.bandcamp.com/a/b", "c") == "https://x.bandcamp.com/a/c"

    def test_an_absolute_location_is_taken_as_is(self):
        assert guard.redirect_target("https://x.bandcamp.com/a", "https://y.bandcamp.com/b") == "https://y.bandcamp.com/b"

    def test_https_may_not_be_left(self):
        with pytest.raises(guard.WeakerScheme) as hit:
            guard.redirect_target("https://x.bandcamp.com/a", "http://x.bandcamp.com/a")
        assert isinstance(hit.value, guard.Untrusted)
        text = str(hit.value)
        assert "x.bandcamp.com" in text and "weaker scheme" in text

    def test_https_may_be_gained(self):
        assert guard.redirect_target("http://127.0.0.1:5000/a", "https://x.bandcamp.com/a") == "https://x.bandcamp.com/a"

    def test_the_hop_limit_is_exact(self):
        assert guard.check_hops(guard.MAX_HOPS, "x.bandcamp.com") == guard.MAX_HOPS
        with pytest.raises(guard.TooManyHops) as hit:
            guard.check_hops(guard.MAX_HOPS + 1, "x.bandcamp.com")
        text = str(hit.value)
        assert "x.bandcamp.com" in text and str(guard.MAX_HOPS) in text


class TestDeclaredLength:
    def test_a_missing_content_length_is_none(self):
        assert guard.declared_length(FakeResponse(b"x")) is None
        assert guard.declared_length({}) is None

    def test_a_plain_number_is_read(self):
        assert guard.declared_length(FakeResponse(headers=message(Content_Length="90000"))) == 90000
        assert guard.declared_length({"Content-Length": " 90000 "}) == 90000

    def test_a_repeated_content_length_is_refused(self):
        headers = message(Content_Length="3003")
        headers["Content-Length"] = "3003"
        with pytest.raises(guard.BadLength) as hit:
            guard.declared_length(FakeResponse(headers=headers), host="x.bandcamp.com")
        assert "x.bandcamp.com" in str(hit.value) and "Content-Length" in str(hit.value)

    @pytest.mark.parametrize("value", ["+90000", "9_0000", "90000, 90000", "90000,90000", "-1", "0x15f90", "\xb2", "9e4", ""])
    def test_a_content_length_that_is_not_plain_digits_is_refused(self, value):
        with pytest.raises(guard.BadLength) as hit:
            guard.declared_length(FakeResponse(headers=message(Content_Length=value)), host="x.bandcamp.com")
        assert "x.bandcamp.com" in str(hit.value)
        if value.strip():
            assert value.strip() in str(hit.value)


class TestBudgets:
    def test_the_constants(self):
        assert (guard.MAX_HOPS, guard.MAX_PAGE, guard.MAX_AUDIO) == (5, 8 * 1024 * 1024, 256 * 1024 * 1024)
        assert (guard.PAGE_SECONDS, guard.AUDIO_SECONDS, guard.AUDIO_RATE, guard.AUDIO_SECONDS_MAX) == (120, 60, 32 * 1024, 3600)

    def test_a_page_has_one_flat_budget(self):
        assert guard.page_seconds(None) == 120
        assert guard.page_seconds(10 ** 9) == 120

    def test_an_audio_budget_scales_with_the_declared_length_up_to_a_ceiling(self):
        assert guard.audio_seconds(0) == 60
        assert guard.audio_seconds(32 * 1024 * 100) == 160
        assert guard.audio_seconds(guard.MAX_AUDIO) == 3600
        assert guard.audio_seconds(None) == 3600


class TestDeclaredAndBody:
    def test_a_declared_length_over_the_limit_is_refused_before_any_reading(self):
        with pytest.raises(guard.TooLarge) as hit:
            guard.check_declared(4001, 4000, host="t4.bcbits.com")
        assert "t4.bcbits.com" in str(hit.value) and "more than 4000 bytes" in str(hit.value)
        assert guard.check_declared(4000, 4000) == 4000
        assert guard.check_declared(None, 4000) is None

    def test_a_downloaded_body_is_checked_against_the_limit_and_the_declaration(self):
        assert guard.check_body(b"x" * 100, declared=100, limit=1000) == 100
        assert guard.check_body(100, declared=100, limit=1000) == 100
        with pytest.raises(guard.TooLarge):
            guard.check_body(b"x" * 1001, limit=1000)
        with pytest.raises(guard.Truncated) as hit:
            guard.check_body(b"x" * 99, declared=100, limit=1000, host="t4.bcbits.com")
        assert "99 of 100" in str(hit.value) and "t4.bcbits.com" in str(hit.value)

    def test_a_body_defaults_to_the_page_limit(self):
        assert guard.check_body(b"x" * guard.MAX_PAGE) == guard.MAX_PAGE
        with pytest.raises(guard.TooLarge):
            guard.check_body(b"x" * (guard.MAX_PAGE + 1))


class TestReadCapped:
    def test_a_complete_body_is_returned(self):
        body = b"<html>" + b"x" * 3000 + b"</html>"
        response = FakeResponse(body, message(Content_Length=str(len(body))))
        assert guard.read_capped(response, 10 ** 6) == body

    def test_a_body_is_streamed_to_a_sink_and_counted(self):
        body = b"ID3" + b"\x00" * 2000

        class Sink:
            def __init__(self):
                self.parts = []

            def write(self, chunk):
                self.parts.append(chunk)
        sink = Sink()
        size = guard.read_capped(FakeResponse(body, message(Content_Length=str(len(body)))), 10 ** 6, sink)
        assert size == len(body)
        assert b"".join(sink.parts) == body

    def test_a_declaration_over_the_limit_is_refused_before_any_reading(self):
        with pytest.raises(guard.TooLarge) as hit:
            guard.read_capped(NeverRead(headers=message(Content_Length="5000")), 4000, host="t4.bcbits.com")
        assert hit.value.limit == 4000
        assert "t4.bcbits.com" in str(hit.value) and "more than 4000 bytes" in str(hit.value)

    def test_a_body_without_a_declaration_is_cut_off_as_it_arrives(self, monkeypatch):
        monkeypatch.setattr(guard, "CHUNK", 100)
        response = FakeResponse(b"x" * 10 ** 6)
        with pytest.raises(guard.TooLarge):
            guard.read_capped(response, 1000)
        assert response.reads == 11, "reading stopped the moment the limit was passed"

    def test_a_body_short_of_its_declaration_is_truncated(self):
        with pytest.raises(guard.Truncated) as hit:
            guard.read_capped(FakeResponse(b"x" * 200, message(Content_Length="90000")), 10 ** 6, host="x.bandcamp.com")
        assert (hit.value.read, hit.value.declared) == (200, 90000)
        assert "x.bandcamp.com" in str(hit.value) and "200 of 90000" in str(hit.value)

    def test_a_malformed_content_length_is_refused(self):
        with pytest.raises(guard.BadLength):
            guard.read_capped(NeverRead(headers=message(Content_Length="9_0000")), 10 ** 6)

    def test_a_body_past_its_budget_is_too_slow(self):
        response = FakeResponse(b"x" * 10 ** 6)
        with pytest.raises(guard.TooSlow) as hit:
            guard.read_capped(response, 10 ** 6, budget=lambda declared: 5, since=time.monotonic() - 10, host="x.bandcamp.com")
        assert hit.value.seconds == 5
        assert "x.bandcamp.com" in str(hit.value) and "within 5 seconds" in str(hit.value)

    def test_page_and_audio_budgets_are_the_defaults_of_their_kind(self):
        body = b"x" * 100
        assert guard.read_capped(FakeResponse(body), 1000) == body
        assert guard.read_capped(FakeResponse(body), 1000, budget=guard.audio_seconds) == body


class TestChallenge:
    @pytest.mark.parametrize("page", [CHALLENGE_PAGE, FASTLY_PAGE])
    def test_a_bot_check_is_recognized(self, page):
        assert guard.is_challenge(page)

    @pytest.mark.parametrize("page", [RELEASE_PAGE, SEARCH_PAGE, "<html>ordinary page</html>"])
    def test_a_real_page_is_not_a_bot_check(self, page):
        assert not guard.is_challenge(page)


class TestExceptions:
    def test_every_refusal_is_a_distinct_kind_of_refused(self):
        kinds = [guard.Untrusted("http://x.example/"), guard.WeakerScheme("https://a.bandcamp.com/", "http://a.bandcamp.com/"),
                 guard.TooManyHops("a.bandcamp.com"), guard.TooLarge(10), guard.Truncated(1, 2), guard.TooSlow(3), guard.BadLength("x")]
        assert all(isinstance(e, guard.Refused) for e in kinds)
        assert len({type(e) for e in kinds}) == len(kinds)
        assert isinstance(kinds[1], guard.Untrusted), "a scheme downgrade is a kind of untrusted address"

    def test_the_message_names_the_host_and_the_numbers(self):
        assert str(guard.TooLarge(4000, "t4.bcbits.com")) == "t4.bcbits.com answered with more than 4000 bytes; refused"
        assert str(guard.Truncated(200, 90000, "x.bandcamp.com")) == "x.bandcamp.com closed the answer after 200 of 90000 bytes; refused"
        assert str(guard.TooSlow(120, "x.bandcamp.com")) == "x.bandcamp.com did not deliver the answer within 120 seconds; refused"
        assert "x.bandcamp.com" in str(guard.BadLength("+1", "x.bandcamp.com"))
        assert "x.bandcamp.com" in str(guard.TooManyHops("x.bandcamp.com"))
        assert "evil.example" in str(guard.Untrusted("https://evil.example/a"))

    def test_the_host_can_be_filled_in_by_whoever_knows_it(self):
        e = guard.TooLarge(4000)
        assert str(e).startswith("the server ")
        e.host = "t4.bcbits.com"
        assert str(e).startswith("t4.bcbits.com ")

    def test_the_values_are_kept_as_attributes(self):
        e = guard.Truncated(200, 90000, "x.bandcamp.com")
        assert (e.read, e.declared, e.host) == (200, 90000, "x.bandcamp.com")
        e = guard.TooSlow(120, "x.bandcamp.com")
        assert (e.seconds, e.host) == (120, "x.bandcamp.com")
        e = guard.WeakerScheme("https://a.bandcamp.com/x", "http://a.bandcamp.com/x")
        assert (e.url, e.target, e.host) == ("https://a.bandcamp.com/x", "http://a.bandcamp.com/x", "a.bandcamp.com")
