"""
`POST /v1/translate/file`: one test per format, the failed-segment error, and
each rejection, against the fake OpenAI-compatible server.
"""
import io
import json
import re
from pathlib import Path

import polib
import pytest
from ruamel.yaml import YAML
from starlette.responses import JSONResponse

from tests.fake_openai_server import DETECT_MARKER, SUMMARY_MARKER
from tests.integration.test_v1_api import client, server  # noqa: F401  (fixtures)

FIXTURES = Path(__file__).parent.parent / "fixtures"
FORMATS = FIXTURES / "formats"
SEGMENT = re.compile(r'Translate the following text from .+? to .+?: "(.*)"\Z', re.DOTALL)
USAGE_PER_CALL = 2


def segment_of(payload):
    """The (masked) segment a translation prompt asks for; "" for the file's summary prompt."""
    found = SEGMENT.search(payload["messages"][-1]["content"])
    return found.group(1) if found else ""


def spanish(payload):
    """A fake model that keeps every mask: it prefixes each segment with `ES `."""
    return f"ES {segment_of(payload)}"


def upload(client, path, from_lang="English", to_lang="Spanish", name=None, content=None,  # noqa: F811
           partial_success=None):
    data = path.read_bytes() if content is None else content
    form = {"from_lang": from_lang, "to_lang": to_lang}
    if partial_success is not None:
        form["partial_success"] = "on" if partial_success else "off"
    return client.post(
        "/v1/translate/file",
        data=form,
        files={"file": (name or path.name, io.BytesIO(data), "application/octet-stream")},
    )


def translation_calls(server):  # noqa: F811
    return [r for r in server.requests
            if not any(marker in r["json"]["messages"][0]["content"] for marker in (DETECT_MARKER, SUMMARY_MARKER))]


def summary_calls(server):  # noqa: F811
    return [r for r in server.requests if SUMMARY_MARKER in r["json"]["messages"][0]["content"]]


def assert_report(body, segments, server, file_format):  # noqa: F811
    # a file of more than one segment adds one summary call, for the context every segment gets
    calls = segments + 1
    assert body["format"] == file_format
    assert body["from_lang"] == "English" and body["to_lang"] == "Spanish"
    assert body["report"] == {
        "segments": segments,
        "model": "translate-model",
        "usage": {"prompt_tokens": calls, "completion_tokens": calls, "total_tokens": calls * USAGE_PER_CALL},
    }
    assert len(translation_calls(server)) == segments
    assert len(summary_calls(server)) == 1


# One test per format

def test_json_file_comes_back_with_keys_order_and_placeholders(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "app.json")

    assert response.status_code == 200
    body = response.json()
    translated = json.loads(body["content"])
    assert list(translated) == list(json.loads((FORMATS / "app.json").read_text()))
    assert translated["greeting"] == "ES Hello {name}, you have %d messages"
    assert translated["menu"] == {"items": ["ES Open", "ES Save as <b>new</b>", 7], "zebra": "ES Last key first"}
    assert translated["count"] == 3 and translated["blank"] == "" and translated["nothing"] is None
    assert_report(body, 6, server, "json")


def test_yaml_file_keeps_comments_anchors_and_placeholders(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "app.yaml")

    assert response.status_code == 200
    body = response.json()
    content = body["content"]
    assert "# Strings for the settings page" in content
    assert re.search(r"^title: ES My App +# shown in the header$", content, re.MULTILINE)
    data = YAML().load(content)
    assert data["greeting"] == "ES Hello {name}"
    assert data["menu"]["items"] == ["ES Open", "ES Save as <b>new</b>"]
    assert data["help"] == "ES First line\nSecond line with %s\n"
    assert body["report"]["segments"] == len(translation_calls(server))
    assert body["report"]["model"] == "translate-model"


def test_po_file_fills_msgstr_and_plural_forms(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "app.po")

    assert response.status_code == 200
    body = response.json()
    po = polib.pofile(body["content"])
    entries = {(e.msgctxt, e.msgid): e for e in po}
    assert entries[(None, "Hello %s")].msgstr == "ES Hello %s"
    assert entries[(None, "Hello %s")].comment == "Extracted comment"
    assert entries[("menu", "Open")].msgstr == "ES Open"
    assert entries[(None, "%d file")].msgstr_plural == {0: "ES %d file", 1: "ES %d files"}
    assert "#~ msgid \"Gone\"" in body["content"]
    assert_report(body, 5, server, "po")


