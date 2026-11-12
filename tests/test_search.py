"""Tests for structural symbol search."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Search (indexer) ────────────────────────────────────────────────────────

class TestSearchSymbols:

    def test_query_by_name(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(query="calc")
        names = [r["name"] for r in results]
        assert "Calculator" in names

    def test_filter_by_type(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(type="class")
        for r in results:
            assert r["type"] == "class"

    def test_filter_by_parent(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(parent="Calculator")
        for r in results:
            assert r["parent"] is not None
            assert "Calculator" in r["parent"]

    def test_filter_has_doc_true(self, tmp_path):
        (tmp_path / "app.py").write_text('def documented():\n    """Has doc."""\n    pass\n\ndef bare(): pass\n')
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(has_doc=True)
        names = [r["name"] for r in results]
        assert "documented" in names
        assert "bare" not in names

    def test_filter_has_doc_false(self, tmp_path):
        (tmp_path / "app.py").write_text('def documented():\n    """Has doc."""\n    pass\n\ndef bare(): pass\n')
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(has_doc=False)
        names = [r["name"] for r in results]
        assert "bare" in names
        assert "documented" not in names

    def test_filter_by_language(self, multi_lang_repo):
        indexer = Indexer(str(multi_lang_repo))
        indexer.build()
        results = indexer.search_symbols(query="add", language="py")
        for r in results:
            assert r["file"].endswith(".py")

    def test_combined_filters(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(query="add", type="method")
        assert len(results) >= 1
        for r in results:
            assert "add" in r["name"].lower()
            assert r["type"] == "method"

    def test_min_complexity_filter(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def simple():
    return 1

def complex_fn(x):
    if x > 0:
        for i in range(x):
            if i > 10:
                return i
    return 0
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(min_complexity=3)
        names = [r["name"] for r in results]
        assert "complex_fn" in names
        assert "simple" not in names

    def test_no_results(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(query="zzzzz")
        assert results == []

    def test_at_least_one_filter_required(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols()
        assert len(results) >= 1


# ─── MCP tool: search_symbols ────────────────────────────────────────────────

class TestSearchSymbolsTool:

    def test_search_by_name(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="calc")
        assert "Calculator" in result

    def test_search_by_type(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(type="class")
        assert "Calculator" in result

    def test_no_results_message(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "search_symbols")
        result = fn(query="zzzzzz")
        assert "no" in result.lower() and ("found" in result.lower() or "match" in result.lower() or "result" in result.lower())

    def test_shows_doc(self, tmp_path):
        (tmp_path / "app.py").write_text('def foo():\n    """A helper."""\n    pass\n')
        fn = _tool(create_server(str(tmp_path)), "search_symbols")
        result = fn(query="foo")
        assert "A helper." in result

    def test_shows_file_and_line(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="Calculator")
        assert "calculator.py" in result
        assert "line" in result.lower()
