"""Offline tests for the tavily_search tool's source-title handling.

A fake Tavily client returns self-made results, some of them without titles,
so no network access or API key is required.
"""
import asyncio

import pytest

from tools import tavily_search as ts


class FakeTavilyClient:
    def __init__(self, results):
        self._results = results

    async def search(self, **kwargs):
        return {"results": [dict(r) for r in self._results]}


@pytest.fixture(autouse=True)
def patch_emit(monkeypatch):
    async def _noop_emit(config, state):
        return None

    monkeypatch.setattr(ts, "copilotkit_emit_state", _noop_emit)


def run_search(monkeypatch, state, results):
    monkeypatch.setattr(ts, "tavily_client", FakeTavilyClient(results))
    return asyncio.run(ts.tavily_search.ainvoke({
        "sub_queries": [{"query": "test query", "topic": "general", "days": 7}],
        "state": state,
    }))


def test_sources_without_titles_get_distinct_placeholders_with_url(monkeypatch):
    results = [
        {"url": "https://a.example/1", "content": "alpha", "score": 0.9, "title": ""},
        {"url": "https://b.example/2", "content": "beta", "score": 0.9},  # no title key at all
        {"url": "https://c.example/3", "content": "gamma", "score": 0.9, "title": "Real Title"},
    ]
    state = {"logs": [], "sources": {}}

    new_state, _ = run_search(monkeypatch, state, results)
    sources = new_state["sources"]

    assert set(sources) == {
        "https://a.example/1",
        "https://b.example/2",
        "https://c.example/3",
    }

    title_a = sources["https://a.example/1"]["title"]
    title_b = sources["https://b.example/2"]["title"]

    # Placeholders are recognizable, non-empty and distinguishable.
    assert title_a and title_b
    assert title_a != title_b
    # Each placeholder records the source's own URL.
    assert "https://a.example/1" in title_a
    assert "https://b.example/2" in title_b
    # A real title is left untouched.
    assert sources["https://c.example/3"]["title"] == "Real Title"
    # Every source keeps its url recorded.
    for url, source in sources.items():
        assert source["url"] == url
