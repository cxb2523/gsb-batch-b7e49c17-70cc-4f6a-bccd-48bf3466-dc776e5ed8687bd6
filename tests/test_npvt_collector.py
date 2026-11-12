"""
آزمون‌های کاملاً آفلاین برای چرخهٔ ذخیره/بازیابی وضعیت جمع‌آورنده.

در این تست‌ها هیچ درخواست واقعی به t.me یا api.telegram.org ارسال نمی‌شود:
  - fetch_url با HTML ساختگی محلی جایگزین می‌شود.
  - send_telegram_message با یک تابع جعلی جایگزین می‌شود.
"""
import json

import pytest

from src import npvt_collector as collector


# ----------------------------------------------------------------------------
# ابزارهای کمکی
# ----------------------------------------------------------------------------
class FakeSender:
    """نتیجهٔ ارسال را از پیش تعیین می‌کند و ترتیب/محتوای فراخوانی‌ها را ثبت می‌کند."""

    def __init__(self, results=None):
        self.results = list(results or [])
        self.calls = []

    def __call__(self, text, parse_mode="HTML"):
        self.calls.append({"text": text, "parse_mode": parse_mode})
        if self.results:
            return self.results.pop(0)
        return True


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def dedup_key(name, size):
    return collector.NpvtFile(
        channel="c", message_id=0, file_name=name, size_text=size, link=""
    ).dedup_key


def make_channel_html(channel, entries):
    """
    یک قطعهٔ HTML شبیه صفحهٔ عمومی t.me/s/<channel> می‌سازد.
    entries: [(message_id, file_name, size_text, posted_at_iso), ...]
    """
    blocks = []
    for msg_id, name, size, posted_at in entries:
        blocks.append(
            f'<div class="tgme_widget_message" data-post="{channel}/{msg_id}">'
            f'<a class="tgme_widget_message_document" href="https://t.me/{channel}/{msg_id}">'
            f'<div class="tgme_widget_message_document_title">{name}</div>'
            f'<div class="tgme_widget_message_document_extra">{size}</div>'
            f"</a>"
            f'<a class="tgme_widget_message_date" href="https://t.me/{channel}/{msg_id}">'
            f'<time datetime="{posted_at}"></time></a>'
            f"</div>"
        )
    return "<html><body>" + "".join(blocks) + "</body></html>"


def sample_entries(count, first_id=101, first_day=1):
    entries = []
    for i in range(count):
        entries.append(
            (
                first_id + i,
                f"config{i + 1:02d}.npvt",
                f"{i + 1} MB",
                f"2026-01-{first_day + i:02d}T10:00:00+00:00",
            )
        )
    return entries


@pytest.fixture
def state_dir(tmp_path, monkeypatch):
    """همهٔ فایل‌های ورودی/وضعیت را به یک پوشهٔ موقت ایزوله منتقل می‌کند."""
    data = tmp_path / "data"
    data.mkdir()

    paths = {
        "CHANNELS_FILE": data / "channels.txt",
        "CHECKPOINT_FILE": data / "last_message_id.json",
        "SEEN_FILES_FILE": data / "seen_files.json",
        "REPORT_FILE": data / "npvt_report.txt",
        "CHANNEL_REPORT_FILE": data / "channel_report.txt",
        "INVALID_CHANNELS_FILE": data / "invalid_channels.txt",
        "PENDING_FILE": data / "pending_send.json",
        "BLOCKED_KEYWORDS_FILE": data / "blocked_keywords.txt",
        "FILTERED_FILES_FILE": data / "filtered_files.txt",
    }
    for constant_name, path in paths.items():
        monkeypatch.setattr(collector, constant_name, path)

    (data / "channels.txt").write_text("testchan\n", encoding="utf-8")
    monkeypatch.setattr(collector, "BOT_TOKEN", "test-token")
    monkeypatch.setattr(collector, "TARGET_CHANNEL", "@target")
    monkeypatch.setattr(collector, "BLOCKED_KEYWORDS", [])
    monkeypatch.setattr(collector, "MAX_FILES_PER_MESSAGE", 10)
    monkeypatch.setattr(collector, "MAX_PAGES_PER_CHANNEL", 1)
    # هیچ تأخیر واقعی در تست‌ها لازم نیست.
    monkeypatch.setattr(collector.time, "sleep", lambda *_args, **_kwargs: None)

    # دیوار آتش تست: هیچ درخواست واقعی نباید به تلگرام یا جایی دیگر برود.
    def _no_network(*_args, **_kwargs):
        raise AssertionError("tests must not perform real network requests")

    monkeypatch.setattr(collector.requests, "get", _no_network)
    monkeypatch.setattr(collector.requests, "post", _no_network)

    return data


