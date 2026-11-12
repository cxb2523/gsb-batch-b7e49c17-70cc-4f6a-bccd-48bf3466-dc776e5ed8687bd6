import asyncio
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone

from apify import Actor


VALID_SCANNERS = {"googlesearch", "ovh", "numverify", "googlecse"}
# Order is deterministic so dataset records and summaries do not change shape between runs.
ALL_SCANNERS = ("local", "googlesearch", "numverify", "ovh", "googlecse")
E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")
# phoneinfoga colourises its console output. Captured output is usually already plain (fatih/color
# disables itself when stdout is not a TTY), but strip escape sequences defensively so the parser
# still sees "Results for local" if colours survive.
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")

# Per-scanner outcome recorded on every dataset row. The caller can therefore tell a source that
# never took part (disabled, or skipped because credentials are missing) from one that took part
# and simply produced no result.
SCANNER_SUCCEEDED = "succeeded"
SCANNER_NO_RESULT = "no_result"
SCANNER_SKIPPED_MISSING_CREDENTIALS = "skipped_missing_credentials"
SCANNER_DISABLED = "disabled"
SCANNER_SKIPPED_UNSUPPORTED_COUNTRY = "skipped_unsupported_country"

# The OVH scanner's DryRun refuses any country outside these calling codes, so it never takes part
# for other countries. Without this the record would wrongly say it participated and found nothing.
OVH_SUPPORTED_COUNTRY_CODES = {33, 32, 44, 34, 41}

# Fields the local (libphonenumber) scanner is expected to supply. When phoneinfoga reports at least
# one successful scanner but these are empty, the record names them instead of leaving an unexplained
# null.
REQUIRED_LOCAL_FIELDS = ("country", "e164")

NOT_CHARGED_INVALID_FORMAT = "invalid_format"
NOT_CHARGED_TIMEOUT = "timeout"
NOT_CHARGED_CRASH = "crash"
NOT_CHARGED_NO_SCANNER = "no_scanner_succeeded"


def normalize_number(raw: str) -> str:
    s = (raw or "").strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if s and not s.startswith("+"):
        s = "+" + s
    return s


def build_command(number: str, disable: list[str]) -> list[str]:
    cmd = ["phoneinfoga", "scan", "-n", number]
    for scanner in disable:
        if scanner in VALID_SCANNERS:
            cmd.extend(["-D", scanner])
    return cmd


