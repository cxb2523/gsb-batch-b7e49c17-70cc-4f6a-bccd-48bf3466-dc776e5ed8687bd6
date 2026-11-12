"""The fetch rules of the arrkit indexer and download client, as independently callable checks.

Bandcamp has no public API, so pages and audio are scraped straight over HTTP under a fixed set of rules: every hop
must be a trusted https address, at most MAX_HOPS redirects are followed, a page is at most MAX_PAGE bytes and an
audio file at most MAX_AUDIO bytes, and each has its own time budget. Those rules live here — and only here — so that
``py_bandcamp.arr.Site.fetch``/``Site.save`` and any other caller judge an address, a redirect, a Content-Length, a
body or a budget by the same code. Nothing in this module opens a socket; it only judges what a caller brings it.

The checks, one entry point each:

- ``trusted`` / ``check_trusted``: is one hop's address trusted (https on bandcamp.com, plus bcbits.com for a stream,
  plus the hosts of ``extra_hosts``)?
- ``redirect_target`` / ``check_hops``: where does a redirect point, is the https scheme kept, and is the chain still
  within MAX_HOPS?
- ``declared_length``: the Content-Length of a response — missing (None), or an int; a repeated or non-numeric one is
  refused.
- ``check_declared``: is a declared length within the limit?
- ``check_body``: does an already downloaded body pass the byte limit and match its declared length?
- ``read_capped``: read a streaming response under the byte limit, the declared length and the time budget.
- ``page_seconds`` / ``audio_seconds``: the time budget of a page and of an audio file.

Every refusal raises a distinct subclass of ``Refused`` — Untrusted (and its WeakerScheme special case), TooManyHops,
TooLarge, Truncated, TooSlow, BadLength — whose message names the host and the numbers that matter, so a log line is
enough to place the failure. Each exception also carries the values as attributes (``.host``, ``.limit``, ``.read``,
``.declared``, ``.seconds``, ``.url``, ``.target``) for callers that want them structured. The message is computed
when the exception is stringified, so a caller that knows the host (``Site.fetch``) can fill in ``.host`` afterwards.
"""
import re
import time
import urllib.parse

MAX_HOPS = 5
MAX_PAGE = 8 * 1024 * 1024
MAX_AUDIO = 256 * 1024 * 1024
CHUNK = 64 * 1024
PAGE_SECONDS = 120
AUDIO_SECONDS = 60
AUDIO_RATE = 32 * 1024
AUDIO_SECONDS_MAX = 3600

UNSAFE = re.compile(r"[\s\x00-\x1f\x7f]")
CONTENT_LENGTH = re.compile(r"[0-9]+")
CHALLENGE = re.compile(r"captcha|client challenge|/_fs-ch-|cf-chl|just a moment|attention required|access denied|verify you are human|checking your browser", re.I)


class Refused(Exception):
    """A fetch rule was broken. The message names the host and the numbers that matter; `host` is the host that broke
    the rule, or "" when the caller that raised the check did not know it (a caller that does know it may set it)."""

    host = ""

    def __str__(self):
        return self.message(self.host or "the server")

    def message(self, who):
        raise NotImplementedError


class Untrusted(Refused):
    """An address is not a trusted one: not https on bandcamp.com (or bcbits.com for a stream), and not in extra_hosts."""

    def __init__(self, url):
        self.url = str(url or "")
        self.host = host_of(self.url)

    def message(self, who):
        return f"{self.host or self.url or 'the address'} is not a Bandcamp address; add it to the extra hosts to use it"


class WeakerScheme(Untrusted):
    """A redirect answered to an https address points at a weaker scheme."""

    def __init__(self, url, target):
        self.url, self.target = str(url or ""), str(target or "")
        self.host = host_of(self.url)

    def message(self, who):
        return f"{self.host or self.url} redirected from https to {host_of(self.target) or 'another address'} over a weaker scheme; refused"


class TooManyHops(Refused):
    """A redirect chain went past MAX_HOPS hops."""

    def __init__(self, host, limit=None):
        self.host = host
        self.limit = MAX_HOPS if limit is None else limit

    def message(self, who):
        return f"{who} redirected more than {self.limit} times; refused"


class TooLarge(Refused):
    """An answer is longer than the limit for it: `limit` bytes."""

    def __init__(self, limit, host=""):
        self.limit, self.host = limit, host

    def message(self, who):
        return f"{who} answered with more than {self.limit} bytes; refused"


class Truncated(Refused):
    """An answer ended before the length it declared: `read` bytes arrived of the `declared` ones."""

    def __init__(self, read, declared, host=""):
        self.read, self.declared, self.host = read, declared, host

    def message(self, who):
        return f"{who} closed the answer after {self.read} of {self.declared} bytes; refused"


class TooSlow(Refused):
    """An answer did not finish within its time budget of `seconds` seconds."""

    def __init__(self, seconds, host=""):
        self.seconds, self.host = seconds, host

    def message(self, who):
        return f"{who} did not deliver the answer within {self.seconds} seconds; refused"


