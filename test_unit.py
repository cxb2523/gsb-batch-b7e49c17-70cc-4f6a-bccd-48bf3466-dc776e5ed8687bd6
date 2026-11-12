"""Local tests for the phoneinfoga Apify wrapper.

Run:  python3 test_unit.py
Covers:
  * normalize_number — accepts dirty inputs, returns E.164.
  * build_command    — disabled scanners passed correctly.
  * parse_output     — text parser handles a real phoneinfoga local-only run.
  * parse_output     — partial scan success with missing local fields is explained, not left null.
  * parse_output     — skipped (missing credentials / disabled / unsupported country) vs participating.
  * main()           — numverify auto-skipped without a key is reported as not participating.
  * main()           — a number whose scans all fail produces no dataset row; Actor.fail fires.
  * main()           — one success plus failures: full list in OUTPUT, bounded status message.
  * status message   — counts plus at most three reasons, never truncated at 900 chars.
  * integration      — invokes phoneinfoga against a sample number end-to-end (skipped if absent).

All mocked tests use fabricated phoneinfoga output: no real binary and no network access.
"""

import asyncio
import json
import os
import subprocess
import sys
import types

_apify_stub = types.ModuleType("apify")


class _DummyActor:
    class log:
        @staticmethod
        def info(*a, **k): pass
        @staticmethod
        def warning(*a, **k): pass
        @staticmethod
        def error(*a, **k): pass
        @staticmethod
        def exception(*a, **k): pass


_apify_stub.Actor = _DummyActor
sys.modules["apify"] = _apify_stub

# Make src package importable
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import src.main as main_module  # noqa: E402
from src.main import (  # noqa: E402
    SCANNER_DISABLED,
    SCANNER_NO_RESULT,
    SCANNER_SKIPPED_MISSING_CREDENTIALS,
    SCANNER_SUCCEEDED,
    build_command,
    normalize_number,
    not_charged_note,
    parse_output,
    run_phoneinfoga,
)


def test_normalize_number():
    cases = [
        ("+14155552671", "+14155552671"),
        ("14155552671", "+14155552671"),
        ("+1 (415) 555-2671", "+14155552671"),
        ("+91 98765 43210", "+919876543210"),
        ("  +44 20 7946 0958  ", "+442079460958"),
    ]
    for raw, expected in cases:
        got = normalize_number(raw)
        assert got == expected, f"normalize_number({raw!r}) = {got!r}, expected {expected!r}"
    print("  normalize_number: OK")


def test_build_command():
    cmd = build_command("+14155552671", [])
    assert cmd == ["phoneinfoga", "scan", "-n", "+14155552671"], cmd
    cmd = build_command("+14155552671", ["googlesearch", "numverify"])
    assert cmd == ["phoneinfoga", "scan", "-n", "+14155552671", "-D", "googlesearch", "-D", "numverify"], cmd
    cmd = build_command("+14155552671", ["nonsense", "ovh"])
    assert "-D" in cmd and "ovh" in cmd and "nonsense" not in cmd, cmd
    print("  build_command: OK")


SAMPLE_OUTPUT = """\
Running scan for phone number +14155552671...

Results for googlesearch
Social media:
\tURL: https://www.google.com/search?q=site%3Afacebook.com+intext%3A%2214155552671%22
\tURL: https://www.google.com/search?q=site%3Atwitter.com+intext%3A%2214155552671%22

Disposable providers:
\tURL: https://www.google.com/search?q=site%3Ahs3x.com+intext%3A%2214155552671%22

Results for local
Raw local: 4155552671
Local: (415) 555-2671
E164: +14155552671
International: 14155552671
Country: US

2 scanner(s) succeeded
"""


