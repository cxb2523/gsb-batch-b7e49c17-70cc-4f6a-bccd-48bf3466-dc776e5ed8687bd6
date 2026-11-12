from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import secrets
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
from telegram import InputFile, Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "PASTE_YOUR_TELEGRAM_BOT_TOKEN")


logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("media-downloader-bot")

STYLE_MAP = str.maketrans({
    "a": "ᴀ", "b": "ʙ", "c": "ᴄ", "d": "ᴅ", "e": "ᴇ", "f": "ꜰ",
    "g": "ɢ", "h": "ʜ", "i": "ɪ", "j": "ᴊ", "k": "ᴋ", "l": "ʟ",
    "m": "ᴍ", "n": "ɴ", "o": "ᴏ", "p": "ᴘ", "q": "ǫ", "r": "ʀ",
    "s": "ꜱ", "t": "ᴛ", "u": "ᴜ", "v": "ᴠ", "w": "ᴡ", "x": "x",
    "y": "ʏ", "z": "ᴢ",
    "A": "ᴀ", "B": "ʙ", "C": "ᴄ", "D": "ᴅ", "E": "ᴇ", "F": "ꜰ",
    "G": "ɢ", "H": "ʜ", "I": "ɪ", "J": "ᴊ", "K": "ᴋ", "L": "ʟ",
    "M": "ᴍ", "N": "ɴ", "O": "ᴏ", "P": "ᴘ", "Q": "ǫ", "R": "ʀ",
    "S": "ꜱ", "T": "ᴛ", "U": "ᴜ", "V": "ᴠ", "W": "ᴡ", "X": "x",
    "Y": "ʏ", "Z": "ᴢ",
})


def styled(value: object) -> str:
    return str(value).translate(STYLE_MAP)


def welcome_text(name: str, members: object) -> str:
    return (
        "╭── [ 🎁 ᴡ є ʟ ᴄ σ ϻ є  ʙ ᴧ ʙ ʏ 🎁 ]\n"
        "│\n"
        f"├── 🍼 ⇛ η ᴧ ϻ є : {styled(name)}\n"
        f"├── 🩷 ⇛ ϻ є �� ʙ є ʀ s : {styled(members)}\n"
        "│\n"
        "├── 🎁 ⇛ єηᴊσʏ ᴛʜє ϻυsɪᴄ ᴧηᴅ ᴠɪᴅ !\n"
        "│\n"
        "╰── ᴘ σ ᴡ є ʀ є ᴅ  ʙ ʏ  ꜱ ɪ ꜰ ᴀ ᴛ"
    )


def help_text() -> str:
    return (
        "╭── [ 🎀 ᴅ ᴏ ᴡ ɴ ʟ ᴏ ᴀ ᴅ ᴇ ʀ  ɢ ᴜ ɪ ᴅ ᴇ 🎀 ]\n"
        "│\n"
        "├── 📥 ⇛ /alldl <ʟɪɴᴋ>\n"
        "├── 🔎 ⇛ /search <ǫᴜᴇʀʏ>\n"
        "├── 🔢 ⇛ ʀᴇᴘʟʏ ᴏʀ ꜱᴇɴᴅ ᴀ ʀᴇꜱᴜʟᴛ ɴᴜᴍʙᴇʀ (1–5)\n"
        "├── 🔗 ⇛ ꜱᴇɴᴅ ᴀ ꜱᴜᴘᴘᴏʀᴛᴇᴅ ʟɪɴᴋ ᴅɪʀᴇᴄᴛʟʏ\n"
        "│\n"
        "├── 🌐 ⇛ ꜰᴀᴄᴇʙᴏᴏᴋ • ʏᴏᴜᴛᴜʙᴇ • ᴛɪᴋᴛᴏᴋ\n"
        "├── 🌐 ⇛ ɪɴꜱᴛᴀɢʀᴀᴍ • ʟɪᴋᴇᴇ • ᴄᴀᴘᴄᴜᴛ\n"
        "├── 🌐 ⇛ ꜱᴘᴏᴛɪꜰʏ • ᴛᴇʀᴀʙᴏx • x • ᴘɪɴᴛᴇʀᴇꜱᴛ\n"
        "│\n"
        "╰── ᴘ σ ᴡ є ʀ є ᴅ  ʙ ʏ  ꜱɪꜰᴀᴛ"
    )