# ----------------------------------------------------------------------------
# ۱) ارسال موفق: هر سه فایل وضعیت یک‌جا و سالم روی دیسک نوشته می‌شوند
# ----------------------------------------------------------------------------
def test_successful_send_persists_checkpoint_seen_and_empty_queue(state_dir, monkeypatch):
    entries = sample_entries(2)
    monkeypatch.setattr(
        collector, "fetch_url", lambda url: make_channel_html("testchan", entries)
    )
    sender = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender)

    write_json(state_dir / "last_message_id.json", {"testchan": 100})
    write_json(state_dir / "seen_files.json", {})

    collector.main()

    # چک‌پوینت به جدیدترین پیام دیده‌شده رسیده است.
    assert read_json(state_dir / "last_message_id.json")["testchan"] == 102

    # فقط بعد از موفقیت هر دو پیام، هر دو فایل در آرشیو «ارسال‌شده» ثبت شده‌اند.
    seen = read_json(state_dir / "seen_files.json")
    expected_keys = {
        dedup_key("config01.npvt", "1 MB"),
        dedup_key("config02.npvt", "2 MB"),
    }
    assert set(seen) == expected_keys
    assert all(item["file_name"].startswith("config") for item in seen.values())

    # صف انتظار خالی است، ولی ساختار دو بخشی آن همچنان حفظ شده است.
    pending = read_json(state_dir / "pending_send.json")
    assert pending["schema_version"] == collector.PENDING_SCHEMA_VERSION
    assert pending["retry"] == {}
    assert pending["discarded"] == {}

    # ابتدا پیام هدر، سپس پیام فهرست.
    assert len(sender.calls) == 2
    assert sender.calls[0]["text"] == collector.HEADER_TEXT
    assert "https://t.me/testchan/101" in sender.calls[1]["text"]
    assert "https://t.me/testchan/102" in sender.calls[1]["text"]

    # هیچ فایل موقت نیمه‌کاره‌ای باقی نمانده است.
    assert list(state_dir.rglob("*.tmp")) == []


# ----------------------------------------------------------------------------
# ۲) شکست ارسال: دسته وارد صف retry می‌شود و اجرای بعدی آن را دوباره می‌فرستد
# ----------------------------------------------------------------------------
def test_send_failure_enters_retry_queue_and_is_retried_next_run(state_dir, monkeypatch):
    entries = sample_entries(2)
    monkeypatch.setattr(
        collector, "fetch_url", lambda url: make_channel_html("testchan", entries)
    )
    monkeypatch.setattr(collector, "MAX_PAGES_PER_CHANNEL", 1)
    write_json(state_dir / "last_message_id.json", {"testchan": 100})

    # پیام هدر موفق، پیام فهرست ناموفق ← کل دسته باید retry شود.
    sender = FakeSender([True, False])
    monkeypatch.setattr(collector, "send_telegram_message", sender)
    collector.main()

    pending = read_json(state_dir / "pending_send.json")
    keys = {dedup_key("config01.npvt", "1 MB"), dedup_key("config02.npvt", "2 MB")}
    assert set(pending["retry"]) == keys
    assert pending["discarded"] == {}
    # هیچ‌کدام نباید به‌عنوان ارسال‌شده ثبت شوند.
    assert read_json(state_dir / "seen_files.json") == {}
    # چک‌پوینت مستقل از نتیجهٔ ارسال، جلو رفته است.
    assert read_json(state_dir / "last_message_id.json")["testchan"] == 102

    # اجرای دوم: همان صفحه دیگر پیام جدیدی ندارد، اما retry باید اولویت بگیرد.
    sender2 = FakeSender([True, True])
    monkeypatch.setattr(collector, "send_telegram_message", sender2)
    collector.main()

    pending2 = read_json(state_dir / "pending_send.json")
    assert pending2["retry"] == {}
    seen2 = read_json(state_dir / "seen_files.json")
    assert set(seen2) == keys
    assert sender2.calls[0]["text"] == collector.HEADER_TEXT
    assert len(sender2.calls) == 2