def test_parse_output():
    rec = parse_output(SAMPLE_OUTPUT, "+14155552671")
    assert rec["target"] == "+14155552671"
    assert rec["country"] == "US"
    assert rec["e164"] == "+14155552671"
    assert rec["local_format"] == "(415) 555-2671"
    assert rec["raw_local"] == "4155552671"
    assert rec["international"] == "14155552671"
    assert rec["scanners_succeeded"] == 2
    assert rec["googlesearch_url_count"] == 3
    assert "Social media" in rec["googlesearch"]
    assert len(rec["googlesearch"]["Social media"]) == 2
    assert "Disposable providers" in rec["googlesearch"]
    # Every field the local scanner should provide was present, so nothing is reported missing.
    assert rec["missing_fields"] == []
    assert rec["missing_reason"] is None
    assert rec["scanner_status"]["local"] == SCANNER_SUCCEEDED
    assert rec["scanner_status"]["googlesearch"] == SCANNER_SUCCEEDED
    # No disable/credential information was supplied to parse_output, so numverify is conservatively
    # reported as having taken part and returned nothing rather than as skipped.
    assert rec["scanner_status"]["numverify"] == SCANNER_NO_RESULT
    print("  parse_output: OK")


# A scan where googlesearch and local succeed but local could only fill part of its block: Country
# and E164 are omitted because phoneinfoga's local scanner uses `console:"...,omitempty"`. Fabricated
# from phoneinfoga v2.11's console writer (lib/output/console.go, lib/remote/local_scanner.go).
PARTIAL_LOCAL_OUTPUT = """\
Running scan for phone number +999999999...

Results for googlesearch
Social media:
\tURL: https://www.google.com/search?q=intext%3A%22999999999%22

Results for local
Raw local: 999999999
Local: 999999999
International: 999999999

2 scanner(s) succeeded
"""


def test_parse_output_partial_success_missing_local_fields():
    rec = parse_output(PARTIAL_LOCAL_OUTPUT, "+999999999")
    assert rec["scanners_succeeded"] == 2
    # The local block ran but reported no country and no E.164.
    assert rec["country"] is None
    assert rec["e164"] is None
    assert rec["international"] == "999999999"
    # The nulls must be explained, not left bare.
    assert rec["missing_fields"] == ["country", "e164"], rec["missing_fields"]
    assert rec["missing_reason"], rec["missing_reason"]
    assert "2 scanner(s) succeeded" in rec["missing_reason"]
    assert "country, e164" in rec["missing_reason"]
    assert rec["scanner_status"]["local"] == SCANNER_SUCCEEDED
    assert rec["scanner_status"]["googlesearch"] == SCANNER_SUCCEEDED
    print("  partial success with missing local fields: OK")


def test_scanner_status_distinguishes_skipped_from_no_result():
    # numverify/googlecse absent because no keys were configured; ovh explicitly disabled; local
    # participates and succeeds; googlesearch participates but errors out.
    output = """\
Running scan for phone number +14155552671...

Results for local
Raw local: 4155552671
Local: (415) 555-2671
E164: +14155552671
International: 14155552671
Country: US

The following scanners returned errors:
googlesearch: context deadline exceeded

1 scanner(s) succeeded
"""
    rec = parse_output(
        output,
        "+14155552671",
        disabled=["numverify", "googlecse", "ovh"],
        missing_credentials=["numverify", "googlecse"],
    )
    status = rec["scanner_status"]
    assert status["numverify"] == SCANNER_SKIPPED_MISSING_CREDENTIALS, status
    assert status["googlecse"] == SCANNER_SKIPPED_MISSING_CREDENTIALS, status
    assert status["ovh"] == SCANNER_DISABLED, status
    assert status["local"] == SCANNER_SUCCEEDED, status
    assert status["googlesearch"] == SCANNER_NO_RESULT, status
    # The upstream error is preserved so "participated but failed" is explainable, not just empty.
    assert rec["scanner_errors"]["googlesearch"] == "context deadline exceeded"
    # Error lines must not leak into a result field.
    assert rec["googlesearch"] == {}
    assert rec["missing_fields"] == []
    print("  scanner_status: OK")


def test_ovh_unsupported_country_is_not_no_result():
    # OVH's DryRun only accepts +33/+32/+44/+34/+41; everywhere else it never runs, which must not
    # look like a scanner that participated and returned nothing.
    rec = parse_output(SAMPLE_OUTPUT.replace("+14155552671", "+919876543210"), "+919876543210")
    assert rec["scanner_status"]["ovh"] == "skipped_unsupported_country", rec["scanner_status"]
    rec = parse_output(SAMPLE_OUTPUT.replace("+14155552671", "+442079460958"), "+442079460958")
    assert rec["scanner_status"]["ovh"] == SCANNER_NO_RESULT, rec["scanner_status"]
    print("  ovh unsupported country: OK")


