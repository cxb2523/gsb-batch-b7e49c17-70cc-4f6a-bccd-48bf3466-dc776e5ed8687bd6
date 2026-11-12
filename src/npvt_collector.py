#!/usr/bin/env python3
"""
src/npvt_collector.py

اسکن صفحات وب عمومی تلگرام (t.me/s/<channel>) برای پیام‌هایی که فایل با
پسوند .npvt دارند — بدون نیاز به لاگین، شماره تلفن، یا عضویت در هیچ کانالی؛
دقیقاً همان روش HTTP/HTML که در پروژه‌های V2ray-Collector و news-monitor
خودتان استفاده شده (t.me/s/... به‌صورت عمومی و بدون احراز هویت در دسترس
است).

فایل‌هایی که نامشان حاوی کلیدواژه‌ای از data/blocked_keywords.txt باشد،
اصلاً جمع‌آوری یا منتشر نمی‌شوند (فقط برای شفافیت در data/filtered_files.txt
ثبت می‌شوند).

باقی فایل‌های یکتا (بر اساس ترکیب «نام + حجم»، مقایسه‌شده در برابر تمام
اجراهای قبلی از data/seen_files.json) به ترتیب «جدیدترین زمان انتشار در
کانال مبدأ» مرتب می‌شوند. حداکثر MAX_FILES_PER_MESSAGE (پیش‌فرض ۱۰) تای
جدیدترین در یک پیام ارسال می‌شوند؛ اگر بیشتر پیدا شود، مابقی طبق دستور
کاملاً کنار گذاشته می‌شوند (نه در صف، نه در اجرای بعدی دوباره لحاظ می‌شوند).

ارسال با یک بات تلگرامی معمولی (Bot API) انجام می‌شود: یک پیام هدر (بولد)
و بلافاصله بعد از آن یک پیام حاوی فهرست فایل‌ها (هرکدام به‌صورت هایپرلینک
به پیام اصلی در کانال مبدأ). این بات فقط باید در کانال *مقصد* خودتان
دسترسی ارسال پیام داشته باشد.

برای مقابله با محدودیت نرخ ارسال تلگرام (429 Too Many Requests)، اگر
تلگرام بگوید «بعد از N ثانیه دوباره امتحان کن»، دقیقاً همان مدت صبر و
دوباره تلاش می‌شود (تا MAX_SEND_RETRIES بار). اگر در نهایت هم پیام‌ها
ارسال نشوند (نه به‌خاطر سقف ۱۰ تایی، بلکه به‌خاطر خطای واقعی ارسال)، کل
آن دسته در data/pending_send.json ذخیره و در اجرای بعدی دوباره امتحان
می‌شود.

همچنین، مثل پروژه‌ی V2ray-Collector، دو فایل گزارش تولید می‌شود:
  - data/channel_report.txt   → تاریخچه‌ی تعداد فایل .npvt یافت‌شده در هر اجرا، به ازای هر کانال
  - data/invalid_channels.txt → کانال‌هایی که در این اجرا هیچ پیامی از آن‌ها خوانده نشد
                                 (وجود ندارند، خصوصی‌اند، یا مسدود شده‌اند)
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("npvt_collector")

# ----------------------------------------------------------------------------
# تنظیمات
# ----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
CHANNELS_FILE = DATA_DIR / "channels.txt"
CHECKPOINT_FILE = DATA_DIR / "last_message_id.json"
SEEN_FILES_FILE = DATA_DIR / "seen_files.json"
REPORT_FILE = DATA_DIR / "npvt_report.txt"
CHANNEL_REPORT_FILE = DATA_DIR / "channel_report.txt"
INVALID_CHANNELS_FILE = DATA_DIR / "invalid_channels.txt"
PENDING_FILE = DATA_DIR / "pending_send.json"
BLOCKED_KEYWORDS_FILE = DATA_DIR / "blocked_keywords.txt"
FILTERED_FILES_FILE = DATA_DIR / "filtered_files.txt"

# ----------------------------------------------------------------------------
# وضعیت پایدار (state)
# ----------------------------------------------------------------------------
# صف انتظار دو دستهٔ کاملاً جدا دارد:
#   - retry:      ارسالشان به خطای واقعی خورده و باید در اجرای بعدی (با اولویت)
#                 دوباره تلاش شوند.
#   - discarded:  به‌خاطر عبور از سقف MAX_FILES_PER_MESSAGE کنار گذاشته شده‌اند
#                 و هرگز نباید دوباره به صف بازگردانده یا ارسال شوند.
PENDING_SCHEMA_VERSION = 2
PENDING_RETRY_KEY = "retry"
PENDING_DISCARDED_KEY = "discarded"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))

SLEEP_BETWEEN_CHANNELS = float(os.getenv("SLEEP_BETWEEN_CHANNELS", "1.5"))
SLEEP_BETWEEN_PAGES = float(os.getenv("SLEEP_BETWEEN_PAGES", "1"))
# فاصله بین پیام هدر و پیام فهرست فایل‌ها (فقط ۲ پیام در هر اجرا، پس نیازی
# به فاصله‌ی زیاد نیست؛ همچنان مقداری احتیاط در برابر محدودیت نرخ تلگرام).
SLEEP_BETWEEN_SENDS = float(os.getenv("SLEEP_BETWEEN_SENDS", "2"))
MAX_PAGES_PER_CHANNEL = int(os.getenv("MAX_PAGES_PER_CHANNEL", "3"))

# ---- تلاش مجدد هنگام محدودیت نرخ ارسال (429 Too Many Requests) ----
MAX_SEND_RETRIES = int(os.getenv("MAX_SEND_RETRIES", "6"))
MAX_RETRY_AFTER_WAIT = int(os.getenv("MAX_RETRY_AFTER_WAIT", "90"))

# ---- سقف تعداد فایل در هر پیام/اجرا ----
# اگر بیشتر از این تعداد فایل جدید پیدا شود، فقط جدیدترین‌ها (بر اساس زمان
# انتشار در کانال مبدأ) ارسال می‌شوند و بقیه کاملاً کنار گذاشته می‌شوند —
# نه در صف اجرای بعدی، نه دوباره بررسی می‌شوند.
MAX_FILES_PER_MESSAGE = int(os.getenv("MAX_FILES_PER_MESSAGE", "10"))

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
TARGET_CHANNEL = os.getenv("TARGET_CHANNEL", "")  # مثال: @my_channel یا -100xxxxxxxxxx

FILE_SUFFIX = ".npvt"
HEADER_TEXT = "<b>فایل های NPVT جدید 😁👇</b>"

# ---- فیلتر نام فایل ----
DEFAULT_BLOCKED_KEYWORDS = [
    "جاوید", "جاویدنام", "جاوید نام",
    "شاه", "آریامهر", "آریا مهر", "پهلوی",
    "خمینی", "خامنه ای", "خامنه‌ای",
    "سیدعلی", "سید علی", "مجتبی",
]


# ----------------------------------------------------------------------------
# توابع کمکی
# ----------------------------------------------------------------------------
def normalize_fa(text: str) -> str:
    """
    برای مقایسه‌ی قابل‌اعتماد بین حالت‌های مختلف نگارشی یک عبارت فارسی
    (با فاصله، با نیم‌فاصله ZWNJ، یا چسبیده)، همه‌ی این‌ها را حذف کرده و
    به حروف کوچک تبدیل می‌کند.
    """
    text = text.replace("\u200c", "")  # نیم‌فاصله (ZWNJ)
    text = re.sub(r"\s+", "", text)
    return text.strip().lower()


def load_blocked_keywords() -> list[str]:
    if not BLOCKED_KEYWORDS_FILE.exists():
        BLOCKED_KEYWORDS_FILE.parent.mkdir(parents=True, exist_ok=True)
        BLOCKED_KEYWORDS_FILE.write_text(
            "# هر خط یک کلیدواژه؛ نام فایل‌هایی که حاوی هر یک از این‌ها باشند منتشر نمی‌شوند.\n"
            "# خط‌هایی که با # شروع می‌شوند نادیده گرفته می‌شوند.\n"
            + "\n".join(DEFAULT_BLOCKED_KEYWORDS) + "\n",
            encoding="utf-8",
        )
        return list(DEFAULT_BLOCKED_KEYWORDS)

    lines = BLOCKED_KEYWORDS_FILE.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]


BLOCKED_KEYWORDS = load_blocked_keywords()


def parse_posted_at(value: str) -> datetime:
    """رشته‌ی ISO 8601 زمان انتشار را پارس می‌کند؛ در صورت نبود/خطا، قدیمی‌ترین زمان ممکن برمی‌گردد."""
    fallback = datetime.min.replace(tzinfo=timezone.utc)
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return fallback


def load_channels() -> list[str]:
    if not CHANNELS_FILE.exists():
        logger.error("فایل %s پیدا نشد.", CHANNELS_FILE)
        return []
    lines = CHANNELS_FILE.read_text(encoding="utf-8").splitlines()
    channels = [
        line.strip().lstrip("@")
        for line in lines
        if line.strip() and not line.strip().startswith("#")
    ]
    logger.info("📋 %d کانال از %s بارگذاری شد.", len(channels), CHANNELS_FILE)
    return channels


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("خطا در خواندن %s؛ از مقدار پیش‌فرض استفاده می‌شود.", path)
    return default


def _atomic_write_text(path: Path, text: str) -> None:
    """
    فایل را ابتدا در یک فایل موقت (در همان پوشه) می‌نویسد و سپس با
    os.replace به‌صورت اتمیک جایگزین می‌کند. اگر در میانهٔ کار خطایی رخ دهد،
    فایل مقصد دست‌نخورده می‌ماند و فایل موقت پاک می‌شود؛ بنابراین هیچ‌وقت
    یک JSON نیمه‌کاره باقی نمی‌ماند.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def save_json(path: Path, data) -> None:
    _atomic_write_text(Path(path), json.dumps(data, ensure_ascii=False, indent=2))


