# -*- coding: utf-8 -*-
"""Offline tests for the media download pipeline in bot.py.

Everything here is faked: no real HTTP calls, no real Telegram traffic and no
external services.  The six required paths are covered:

1. successful download + upload
2. unsupported platform
3. resolver failure
4. announced file size over the 49 MB limit
5. mid-stream cumulative size over the limit
6. Telegram upload exception

Each test also asserts that the temporary directory is empty afterwards.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import aiohttp

import bot

FIXED_REQUEST_ID = "abc123"
FIXED_TAG = f"#{FIXED_REQUEST_ID}"
MEDIA_URL = "https://cdn.example.test/videos/clip.mp4"
SOURCE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


class FakeContent:
    """Mimics aiohttp's response.content with an async iter_chunked()."""

    def __init__(self, chunks: list[bytes], started: asyncio.Event | None = None,
                 can_continue: asyncio.Event | None = None) -> None:
        self._chunks = chunks
        self._started = started
        self._can_continue = can_continue

    async def iter_chunked(self, size: int):
        for index, chunk in enumerate(self._chunks):
            if index > 0 and self._can_continue is not None:
                await self._can_continue.wait()
            if self._started is not None:
                self._started.set()
            yield chunk


class FakeResponse:
    """Minimal stand-in for aiohttp.ClientResponse."""

    def __init__(
        self,
        *,
        text_data: str | None = None,
        chunks: list[bytes] | None = None,
        content_type: str = "video/mp4",
        content_length: int | None = None,
        status: int = 200,
        error: BaseException | None = None,
        started: asyncio.Event | None = None,
        can_continue: asyncio.Event | None = None,
    ) -> None:
        self.headers = {"Content-Type": content_type}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)
        self._text = text_data or ""
        self._content_length = content_length
        self._status = status
        self._error = error
        self.content = FakeContent(chunks or [], started, can_continue)

    @property
    def content_length(self) -> int | None:
        return self._content_length

    def raise_for_status(self) -> None:
        if self._error is not None:
            raise self._error
        if self._status >= 400:
            raise aiohttp.ClientResponseError(
                request_info=SimpleNamespace(real_url=MEDIA_URL),
                history=(),
                status=self._status,
                message="faked HTTP failure",
            )

    async def text(self) -> str:
        if self._error is not None:
            raise self._error
        return self._text


