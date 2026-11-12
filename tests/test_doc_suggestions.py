"""Tests for auto-documentation suggestions (suggest_docs)."""

import pytest
import tempfile
from pathlib import Path
from codetree.graph.store import GraphStore
from codetree.graph.builder import GraphBuilder
from codetree.graph.queries import GraphQueries
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


@pytest.fixture
def doc_repo():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'class Calculator:\n'
            '    """A calculator class."""\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def sub(self, a, b):\n'
            '        """Subtract b from a."""\n'
            '        return a - b\n'
        )
        (p / "main.py").write_text(
            'from calc import Calculator\n'
            'def main():\n'
            '    c = Calculator()\n'
            '    print(c.add(1, 2))\n'
        )
        (p / "utils.py").write_text(
            'def helper(x, y):\n'
            '    return x + y\n'
            'def _private(z):\n'
            '    return z * 2\n'
        )
        (p / "test_calc.py").write_text(
            'from calc import Calculator\n'
            'def test_add():\n'
            '    c = Calculator()\n'
            '    assert c.add(1, 2) == 3\n'
        )
        indexer = Indexer(str(p))
        indexer.build()
        store = GraphStore(str(p))
        store.open()
        builder = GraphBuilder(str(p), store)
        builder.build(indexer=indexer)
        queries = GraphQueries(store)
        yield queries, store, p, indexer
        store.close()


class TestSuggestDocs:

    def test_finds_undocumented(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer)
        names = [r["name"] for r in results]
        # add has no docstring, sub has docstring
        assert "add" in names
        assert "sub" not in names

    def test_skips_private(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer)
        names = [r["name"] for r in results]
        assert "_private" not in names

    def test_skips_test_functions(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer)
        names = [r["name"] for r in results]
        assert "test_add" not in names

    def test_file_filter(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer, file_path="utils.py")
        for r in results:
            assert r["file"] == "utils.py"

    def test_symbol_filter(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer, symbol_name="helper")
        assert len(results) >= 1
        assert all(r["name"] == "helper" for r in results)

    def test_has_context_fields(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer)
        for r in results:
            assert "qualified_name" in r
            assert "name" in r
            assert "file" in r
            assert "line" in r
            assert "params" in r
            assert "callees" in r
            assert "callers" in r
            assert "variables" in r

    def test_returns_callees(self, doc_repo):
        queries, _, _, indexer = doc_repo
        results = queries.suggest_docs(indexer, symbol_name="main")
        if results:
            r = results[0]
            # main() calls Calculator() and c.add() and print()
            assert len(r["callees"]) > 0

    def test_no_results_when_all_documented(self, doc_repo):
        queries, _, _, indexer = doc_repo
        # sub has docs — should not appear
        results = queries.suggest_docs(indexer, symbol_name="sub")
        assert len(results) == 0


class TestSuggestDocsTool:

    def test_tool_returns_text(self, tmp_path):
        (tmp_path / "calc.py").write_text(
            'def add(a, b):\n    return a + b\n'
        )
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "suggest_docs")
        result = fn()
        assert isinstance(result, str)
        assert "add" in result

    def test_tool_no_undocumented(self, tmp_path):
        (tmp_path / "calc.py").write_text(
            'def add(a, b):\n    """Add two numbers."""\n    return a + b\n'
        )
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "suggest_docs")
        result = fn()
        assert "No undocumented" in result