def test_markdown_file_keeps_code_blocks_and_links(server, client):  # noqa: F811
    server.respond = spanish
    source = (FIXTURES / "sample.md").read_text()
    response = upload(client, FIXTURES / "sample.md")

    assert response.status_code == 200
    body = response.json()
    content = body["content"]
    blocks = re.compile(r"^```.*?^```$", re.DOTALL | re.MULTILINE)
    assert blocks.findall(content) == blocks.findall(source)
    assert content.startswith("---\ntitle: Keep me\n---\n\n# ES Getting *started*\n")
    assert '[docs](https://example.com/docs "Docs")' in content
    assert_report(body, 10, server, "markdown")


def test_html_file_keeps_tags_and_attributes(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FIXTURES / "sample.html")

    assert response.status_code == 200
    body = response.json()
    content = body["content"]
    assert '<h1 class="big" title="Do not touch">ES Welcome</h1>' in content
    assert '<a href="https://example.com/?a=1&amp;b=2">ES docs</a>' in content
    assert '<script>var greeting = "Hello <b>";</script>' in content
    assert_report(body, 8, server, "html")


def test_srt_file_keeps_cue_numbers_and_timings(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "sample.srt")

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == (
        "1\n00:00:01,000 --> 00:00:03,500\nES Hello, {name}!\n\n"
        "2\n00:00:04,000 --> 00:00:06,250\nES See you soon.\nTake care.\n"
    )
    assert_report(body, 2, server, "srt")


def test_each_srt_cue_is_sent_with_the_file_summary_and_its_neighbouring_cues(server, client):  # noqa: F811
    def spanish_with_terms(payload):
        if SUMMARY_MARKER in payload["messages"][0]["content"]:
            return "A night chase. Terms: Scales -> Scales (a name; keep it)."
        return spanish(payload)

    server.respond = spanish_with_terms
    response = upload(client, FORMATS / "recurring_name.srt")

    assert response.status_code == 200
    body = response.json()
    cues = [block.split("\n", 2) for block in body["content"].strip().split("\n\n")]
    assert [cue[0] for cue in cues] == ["1", "2", "3", "4", "5", "6"]
    assert cues[0][1] == "00:00:01,000 --> 00:00:02,500" and cues[5][1] == "00:00:11,000 --> 00:00:12,500"
    assert cues[3][2] == "ES She poured it, {name}."

    # the summary is asked once, of every cue's source text
    (summary,) = summary_calls(server)
    asked = summary["json"]["messages"][-1]["content"]
    assert all(line in asked for line in ["Good night, Scales.", "She poured it, {name}.", "Scales..."])
    assert "names" in asked

    sources = ["Good night, Scales.", "Where is the blade?", "Get him, Scales! Come on!",
               "She poured it, ⟦0⟧.", "Run!", "Scales..."]
    raw = [text.replace("⟦0⟧", "{name}") for text in sources]
    prompts = {segment_of(r["json"]): r["json"]["messages"][-1]["content"] for r in translation_calls(server)}
    assert sorted(prompts) == sorted(sources)
    for i, source in enumerate(sources):
        prompt = prompts[source]
        # context comes first; the line to translate is still the last thing in the prompt, alone
        assert prompt.endswith(f'Translate the following text from English to Spanish: "{source}"')
        assert "A night chase. Terms: Scales -> Scales (a name; keep it)." in prompt
        before, after = raw[max(0, i - 2):i], raw[i + 1:i + 3]
        for neighbour in before + after:
            assert f'"{neighbour}"' in prompt
        for far in raw[:max(0, i - 2)] + raw[i + 3:]:
            assert f'"{far}"' not in prompt
        assert ("Earlier segments" in prompt) == bool(before)
        assert ("Later segments" in prompt) == bool(after)


def test_a_file_of_one_segment_gets_no_summary_call(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "app.json", content=b'{"a": "Hello"}')

    assert json.loads(response.json()["content"]) == {"a": "ES Hello"}
    assert summary_calls(server) == []
    (call,) = translation_calls(server)
    assert call["json"]["messages"][-1]["content"] == 'Translate the following text from English to Spanish: "Hello"'


def test_a_failed_summary_fails_the_file_before_any_segment(server, client):  # noqa: F811
    def no_summary(payload):
        return "" if SUMMARY_MARKER in payload["messages"][0]["content"] else spanish(payload)

    server.respond = no_summary
    response = upload(client, FORMATS / "sample.srt")

    assert response.status_code == 500
    assert response.json()["error"]["message"] == "The model returned an empty document summary."
    assert translation_calls(server) == []