API_BASE_URL = "https://mediadlapi.vercel.app/api"
DOWNLOADER_API_URL = f"{API_BASE_URL}/alldownloader"
SEARCH_API_URL = f"{API_BASE_URL}/search"
MAX_SEARCH_RESULTS = 5

SUPPORTED_DOMAINS = {
    "facebook.com", "fb.watch", "youtube.com", "youtu.be", "tiktok.com",
    "instagram.com", "instagr.am", "likee.com", "likee.video", "capcut.com",
    "spotify.com", "terabox.com", "twitter.com", "x.com", "drive.google.com",
    "soundcloud.com", "ndown.app", "pinterest.com", "pin.it",
}

MAX_DOWNLOAD_BYTES = 49 * 1024 * 1024
MAX_CONCURRENT_DOWNLOADS = 3
URL_PATTERN = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)
TRAILING_URL_CHARS = ".,!?;:'\""
DOWNLOAD_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)

# (user id, source url) pairs that are currently being processed.  Keeping this
# global prevents one user from starting the same download twice at once.
INFLIGHT_DOWNLOADS: set[tuple[Any, str]] = set()

FAILURE_MESSAGES = {
    "unsupported": "平台不支持：未收录该域名。",
    "resolve": "解析失败：无法从该链接获取可下载的媒体地址。",
    "size": "文件超过 49MB 上限，无法上传到 Telegram。",
    "download": "下载中断：媒体文件未能完整下载。",
    "upload": "上传失败：媒体文件无法发送到 Telegram。",
    "internal": "下载处理失败，请稍后重试。",
}

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".ogg", ".wav"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}


class DownloaderError(Exception):
    """A user-safe failure.  The original exception is only logged.

    ``category`` is one of the keys in ``FAILURE_MESSAGES`` and lets the
    download handler pick a short, stable message for the user.
    """

    def __init__(self, message: str, category: str = "internal") -> None:
        super().__init__(message)
        self.category = category


def new_request_id() -> str:
    """Return a short, non-guessable identifier for one download request."""
    return secrets.token_hex(3)


def request_tag(request_id: str) -> str:
    return f"#{request_id}"


def failure_text(tag: str, category: str) -> str:
    return f"❌ {tag} {FAILURE_MESSAGES.get(category, FAILURE_MESSAGES['internal'])}"


def success_caption(tag: str, platform: str, filename: str, size: int) -> str:
    return (
        "╭── [ 🎁 ᴅ ᴏ ᴡ ɴ ʟ ᴏ ᴀ ᴅ  ᴄ ᴏ ᴍ ᴘ ʟ ᴇ ᴛ ᴇ 🎁 ]\n"
        "│\n"
        f"├── 🆔 ⇛ ʀ ᴇ ǫ ᴜ ᴇ ꜱ ᴛ : {tag}\n"
        f"├── 🌐 ⇛ ᴘ ʟ ᴀ ᴛ ꜰ ᴏ ʀ ᴍ : {platform}\n"
        f"├── 📄 ⇛ ꜰ ɪ ʟ ᴇ ɴ ᴀ ᴍ ᴇ : {filename}\n"
        f"├── 📦 ⇛ ꜱ ɪ ᴢ ᴇ : {size} ʙʏᴛᴇꜱ\n"
        "│\n"
        "├── ✨ ⇛ ᴇ ɴ ᴊ ᴏ ʏ ʏ ᴏ ᴜ ʀ ᴍ ᴇ ᴅ ɪ ᴀ !\n"
        "│\n"
        "╰── ᴘ σ ᴡ ᴇ ʀ ᴇ ᴅ  ʙ ʏ  ꜱ ɪ ꜰ ᴀ ᴛ"
    )