class BadLength(Refused):
    """An answer carries a Content-Length that is not a single run of ASCII digits: `value`."""

    def __init__(self, value="", host=""):
        self.value, self.host = value, host

    def message(self, who):
        detail = f": {self.value!r}" if self.value else ""
        return f"{who} sent a Content-Length that is not a single number{detail}; refused"


def host_of(url):
    """The lowercased "host[:port]" of `url`'s authority, without userinfo or a trailing dot; "" when there is no host."""
    try:
        u = urllib.parse.urlsplit(str(url or ""))
        host, port = u.hostname, u.port
    except ValueError:
        return ""
    if not host:
        return ""
    host = host.lower().rstrip(".")
    return f"{host}:{port}" if port else host


def trusted(url, extra=(), stream=False):
    """True for an https address on bandcamp.com (and on bcbits.com for a stream), or on a host named in `extra`."""
    url = str(url or "")
    u = urllib.parse.urlsplit(url)
    if UNSAFE.search(url) or "\\" in u.netloc:
        return False
    host = host_of(url) if u.hostname else ""
    if host and host in extra and u.scheme in ("http", "https"):
        return True
    suffixes = (".bandcamp.com", ".bcbits.com") if stream else (".bandcamp.com",)
    name = (u.hostname or "").lower()
    return u.scheme == "https" and bool(name) and (name == "bandcamp.com" or name.endswith(suffixes))


def check_trusted(url, extra=(), stream=False):
    """The host of `url` when it is a trusted address for one hop. Raises Untrusted otherwise."""
    if not trusted(url, extra, stream):
        raise Untrusted(url)
    return host_of(url)


def redirect_target(url, location):
    """The absolute address a redirect from `url` to `location` points to. Raises WeakerScheme when it leaves https."""
    target = urllib.parse.urljoin(url, location)
    if urllib.parse.urlsplit(url).scheme == "https" and urllib.parse.urlsplit(target).scheme != "https":
        raise WeakerScheme(url, target)
    return target


def check_hops(hops, host, limit=None):
    """`hops`, the number of redirect hops followed so far. Raises TooManyHops when it passes MAX_HOPS."""
    limit = MAX_HOPS if limit is None else limit
    if hops > limit:
        raise TooManyHops(host, limit)
    return hops


def page_seconds(declared=None):
    """The time a page may take to arrive: the headers of every hop and the body share this one budget."""
    return PAGE_SECONDS


def audio_seconds(declared=None):
    """The time an audio file may take to arrive: a base plus the time at AUDIO_RATE bytes a second, up to AUDIO_SECONDS_MAX."""
    return min(AUDIO_SECONDS_MAX, AUDIO_SECONDS + (MAX_AUDIO if declared is None else declared) / AUDIO_RATE)


def declared_length(response, host=""):
    """The Content-Length of `response` (or of a plain header mapping) as an int, or None when it has none.
    Raises BadLength for one that is repeated or is not a single run of ASCII digits."""
    headers = getattr(response, "headers", response)
    get_all = getattr(headers, "get_all", None)
    if get_all:
        values = get_all("Content-Length") or []
    else:
        one = headers.get("Content-Length")
        values = [] if one is None else [one]
    if not values:
        return None
    if len(values) > 1:
        raise BadLength(", ".join(str(v) for v in values), host)
    value = str(values[0]).strip()
    if not CONTENT_LENGTH.fullmatch(value):
        raise BadLength(value, host)
    return int(value)


def check_declared(declared, limit, host=""):
    """`declared` (a Content-Length or a byte count) when it is within `limit` bytes. Raises TooLarge otherwise."""
    if declared is not None and declared > limit:
        raise TooLarge(limit, host)
    return declared


def check_body(body, declared=None, limit=None, host=""):
    """The size of an already downloaded `body` (bytes, or a byte count) that passes the rules: at most `limit`
    (MAX_PAGE when not given) and exactly `declared` when a length was declared. Raises TooLarge or Truncated."""
    size = len(body) if hasattr(body, "__len__") else int(body)
    check_declared(size, MAX_PAGE if limit is None else limit, host)
    if declared is not None and size != declared:
        raise Truncated(size, declared, host)
    return size


def read_capped(response, limit, sink=None, budget=None, since=None, host=""):
    """The body of `response`, or the number of bytes written to `sink` when there is one. Raises TooLarge as soon as
    the body passes `limit`, BadLength for a malformed Content-Length, TooSlow when it is not complete
    `budget(declared length)` seconds after `since` (the first read when not given), and Truncated when it ends short
    of its declared length."""
    budget = page_seconds if budget is None else budget
    declared = declared_length(response, host)
    check_declared(declared, limit, host)
    deadline = (time.monotonic() if since is None else since) + budget(declared)
    chunks, size = [], 0
    while True:
        chunk = response.read1(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise TooLarge(limit, host)
        sink.write(chunk) if sink else chunks.append(chunk)
        if time.monotonic() > deadline:
            raise TooSlow(round(budget(declared)), host)
    if declared is not None and size != declared:
        raise Truncated(size, declared, host)
    return size if sink else b"".join(chunks)


def is_challenge(text):
    """True for a page that is a bot check and not Bandcamp's."""
    return bool(CHALLENGE.search(text[:20000])) and "searchresult" not in text and "data-tralbum" not in text