def test_ansi_coloured_output_is_parsed():
    # fatih/color normally disables colour for a non-TTY pipe, but do not rely on it: if escape
    # codes survive, the "Results for local" header must still be recognised.
    coloured = SAMPLE_OUTPUT.replace("Results for local", "\x1b[1mResults for local\x1b[0m")
    coloured = coloured.replace("Country: US", "\x1b[33mCountry: US\x1b[0m")
    rec = parse_output(coloured, "+14155552671")
    assert rec["country"] == "US", rec["country"]
    assert rec["scanner_status"]["local"] == SCANNER_SUCCEEDED
    print("  ANSI-coloured output: OK")


def test_plugin_scanner_result_is_reported():
    # A phoneinfoga plugin scanner prints its own "Results for <name>" block; it must count as
    # succeeded rather than vanish from scanner_status.
    output = SAMPLE_OUTPUT.replace(
        "2 scanner(s) succeeded", "Results for myplugin\nField: value\n\n3 scanner(s) succeeded"
    )
    rec = parse_output(output, "+14155552671")
    assert rec["scanner_status"]["myplugin"] == SCANNER_SUCCEEDED, rec["scanner_status"]
    assert rec["scanners_succeeded"] == 3
    print("  plugin scanner result: OK")


class FakeActor:
    """Minimal async stand-in for the Apify Actor class, recording everything main() does."""

    log = _DummyActor.log

    def __init__(self, input_data=None):
        self.input_data = input_data or {}
        self.pushed = []
        self.values = {}
        self.status_messages = []
        self.fail_message = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get_input(self):
        return self.input_data

    async def push_data(self, item):
        self.pushed.append(item)

    async def set_value(self, key, value):
        self.values[key] = value

    async def set_status_message(self, message):
        self.status_messages.append(message)

    async def fail(self, status_message=None, **kwargs):
        self.fail_message = status_message


def run_main(fake_actor, fake_scan):
    """Run main() against a FakeActor and a stub run_phoneinfoga.

    ``fake_scan(number, disable, env)`` returns ``(output, rc)`` or raises. Credential environment
    variables are cleared for the duration so the tests are independent of the host environment.
    """
    old_actor = main_module.Actor
    old_scan = main_module.run_phoneinfoga
    credentials = ("NUMVERIFY_API_KEY", "GOOGLECSE_CSE_ID", "GOOGLECSE_API_KEY", "GOOGLECSE_CX", "GOOGLE_API_KEY")
    saved_env = {k: os.environ.pop(k) for k in credentials if k in os.environ}
    main_module.Actor = fake_actor
    main_module.run_phoneinfoga = fake_scan
    try:
        asyncio.run(main_module.main())
    finally:
        main_module.Actor = old_actor
        main_module.run_phoneinfoga = old_scan
        os.environ.update(saved_env)


def test_numverify_skipped_without_key():
    actor = FakeActor({"numbers": ["+14155552671"]})

    def fake_scan(number, disable, env):
        assert "numverify" in disable, disable
        assert "googlecse" in disable, disable
        assert "NUMVERIFY_API_KEY" not in env
        return SAMPLE_OUTPUT.replace("+14155552671", number), 0

    run_main(actor, fake_scan)

    assert len(actor.pushed) == 1, actor.pushed
    record = actor.pushed[0]
    assert record["scanner_status"]["numverify"] == SCANNER_SKIPPED_MISSING_CREDENTIALS
    assert record["scanner_status"]["googlecse"] == SCANNER_SKIPPED_MISSING_CREDENTIALS
    assert record["scanner_status"]["local"] == SCANNER_SUCCEEDED
    assert record["missing_fields"] == []
    summary = actor.values["OUTPUT"]
    assert summary["successful"] == 1
    assert summary["not_charged"] == []
    assert "numverify" in summary["scanners_skipped_for_missing_credentials"]
    assert "googlecse" in summary["scanners_skipped_for_missing_credentials"]
    assert actor.fail_message is None
    assert actor.status_messages, "a successful run should set a status message"
    print("  numverify skipped without key: OK")