def test_srt_cue_over_the_line_limit_is_rewrapped(server, client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LLM_SRT_MAX_LINE_CHARS", "10")
    server.respond = spanish
    response = upload(client, FORMATS / "sample.srt")

    assert response.status_code == 200
    lines = response.json()["content"].split("\n")
    assert "00:00:01,000 --> 00:00:03,500" in lines
    assert all(len(line) <= 30 for line in lines)  # the timing line is the longest
    assert all(len(line) <= 10 for line in lines if line and "-->" not in line)


# A failed segment fails the whole file

def test_one_broken_placeholder_returns_an_error_listing_that_segment_and_no_file(server, client):  # noqa: F811
    def renames_the_placeholder(payload):
        segment = segment_of(payload)
        return "Hola {nombre}" if "⟦0⟧" in segment else f"ES {segment}"

    server.respond = renames_the_placeholder
    response = upload(client, FORMATS / "broken_placeholder.json")

    assert response.status_code == 500
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert error["type"] == "api_error"
    assert error["segment_errors"] == [{
        "segment": 1,
        "type": "api_error",
        "message": "Segment /greeting: the translation did not keep its placeholders "
                   "(missing {name}; unexpected {nombre}).",
    }]
    assert error["message"].startswith("1 of 2 segments failed, so the file was not translated")
    assert "content" not in json.dumps(body) and "Goodbye" not in json.dumps(body)


def test_model_errors_list_every_failed_segment(server, client):  # noqa: F811
    def fails_the_second_cue(payload):
        if "See you soon" in segment_of(payload):
            return JSONResponse({"error": {"message": "rate limited"}}, status_code=429)
        return spanish(payload)

    server.respond = fails_the_second_cue
    response = upload(client, FORMATS / "sample.srt")

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["type"] == "rate_limit_error"
    assert [e["segment"] for e in error["segment_errors"]] == [2]
    assert error["message"].startswith("1 of 2 segments failed")


# Languages

def test_auto_detect_runs_once_for_the_whole_file(server, client):  # noqa: F811
    server.respond = lambda payload: (
        "English" if DETECT_MARKER in payload["messages"][0]["content"] else spanish(payload)
    )
    response = upload(client, FORMATS / "sample.srt", from_lang="Auto-detect")

    assert response.status_code == 200
    body = response.json()
    assert body["from_lang"] == "Auto-detect"
    detections = [r for r in server.requests if DETECT_MARKER in r["json"]["messages"][0]["content"]]
    assert len(detections) == 1
    assert body["report"]["usage"]["total_tokens"] == 4 * USAGE_PER_CALL  # detect, summary, two cues
    assert "ES See you soon." in body["content"]


def test_same_language_returns_the_file_unchanged_without_a_model(server, client):  # noqa: F811
    response = upload(client, FORMATS / "app.json", to_lang="english")

    assert response.status_code == 200
    body = response.json()
    assert json.loads(body["content"]) == json.loads((FORMATS / "app.json").read_text())
    assert body["report"]["model"] is None
    assert body["report"]["usage"]["total_tokens"] == 0
    assert server.requests == []


def test_segment_of_placeholders_only_is_not_sent_to_the_model(server, client):  # noqa: F811
    server.respond = spanish
    content = b'{"count": "{count}", "label": "%d items", "title": "Inbox"}'
    response = upload(client, FORMATS / "app.json", content=content)

    assert response.status_code == 200
    assert json.loads(response.json()["content"]) == {"count": "{count}", "label": "ES %d items", "title": "ES Inbox"}
    assert len(translation_calls(server)) == 2


def test_surrounding_whitespace_of_a_value_is_kept(server, client):  # noqa: F811
    server.respond = lambda payload: f"  ES {segment_of(payload).strip()}  "
    response = upload(client, FORMATS / "app.json", content=b'{"a": "  Hello\\n"}')

    assert json.loads(response.json()["content"]) == {"a": "  ES Hello\n"}


# Rejections

def test_unsupported_format_is_a_400_without_the_file_name(server, client):  # noqa: F811
    response = upload(client, FORMATS / "app.json", name="secret-plans.txt")

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["type"] == "bad_request_error"
    assert "secret-plans" not in json.dumps(response.json())
    assert server.requests == []


def test_malformed_file_is_a_400(server, client):  # noqa: F811
    response = upload(client, FORMATS / "app.json", content=b'{"a": ')

    assert response.status_code == 400
    assert response.json()["error"]["message"].startswith("The JSON file is malformed")
    assert server.requests == []


def test_file_over_the_byte_limit_is_a_413(server, client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LLM_MAX_FILE_BYTES", "10")
    response = upload(client, FORMATS / "app.json")

    assert response.status_code == 413
    assert response.json()["error"]["message"] == "The file is larger than LLM_MAX_FILE_BYTES (10 bytes) allows."
    assert server.requests == []


def test_file_with_too_many_segments_is_a_413(server, client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LLM_MAX_SEGMENTS", "2")
    response = upload(client, FORMATS / "app.json")

    assert response.status_code == 413
    assert response.json()["error"]["message"] == "The file has 6 segments, more than LLM_MAX_SEGMENTS (2) allows."
    assert server.requests == []


def test_file_without_segments_comes_back_unchanged(server, client):  # noqa: F811
    response = upload(client, FORMATS / "app.json", content=b'{"count": 3}\n')

    assert response.status_code == 200
    assert response.json()["content"] == '{"count": 3}\n'
    assert response.json()["report"]["segments"] == 0
    assert server.requests == []


def test_missing_target_language_is_a_422(server, client):  # noqa: F811
    response = client.post(
        "/v1/translate/file", data={"from_lang": "English"},
        files={"file": ("app.json", b'{"a": "b"}', "application/json")},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("raw", [b"", b"\xff\xfe\x00bad"])
def test_empty_or_binary_file_is_a_400(server, client, raw):  # noqa: F811
    response = upload(client, FORMATS / "app.json", content=raw)
    assert response.status_code == 400


def test_unexpected_error_in_a_segment_is_a_500_that_hides_its_details(server, client):  # noqa: F811
    from unittest.mock import patch
    with patch("llm_translate.services.llm_translator.LLMTranslator.translate_structured",
               side_effect=RuntimeError("secret internals")):
        response = upload(client, FORMATS / "sample.srt")

    assert response.status_code == 500
    assert response.json()["error"]["type"] == "unknown_error"
    assert "secret internals" not in response.text


# Partial success (`partial_success=on`, SRT only)

# Three cues; the number lines deliberately skip, so a failure can report the file's own number.
PARTIAL_SRT = (
    "1\n00:00:01,000 --> 00:00:02,000\nHello, {name}!\n\n"
    "3\n00:00:03,000 --> 00:00:04,000\nSee you soon.\n\n"
    "5\n00:00:05,000 --> 00:00:06,000\nTake care.\n"
)


def _fail_the_first_two_cues(payload):
    """Cue 1 loses its placeholder; cue 2 hits a model error; the rest translate normally."""
    segment = segment_of(payload)
    if "⟦0⟧" in segment:
        return "Hola {nombre}"
    if "See you soon" in segment:
        return JSONResponse({"error": {"message": "rate limited"}}, status_code=429)
    return spanish(payload)


def test_partial_success_translates_the_good_cues_and_keeps_the_failed_ones(server, client):  # noqa: F811
    server.respond = _fail_the_first_two_cues
    response = upload(client, FORMATS / "sample.srt", content=PARTIAL_SRT.encode(), partial_success=True)

    assert response.status_code == 200
    body = response.json()
    # the output is still a legal SRT: every number and timing line is kept verbatim
    assert body["content"] == (
        "1\n00:00:01,000 --> 00:00:02,000\nHello, {name}!\n\n"
        "3\n00:00:03,000 --> 00:00:04,000\nSee you soon.\n\n"
        "5\n00:00:05,000 --> 00:00:06,000\nES Take care.\n"
    )
    assert body["replaced_segments"] == [3]
    assert body["failed_segments"] == [
        {
            "segment": 1,
            "type": "api_error",
            "message": "Segment 1: the translation did not keep its placeholders "
                       "(missing {name}; unexpected {nombre}).",
            "cue_number": "1",
        },
        {
            "segment": 2, "type": "rate_limit_error",
            "message": "Model endpoint rate limit exceeded. Please try again later.", "cue_number": "3",
        },
    ]
    # only the good cue's translation call is billed; the summary still ran once
    assert body["report"]["usage"]["total_tokens"] == (1 + 1) * USAGE_PER_CALL
    assert len(translation_calls(server)) == 3 and len(summary_calls(server)) == 1


def test_partial_success_rewraps_the_translated_cues_under_the_line_limit(server, client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LLM_SRT_MAX_LINE_CHARS", "10")
    server.respond = _fail_the_first_two_cues
    response = upload(client, FORMATS / "sample.srt", content=PARTIAL_SRT.encode(), partial_success=True)

    assert response.status_code == 200
    lines = response.json()["content"].split("\n")
    # the kept cues come back with their source lines untouched (and are not re-wrapped)...
    assert "Hello, {name}!" in lines and "See you soon." in lines
    # ...only the translated cue is re-wrapped to the limit
    translated = [line for line in lines if line.startswith("ES ") or line == "care."]
    assert translated and all(len(line) <= 10 for line in translated)


def test_partial_success_with_all_cues_failing_is_an_error_and_returns_no_file(server, client):  # noqa: F811
    def break_every_cue(payload):
        if SUMMARY_MARKER in payload["messages"][0]["content"]:
            return "A short document."
        # the first cue loses its placeholder; the second comes back empty, which is never a translation
        return "Hola {nombre}" if "⟦0⟧" in segment_of(payload) else ""

    server.respond = break_every_cue
    response = upload(client, FORMATS / "sample.srt", partial_success=True)

    assert response.status_code == 500
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert [entry["segment"] for entry in error["segment_errors"]] == [1, 2]
    assert error["segment_errors"][0]["message"].startswith("Segment 1: the translation did not keep its placeholders")
    assert error["message"].startswith("2 of 2 segments failed, so the file was not translated")
    assert "content" not in json.dumps(body) and "Hello" not in json.dumps(body)


def test_partial_success_off_fails_the_whole_file_as_before(server, client):  # noqa: F811
    server.respond = _fail_the_first_two_cues

    # the option sent explicitly as off, and omitted entirely, behave the same
    for kwargs in ({"partial_success": False}, {}):
        server.requests.clear()
        response = upload(client, FORMATS / "sample.srt", content=PARTIAL_SRT.encode(), **kwargs)

        # the whole file takes the first failed cue's status: the placeholder loss is a 500
        assert response.status_code == 500
        body = response.json()
        assert set(body) == {"error"}
        assert [entry["segment"] for entry in body["error"]["segment_errors"]] == [1, 2]
        assert body["error"]["message"].startswith("2 of 3 segments failed, so the file was not translated")
        assert "replaced_segments" not in json.dumps(body) and "failed_segments" not in json.dumps(body)
        assert "ES Take care." not in response.text


def test_partial_success_on_a_normal_file_reports_every_cue_replaced(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "sample.srt", partial_success=True)

    assert response.status_code == 200
    body = response.json()
    assert body["replaced_segments"] == [1, 2]
    assert body["failed_segments"] == []
    assert body["content"] == (
        "1\n00:00:01,000 --> 00:00:03,500\nES Hello, {name}!\n\n"
        "2\n00:00:04,000 --> 00:00:06,250\nES See you soon.\nTake care.\n"
    )


def test_partial_success_is_rejected_for_other_formats(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "app.json", partial_success=True)

    assert response.status_code == 400
    assert response.json()["error"]["type"] == "invalid_request_error"
    assert "SRT" in response.json()["error"]["message"]
    assert server.requests == []


def test_partial_success_off_omits_the_partial_fields(server, client):  # noqa: F811
    server.respond = spanish
    response = upload(client, FORMATS / "sample.srt", partial_success=False)

    assert response.status_code == 200
    assert "replaced_segments" not in response.json() and "failed_segments" not in response.json()


def test_partial_success_with_review_only_reviews_the_translated_cues(server, client):  # noqa: F811
    def reviewable(payload):
        segment = segment_of(payload)
        if "⟦0⟧" in segment:
            return "Hola {nombre}"
        return spanish(payload)

    server.respond = reviewable
    response = client.post(
        "/v1/translate/file",
        data={"from_lang": "English", "to_lang": "Spanish", "partial_success": "on", "review": "on"},
        files={"file": ("sample.srt", io.BytesIO(PARTIAL_SRT.encode()), "application/octet-stream")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["replaced_segments"] == [2, 3]
    assert [failure["cue_number"] for failure in body["failed_segments"]] == ["1"]
    # the kept cue is untouched, and the review section exists for the two translated cues
    assert body["content"].startswith("1\n00:00:01,000 --> 00:00:02,000\nHello, {name}!\n")
    assert "review" in body["report"]


def test_partial_success_same_language_returns_the_file_without_a_model(server, client):  # noqa: F811
    server.respond = _fail_the_first_two_cues
    response = upload(client, FORMATS / "sample.srt", to_lang="english", partial_success=True)

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == (FORMATS / "sample.srt").read_text()
    assert body["replaced_segments"] == [] and body["failed_segments"] == []
    assert body["report"]["model"] is None and body["report"]["usage"]["total_tokens"] == 0
    assert server.requests == []