# ----------------------------------------------------------------------------
# ۳) سرریز سقف: کنار گذاشته می‌شود، بالنشت data/pending نمی‌شود و دوباره هم
#    حتی اگر صفحه مجدداً دیده شود، ارسال نمی‌شود.
# ----------------------------------------------------------------------------
def test_over_limit_files_are_discarded_and_never_backfilled(state_dir, monkeypatch):
    entries = sample_entries(12)  # قدیمی‌ترین: config01, جدیدترین: config12
    monkeypatch.setattr(
        collector, "fetch_url", lambda url: make_channel_html("testchan", entries)
    )
    sender = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender)
    write_json(state_dir / "last_message_id.json", {"testchan": 0})

    collector.main()

    seen = read_json(state_dir / "seen_files.json")
    pending = read_json(state_dir / "pending_send.json")

    sent_keys = {dedup_key(f"config{i:02d}.npvt", f"{i} MB") for i in range(3, 13)}
    discarded_keys = {
        dedup_key("config01.npvt", "1 MB"),
        dedup_key("config02.npvt", "2 MB"),
    }

    assert len(sender.calls) == 2
    assert set(seen) == sent_keys
    assert pending["retry"] == {}
    assert set(pending["discarded"]) == discarded_keys
    assert pending["discarded"][dedup_key("config01.npvt", "1 MB")]["reason"] == "max_files_per_run"

    # اجرای دوم با چک‌پوینت صفر: صفحه دوباره کامل اسکن می‌شود و فایل‌های
    # کنارگذاشته‌شده دوباره دیده می‌شوند، ولی نباید به هیچ طریقی ارسال شوند.
    write_json(state_dir / "last_message_id.json", {"testchan": 0})
    sender2 = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender2)
    collector.main()

    assert sender2.calls == []
    pending2 = read_json(state_dir / "pending_send.json")
    assert pending2["retry"] == {}
    assert set(pending2["discarded"]) == discarded_keys
    assert read_json(state_dir / "seen_files.json") == seen


# ----------------------------------------------------------------------------
# ۴) شکست صفحهٔ اول: کانال ERR می‌شود ولی چک‌پوینت قدیمی حفظ می‌شود
# ----------------------------------------------------------------------------
def test_first_page_failure_marks_invalid_and_preserves_old_checkpoint(state_dir, monkeypatch):
    write_json(state_dir / "last_message_id.json", {"testchan": 500})
    monkeypatch.setattr(collector, "fetch_url", lambda url: "")
    sender = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender)

    collector.main()

    assert read_json(state_dir / "last_message_id.json")["testchan"] == 500
    assert "testchan" in (state_dir / "invalid_channels.txt").read_text(encoding="utf-8")
    assert "testchan: ERR" in (state_dir / "channel_report.txt").read_text(encoding="utf-8")
    assert sender.calls == []
    # هیچ فایل تازه‌ای هم نباید به آرشیو/صف اضافه شده باشد.
    assert read_json(state_dir / "pending_send.json")["retry"] == {}


