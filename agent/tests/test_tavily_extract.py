"""Offline tests for the tavily_extract tool's failure handling.

Fake Tavily clients simulate an exception, an empty result set, and a normal
extraction, so no network access or API key is required.
"""
import asyncio

import pytest

from tools import tavily_extract as te


class FailingTavilyClient:
    async def extract(self, urls):
        raise RuntimeError("simulated extract failure")


class EmptyTavilyClient:
    async def extract(self, urls):
        return {"results": []}


class OkTavilyClient:
    async def extract(self, urls):
        return {
            "results": [
                {"url": urls[0], "raw_content": "full page text"},
            ],
            "failed_results": [],
        }


@pytest.fixture(autouse=True)
def patch_emit(monkeypatch):
    async def _noop_emit(config, state):
        return None

    monkeypatch.setattr(te, "copilotkit_emit_state", _noop_emit)


def run_extract(state, urls):
    return asyncio.run(te.tavily_extract.ainvoke({"urls": urls, "state": state}))


def make_state():
    return {
        "logs": [],
        "sources": {
            "https://a.example/1": {"url": "https://a.example/1", "title": "A"},
        },
    }


def test_extract_exception_is_logged_and_reported(monkeypatch):
    monkeypatch.setattr(te, "tavily_client", FailingTavilyClient())
    state = make_state()

    new_state, tool_msg = run_extract(state, ["https://a.example/1"])

    # The tool must not silently return an empty string.
    assert tool_msg
    assert "https://a.example/1" in tool_msg
    assert "No content was extracted" in tool_msg
    # A log entry records the failure for the UI.
    assert any("Failed to extract" in log["message"] for log in new_state["logs"])
    # State sources were not polluted with phantom content.
    assert "raw_content" not in new_state["sources"]["https://a.example/1"]


def test_extract_empty_results_is_logged_and_reported(monkeypatch):
    monkeypatch.setattr(te, "tavily_client", EmptyTavilyClient())
    state = make_state()

    new_state, tool_msg = run_extract(state, ["https://a.example/1"])

    assert tool_msg
    assert "No content was extracted" in tool_msg
    assert any("no content" in log["message"].lower() for log in new_state["logs"])
    assert "raw_content" not in new_state["sources"]["https://a.example/1"]


def test_extract_success_stores_raw_content(monkeypatch):
    monkeypatch.setattr(te, "tavily_client", OkTavilyClient())
    state = make_state()

    new_state, tool_msg = run_extract(state, ["https://a.example/1"])

    assert new_state["sources"]["https://a.example/1"]["raw_content"] == "full page text"
    assert "https://a.example/1" in tool_msg
    assert any("Extracting additional content" in log["message"] for log in new_state["logs"])