def test_explicit_disable_is_not_missing_credentials():
    actor = FakeActor(
        {
            "numbers": ["+14155552671"],
            "disableScanners": ["numverify"],
            "numverifyApiKey": "test-key",
        }
    )

    seen = {}

    def fake_scan(number, disable, env):
        seen["disable"] = list(disable)
        seen["numverify_key"] = env.get("NUMVERIFY_API_KEY")
        return SAMPLE_OUTPUT, 0

    run_main(actor, fake_scan)

    # numverify was explicitly disabled, so it is not auto-disabled; googlecse still is, because
    # no CSE key/CX was supplied.
    assert seen["disable"] == ["numverify", "googlecse"], seen
    assert seen["numverify_key"] == "test-key", seen
    record = actor.pushed[0]
    assert record["scanner_status"]["numverify"] == SCANNER_DISABLED, record["scanner_status"]
    assert record["scanner_status"]["googlecse"] == SCANNER_SKIPPED_MISSING_CREDENTIALS
    # Explicitly disabled is not "skipped for missing credentials".
    assert "numverify" not in actor.values["OUTPUT"]["scanners_skipped_for_missing_credentials"]
    assert "googlecse" in actor.values["OUTPUT"]["scanners_skipped_for_missing_credentials"]
    print("  explicit disable: OK")


def test_all_fail_pushes_nothing():
    actor = FakeActor({"numbers": ["+14155552671", "12345"]})

    def fake_scan(number, disable, env):
        # phoneinfoga runs but no scanner succeeds.
        return "Running scan for phone number {}...\n\n0 scanner(s) succeeded\n".format(number), 0

    run_main(actor, fake_scan)

    assert actor.pushed == [], f"no scanner succeeded, yet rows were pushed: {actor.pushed}"
    assert actor.fail_message is not None, "a run with zero successes must call Actor.fail"
    assert "No number could be scanned" in actor.fail_message
    # The message is bounded on its own, so the [:900] slice in main() never cuts a reason.
    assert len(actor.fail_message) <= 900
    assert not actor.status_messages, "a failed run should not also set a success status message"

    summary = actor.values["OUTPUT"]
    assert summary["successful"] == 0
    assert summary["failed"] == 1
    assert summary["invalid_format"] == 1
    assert len(summary["not_charged"]) == 2
    assert summary["not_charged_by_reason"] == {"invalid_format": 1, "no_scanner_succeeded": 1}
    codes = {entry["number"]: entry["reason_code"] for entry in summary["not_charged"]}
    assert codes["+14155552671"] == "no_scanner_succeeded", codes
    assert codes["12345"] == "invalid_format", codes
    for entry in summary["not_charged"]:
        assert entry["reason"], entry
    print("  all fail pushes nothing: OK")


def test_timeout_and_crash_are_not_charged():
    actor = FakeActor({"numbers": ["+14155552671", "+442079460958"]})

    def fake_scan(number, disable, env):
        if number == "+14155552671":
            raise subprocess.TimeoutExpired(cmd="phoneinfoga", timeout=90)
        raise RuntimeError("boom")

    run_main(actor, fake_scan)

    assert actor.pushed == []
    assert actor.fail_message is not None
    codes = {entry["number"]: entry["reason_code"] for entry in actor.values["OUTPUT"]["not_charged"]}
    assert codes["+14155552671"] == "timeout", codes
    assert codes["+442079460958"] == "crash", codes
    # The exception text is kept, but bounded, in the OUTPUT entry.
    crash = next(e for e in actor.values["OUTPUT"]["not_charged"] if e["reason_code"] == "crash")
    assert "boom" in crash["reason"], crash
    print("  timeout/crash not charged: OK")


def test_status_message_note_is_bounded():
    entries = [
        {"number": f"+1415555{idx:04d}", "reason_code": "no_scanner_succeeded",
         "reason": "no scanner succeeded (phoneinfoga exit 1)"}
        for idx in range(50)
    ]
    note = not_charged_note(entries)
    assert len(note) <= 900, len(note)
    assert "50 not charged" in note
    assert "no_scanner_succeeded=50" in note
    # At most three individual reasons are spelled out; the rest is a pointer to OUTPUT.
    assert note.count(": no scanner succeeded") == 3, note
    assert "(+47 more in OUTPUT)" in note

    # A whole status message built like main() does also stays under the Apify 900-char limit.
    status = f"Scanned 1 of 50 number(s).{note}"
    assert len(status) <= 900, len(status)
    assert not_charged_note([]) == ""

    # Long, attacker-controlled numbers/reasons cannot bloat the note either.
    hostile = [
        {"number": "+" + "9" * 300, "reason_code": "crash", "reason": "x" * 500}
        for _ in range(100)
    ]
    hostile_note = not_charged_note(hostile)
    assert len(f"Scanned 0 of 100 number(s).{hostile_note}") <= 900, len(hostile_note)
    print("  status message note: OK")