def parse_output(
    stdout: str,
    target: str,
    *,
    disabled: list[str] | None = None,
    missing_credentials: list[str] | None = None,
) -> dict:
    """Turn a phoneinfoga console scan into one dataset record.

    ``disabled`` lists scanners passed to phoneinfoga via ``-D`` (including ones the caller disabled
    implicitly because credentials were missing). ``missing_credentials`` names the scanners that
    were auto-disabled for lack of a key/CX, so they can be reported differently from a scanner the
    caller explicitly turned off.
    """
    disabled = {s for s in (disabled or []) if s in VALID_SCANNERS}
    missing_credentials = {s for s in (missing_credentials or []) if s in VALID_SCANNERS}

    record: dict = {
        "target": target,
        "status": "ok",
        "country": None,
        "raw_local": None,
        "local_format": None,
        "international": None,
        "e164": None,
        "carrier": None,
        "line_type": None,
        "valid": None,
        "ovh": None,
        "numverify": None,
        "googlesearch": {},
        "googlecse": None,
        "googlesearch_url_count": 0,
        "scanners_succeeded": 0,
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    }

    # phoneinfoga prints three sections: one ``Results for <scanner>`` block per scanner that
    # returned a non-nil result, an errors block naming scanners that ran but failed, and a final
    # ``N scanner(s) succeeded`` line. Track which section we are in so error lines are never
    # appended to the last scanner's result block.
    section: str | None = None
    current_scanner: str | None = None
    current_category: str | None = None
    results_seen: set[str] = set()
    scanner_errors: dict[str, str] = {}

    for raw_line in stdout.splitlines():
        line = ANSI_ESCAPE.sub("", raw_line).rstrip()
        stripped = line.strip()

        m = re.match(r"^Results for ([\w.-]+)$", stripped)
        if m:
            section = "results"
            current_scanner = m.group(1)
            current_category = None
            results_seen.add(current_scanner)
            continue

        if stripped == "The following scanners returned errors:":
            section = "errors"
            current_scanner = None
            continue

        m = re.match(r"^(\d+) scanner\(s\) succeeded$", stripped)
        if m:
            record["scanners_succeeded"] = int(m.group(1))
            section = "summary"
            current_scanner = None
            continue

        if section == "errors":
            m = re.match(r"^([\w.-]+):\s*(.*)$", stripped)
            if m:
                scanner_errors[m.group(1)] = m.group(2).strip()
            continue

        if section != "results" or not current_scanner:
            continue

        if current_scanner == "local":
            if stripped.startswith("Raw local:"):
                record["raw_local"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("Local:"):
                record["local_format"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("E164:"):
                record["e164"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("International:"):
                record["international"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("Country:"):
                record["country"] = stripped.split(":", 1)[1].strip()

        elif current_scanner == "googlesearch":
            if stripped.endswith(":") and not stripped.startswith("URL:"):
                current_category = stripped[:-1]
                record["googlesearch"].setdefault(current_category, [])
            elif stripped.startswith("URL:"):
                url = stripped.split(":", 1)[1].strip()
                cat = current_category or "general"
                record["googlesearch"].setdefault(cat, []).append(url)
                record["googlesearch_url_count"] += 1

        elif current_scanner == "numverify":
            # phoneinfoga's numverify block labels the country "Country name", unlike the local
            # block's "Country"; accept both so a country supplied only by numverify is not reported
            # as missing. Local wins because phoneinfoga sorts "local" before "numverify".
            if stripped.startswith("Country name:") or stripped.startswith("Country:"):
                record["country"] = record["country"] or stripped.split(":", 1)[1].strip()
                record.setdefault("numverify_raw", []).append(stripped)
            elif stripped.startswith("Carrier:"):
                record["carrier"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("Line type:") or stripped.startswith("Line Type:"):
                record["line_type"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("Valid:"):
                record["valid"] = stripped.split(":", 1)[1].strip().lower() == "true"
            else:
                record.setdefault("numverify_raw", []).append(stripped)

        elif current_scanner == "ovh":
            record.setdefault("ovh_raw", []).append(stripped)

        elif current_scanner == "googlecse":
            record.setdefault("googlecse_raw", []).append(stripped)

    if record.get("ovh_raw"):
        record["ovh"] = "\n".join(text for text in record["ovh_raw"] if text)
        del record["ovh_raw"]
    if record.get("numverify_raw"):
        record["numverify"] = "\n".join(text for text in record["numverify_raw"] if text)
        del record["numverify_raw"]
    if record.get("googlecse_raw"):
        record["googlecse"] = "\n".join(text for text in record["googlecse_raw"] if text)
        del record["googlecse_raw"]

    ovh_supported = _ovh_supports(target)

    # Per-source outcome. A scanner that printed a result block succeeded; one whose credentials
    # were absent never took part; one the caller disabled never took part; OVH never takes part
    # outside its supported countries; anything else was attempted but produced no result
    # (scanner_errors holds the upstream error when one was reported).
    scanner_status: dict[str, str] = {}
    for name in ALL_SCANNERS:
        if name in results_seen:
            scanner_status[name] = SCANNER_SUCCEEDED
        elif name in missing_credentials:
            scanner_status[name] = SCANNER_SKIPPED_MISSING_CREDENTIALS
        elif name in disabled:
            scanner_status[name] = SCANNER_DISABLED
        elif name == "ovh" and not ovh_supported:
            scanner_status[name] = SCANNER_SKIPPED_UNSUPPORTED_COUNTRY
        else:
            scanner_status[name] = SCANNER_NO_RESULT
    # Unexpected scanners (e.g. a phoneinfoga plugin) are still reported as having succeeded.
    for name in sorted(results_seen - set(ALL_SCANNERS)):
        scanner_status[name] = SCANNER_SUCCEEDED
    record["scanner_status"] = scanner_status
    record["scanner_errors"] = scanner_errors

    # Do not leave an unexplained null where a scan was expected to fill a field: when phoneinfoga
    # says scanners succeeded, name the empty fields and why they are empty.
    missing_fields = [field for field in REQUIRED_LOCAL_FIELDS if not record.get(field)]
    record["missing_fields"] = missing_fields
    record["missing_reason"] = None
    if missing_fields and record["scanners_succeeded"] > 0:
        record["missing_reason"] = (
            f"phoneinfoga reported {record['scanners_succeeded']} scanner(s) succeeded, "
            f"but no scanner supplied {', '.join(missing_fields)}"
        )

    return record


def run_phoneinfoga(number: str, disable: list[str], env: dict, timeout: int = 90) -> tuple[str, int]:
    cmd = build_command(number, disable)
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )
    return proc.stdout + proc.stderr, proc.returncode


def not_charged_note(entries: list[dict], limit: int = 3) -> str:
    """Short status-message note: counts per reason plus at most ``limit`` individual reasons.

    The full list is kept in the OUTPUT record, so the status message never has to carry it. Number
    and reason text is shortened here so an arbitrarily long input cannot push the note past
    Apify's 900-character status-message limit.
    """
    if not entries:
        return ""

    counts = Counter(entry["reason_code"] for entry in entries)
    count_text = ", ".join(f"{code}={counts[code]}" for code in sorted(counts))

    shown = entries[:limit]
    details = []
    for entry in shown:
        number = _shorten(str(entry["number"]), 40)
        reason = _shorten(str(entry["reason"]), 80)
        details.append(f"{number}: {reason}")
    detail = " | ".join(details)

    note = f" {len(entries)} not charged ({count_text})."
    if detail:
        note += f" Reasons: {detail}"
    if len(entries) > len(shown):
        note += f" (+{len(entries) - len(shown)} more in OUTPUT)"
    return note


def _shorten(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _ovh_supports(number: str) -> bool:
    """Whether OVH's DryRun would run for this number.

    OVH supports only +33, +32, +44, +34 and +41 (lib/remote/ovh_scanner.go). Checked on the E.164
    prefix directly, because a longer supported code must win over a shorter unrelated one.
    """
    digits = (number or "").lstrip("+")
    return any(digits.startswith(str(code)) for code in OVH_SUPPORTED_COUNTRY_CODES)


async def main() -> None:
    async with Actor:
        Actor.log.info("PhoneInfoga actor starting")

        input_data = await Actor.get_input() or {}
        raw_numbers = input_data.get("numbers") or []
        disable = list(input_data.get("disableScanners") or [])
        numverify_key = (input_data.get("numverifyApiKey") or "").strip()
        gcse_key = (input_data.get("googleCseApiKey") or "").strip()
        gcse_cx = (input_data.get("googleCseCx") or "").strip()

        if not raw_numbers:
            Actor.log.error("No phone numbers provided. Provide at least one E.164 number in 'numbers'.")
            await Actor.fail(status_message="No phone numbers provided")
            return

        env = os.environ.copy()
        # Scanners auto-disabled for missing credentials are tracked separately from the caller's
        # disableScanners list, so records can say why each source did not take part.
        missing_credentials: list[str] = []
        if numverify_key:
            env["NUMVERIFY_API_KEY"] = numverify_key
        else:
            if "numverify" not in disable:
                disable.append("numverify")
                missing_credentials.append("numverify")

        if gcse_key and gcse_cx:
            env["GOOGLECSE_CSE_ID"] = gcse_cx
            env["GOOGLECSE_API_KEY"] = gcse_key
            # phoneinfoga v2.11's googlecse scanner reads these two names; set both spellings so the
            # scanner really takes part whenever the caller supplied a key/CX pair. Without the
            # aliases the scanner silently skips (DryRun fails, never printed) and the record would
            # wrongly describe it as having participated.
            env["GOOGLECSE_CX"] = gcse_cx
            env["GOOGLE_API_KEY"] = gcse_key
        else:
            if "googlecse" not in disable:
                disable.append("googlecse")
                missing_credentials.append("googlecse")

        if missing_credentials:
            Actor.log.warning(
                "Skipping scanner(s) with no credentials configured: "
                f"{', '.join(missing_credentials)}. Their records are marked "
                f"'{SCANNER_SKIPPED_MISSING_CREDENTIALS}'."
            )

        ok = 0
        failed = 0
        invalid = 0
        total = len(raw_numbers)
        # Each dataset row is billed as a result, so only numbers phoneinfoga actually scanned become
        # rows. Invalid, timed-out, crashed and failed scans, and the run summary, used to be rows too
        # (a one-number run billed 2 rows, run vl3zrNMa3BbplCRlk, 2026-10-29); they are listed in the
        # OUTPUT record and summarised in the status message instead.
        not_charged: list[dict] = []

        def record_not_charged(number: str, reason_code: str, reason: str) -> None:
            not_charged.append({"number": number, "reason_code": reason_code, "reason": reason})

        for idx, raw in enumerate(raw_numbers, 1):
            number = normalize_number(str(raw))
            if not E164_PATTERN.match(number):
                Actor.log.warning(f"[{idx}/{total}] Skipping invalid E.164 number: {raw!r}")
                record_not_charged(
                    str(raw),
                    NOT_CHARGED_INVALID_FORMAT,
                    "not in E.164 international format (e.g. +14155552671)",
                )
                invalid += 1
                continue

            Actor.log.info(f"[{idx}/{total}] Scanning {number}")
            try:
                output, rc = run_phoneinfoga(number, disable, env)
            except subprocess.TimeoutExpired:
                Actor.log.warning(f"[{idx}/{total}] {number} timed out after 90s")
                record_not_charged(number, NOT_CHARGED_TIMEOUT, "the scan took over 90 s")
                failed += 1
                continue
            except Exception as exc:
                Actor.log.exception(f"[{idx}/{total}] {number} crashed: {exc}")
                record_not_charged(number, NOT_CHARGED_CRASH, f"the scan crashed ({str(exc)[:160]})")
                failed += 1
                continue

            record = parse_output(
                output,
                number,
                disabled=disable,
                missing_credentials=missing_credentials,
            )
            # A number is a billable row only when at least one scanner really succeeded — no exit
            # code is a substitute for that.
            if record["scanners_succeeded"] == 0:
                reason = (
                    f"no scanner succeeded (phoneinfoga exit {rc})" if rc != 0 else "no scanner succeeded"
                )
                record_not_charged(number, NOT_CHARGED_NO_SCANNER, reason)
                failed += 1
                continue
            ok += 1
            await Actor.push_data(record)

        summary = {
            "target": "__summary__",
            "status": "summary",
            "total_numbers": total,
            "successful": ok,
            "failed": failed,
            "invalid_format": invalid,
            "disabled_scanners": disable,
            "scanners_skipped_for_missing_credentials": missing_credentials,
            "not_charged": not_charged,
            "not_charged_by_reason": dict(Counter(e["reason_code"] for e in not_charged)),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }
        await Actor.set_value("OUTPUT", summary)
        note = not_charged_note(not_charged)
        Actor.log.info(f"Done. ok={ok} failed={failed} invalid={invalid} total={total}")
        if not ok:
            await Actor.fail(status_message=f"No number could be scanned, so nothing was charged.{note}"[:900])
            return
        await Actor.set_status_message(f"Scanned {ok} of {total} number(s).{note}"[:900])


if __name__ == "__main__":
    asyncio.run(main())
