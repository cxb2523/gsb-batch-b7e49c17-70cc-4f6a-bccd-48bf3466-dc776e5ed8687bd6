#!/usr/bin/env python3
"""Capture Cloudflare Turnstile challenge parameters from a page.

Static mode (stdlib only) recognises both ways the widget can be configured:

* declarative ``data-*`` attributes on the widget container, e.g.
  ``<div data-sitekey="0x..." data-action="login" data-cdata="...">``;
* an explicit ``turnstile.render(container, {...})`` call whose options object
  carries ``sitekey``, ``action``, ``cData`` and ``chlPageData``.

When both forms supply the same field, the explicit render options win: they
are what actually configures the widget at runtime.  A field missing from the
render options falls back to its ``data-*`` attribute, so a page can mix the
two forms.  ``source`` records where each non-null value came from
(``"attribute"`` or ``"script"``); a missing field stays ``null`` rather than
being filled with a guessed default.

Values that violate the documented constraints are rejected (reported as
``null``, with the reason in ``invalid``):
``action`` must be at most 32 characters of ``[A-Za-z0-9_-]`` and ``cData`` at
most 255 characters.

The observed live request flow is in docs/01-challenge-flow.md. ``--solve``
routes the challenge to the Peak API and prints the token.

    python capture.py https://example.com/
    PEAK_API_KEY=pk_... python capture.py https://example.com/ --solve
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Endpoints observed live (Turnstile v0), see docs/01-challenge-flow.md.
FLOW = [
    "loader    GET  challenges.cloudflare.com/turnstile/v0/api.js?render=explicit   -> 302",
    "bundle    GET  challenges.cloudflare.com/turnstile/v0/b/<hash>/api.js          -> obfuscated challenge JS",
    "orchestr  POST challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/<seg>/<sitekey>",
    "token     ->   submitted as the 'cf-turnstile-response' field",
]

FIELDS = ("sitekey", "cdata", "action", "chlpagedata")

# HTML attribute name -> output field.  HTMLParser lowercases attribute names.
DATA_ATTRIBUTES = {
    "data-sitekey": "sitekey",
    "data-cdata": "cdata",
    "data-action": "action",
    "data-chlpagedata": "chlpagedata",
}

# JS render option name (normalised to lower case) -> output field.  The
# documented spellings are sitekey, action, cData and chlPageData.
JS_OPTIONS = {
    "sitekey": "sitekey",
    "action": "action",
    "cdata": "cdata",
    "chlpagedata": "chlpagedata",
}

ACTION_RE = re.compile(r"[A-Za-z0-9_-]+\Z")
LOADER_RE = re.compile(r"challenges\.cloudflare\.com/turnstile/v0/api\.js")
MANAGED_RE = re.compile(r"cf_chl_opt|__cf_chl|window\._cf_chl_opt|Just a moment")
JS_RENDER_RE = re.compile(
    r"(?:(?:window|self|globalThis)\s*\.\s*)?\bturnstile\s*\.\s*render\s*\("
)
JS_QUOTES = "'\"`"


class _PageParser(HTMLParser):
    """Collect data-* widget attributes and inline script bodies from HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.data_attributes = {field: None for field in FIELDS}
        self.scripts = []
        self._in_script = False
        self._script_chunks = []

    def handle_starttag(self, tag, attrs) -> None:
        for name, value in attrs:
            field = DATA_ATTRIBUTES.get(name.lower())
            if field is None or self.data_attributes[field] is not None:
                continue
            # An empty/whitespace-only value is absence, not a value.
            if value and value.strip():
                self.data_attributes[field] = value
        if tag == "script":
            self._in_script = True
            self._script_chunks = []

    def handle_data(self, data) -> None:
        if self._in_script:
            self._script_chunks.append(data)

    def handle_endtag(self, tag) -> None:
        if tag == "script" and self._in_script:
            self.scripts.append("".join(self._script_chunks))
            self._script_chunks = []
            self._in_script = False


def _skip_js_string(source: str, index: int) -> int:
    """Return the index just past a JS string/template literal at *index*."""
    quote = source[index]
    index += 1
    while index < len(source):
        ch = source[index]
        if ch == "\\":
            index += 2
            continue
        if ch == quote:
            return index + 1
        index += 1
    return len(source)


def _skip_js_comment(source: str, index: int) -> int | None:
    """Return the index just past a JS comment at *index*, else None."""
    if source.startswith("//", index):
        end = source.find("\n", index + 2)
        return len(source) if end < 0 else end + 1
    if source.startswith("/*", index):
        end = source.find("*/", index + 2)
        return len(source) if end < 0 else end + 2
    return None