# ----------------------------------------------------------------------------
# ۵) اولویت retry بر فایل‌های تازه‌یاب
# ----------------------------------------------------------------------------
def test_retry_items_take_priority_over_fresh_files(state_dir, monkeypatch):
    # ۱۲ مورد از اجرای قبلی هنوز در صف retry مانده‌اند.
    pending_retry = {}
    for i in range(1, 13):
        item = collector.NpvtFile(
            channel="oldchan",
            message_id=i,
            file_name=f"retry{i:02d}.npvt",
            size_text=f"{i} MB",
            link=f"https://t.me/oldchan/{i}",
            posted_at=f"2026-01-{i:02d}T09:00:00+00:00",
        )
        pending_retry[item.dedup_key] = item.to_dict()
    write_json(
        state_dir / "pending_send.json",
        {
            "schema_version": collector.PENDING_SCHEMA_VERSION,
            "retry": pending_retry,
            "discarded": {},
        },
    )

    # اسکن فعلی ۳ فایل تازه برمی‌گرداند.
    fresh_entries = [
        (201, "fresh01.npvt", "1 MB", "2026-02-01T10:00:00+00:00"),
        (202, "fresh02.npvt", "2 MB", "2026-02-02T10:00:00+00:00"),
        (203, "fresh03.npvt", "3 MB", "2026-02-03T10:00:00+00:00"),
    ]
    monkeypatch.setattr(
        collector, "fetch_url", lambda url: make_channel_html("testchan", fresh_entries)
    )
    write_json(state_dir / "last_message_id.json", {"testchan": 200})
    sender = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender)

    collector.main()

    list_text = sender.calls[1]["text"]
    # سقف ۱۰تایی کاملاً با retry پر می‌شود؛ فایل تازه فرصتی برای ورود به دسته ندارد.
    assert "https://t.me/testchan/201" not in list_text
    assert sum("https://t.me/oldchan/" in line for line in list_text.splitlines()) == 10

    pending = read_json(state_dir / "pending_send.json")
    # ۲ مورد retry که جا نشده‌اند همچنان در صف retry مانده‌اند (دیسکارد نشده‌اند).
    assert len(pending["retry"]) == 2
    assert all(key.startswith("retry") for key in pending["retry"])
    # هر ۳ فایل تازه که ظرفیتی برایشان نمانده، در بخش discarded ثبت شده‌اند.
    assert len(pending["discarded"]) == 3
    assert set(pending["discarded"]) == {
        dedup_key("fresh01.npvt", "1 MB"),
        dedup_key("fresh02.npvt", "2 MB"),
        dedup_key("fresh03.npvt", "3 MB"),
    }


# ----------------------------------------------------------------------------
# ۶) شکست صفحهٔ بعدی: نتایج صفحهٔ اول حفظ و صفحه‌بندی متوقف می‌شود
# ----------------------------------------------------------------------------
def test_later_page_failure_keeps_results_already_collected(state_dir, monkeypatch):
    entries = sample_entries(2)
    requested_urls = []

    def fake_fetch(url):
        requested_urls.append(url)
        if "before=" in url:
            return ""  # صفحهٔ دوم شکست می‌خورد
        return make_channel_html("testchan", entries)

    monkeypatch.setattr(collector, "MAX_PAGES_PER_CHANNEL", 2)
    monkeypatch.setattr(collector, "fetch_url", fake_fetch)
    sender = FakeSender()
    monkeypatch.setattr(collector, "send_telegram_message", sender)
    write_json(state_dir / "last_message_id.json", {"testchan": 100})

    collector.main()

    # نتایج صفحهٔ اول از دست نرفته‌اند.
    seen = read_json(state_dir / "seen_files.json")
    assert set(seen) == {
        dedup_key("config01.npvt", "1 MB"),
        dedup_key("config02.npvt", "2 MB"),
    }
    assert read_json(state_dir / "last_message_id.json")["testchan"] == 102
    # فقط یک بار صفحهٔ بعدی درخواست شده و بعد از شکست، صفحه‌بندی متوقف شده است.
    assert sum("before=" in url for url in requested_urls) == 1
    assert len(sender.calls) == 2


# ----------------------------------------------------------------------------
# ۷) شکست زمان جایگزینی اتمیک: فایل قدیمی سالم می‌ماند و فایل موقتی پاک می‌شود
# ----------------------------------------------------------------------------
def test_state_write_failure_keeps_previous_json_and_no_temp_files(state_dir, monkeypatch):
    checkpoint = state_dir / "last_message_id.json"
    seen = state_dir / "seen_files.json"
    pending = state_dir / "pending_send.json"
    for path in (checkpoint, seen, pending):
        write_json(path, {"old": 1})

    def failing_replace(src, dst):
        raise OSError("simulated atomic replace failure")

    monkeypatch.setattr(collector.os, "replace", failing_replace)

    with pytest.raises(OSError):
        collector.save_state({"new": 1}, {"sent": {}}, {}, {})

    # هیچ‌کدام از فایل‌های قبلی خراب نشده‌اند و JSON نیمه‌کاره/موقتی باقی نمانده.
    for path in (checkpoint, seen, pending):
        assert read_json(path) == {"old": 1}
    assert list(state_dir.rglob("*.tmp")) == []