def _serialize_pending(
    retry_items: dict, discarded_items: dict
) -> dict:
    def as_dict(item):
        return item.to_dict() if isinstance(item, NpvtFile) else dict(item)

    return {
        "schema_version": PENDING_SCHEMA_VERSION,
        PENDING_RETRY_KEY: {key: as_dict(item) for key, item in retry_items.items()},
        PENDING_DISCARDED_KEY: {key: as_dict(item) for key, item in discarded_items.items()},
    }


def save_state(
    checkpoints: dict,
    seen_files: dict,
    retry_items: dict,
    discarded_items: dict,
) -> None:
    """
    سه فایل وضعیت (چک‌پوینت، آرشیو ارسال‌شده، صف انتظار) را یک‌جا و فقط در
    پایان اجرا می‌نویسد.

    ابتدا هر سه محتوا کاملاً سریالایز می‌شوند و هر سه فایل موقت نوشته و
    fsync می‌شوند؛ تنها پس از موفقیت همهٔ این مراحل، فایل‌های نهایی با
    os.replace جایگزین می‌شوند. بنابراین اگر در ساخت/نوشتن هر یک از آن‌ها
    خطایی رخ دهد، هیچ‌کدام از فایل‌های وضعیت تغییر نمی‌کنند و هیچ JSON
    نیمه‌کاره‌ای روی دیسک باقی نمی‌ماند.
    """
    entries = [
        (Path(CHECKPOINT_FILE), checkpoints),
        (Path(SEEN_FILES_FILE), seen_files),
        (Path(PENDING_FILE), _serialize_pending(retry_items, discarded_items)),
    ]

    # سریالایز کردن همه پیش از لمس دیسک: خطای احتمالی هیچ فایلی را خراب نمی‌کند.
    serialized = [
        (path, json.dumps(data, ensure_ascii=False, indent=2))
        for path, data in entries
    ]

    prepared: list[tuple[Path, Path]] = []  # (temp, final)
    try:
        for path, text in serialized:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(
                prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
            )
            tmp_path = Path(tmp_name)
            prepared.append((tmp_path, path))
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())

        # همهٔ فایل‌های موقت با موفقیت آماده‌اند؛ حالا جایگزینی اتمیک.
        for tmp_path, path in prepared:
            os.replace(tmp_path, path)
    except BaseException:
        for tmp_path, _ in prepared:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise


def load_pending_state(path: Path | None = None) -> tuple[dict, dict]:
    """
    صف انتظار را می‌خواند و دو بخش آن را جدا برمی‌گرداند:
    (retry_items, discarded_items)

    فرمت قدیمی (یک دیکشنری تخت از فایل‌های ناموفق) هم پشتیبانی می‌شود و در
    آن حالت همهٔ موارد به‌عنوان retry در نظر گرفته می‌شوند.
    """
    path = Path(path) if path is not None else PENDING_FILE
    raw = load_json(path, {})
    if not isinstance(raw, dict):
        logger.warning("ساختار %s معتبر نیست؛ صف خالی در نظر گرفته می‌شود.", path)
        return {}, {}

    is_new_format = raw.get("schema_version") == PENDING_SCHEMA_VERSION or (
        isinstance(raw.get(PENDING_RETRY_KEY), dict)
        and isinstance(raw.get(PENDING_DISCARDED_KEY), dict)
    )
    if is_new_format:
        retry_raw = raw.get(PENDING_RETRY_KEY) or {}
        discarded_raw = raw.get(PENDING_DISCARDED_KEY) or {}
    else:
        retry_raw = raw
        discarded_raw = {}

    retry_items: dict[str, NpvtFile] = {}
    for key, data in retry_raw.items():
        if not isinstance(data, dict):
            continue
        try:
            retry_items[str(key)] = NpvtFile.from_dict(data)
        except Exception:
            logger.warning("یک مورد نامعتبر در صف retry نادیده گرفته شد: %r", key)

    discarded_items: dict[str, dict] = {}
    for key, data in discarded_raw.items():
        if isinstance(data, dict):
            discarded_items[str(key)] = dict(data)

    return retry_items, discarded_items