def _decode_js_string(source: str, index: int) -> tuple[str | None, int]:
    """Decode one quoted JS string starting at *index*.

    Returns ``(None, index)`` when the literal is unterminated or is a template
    literal with interpolation (``${...}``), whose value cannot be known
    statically.
    """
    quote = source[index]
    index += 1
    out = []
    while index < len(source):
        ch = source[index]
        if ch == quote:
            return "".join(out), index + 1
        if ch == "\\":
            index += 1
            if index >= len(source):
                return None, index
            esc = source[index]
            simple = {
                "n": "\n", "r": "\r", "t": "\t", "b": "\b",
                "f": "\f", "v": "\v", "0": "\0",
            }
            if esc == "\n":           # line continuation
                index += 1
                continue
            if esc == "u" and index + 5 <= len(source):
                try:
                    out.append(chr(int(source[index + 1:index + 5], 16)))
                except ValueError:
                    out.append(esc)
                index += 5
                continue
            if esc == "x" and index + 3 <= len(source):
                try:
                    out.append(chr(int(source[index + 1:index + 3], 16)))
                except ValueError:
                    out.append(esc)
                index += 3
                continue
            out.append(simple.get(esc, esc))
            index += 1
            continue
        if quote == "`" and ch == "$" and source.startswith("${", index):
            return None, index
        out.append(ch)
        index += 1
    return None, index


def _skip_js_trivia(source: str, index: int) -> int:
    """Skip whitespace and JS comments starting at *index*."""
    while index < len(source):
        if source[index].isspace():
            index += 1
            continue
        comment_end = _skip_js_comment(source, index)
        if comment_end is None:
            break
        index = comment_end
    return index


def _js_string_value(expression: str) -> str | None:
    """Return the value of a JS expression that is exactly one string literal."""
    start = _skip_js_trivia(expression, 0)
    if start >= len(expression) or expression[start] not in JS_QUOTES:
        return None
    value, end = _decode_js_string(expression, start)
    if value is None or _skip_js_trivia(expression, end) != len(expression):
        return None
    return value


def _find_object_argument(source: str, start: int) -> int | None:
    """Find the first top-level object literal in a ``render(...)`` call."""
    paren = 1  # we start just after the opening "("
    brace = bracket = 0
    index = start
    while index < len(source):
        ch = source[index]
        if ch in JS_QUOTES:
            index = _skip_js_string(source, index)
            continue
        comment_end = _skip_js_comment(source, index)
        if comment_end is not None:
            index = comment_end
            continue
        if ch == "(":
            paren += 1
        elif ch == ")":
            paren -= 1
            if paren == 0:
                return None
        elif ch == "[":
            bracket += 1
        elif ch == "]":
            bracket = max(0, bracket - 1)
        elif ch == "{":
            if paren == 1 and bracket == 0 and brace == 0:
                return index
            brace += 1
        elif ch == "}":
            brace = max(0, brace - 1)
        index += 1
    return None


def _object_body(source: str, start: int) -> str | None:
    """Return the contents of the object literal whose ``{`` is at *start*."""
    depth = 0
    index = start
    while index < len(source):
        ch = source[index]
        if ch in JS_QUOTES:
            index = _skip_js_string(source, index)
            continue
        comment_end = _skip_js_comment(source, index)
        if comment_end is not None:
            index = comment_end
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start + 1:index]
        index += 1
    return None


def _split_members(body: str) -> list[str]:
    """Split an object body on top-level commas (ignoring nested literals)."""
    members = []
    start = 0
    depth = 0
    index = 0
    while index < len(body):
        ch = body[index]
        if ch in JS_QUOTES:
            index = _skip_js_string(body, index)
            continue
        comment_end = _skip_js_comment(body, index)
        if comment_end is not None:
            index = comment_end
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            members.append(body[start:index])
            start = index + 1
        index += 1
    members.append(body[start:])
    return members


def _member_key_value(member: str) -> tuple[str, str] | None:
    """Split an object member into its raw key and value expression."""
    index = _skip_js_trivia(member, 0)
    if index >= len(member):
        return None
    if member[index] in JS_QUOTES:
        key_end = _skip_js_string(member, index)
        raw_key = member[index:key_end]
        index = key_end
    else:
        match = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", member[index:])
        if match is None:
            return None
        raw_key = match.group(0)
        index += len(raw_key)
    index = _skip_js_trivia(member, index)
    if index < len(member) and member[index] == ":":
        return raw_key, member[index + 1:]
    return None


