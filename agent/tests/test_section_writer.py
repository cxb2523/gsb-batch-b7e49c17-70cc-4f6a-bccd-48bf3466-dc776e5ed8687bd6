"""Offline tests for the section_writer tool.

These tests replace ChatOpenAI with a fake that returns a canned WriteSection
tool call, so no network access or API key is required. They cover:

- rewriting an existing section located by id (never by idx as a list index)
- in-place replacement (no duplicates when the same id is written twice)
- idx-ordered insertion of brand-new sections
"""
import asyncio

import pytest
from langchain_core.messages import AIMessage

from tools import section_writer as sw


class FakeChatOpenAI:
    """Stand-in for ChatOpenAI that always answers with a fixed WriteSection call."""

    response_args = {"title": "T", "content": "C", "footer": "F"}
    last_messages = None

    def __init__(self, *args, **kwargs):
        pass

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages, config=None):
        type(self).last_messages = messages
        return AIMessage(
            content="",
            tool_calls=[{
                "name": "WriteSection",
                "args": dict(type(self).response_args),
                "id": "call_fake",
            }],
        )


@pytest.fixture(autouse=True)
def patch_llm_and_emit(monkeypatch):
    monkeypatch.setattr(sw, "ChatOpenAI", FakeChatOpenAI)

    async def _noop_emit(config, state):
        return None

    monkeypatch.setattr(sw, "copilotkit_emit_state", _noop_emit)


def run_writer(state, **overrides):
    args = {
        "research_query": "test query",
        "section_title": "Section",
        "idx": 0,
        "state": state,
    }
    args.update(overrides)
    return asyncio.run(sw.section_writer.ainvoke(args))


def make_state(sections):
    return {
        "logs": [],
        "sections": sections,
        "sources": {},
        "outline": {},
        "messages": {"HumanMessage": "please rewrite the section"},
    }


def make_section(idx, section_id, title="S", content="body", footer=""):
    return {"id": section_id, "idx": idx, "title": title, "content": content, "footer": footer}


def test_rewrite_locates_section_by_id_not_by_idx():
    """List order deliberately disagrees with idx: indexing by idx would hit
    the wrong section, while lookup by id must hit the right one."""
    intro = make_section(0, "intro1", title="Introduction", content="old intro body")
    methods = make_section(1, "meth01", title="Methods", content="methods body")
    state = make_state([methods, intro])  # sections[0] is NOT the idx-0 section

    FakeChatOpenAI.response_args = {
        "title": "Introduction",
        "content": "new intro body",
        "footer": "[^1]: https://a.example",
    }
    new_state, _ = run_writer(state, section_title="Introduction", idx=0, section_id="intro1")

    sections = new_state["sections"]
    assert len(sections) == 2
    # Replaced in place: same list position, same id, new content.
    assert sections[1]["id"] == "intro1"
    assert sections[1]["idx"] == 0
    assert sections[1]["content"] == "new intro body"
    assert sections[1]["footer"] == "[^1]: https://a.example"
    # The other section is untouched.
    assert sections[0] == methods
    # The rewrite prompt was built from the section with the matching id,
    # not from whatever happens to sit at list position `idx`.
    prompt_text = str(FakeChatOpenAI.last_messages)
    assert "old intro body" in prompt_text
    assert "methods body" not in prompt_text


def test_rewriting_same_id_twice_does_not_duplicate():
    state = make_state([])

    FakeChatOpenAI.response_args = {"title": "S", "content": "v1", "footer": ""}
    state, _ = run_writer(state, section_id="fixed1", idx=0)
    assert [s["id"] for s in state["sections"]] == ["fixed1"]

    FakeChatOpenAI.response_args = {"title": "S", "content": "v2", "footer": ""}
    state, _ = run_writer(state, section_id="fixed1", idx=0)

    assert len(state["sections"]) == 1
    assert state["sections"][0]["id"] == "fixed1"
    assert state["sections"][0]["content"] == "v2"


def test_new_sections_are_inserted_in_idx_order():
    state = make_state([
        make_section(0, "a", title="First"),
        make_section(2, "c", title="Third"),
    ])

    FakeChatOpenAI.response_args = {"title": "Second", "content": "middle", "footer": ""}
    state, _ = run_writer(state, section_title="Second", idx=1)

    assert [s["idx"] for s in state["sections"]] == [0, 1, 2]
    assert state["sections"][1]["title"] == "Second"
    assert state["sections"][1]["id"]  # a fresh id was generated
    assert len({s["id"] for s in state["sections"]}) == 3


def test_new_section_without_id_does_not_clobber_existing_one():
    """A brand-new section (no section_id) must never overwrite the section
    that happens to sit at list position idx."""
    existing = make_section(0, "keep-me", title="Keep", content="keep body")
    state = make_state([existing])

    FakeChatOpenAI.response_args = {"title": "New", "content": "new body", "footer": ""}
    state, _ = run_writer(state, section_title="New", idx=0)

    assert len(state["sections"]) == 2
    by_id = {s["id"]: s for s in state["sections"]}
    assert by_id["keep-me"]["content"] == "keep body"