class FakeRequestContext:
    def __init__(self, response: FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> FakeResponse:
        return self._response

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeSession:
    """Routes get() calls by URL; records every request for assertions."""

    def __init__(self, routes: dict[str, FakeResponse]) -> None:
        self._routes = routes
        self.requests: list[tuple[str, dict]] = []

    def get(self, url: str, **kwargs) -> FakeRequestContext:
        self.requests.append((url, kwargs))
        if url not in self._routes:
            raise AssertionError(f"unexpected request to {url}")
        return FakeRequestContext(self._routes[url])


class FakeStatusMessage:
    def __init__(self, text: str) -> None:
        self.text = text
        self.edits: list[str] = []
        self.deleted = False
        self.delete_raises = False
        self.edit_raises = False

    async def edit_text(self, text: str, **kwargs) -> None:
        if self.edit_raises:
            raise RuntimeError("telegram edit failed")
        self.edits.append(text)
        self.text = text

    async def delete(self) -> None:
        if self.delete_raises:
            raise RuntimeError("telegram delete failed")
        self.deleted = True


class FakeMessage:
    def __init__(self, text: str | None = None, caption: str | None = None,
                 chat_id: int = 777, upload_error: BaseException | None = None) -> None:
        self.text = text
        self.caption = caption
        self.chat_id = chat_id
        self.reply_to_message = None
        self.status_messages: list[FakeStatusMessage] = []
        self.uploads: list[dict] = []
        self._upload_error = upload_error

    async def reply_text(self, text: str, **kwargs) -> FakeStatusMessage:
        # Yield once so coroutines behave like real Telegram network calls.
        await asyncio.sleep(0)
        status = FakeStatusMessage(text)
        self.status_messages.append(status)
        return status

    async def _record_upload(self, kind: str, input_file, caption: str) -> None:
        await asyncio.sleep(0)  # mimic a real network round-trip before failing
        self.uploads.append(
            {"kind": kind, "caption": caption, "filename": getattr(input_file, "filename", None)}
        )
        if self._upload_error is not None:
            raise self._upload_error

    async def reply_video(self, video=None, caption=None, **kwargs) -> None:
        await self._record_upload("video", video, caption)

    async def reply_audio(self, audio=None, caption=None, **kwargs) -> None:
        await self._record_upload("audio", audio, caption)

    async def reply_document(self, document=None, caption=None, **kwargs) -> None:
        await self._record_upload("document", document, caption)


class FakeUser:
    id = 4242


class FakeUpdate:
    def __init__(self, message: FakeMessage) -> None:
        self.effective_message = message
        self.effective_user = FakeUser()
        self.effective_chat = SimpleNamespace(id=message.chat_id)


class FakeBot:
    def __init__(self) -> None:
        self.actions: list[str] = []

    async def send_chat_action(self, chat_id, action) -> None:
        self.actions.append(str(action))


class FakeContext:
    def __init__(self, session: FakeSession) -> None:
        self.bot = FakeBot()
        self.application = SimpleNamespace(bot_data={"http_session": session})
        self.args: list[str] = []
        self.user_data: dict = {}


class DownloadPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._old_tempdir = tempfile.tempdir
        self.temp_dir = Path(tempfile.mkdtemp(prefix="bot_test_tmp_"))
        tempfile.tempdir = str(self.temp_dir)
        bot.INFLIGHT_DOWNLOADS.clear()

    async def asyncTearDown(self) -> None:
        tempfile.tempdir = self._old_tempdir
        shutil.rmtree(self.temp_dir, ignore_errors=True)
        bot.INFLIGHT_DOWNLOADS.clear()
        # Rebalance the semaphore in case a test manipulated it.  Reset the
        # value directly so a leftover waiter cannot keep the next test blocked.
        bot.DOWNLOAD_SEMAPHORE._value = bot.MAX_CONCURRENT_DOWNLOADS
        waiters = getattr(bot.DOWNLOAD_SEMAPHORE, "_waiters", None)
        if waiters:
            waiters.clear()

    def assert_temp_dir_empty(self) -> None:
        leftovers = list(self.temp_dir.iterdir())
        self.assertEqual(leftovers, [], f"temporary files leaked: {leftovers}")

    def build_context(self, routes: dict[str, FakeResponse]) -> tuple[FakeContext, FakeSession]:
        session = FakeSession(routes)
        return FakeContext(session), session

    async def run_handler(self, routes: dict[str, FakeResponse], *,
                          text: str | None = SOURCE_URL,
                          source_url: str | None = None,
                          upload_error: BaseException | None = None):
        context, session = self.build_context(routes)
        message = FakeMessage(text=text, upload_error=upload_error)
        update = FakeUpdate(message)
        with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID):
            await bot.download_handler(update, context, source_url=source_url)
        return message, session, context

    def resolver_routes(self, media_response: FakeResponse) -> dict[str, FakeResponse]:
        payload = {"title": "My Clip", "high_quality": MEDIA_URL}
        return {
            bot.DOWNLOADER_API_URL: FakeResponse(text_data=json.dumps(payload)),
            MEDIA_URL: media_response,
        }

    async def test_successful_download_cleans_up_and_reports_details(self) -> None:
        body = b"hello media body"
        routes = self.resolver_routes(FakeResponse(chunks=[body[:6], body[6:]]))
        message, session, context = await self.run_handler(routes)

        self.assertEqual(len(message.status_messages), 1)
        status = message.status_messages[0]
        self.assertTrue(status.deleted, "status message must be deleted on success")
        self.assertNotIn("准备", status.text)
        # The id is present on the initial status and on every later edit.
        self.assertTrue(all(FIXED_TAG in edit for edit in status.edits))
        self.assertIn(FIXED_TAG, message.status_messages[0].text)

        self.assertEqual(len(message.uploads), 1)
        upload = message.uploads[0]
        self.assertEqual(upload["kind"], "video")
        self.assertEqual(upload["filename"], "My Clip.mp4")
        caption = upload["caption"]
        self.assertIn(FIXED_TAG, caption)
        self.assertIn("YOUTUBE", caption)
        self.assertIn("My Clip.mp4", caption)
        self.assertIn(str(len(body)), caption)

        self.assertEqual(len(session.requests), 2)
        self.assertEqual(session.requests[0][0], bot.DOWNLOADER_API_URL)
        self.assertEqual(session.requests[1][0], MEDIA_URL)
        self.assertIn("upload_video", context.bot.actions[0])
        self.assert_temp_dir_empty()

    async def test_unsupported_platform_is_rejected_without_network(self) -> None:
        context, session = self.build_context({})
        message = FakeMessage(text="https://unknown-site.example/watch/1")
        update = FakeUpdate(message)
        with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID):
            await bot.download_handler(update, context)

        status = message.status_messages[0]
        self.assertFalse(status.deleted)
        self.assertEqual(status.text, status.edits[-1])
        self.assertIn(FIXED_TAG, status.text)
        self.assertIn("不支持", status.text)
        self.assertNotIn("准备", status.text)
        self.assertEqual(session.requests, [])
        self.assertEqual(message.uploads, [])
        self.assert_temp_dir_empty()

    async def test_resolver_failure_is_reported_without_internal_text(self) -> None:
        routes = {
            bot.DOWNLOADER_API_URL: FakeResponse(
                error=aiohttp.ClientConnectionError("secret resolver outage")
            ),
        }
        message, session, _ = await self.run_handler(routes)

        status = message.status_messages[0]
        self.assertFalse(status.deleted)
        self.assertIn(FIXED_TAG, status.text)
        self.assertIn("解析失败", status.text)
        self.assertNotIn("secret resolver outage", status.text)
        self.assertNotIn("准备", status.text)
        self.assertEqual(message.uploads, [])
        self.assert_temp_dir_empty()

    async def test_resolver_payload_without_media_url_is_resolve_failure(self) -> None:
        routes = {bot.DOWNLOADER_API_URL: FakeResponse(text_data=json.dumps({"data": {}}))}
        message, _, _ = await self.run_handler(routes)
        self.assertIn("解析失败", message.status_messages[0].text)
        self.assert_temp_dir_empty()

    async def test_announced_size_limit_aborts_before_creating_file(self) -> None:
        huge = bot.MAX_DOWNLOAD_BYTES + 1
        routes = self.resolver_routes(
            FakeResponse(chunks=[], content_length=huge)
        )
        message, session, _ = await self.run_handler(routes)

        status = message.status_messages[0]
        self.assertIn(FIXED_TAG, status.text)
        self.assertIn("49MB", status.text)
        self.assertIn("上限", status.text)
        self.assertFalse(status.deleted)
        self.assertEqual(message.uploads, [])
        self.assertEqual(len(session.requests), 2)
        self.assert_temp_dir_empty()

    async def test_midstream_size_limit_removes_partial_file(self) -> None:
        created_before: list[str] = []
        real_named_temp = bot.tempfile.NamedTemporaryFile

        def tracking_named_temp(*args, **kwargs):
            handle = real_named_temp(*args, **kwargs)
            created_before.append(handle.name)
            return handle

        routes = self.resolver_routes(FakeResponse(chunks=[b"x" * 600, b"y" * 600]))
        context, session = self.build_context(routes)
        message = FakeMessage()
        update = FakeUpdate(message)
        with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID), \
             mock.patch.object(bot, "MAX_DOWNLOAD_BYTES", 1024):
            # NamedTemporaryFile is an imported attribute of the tempfile module;
            # swap it directly (mock.patch.object with create=True replaces the
            # attribute before our side effect is installed).
            bot.tempfile.NamedTemporaryFile = tracking_named_temp
            try:
                await bot.download_handler(update, context, source_url=SOURCE_URL)
                self.assertEqual(
                    len(created_before), 1,
                    "a partial temporary file should have been created",
                )
            finally:
                bot.tempfile.NamedTemporaryFile = real_named_temp
        self.assertFalse(Path(created_before[0]).exists(), "partial file must be removed")
        status = message.status_messages[0]
        self.assertIn(FIXED_TAG, status.text)
        self.assertIn("49MB", status.text)
        self.assertEqual(message.uploads, [])
        self.assert_temp_dir_empty()

    async def test_upload_failure_is_categorized_and_file_is_cleaned(self) -> None:
        routes = self.resolver_routes(FakeResponse(chunks=[b"small video"]))
        internal_error = RuntimeError("telegram internal upload boom")
        message, session, _ = await self.run_handler(routes, upload_error=internal_error)

        status = message.status_messages[0]
        self.assertIn(FIXED_TAG, status.text)
        self.assertIn("上传失败", status.text)
        self.assertNotIn("internal upload boom", status.text)
        self.assertFalse(status.deleted)
        self.assertEqual(len(message.uploads), 1)
        self.assertEqual(len(session.requests), 2)
        self.assert_temp_dir_empty()

    async def test_queued_request_reports_waiting_then_completes(self) -> None:
        held = []
        for _ in range(bot.MAX_CONCURRENT_DOWNLOADS):
            await bot.DOWNLOAD_SEMAPHORE.acquire()
            held.append(1)
        try:
            routes = self.resolver_routes(FakeResponse(chunks=[b"queued body"]))
            context, session = self.build_context(routes)
            message = FakeMessage()
            update = FakeUpdate(message)
            with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID):
                task = asyncio.create_task(
                    bot.download_handler(update, context, source_url=SOURCE_URL)
                )
                waiting_seen = False
                for _ in range(100):
                    await asyncio.sleep(0)
                    if not message.status_messages:
                        continue
                    waiting_seen = any(
                        "等待" in status.text
                        or any("等待" in edit for edit in status.edits)
                        for status in message.status_messages
                    )
                    if waiting_seen:
                        break
                self.assertTrue(waiting_seen, "queued request must show a waiting status")
            bot.DOWNLOAD_SEMAPHORE.release()
            held.pop()
            await task
            status = message.status_messages[0]
            self.assertTrue(status.deleted)
            self.assertEqual(len(message.uploads), 1)
            self.assert_temp_dir_empty()
        finally:
            while held:
                bot.DOWNLOAD_SEMAPHORE.release()
                held.pop()

    async def test_duplicate_link_from_same_user_runs_only_once(self) -> None:
        started = asyncio.Event()
        can_continue = asyncio.Event()
        blocking_media = FakeResponse(
            chunks=[b"first part", b"second part"],
            started=started,
            can_continue=can_continue,
        )
        routes = self.resolver_routes(blocking_media)
        context, session = self.build_context(routes)
        first_message = FakeMessage()
        first_update = FakeUpdate(first_message)
        second_message = FakeMessage()
        second_update = FakeUpdate(second_message)

        with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID):
            first_task = asyncio.create_task(
                bot.download_handler(first_update, context, source_url=SOURCE_URL)
            )
            await started.wait()
            await bot.download_handler(second_update, context, source_url=SOURCE_URL)
            can_continue.set()
            await first_task

        self.assertEqual(len(session.requests), 2, "duplicate request must not hit the API again")
        second_status = second_message.status_messages[0]
        self.assertIn("相同链接正在处理中", second_status.text)
        self.assertTrue(first_message.status_messages[0].deleted)
        self.assertEqual(len(first_message.uploads), 1)
        self.assertEqual(second_message.uploads, [])
        self.assertEqual(bot.INFLIGHT_DOWNLOADS, set())
        self.assert_temp_dir_empty()

    async def test_reply_to_link_entry_is_supported(self) -> None:
        parent = FakeMessage(text="look at this https://youtu.be/abc123456789 later")
        incoming = FakeMessage(text="/alldl")
        incoming.reply_to_message = parent
        body = b"reply payload"
        routes = {
            bot.DOWNLOADER_API_URL: FakeResponse(
                text_data=json.dumps({"high_quality": MEDIA_URL})
            ),
            MEDIA_URL: FakeResponse(chunks=[body]),
        }
        session = FakeSession(routes)
        context = FakeContext(session)
        update = FakeUpdate(incoming)
        with mock.patch.object(bot, "new_request_id", return_value=FIXED_REQUEST_ID):
            await bot.download_handler(update, context)
        self.assertEqual(len(incoming.uploads), 1)
        self.assertTrue(incoming.status_messages[0].deleted)
        self.assert_temp_dir_empty()

    async def test_finish_status_falls_back_when_primary_action_fails(self) -> None:
        status = FakeStatusMessage(f"⏳ {FIXED_TAG} 正在检查链接并准备媒体…")
        status.edit_raises = True
        await bot.finish_status(status, bot.failure_text(FIXED_TAG, "resolve"))
        self.assertTrue(status.deleted, "failed edit must fall back to deleting the message")
        self.assertEqual(status.edits, [])

        status = FakeStatusMessage(f"⏳ {FIXED_TAG} 正在检查链接并准备媒体…")
        status.delete_raises = True
        await bot.finish_status(status, fallback_text=f"✅ {FIXED_TAG} 媒体已成功发送。")
        self.assertIn(FIXED_TAG, status.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