def _option_name(raw_key: str) -> str | None:
    """Normalise a JS object key (possibly quoted) to a lower-case name."""
    if not raw_key:
        return None
    if raw_key[0] in JS_QUOTES:
        key = _js_string_value(raw_key)
    else:
        key = raw_key if re.match(r"[A-Za-z_$][A-Za-z0-9_$]*\Z", raw_key) else None
    return key.lower() if key else None


def _render_options(script: str) -> dict:
    """Extract string options from ``turnstile.render(...)`` object literals."""
    options = {}
    for match in JS_RENDER_RE.finditer(script):
        start = _find_object_argument(script, match.end())
        if start is None:
            continue
        body = _object_body(script, start)
        if body is None:
            continue
        for member in _split_members(body):
            pair = _member_key_value(member)
            if pair is None:
                continue
            name = _option_name(pair[0])
            field = JS_OPTIONS.get(name) if name else None
            if field is None or options.get(field):
                continue
            value = _js_string_value(pair[1])
            # Identifier/variable values cannot be resolved statically; leave
            # the field absent instead of guessing.
            if value:
                options[field] = value
    return options


def _invalid_reason(field: str, value: str) -> str | None:
    """Return why *value* is invalid for *field*, or None when valid."""
    if field == "action":
        if len(value) > 32:
            return f"action is {len(value)} characters; maximum is 32"
        if not ACTION_RE.match(value):
            return "action may only contain letters, digits, '_' and '-'"
    elif field == "cdata" and len(value) > 255:
        return f"cdata is {len(value)} characters; maximum is 255"
    return None


def extract(html: str) -> dict:
    """Extract Turnstile widget parameters from a page's HTML."""
    parser = _PageParser()
    parser.feed(html)
    parser.close()

    script_fields = {}
    for script in parser.scripts:
        for field, value in _render_options(script).items():
            script_fields.setdefault(field, value)

    values = {}
    sources = {}
    invalid = {}
    for field in FIELDS:
        # Explicit turnstile.render options are authoritative; a missing field
        # falls back to the declarative data-* attribute.
        if script_fields.get(field):
            value, source = script_fields[field], "script"
        elif parser.data_attributes.get(field):
            value, source = parser.data_attributes[field], "attribute"
        else:
            values[field] = None
            sources[field] = None
            continue

        reason = _invalid_reason(field, value)
        if reason:
            # Present but unusable: keep the field null and explain why.
            values[field] = None
            sources[field] = None
            invalid[field] = reason
        else:
            values[field] = value
            sources[field] = source

    return {
        "sitekey": values["sitekey"],
        "cdata": values["cdata"],
        "action": values["action"],
        "chlpagedata": values["chlpagedata"],
        "loads_turnstile": bool(LOADER_RE.search(html)),
        "managed_challenge": bool(MANAGED_RE.search(html)),
        "source": sources,
        "invalid": invalid,
    }


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def solve_with_peak(sitekey: str, url: str, proxy: str | None = None) -> dict:
    key = os.environ.get("PEAK_API_KEY")
    if not key:
        sys.exit("Set PEAK_API_KEY to use --solve. Free key at peak.fo.")
    body = {"task_type": "turnstiletask", "sitekey": sitekey, "url": url}
    if proxy:
        body["proxy"] = proxy
    req = urllib.request.Request(
        "https://api.peak.fo/solve",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": key, "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser(description="Capture Turnstile challenge params from a page.")
    ap.add_argument("url")
    ap.add_argument("--solve", action="store_true", help="solve via Peak (needs PEAK_API_KEY)")
    ap.add_argument("--proxy", help="proxy forwarded to the solver")
    a = ap.parse_args()

    info = extract(fetch(a.url))
    print(json.dumps(info, indent=2))
    print("\nObserved Turnstile flow:")
    for step in FLOW:
        print("  " + step)

    if a.solve:
        if not info["sitekey"]:
            sys.exit("No sitekey found on the page.")
        if not os.environ.get("PEAK_API_KEY"):
            sys.exit("Set PEAK_API_KEY to use --solve. Free key at peak.fo.")
        print("\nPeak solve:", json.dumps(solve_with_peak(info["sitekey"], a.url, a.proxy)))


if __name__ == "__main__":
    main()