def test_partial_success_status_message():
    """One success plus several failures: full list in OUTPUT, counts plus <=3 reasons in status."""
    actor = FakeActor({"numbers": ["+14155552671", "not-a-number", "+442079460958", "+33123456789"]})

    def fake_scan(number, disable, env):
        if number == "+14155552671":
            return SAMPLE_OUTPUT, 0
        if number == "+442079460958":
            raise subprocess.TimeoutExpired(cmd="phoneinfoga", timeout=90)
        return "0 scanner(s) succeeded\n", 1

    run_main(actor, fake_scan)

    assert len(actor.pushed) == 1
    assert actor.pushed[0]["target"] == "+14155552671"
    summary = actor.values["OUTPUT"]
    assert len(summary["not_charged"]) == 3, summary["not_charged"]
    assert summary["not_charged_by_reason"] == {"invalid_format": 1, "no_scanner_succeeded": 1, "timeout": 1}
    assert actor.fail_message is None
    assert len(actor.status_messages) == 1
    message = actor.status_messages[0]
    assert "Scanned 1 of 4" in message
    assert "3 not charged" in message
    assert "timeout=1" in message
    assert len(message) <= 900, len(message)
    print("  partial success status message: OK")


def test_partial_scan_success_is_pushed_with_explained_nulls():
    """A run whose one success lacks local country/e164 still bills one row, with fields explained."""
    actor = FakeActor({"numbers": ["+999999999"]})
    run_main(actor, lambda number, disable, env: (PARTIAL_LOCAL_OUTPUT, 0))

    assert len(actor.pushed) == 1
    record = actor.pushed[0]
    assert record["missing_fields"] == ["country", "e164"]
    assert record["missing_reason"]
    # Records and the OUTPUT summary must be JSON-serialisable for the Apify storages.
    json.dumps(record)
    json.dumps(actor.values["OUTPUT"])
    assert actor.fail_message is None
    assert actor.values["OUTPUT"]["successful"] == 1
    print("  partial scan success pushed with explained nulls: OK")


def test_integration():
    """Real phoneinfoga invocation — skipped if binary missing."""
    try:
        subprocess.run(["phoneinfoga", "version"], capture_output=True, check=True, timeout=5)
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        print("  integration: SKIPPED (phoneinfoga not installed)")
        return

    output, rc = run_phoneinfoga(
        "+14155552671",
        disable=["googlesearch", "ovh", "numverify", "googlecse"],
        env=os.environ.copy(),
        timeout=30,
    )
    rec = parse_output(output, "+14155552671")
    assert rec["country"] == "US", f"expected country=US, got {rec['country']!r}\noutput:\n{output}"
    assert rec["e164"] == "+14155552671", f"expected e164=+14155552671, got {rec['e164']!r}"
    assert rec["scanners_succeeded"] >= 1, f"expected at least 1 scanner ok, got {rec['scanners_succeeded']}"
    assert rec["missing_fields"] == []
    print(f"  integration: OK (country={rec['country']}, scanners_succeeded={rec['scanners_succeeded']})")


if __name__ == "__main__":
    print("Running phoneinfoga wrapper tests...")
    test_normalize_number()
    test_build_command()
    test_parse_output()
    test_parse_output_partial_success_missing_local_fields()
    test_scanner_status_distinguishes_skipped_from_no_result()
    test_ovh_unsupported_country_is_not_no_result()
    test_ansi_coloured_output_is_parsed()
    test_plugin_scanner_result_is_reported()
    test_numverify_skipped_without_key()
    test_explicit_disable_is_not_missing_credentials()
    test_all_fail_pushes_nothing()
    test_timeout_and_crash_are_not_charged()
    test_status_message_note_is_bounded()
    test_partial_success_status_message()
    test_partial_scan_success_is_pushed_with_explained_nulls()
    test_integration()
    print("All tests passed.")