def fetch_url(url: str) -> str:
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.warning("   ↳ خطا در واکشی %s: %s", url, e)
        return ""


# ----------------------------------------------------------------------------
# مدل داده
# ----------------------------------------------------------------------------
@dataclass
class NpvtFile:
    channel: str
    message_id: int
    file_name: str
    size_text: str
    link: str
    posted_at: str = ""  # ISO 8601، از attribute «datetime» عنصر <time> صفحه‌ی تلگرام

    @property
    def dedup_key(self) -> str:
        # طبق درخواست: فقط وقتی تکراری است که «هم نام و هم حجم» یکسان باشند
        name = re.sub(r"\s+", " ", self.file_name.strip().lower())
        size = re.sub(r"\s+", "", self.size_text.strip().lower())
        return f"{name}::{size}"

    @property
    def posted_at_dt(self) -> datetime:
        return parse_posted_at(self.posted_at)

    def to_dict(self) -> dict:
        return {
            "channel": self.channel,
            "message_id": self.message_id,
            "file_name": self.file_name,
            "size_text": self.size_text,
            "link": self.link,
            "posted_at": self.posted_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NpvtFile":
        return cls(
            channel=data.get("channel", ""),
            message_id=int(data.get("message_id", 0)),
            file_name=data.get("file_name", ""),
            size_text=data.get("size_text", ""),
            link=data.get("link", ""),
            posted_at=data.get("posted_at", ""),
        )


def extract_npvt_from_node(node, channel: str, msg_id: int) -> NpvtFile | None:
    """استخراج اطلاعات فایل .npvt (نام، حجم، زمان انتشار) از یک بلوک پیام، در صورت وجود ضمیمه."""
    doc_anchor = node.select_one('a[class*="document"]')
    if not doc_anchor:
        return None

    title_el = doc_anchor.select_one('[class*="document_title"]')
    extra_el = doc_anchor.select_one('[class*="document_extra"]')
    file_name = title_el.get_text(strip=True) if title_el else ""
    size_text = extra_el.get_text(strip=True) if extra_el else ""

    if not file_name or not file_name.lower().endswith(FILE_SUFFIX):
        return None

    time_el = node.select_one('[class*="tgme_widget_message_date"] time')
    posted_at = time_el.get("datetime", "") if time_el else ""

    return NpvtFile(
        channel=channel,
        message_id=msg_id,
        file_name=file_name,
        size_text=size_text or "نامشخص",
        link=f"https://t.me/{channel}/{msg_id}",
        posted_at=posted_at,
    )


def find_blocked_keyword(file_name: str) -> str | None:
    """اگر نام فایل حاوی یکی از کلیدواژه‌های مسدود باشد، همان کلیدواژه را برمی‌گرداند، وگرنه None."""
    normalized_name = normalize_fa(file_name)
    for keyword in BLOCKED_KEYWORDS:
        if normalize_fa(keyword) in normalized_name:
            return keyword
    return None


# ----------------------------------------------------------------------------
# اسکن یک کانال (با صفحه‌بندی محدود برای رسیدن به چک‌پوینت قبلی)
# ----------------------------------------------------------------------------
def scan_channel(channel: str, last_id: int) -> tuple[list[NpvtFile], int, bool, list[tuple[str, str, str]]]:
    """
    خروجی: (فایل‌های .npvt پیدا‌شده, جدیدترین message_id دیده‌شده, آیا کانال نامعتبر است, فایل‌های فیلترشده)
    فایل‌های فیلترشده: (نام فایل, کلیدواژه‌ی مسدودکننده, لینک) — اصلاً به لیست found اضافه نمی‌شوند.
    """
    found: list[NpvtFile] = []
    filtered: list[tuple[str, str, str]] = []
    newest_id = last_id
    before: int | None = None
    first_page = True
    invalid = False

    for page in range(MAX_PAGES_PER_CHANNEL):
        url = f"https://t.me/s/{channel}" + (f"?before={before}" if before else "")
        html = fetch_url(url)
        if not html:
            if first_page:
                invalid = True
            else:
                # صفحهٔ بعدی در دسترس نیست؛ نتایج صفحه‌های قبلی حفظ می‌شوند
                # و فقط صفحه‌بندی متوقف می‌شود (کانال نامعتبر اعلام نمی‌شود).
                logger.warning("   ↳ صفحهٔ بعدی (%s) شکست خورد؛ با نتایج فعلی متوقف می‌کنیم.", url)
            break

        soup = BeautifulSoup(html, "lxml")
        nodes = soup.select("[data-post]")
        if not nodes:
            if first_page:
                invalid = True
            else:
                logger.warning("   ↳ صفحهٔ بعدی (%s) پیامی نداشت؛ با نتایج فعلی متوقف می‌کنیم.", url)
            break

        ids_on_page: list[int] = []
        for node in nodes:
            data_post = node.get("data-post", "")
            m = re.search(r"/(\d+)$", data_post)
            if not m:
                continue
            msg_id = int(m.group(1))
            ids_on_page.append(msg_id)
            newest_id = max(newest_id, msg_id)

            if msg_id <= last_id:
                continue

            item = extract_npvt_from_node(node, channel, msg_id)
            if not item:
                continue

            matched_keyword = find_blocked_keyword(item.file_name)
            if matched_keyword:
                filtered.append((item.file_name, matched_keyword, item.link))
                continue

            found.append(item)

        first_page = False
        if not ids_on_page:
            break

        oldest_on_page = min(ids_on_page)
        if oldest_on_page <= last_id:
            break  # به آخرین چک‌پوینت رسیدیم؛ نیازی به صفحهٔ قبل‌تر نیست

        before = oldest_on_page
        if page < MAX_PAGES_PER_CHANNEL - 1:
            time.sleep(SLEEP_BETWEEN_PAGES)

    return found, newest_id, invalid, filtered


# ----------------------------------------------------------------------------
# ارسال پیام از طریق بات تلگرام (Bot API)، با تلاش مجدد هنگام محدودیت نرخ
# ----------------------------------------------------------------------------
def send_telegram_message(text: str, parse_mode: str = "HTML") -> bool:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TARGET_CHANNEL,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    for attempt in range(1, MAX_SEND_RETRIES + 1):
        try:
            resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
        except Exception as e:
            logger.error("   ↳ خطای شبکه هنگام ارسال پیام (تلاش %d/%d): %s", attempt, MAX_SEND_RETRIES, e)
            time.sleep(min(5 * attempt, MAX_RETRY_AFTER_WAIT))
            continue

        if resp.status_code == 200:
            return True

        if resp.status_code == 429:
            try:
                retry_after = int(resp.json().get("parameters", {}).get("retry_after", 5))
            except Exception:
                retry_after = 5
            wait_time = min(retry_after + 1, MAX_RETRY_AFTER_WAIT)
            logger.warning(
                "   ↳ ⏳ محدودیت نرخ تلگرام (429)؛ %ss صبر می‌کنیم (تلاش %d/%d)...",
                wait_time, attempt, MAX_SEND_RETRIES,
            )
            time.sleep(wait_time)
            continue

        logger.error("   ↳ ارسال پیام شکست خورد: %s", resp.text)
        return False

    logger.error("   ↳ ارسال پیام پس از %d تلاش، همچنان ناموفق بود.", MAX_SEND_RETRIES)
    return False


def build_file_list_message(batch: list[NpvtFile]) -> str:
    lines = [f'<a href="{item.link}">فایل {i}</a>' for i, item in enumerate(batch, 1)]
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# گزارش‌ها: channel_report.txt (تاریخچه)، invalid_channels.txt، filtered_files.txt
# ----------------------------------------------------------------------------
def update_channel_report(channel_results: list[tuple[str, str]]) -> None:
    history: dict[str, list[str]] = {}
    if CHANNEL_REPORT_FILE.exists():
        with open(CHANNEL_REPORT_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or ":" not in line:
                    continue
                ch, counts = line.split(":", 1)
                ch = ch.strip()
                values = [c.strip() for c in counts.split(",") if c.strip()]
                history[ch] = values

    for ch, value in channel_results:
        history.setdefault(ch, []).append(value)

    CHANNEL_REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CHANNEL_REPORT_FILE, "w", encoding="utf-8") as f:
        f.write(f"NPVT Channel Report — last update: {datetime.now(timezone.utc).isoformat()}\n\n")
        for ch in sorted(history.keys()):
            f.write(f"{ch}: {', '.join(history[ch])}\n")

    logger.info("📊 تاریخچه‌ی کانال‌ها در %s به‌روزرسانی شد.", CHANNEL_REPORT_FILE)


def write_invalid_channels(invalid_channels: list[str]) -> None:
    INVALID_CHANNELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(INVALID_CHANNELS_FILE, "w", encoding="utf-8") as f:
        f.write(f"Invalid Telegram Channels — {datetime.now(timezone.utc).isoformat()}\n\n")
        for ch in sorted(invalid_channels):
            f.write(f"{ch}\n")

    if invalid_channels:
        logger.info("📁 %d کانال نامعتبر در %s ذخیره شد.", len(invalid_channels), INVALID_CHANNELS_FILE)


def append_filtered_files(filtered: list[tuple[str, str, str]]) -> None:
    if not filtered:
        return
    FILTERED_FILES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(FILTERED_FILES_FILE, "a", encoding="utf-8") as f:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        for file_name, keyword, link in filtered:
            f.write(f"{ts} | keyword=«{keyword}» | {file_name} | {link}\n")
    logger.info("🚫 %d فایل به‌خاطر کلیدواژه‌ی مسدود، منتشر نشد (جزئیات در %s).", len(filtered), FILTERED_FILES_FILE)


# ----------------------------------------------------------------------------
# اجرای اصلی
# ----------------------------------------------------------------------------
def main() -> None:
    if not BOT_TOKEN or not TARGET_CHANNEL:
        logger.error("❌ BOT_TOKEN و/یا TARGET_CHANNEL تنظیم نشده است؛ اجرا متوقف شد.")
        return

    channels = load_channels()
    if not channels:
        return

    checkpoints: dict = load_json(CHECKPOINT_FILE, {})
    seen_files: dict = load_json(SEEN_FILES_FILE, {})
    pending_retry, discarded_files = load_pending_state(PENDING_FILE)

    all_new: list[NpvtFile] = []
    all_filtered: list[tuple[str, str, str]] = []
    channel_results: list[tuple[str, str]] = []
    invalid_channels: list[str] = []

    for idx, ch in enumerate(channels, 1):
        logger.info("📡 [%d/%d] بررسی کانال: %s", idx, len(channels), ch)
        last_id = checkpoints.get(ch, 0)
        found, newest_id, invalid, filtered = scan_channel(ch, last_id)

        if invalid:
            # خطای صفحهٔ اول: کانال در گزارش ERR می‌شود، اما چک‌پوینت قبلی
            # آن دست‌نخورده می‌ماند تا داده‌های ازدست‌رفته دوباره بررسی شوند.
            logger.warning("   ↳ ⚠️ کانال نامعتبر یا غیرقابل‌دسترسی (وجود ندارد/خصوصی/مسدود).")
            invalid_channels.append(ch)
            channel_results.append((ch, "ERR"))
        else:
            if found:
                logger.info("   ↳ %d فایل .npvt جدید پیدا شد.", len(found))
            else:
                logger.info("   ↳ فایل .npvt جدیدی پیدا نشد.")
            if filtered:
                logger.info("   ↳ 🚫 %d فایل به‌خاطر کلیدواژه‌ی مسدود نادیده گرفته شد.", len(filtered))
            channel_results.append((ch, str(len(found))))

            if newest_id:
                checkpoints[ch] = max(newest_id, last_id)

        all_new.extend(found)
        all_filtered.extend(filtered)
        if idx < len(channels):
            time.sleep(SLEEP_BETWEEN_CHANNELS)

    # ---- گام ۱: حذف تکراری‌های داخل همین اجرا (اولین موردِ هر نام+حجم می‌ماند) ----
    unique_batch: dict[str, NpvtFile] = {}
    duplicate_in_batch = 0
    for item in all_new:
        if item.dedup_key in unique_batch:
            duplicate_in_batch += 1
            continue
        unique_batch[item.dedup_key] = item

    # ---- گام ۲: حذف موارد قبلاً ارسال‌شده و موارد «کنارگذاشته‌شده برای همیشه» ----
    already_sent = 0
    previously_discarded = 0
    duplicate_with_pending = 0
    fresh_items: list[NpvtFile] = []
    for key, item in unique_batch.items():
        if key in seen_files:
            already_sent += 1
            continue
        if key in discarded_files:
            # قبلاً به‌خاطر سقف کنار گذاشته شده؛ هرگز دوباره کاندید ارسال نمی‌شود.
            previously_discarded += 1
            continue
        if key in pending_retry:
            # همان فایل از قبل در صف retry است؛ دوباره اضافه نمی‌شود.
            duplicate_with_pending += 1
            continue
        fresh_items.append(item)

    logger.info(
        "🔍 جمع‌بندی اسکن: %d پیام یافت شد | %d تکراری در همین اجرا حذف شد | "
        "%d مورد قبلاً ارسال شده بود | %d مورد قبلاً کنار گذاشته شده بود | "
        "%d مورد تازه‌یاب.",
        len(all_new), duplicate_in_batch, already_sent, previously_discarded, len(fresh_items),
    )

    # ---- گام ۳: پاک‌سازی وضعیت‌های متناقض و آماده‌سازی صف retry ----
    for key in list(pending_retry):
        if key in seen_files:
            # قبلاً با موفقیت ارسال شده؛ دیگر نباید در صف retry بماند.
            del pending_retry[key]
        elif key in discarded_files:
            # retry بر ثبت کنارگذاشته‌شده اولویت دارد.
            del discarded_files[key]

    if pending_retry:
        logger.info(
            "📥 %d مورد از صف اجرای قبلی (ارسال ناموفق) با اولویت دوباره امتحان می‌شود.",
            len(pending_retry),
        )
    if duplicate_with_pending:
        logger.info("   ↳ %d مورد تازه‌یاب از قبل در صف retry بود و تکراری نشد.", duplicate_with_pending)

    # ---- گام ۴: انتخاب دسته ----
    # موارد retry اجرای قبلی همیشه اولویت دارند و اگر از سقف بیشتر باشند،
    # در صف retry می‌مانند (نه در دستهٔ «کنارگذاشته‌شده»). فقط فایل‌های
    # تازه‌یابی که از ظرفیت باقی‌مانده بیشترند، برای همیشه کنار گذاشته می‌شوند.
    max_per_run = max(0, MAX_FILES_PER_MESSAGE)
    retry_sorted = sorted(pending_retry.values(), key=lambda it: it.posted_at_dt, reverse=True)
    fresh_sorted = sorted(fresh_items, key=lambda it: it.posted_at_dt, reverse=True)

    batch: list[NpvtFile] = retry_sorted[:max_per_run]
    remaining_capacity = max_per_run - len(batch)
    if remaining_capacity > 0:
        fresh_selected = fresh_sorted[:remaining_capacity]
        fresh_overflow = fresh_sorted[remaining_capacity:]
    else:
        fresh_selected = []
        fresh_overflow = fresh_sorted
    batch.extend(fresh_selected)

    if fresh_overflow:
        logger.info(
            "🗑️ %d فایل تازه‌یاب اضافه بر سقف %d موردِ هر اجرا، کاملاً کنار گذاشته شد "
            "(در صف اجرای بعدی بازگردانده نمی‌شود).",
            len(fresh_overflow), max_per_run,
        )

    sent = failed = 0
    # از همهٔ retryهای قبلی شروع می‌کنیم؛ آن‌هایی که انتخاب نشده‌اند هم می‌مانند.
    retry_next: dict[str, NpvtFile] = dict(pending_retry)

    if not batch:
        logger.info("ℹ️ هیچ فایل جدیدی برای ارسال نبود.")
    else:
        header_ok = send_telegram_message(HEADER_TEXT, parse_mode="HTML")
        time.sleep(SLEEP_BETWEEN_SENDS)
        list_text = build_file_list_message(batch)
        list_ok = send_telegram_message(list_text, parse_mode="HTML")

        if header_ok and list_ok:
            # فقط وقتی هر دو پیام موفق بودند، این دسته «ارسال‌شده» ثبت می‌شود.
            sent = len(batch)
            for item in batch:
                seen_files[item.dedup_key] = {
                    "file_name": item.file_name,
                    "size": item.size_text,
                    "source_channel": item.channel,
                    "link": item.link,
                    "posted_at": item.posted_at,
                    "date": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
                retry_next.pop(item.dedup_key, None)
        else:
            # خطای واقعی ارسال: کل دسته به صف retry اجرای بعدی می‌رود.
            failed = len(batch)
            for item in batch:
                retry_next[item.dedup_key] = item
            logger.error("   ↳ ارسال پیام هدر یا فهرست فایل‌ها شکست خورد؛ این دسته برای اجرای بعدی در صف می‌ماند.")

    # فایل‌های تازه‌یابِ سرریز، در فهرست «کنارگذاشته‌شده» ثبت می‌شوند تا اگر
    # دوباره دیده شوند، هرگز به دستهٔ ارسال بازنگردند.
    discarded_at = time.strftime("%Y-%m-%d %H:%M:%S")
    for item in fresh_overflow:
        discarded_files[item.dedup_key] = {
            **item.to_dict(),
            "reason": "max_files_per_run",
            "discarded_at": discarded_at,
        }

    update_channel_report(channel_results)
    write_invalid_channels(invalid_channels)
    append_filtered_files(all_filtered)

    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_FILE, "a", encoding="utf-8") as f:
        f.write(
            f"{time.strftime('%Y-%m-%d %H:%M:%S')} | found={len(all_new)} "
            f"duplicates={duplicate_in_batch} already_sent={already_sent} "
            f"previously_discarded={previously_discarded} "
            f"batch={len(batch)} sent={sent} failed={failed} discarded={len(fresh_overflow)} "
            f"pending_retry={len(retry_next)} discarded_total={len(discarded_files)} "
            f"filtered={len(all_filtered)} invalid_channels={len(invalid_channels)}\n"
        )

    # ---- گام ۵: تنها نقطهٔ نوشتن وضعیت ----
    # هر سه فایل (چک‌پوینت، آرشیو ارسال‌شده، صف انتظار) پس از پایان همهٔ
    # کارهای این اجرا، یک‌جا و به‌صورت اتمیک نوشته می‌شوند.
    save_state(checkpoints, seen_files, retry_next, discarded_files)

    logger.info(
        "✅ پایان اجرا. ارسال‌شده: %d | ناموفق (در صف ماند): %d | کنار گذاشته‌شده (سقف %d): %d | "
        "در انتظار retry: %d | فیلترشده: %d | کانال نامعتبر: %d",
        sent, failed, max_per_run, len(fresh_overflow), len(retry_next),
        len(all_filtered), len(invalid_channels),
    )


if __name__ == "__main__":
    main()
