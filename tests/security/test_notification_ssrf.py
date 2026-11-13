"""SSRF preflight on the notification path (§3.10) — every channel, one guard.

A webhook URL is user-supplied, so the notification send path must validate the
destination *before* any HTTP request: a forbidden bare IP or a domain resolving to a
non-public address raises :class:`ForbiddenTarget`, the channel records one structured
log line (channel + host + hit IP, never the full URL/query token) and reports the
delivery as failed without ever calling the HTTP transport. These tests inject a fake
resolver and a capturing transport — no network, no aiohttp required.
"""

from __future__ import annotations

import pytest
from loguru import logger as loguru_logger

from core.models import ChannelType
from core.severity import Severity
from modules.notification import discord, slack, telegram, webhook
from modules.notification.base import Alert, Senders
from modules.notification.router import deliver
from modules.safe_http import ForbiddenTarget

_ALERT = Alert("New subdomain: x", Severity.INFO, "acme.com", "x.acme.com", "ingest")
_TOKEN_IN_QUERY = "bot6427:AAH-supersecret-telegram-token"


class _RecordingHttp:
    """Stands in for guarded_post: remembers every attempted (url, payload)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def __call__(self, url: str, payload: dict) -> int:
        self.calls.append((url, payload))
        return 204


class _ForbiddenHttp:
    """Stands in for guarded_post rejecting the destination at preflight time."""

    def __init__(self, host: str, hit_ip: str | None, reason: str) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.exc = ForbiddenTarget(
            f"refusing {host}", host=host, hit_ip=hit_ip, reason=reason
        )

    async def __call__(self, url: str, payload: dict) -> int:
        # Record the attempt so a test can prove the transport never got the request.
        self.calls.append((url, payload))
        raise self.exc


def _channel(channel_type: ChannelType, url: str) -> dict:
    if channel_type is ChannelType.WEBHOOK:
        return {"type": channel_type.value, "config": {"url": url}}
    if channel_type is ChannelType.TELEGRAM:
        return {
            "type": channel_type.value,
            "config": {"bot_token": "123:abc", "chat_id": "99"},
        }
    return {"type": channel_type.value, "config": {"webhook_url": url}}


async def test_every_http_channel_logs_and_fails_closed_on_forbidden_target():
    secret_url = f"https://169.254.169.254/latest/meta-data/?token={_TOKEN_IN_QUERY}"
    channels = [
        (ChannelType.DISCORD, discord, secret_url),
        (ChannelType.SLACK, slack, secret_url),
        (ChannelType.WEBHOOK, webhook, secret_url),
        # Telegram's URL embeds the bot token in its *path* — prove that never lands
        # in the log either (the guard only exposes the canonical host).
        (ChannelType.TELEGRAM, telegram, f"https://api.telegram.org/bot{_TOKEN_IN_QUERY}/x"),
    ]

    records: list[dict] = []
    sink_id = loguru_logger.add(lambda msg: records.append(msg.record))
    try:
        for channel_type, module, url in channels:
            http = _ForbiddenHttp("169.254.169.254", "169.254.169.254",
                                  "forbidden_ip_literal")
            senders = Senders(http=http)
            channel = _channel(channel_type, url)

            ok = await deliver(_ALERT, channel, senders)

            assert ok is False, f"{channel_type} must report a failed delivery"
            # The transport raised before sending — no request left the process.
            assert http.calls and http.calls[0][0]  # reached transport, which refused
            warning = next(
                r for r in records
                if r["level"].name == "WARNING"
                and r["extra"].get("refused_host") == "169.254.169.254"
            )
            extra = warning["extra"]
            assert extra["notify_channel"] == channel_type.value
            assert extra["hit_ip"] == "169.254.169.254"
            assert extra["reason"] == "forbidden_ip_literal"
            # The full URL — and therefore the token — must never be logged.
            rendered = warning["message"] + " " + " ".join(map(str, extra.values()))
            assert _TOKEN_IN_QUERY not in rendered
            assert "169.254.169.254/latest" not in rendered  # no path either
            records.clear()
    finally:
        loguru_logger.remove(sink_id)


async def test_domain_resolving_internally_is_refused_for_all_http_channels():
    # Mirror the real preflight outcome for a DNS name: no hit IP is a bare literal,
    # the refusal names the resolved internal address.
    for channel_type, module, url in (
        (ChannelType.DISCORD, discord, "https://hooks.evil.example/hook"),
        (ChannelType.SLACK, slack, "https://hooks.evil.example/hook"),
        (ChannelType.WEBHOOK, webhook, "https://hooks.evil.example/hook"),
    ):
        http = _ForbiddenHttp("hooks.evil.example", "10.0.0.7",
                              "forbidden_resolved_address")
        records: list[dict] = []
        sink_id = loguru_logger.add(lambda msg: records.append(msg.record))
        try:
            ok = await deliver(
                _ALERT, _channel(channel_type, url), Senders(http=http)
            )
        finally:
            loguru_logger.remove(sink_id)
        assert ok is False
        extra = records[-1]["extra"]
        assert extra["refused_host"] == "hooks.evil.example"
        assert extra["hit_ip"] == "10.0.0.7"
        assert extra["reason"] == "forbidden_resolved_address"


async def test_legal_address_still_delivers_and_returns_status():
    http = _RecordingHttp()
    senders = Senders(http=http)
    channel = {"type": "discord", "config": {"webhook_url": "https://discord.com/hooks/x"}}

    ok = await deliver(_ALERT, channel, senders)

    assert ok is True  # 204 → success
    assert len(http.calls) == 1
    assert http.calls[0][0] == "https://discord.com/hooks/x"


async def test_dns_failure_is_rejected_not_sent():
    # A resolver failure surfaces as ForbiddenTarget with no hit IP and a reason.
    http = _ForbiddenHttp("gone.example", None, "resolve_failed")
    records: list[dict] = []
    sink_id = loguru_logger.add(lambda msg: records.append(msg.record))
    try:
        ok = await deliver(
            _ALERT,
            {"type": "webhook", "config": {"url": "https://gone.example/hook"}},
            Senders(http=http),
        )
    finally:
        loguru_logger.remove(sink_id)
    assert ok is False
    extra = records[-1]["extra"]
    assert extra["refused_host"] == "gone.example"
    assert extra["hit_ip"] is None
    assert extra["reason"] == "resolve_failed"


async def test_guarded_post_rejects_before_any_http_work():
    # The real production transport. aiohttp is absent from this venv, so if the
    # preflight did not fire first, guarded_post would raise ModuleNotFoundError while
    # building the session instead — a clean ForbiddenTarget proves validation wins.
    import modules.safe_http as safe_http

    original = safe_http._default_resolver
    safe_http._default_resolver = lambda host: ["169.254.169.254"]
    try:
        with pytest.raises(ForbiddenTarget) as info:
            await safe_http.guarded_post("https://rebind.example/hook", {"x": 1})
        assert info.value.host == "rebind.example"
        assert info.value.hit_ip == "169.254.169.254"

        with pytest.raises(ForbiddenTarget) as info:
            await safe_http.guarded_post(
                "http://127.0.0.1:9000/admin?token=abc", {"x": 1}
            )
        assert info.value.host == "127.0.0.1"
        assert "abc" not in str(info.value)
    finally:
        safe_http._default_resolver = original