def extract_url(text: str | None) -> str | None:
    if not text:
        return None
    match = URL_PATTERN.search(text)
    return match.group(0).rstrip(TRAILING_URL_CHARS) if match else None


def is_supported_url(url: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return False
    return any(hostname == domain or hostname.endswith(f".{domain}")
               for domain in SUPPORTED_DOMAINS)


def platform_name(url: str) -> str:
    hostname = (urlparse(url).hostname or "media").lower().removeprefix("www.")
    return hostname.split(".")[0].upper()


def safe_filename(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^\w .-]+", "_", value, flags=re.UNICODE).strip(" .")
    return (cleaned[:80] or fallback).strip()


def choose_extension(media_url: str, content_type: str | None = None) -> str:
    path_suffix = Path(urlparse(media_url).path).suffix.lower()
    allowed = {
        ".mp3", ".m4a", ".aac", ".ogg", ".wav", ".mp4", ".mkv", ".webm",
        ".mov", ".avi", ".jpg", ".jpeg", ".png", ".gif", ".webp",
    }
    if path_suffix in allowed:
        return path_suffix
    guessed = mimetypes.guess_extension((content_type or "").split(";")[0])
    return guessed if guessed in allowed else ".mp4"


def first_media_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in (
            "high_quality", "highQuality", "low_quality", "lowQuality",
            "download_url", "downloadUrl", "video_url", "videoUrl", "url", "link",
        ):
            value = payload.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        for key in ("data", "result", "media", "videos", "results"):
            nested = first_media_url(payload.get(key))
            if nested:
                return nested
    elif isinstance(payload, list):
        for item in payload:
            nested = first_media_url(item)
            if nested:
                return nested
    return None


def payload_title(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("title", "filename", "file_name", "name"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


async def response_json(response: aiohttp.ClientResponse) -> Any:
    try:
        return json.loads(await response.text())
    except json.JSONDecodeError as exc:
        raise DownloaderError(FAILURE_MESSAGES["resolve"], "resolve") from exc


async def resolve_media(session: aiohttp.ClientSession, source_url: str) -> tuple[str, Any]:
    try:
        async with session.get(DOWNLOADER_API_URL, params={"q": source_url}) as response:
            response.raise_for_status()
            payload = await response_json(response)
    except DownloaderError:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        raise DownloaderError(FAILURE_MESSAGES["resolve"], "resolve") from exc
    media_url = first_media_url(payload)
    if not media_url:
        raise DownloaderError(FAILURE_MESSAGES["resolve"], "resolve")
    return media_url, payload


def search_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("results", "items", "videos", "data", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            items = [item for item in value if isinstance(item, dict)]
            if items:
                return items
        nested = search_items(value)
        if nested:
            return nested
    return []


def search_result_link(item: dict[str, Any]) -> str | None:
    for key in (
        "url", "video_url", "videoUrl", "web_url", "webpage_url", "link",
        "permalink", "source_url", "original_url",
    ):
        value = item.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return None


async def search_videos(session: aiohttp.ClientSession, query: str) -> list[dict[str, Any]]:
    try:
        async with session.get(SEARCH_API_URL, params={"q": query}) as response:
            response.raise_for_status()
            payload = await response_json(response)
    except DownloaderError:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        raise DownloaderError(styled("The search API is currently unavailable.")) from exc
    return search_items(payload)


def announced_content_length(response: aiohttp.ClientResponse) -> int | None:
    """Best-effort Content-Length lookup that also tolerates simple fakes."""
    value = getattr(response, "content_length", None)
    if value is None:
        value = response.headers.get("Content-Length")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


async def download_to_file(
    session: aiohttp.ClientSession,
    media_url: str,
) -> tuple[str, str]:
    try:
        async with session.get(media_url) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            announced_size = announced_content_length(response)
            if announced_size is not None and announced_size > MAX_DOWNLOAD_BYTES:
                # No temporary file has been created yet.
                raise DownloaderError(FAILURE_MESSAGES["size"], "size")

            extension = choose_extension(media_url, content_type)
            temporary_file = tempfile.NamedTemporaryFile(
                prefix="telegram_media_", suffix=extension, delete=False
            )
            temporary_path = temporary_file.name
            downloaded = 0
            try:
                with temporary_file:
                    async for chunk in response.content.iter_chunked(64 * 1024):
                        downloaded += len(chunk)
                        if downloaded > MAX_DOWNLOAD_BYTES:
                            raise DownloaderError(FAILURE_MESSAGES["size"], "size")
                        temporary_file.write(chunk)
            except BaseException:
                try:
                    Path(temporary_path).unlink(missing_ok=True)
                except OSError:
                    logger.debug("Could not remove temporary file %s", temporary_path, exc_info=True)
                raise
            return temporary_path, extension
    except DownloaderError:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        raise DownloaderError(FAILURE_MESSAGES["download"], "download") from exc


def message_url(update: Update) -> str | None:
    message = update.effective_message
    if not message:
        return None
    url = extract_url(message.text or message.caption)
    if url:
        return url
    replied = message.reply_to_message
    return extract_url(replied.text or replied.caption) if replied else None


async def show_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(help_text())


async def search_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message:
        return
    query = " ".join(context.args).strip()
    if not query:
        await message.reply_text(styled("🔎 Usage: /search <video name or keywords>"))
        return
    if len(query) > 200:
        await message.reply_text(styled("❌ Search query is too long (maximum 200 characters)."))
        return

    status_message = await message.reply_text(styled("🔎 Searching videos..."))
    session: aiohttp.ClientSession = context.application.bot_data["http_session"]
    try:
        api_results = await search_videos(session, query)
        results: list[dict[str, str]] = []
        for item in api_results:
            link = search_result_link(item)
            if not link:
                continue
            title = next(
                (str(item[key]).strip() for key in ("title", "name")
                 if isinstance(item.get(key), str) and item[key].strip()),
                "Untitled video",
            )
            results.append({"title": title, "url": link})
            if len(results) >= MAX_SEARCH_RESULTS:
                break

        if not results:
            context.user_data.pop("last_search", None)
            await status_message.edit_text(styled("No video results were found. Try another search."))
            return

        context.user_data["last_search"] = {
            "chat_id": message.chat_id,
            "results": results,
        }
        listing = "\n".join(
            f"{index}. {result['title'][:100]}"
            for index, result in enumerate(results, start=1)
        )
        await status_message.edit_text(
            f"🔎 Results for: {query}\n\n{listing}\n\n"
            "Send a result number (1–{count}) to download that video. "
            "You can reply to this message with the number or send it normally."
            .format(count=len(results))
        )
    except DownloaderError as exc:
        await status_message.edit_text(f"❌ {exc}")
    except Exception:
        logger.exception("Unexpected search error")
        await status_message.edit_text(styled("❌ Search failed. Please try again later."))


async def select_search_result(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message or not message.text:
        return

    selection = context.user_data.get("last_search")
    if not selection or selection.get("chat_id") != message.chat_id:
        await message.reply_text(styled("No recent search found. Use /search <query> first."))
        return

    results = selection.get("results", [])
    index = int(message.text.strip()) - 1
    if index < 0 or index >= len(results):
        await message.reply_text(styled(f"Choose a number from 1 to {len(results)}."))
        return

    selected = results[index]
    url = selected.get("url", "")
    # The download handler owns the whitelist check so the rejection carries a
    # request id and a stable, categorized message.
    await download_handler(update, context, source_url=url)


async def show_welcome(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message:
        return
    user = update.effective_user
    name = user.first_name if user and user.first_name else "Guest"
    try:
        members = await context.bot.get_chat_member_count(message.chat_id)
    except Exception:
        members = "—"
    await message.reply_text(welcome_text(name, members))


async def update_status(status_message: Any, text: str) -> bool:
    """Edit a status message, never letting Telegram failures escape."""
    try:
        await status_message.edit_text(text)
        return True
    except Exception:
        logger.debug("Failed to update a status message", exc_info=True)
        return False


async def finish_status(
    status_message: Any,
    text: str | None = None,
    *,
    fallback_text: str | None = None,
) -> None:
    """Ensure a status message does not stay on the initial "preparing" text.

    With ``text=None`` the message is deleted; if deletion fails it is edited
    to ``fallback_text`` instead.  With a ``text`` the message is edited; if
    editing fails it is deleted.  Every branch makes a best effort to leave no
    stale "preparing" message behind.
    """
    if text is None:
        try:
            await status_message.delete()
            return
        except Exception:
            logger.debug("Failed to delete a status message", exc_info=True)
        if fallback_text:
            await update_status(status_message, fallback_text)
        return

    if await update_status(status_message, text):
        return
    try:
        await status_message.delete()
    except Exception:
        logger.debug("Failed to remove a stale status message", exc_info=True)


async def send_uploading_action(context: ContextTypes.DEFAULT_TYPE, chat_id: int) -> None:
    bot = getattr(context, "bot", None)
    if bot is None:
        return
    try:
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_VIDEO)
    except Exception:
        logger.debug("Failed to send the upload chat action", exc_info=True)


async def upload_media(
    message: Any,
    temporary_path: str,
    extension: str,
    filename: str,
    caption: str,
) -> None:
    """Deliver the downloaded file, turning every Telegram error into an
    "upload failure" so internal exception text never reaches the user."""
    try:
        if extension in AUDIO_EXTENSIONS:
            with open(temporary_path, "rb") as media_file:
                await message.reply_audio(
                    audio=InputFile(media_file, filename=filename), caption=caption
                )
        elif extension in VIDEO_EXTENSIONS:
            with open(temporary_path, "rb") as media_file:
                await message.reply_video(
                    video=InputFile(media_file, filename=filename),
                    caption=caption,
                    supports_streaming=True,
                )
        else:
            with open(temporary_path, "rb") as media_file:
                await message.reply_document(
                    document=InputFile(media_file, filename=filename), caption=caption
                )
    except DownloaderError:
        raise
    except Exception as exc:
        raise DownloaderError(FAILURE_MESSAGES["upload"], "upload") from exc


def request_owner_key(update: Update, message: Any, url: str) -> tuple[Any, str]:
    user = getattr(update, "effective_user", None)
    owner_id = getattr(user, "id", None)
    if owner_id is None:
        chat = getattr(update, "effective_chat", None)
        owner_id = getattr(chat, "id", None) or message.chat_id
    return owner_id, url


async def perform_download(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    session: aiohttp.ClientSession,
    message: Any,
    status_message: Any,
    url: str,
    tag: str,
) -> None:
    temporary_path: str | None = None
    waiting = DOWNLOAD_SEMAPHORE.locked()
    try:
        if waiting:
            await update_status(
                status_message,
                f"⏳ {tag} 当前已有 {MAX_CONCURRENT_DOWNLOADS} 个下载在进行，正在等待空闲位置…",
            )
        async with DOWNLOAD_SEMAPHORE:
            if waiting:
                await update_status(
                    status_message,
                    f"📥 {tag} 已获得下载位置，开始处理链接…",
                )
            await send_uploading_action(context, message.chat_id)
            media_url, payload = await resolve_media(session, url)
            await update_status(status_message, f"📥 {tag} 正在下载媒体…")
            temporary_path, extension = await download_to_file(session, media_url)
            size = os.path.getsize(temporary_path)
            title = safe_filename(
                payload_title(payload) or f"{platform_name(url)}_media", "downloaded_media"
            )
            filename = f"{title}{extension}"
            caption = success_caption(tag, platform_name(url), filename, size)
            await update_status(status_message, f"📤 {tag} 正在上传到 Telegram…")
            await upload_media(message, temporary_path, extension, filename, caption)
            await finish_status(
                status_message,
                fallback_text=f"✅ {tag} 媒体已成功发送。",
            )
    except DownloaderError as exc:
        logger.warning("Download %s failed (%s)", tag, exc.category)
        await finish_status(status_message, failure_text(tag, exc.category))
    except asyncio.CancelledError:
        logger.warning("Download %s was cancelled", tag)
        await finish_status(status_message, failure_text(tag, "download"))
        raise
    except Exception:
        logger.exception("Unexpected download error for %s", tag)
        await finish_status(status_message, failure_text(tag, "internal"))
    finally:
        if temporary_path:
            try:
                Path(temporary_path).unlink(missing_ok=True)
            except OSError:
                logger.debug(
                    "Could not remove temporary file %s", temporary_path, exc_info=True
                )


async def download_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    source_url: str | None = None,
) -> None:
    message = update.effective_message
    if not message:
        return

    url = source_url or message_url(update)
    if not url and context.args:
        url = extract_url(" ".join(context.args))
    if not url:
        if message.text and message.text.startswith("/"):
            await message.reply_text(styled("📥 Please send a complete https:// media link."))
        return

    request_id = new_request_id()
    tag = request_tag(request_id)
    status_message = await message.reply_text(f"⏳ {tag} 正在检查链接并准备媒体…")

    try:
        if not is_supported_url(url):
            await finish_status(status_message, failure_text(tag, "unsupported"))
            return

        inflight_key = request_owner_key(update, message, url)
        if inflight_key in INFLIGHT_DOWNLOADS:
            await finish_status(
                status_message,
                f"⚠️ {tag} 相同链接正在处理中，请等待当前下载完成。",
            )
            return

        INFLIGHT_DOWNLOADS.add(inflight_key)
        try:
            session: aiohttp.ClientSession = context.application.bot_data["http_session"]
            await perform_download(update, context, session, message, status_message, url, tag)
        finally:
            INFLIGHT_DOWNLOADS.discard(inflight_key)
    except asyncio.CancelledError:
        logger.warning("Download %s was cancelled before processing", tag)
        await finish_status(status_message, failure_text(tag, "download"))
        raise
    except Exception:
        logger.exception("Unexpected download error for %s", tag)
        await finish_status(status_message, failure_text(tag, "internal"))


async def post_init(application: Application) -> None:
    timeout = aiohttp.ClientTimeout(total=120, connect=20, sock_read=120)
    application.bot_data["http_session"] = aiohttp.ClientSession(timeout=timeout)


async def post_shutdown(application: Application) -> None:
    session: aiohttp.ClientSession | None = application.bot_data.get("http_session")
    if session and not session.closed:
        await session.close()


def build_application(token: str) -> Application:
    application = (
        Application.builder()
        .token(token)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )
    application.add_handler(CommandHandler("start", show_welcome))
    application.add_handler(CommandHandler("help", show_help))
    application.add_handler(CommandHandler("search", search_handler))
    application.add_handler(CommandHandler("alldl", download_handler))
    application.add_handler(
        MessageHandler(filters.Regex(r"^[1-5]$") & filters.TEXT, select_search_result)
    )
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, download_handler)
    )
    return application


def main() -> None:
    token = BOT_TOKEN
    if not token or token == "PASTE_YOUR_BOT_TOKEN_HERE":
        raise SystemExit(
            "Add your Telegram bot token to BOT_TOKEN or set "
            "the TELEGRAM_BOT_TOKEN environment variable."
        )
    application = build_application(token)
    logger.info("Telegram downloader bot is starting")
    application.run_polling()


if __name__ == "__main__":
    main()
