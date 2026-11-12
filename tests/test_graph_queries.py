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
def built_graph():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'class Calculator:\n'
            '    """A calculator class."""\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def sub(self, a, b):\n'
            '        return a - b\n'
        )
        (p / "main.py").write_text(
            'from calc import Calculator\n'
            'def main():\n'
            '    c = Calculator()\n'
            '    print(c.add(1, 2))\n'
        )
        (p / "utils.py").write_text(
            'def add(a, b):\n'
            '    return a + b\n'
            'def helper():\n'
            '    pass\n'
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


class TestRepositoryMap:
    def test_returns_languages(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.repository_map()
        assert "py" in result["languages"]

    def test_returns_entry_points(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.repository_map()
        assert any("main" in ep for ep in result["entry_points"])

    def test_returns_hotspots(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.repository_map()
        assert len(result["hotspots"]) > 0

    def test_returns_stats(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.repository_map()
        assert result["stats"]["files"] > 0
        assert result["stats"]["symbols"] > 0

    def test_max_items_limits_output(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.repository_map(max_items=2)
        assert len(result["hotspots"]) <= 2


class TestResolveSymbol:
    def test_exact_match(self, built_graph):
        queries, _, _, _ = built_graph
        results = queries.resolve_symbol("Calculator")
        assert len(results) >= 1
        assert results[0].name == "Calculator"

    def test_disambiguates_by_callers(self, built_graph):
        queries, _, _, _ = built_graph
        # "add" exists in both calc.py and utils.py
        results = queries.resolve_symbol("add")
        assert len(results) >= 2

    def test_kind_filter(self, built_graph):
        queries, _, _, _ = built_graph
        results = queries.resolve_symbol("add", kind="method")
        assert all(r.kind == "method" for r in results)

    def test_path_hint(self, built_graph):
        queries, _, _, _ = built_graph
        results = queries.resolve_symbol("add", path_hint="utils.py")
        assert results[0].file_path == "utils.py"

    def test_non_test_preferred(self, built_graph):
        queries, _, _, _ = built_graph
        results = queries.resolve_symbol("add")
        # Non-test results should come before test results
        non_test = [r for r in results if not r.is_test]
        if non_test:
            assert not results[0].is_test


class TestSearchGraph:
    def test_search_by_name(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.search_graph(query="calc")
        assert result["total"] > 0

    def test_search_by_kind(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.search_graph(kind="class")
        assert all(r["kind"] == "class" for r in result["results"])

    def test_search_by_file_pattern(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.search_graph(file_pattern="calc")
        assert all("calc" in r["file_path"] for r in result["results"])

    def test_search_pagination(self, built_graph):
        queries, _, _, _ = built_graph
        r1 = queries.search_graph(limit=2, offset=0)
        r2 = queries.search_graph(limit=2, offset=2)
        if r1["total"] > 2:
            assert r1["results"] != r2["results"]

    def test_search_by_min_degree(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.search_graph(min_degree=1)
        # All results should have at least 1 connection
        for r in result["results"]:
            assert r["in_degree"] + r["out_degree"] >= 1


# ─── Hot path detection ─────────────────────────────────────────────────────

class TestHotPaths:

    def test_returns_results(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=10)
        assert isinstance(results, list)

    def test_results_have_required_fields(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=10)
        if results:
            r = results[0]
            assert "qualified_name" in r
            assert "name" in r
            assert "file" in r
            assert "complexity" in r
            assert "inbound_calls" in r
            assert "hot_score" in r

    def test_sorted_by_hot_score(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=10)
        if len(results) > 1:
            scores = [r["hot_score"] for r in results]
            assert scores == sorted(scores, reverse=True)

    def test_top_n_limits_results(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=1)
        assert len(results) <= 1

    def test_excludes_zero_callers(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=100)
        for r in results:
            assert r["inbound_calls"] > 0

    def test_hot_score_formula(self, built_graph):
        queries, _, _, indexer = built_graph
        results = queries.find_hot_paths(indexer, top_n=10)
        for r in results:
            assert r["hot_score"] == r["complexity"] * r["inbound_calls"]


class TestHotPathsTool:

    def test_tool_returns_text(self, tmp_path):
        (tmp_path / "calc.py").write_text(
            'def add(a, b):\n    return a + b\n'
        )
        (tmp_path / "main.py").write_text(
            'from calc import add\ndef main():\n    add(1, 2)\n'
        )
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_hot_paths")
        result = fn(top_n=5)
        assert isinstance(result, str)


# ─── Dependency graph visualization ─────────────────────────────────────────

class TestDependencyGraph:

    def test_mermaid_format(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.get_dependency_graph(format="mermaid")
        if result["edges"] > 0:
            assert "graph LR" in result["content"]
            assert "-->" in result["content"]

    def test_list_format(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.get_dependency_graph(format="list")
        if result["edges"] > 0:
            assert "→" in result["content"]

    def test_returns_node_edge_counts(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.get_dependency_graph()
        assert "nodes" in result
        assert "edges" in result
        assert isinstance(result["nodes"], int)
        assert isinstance(result["edges"], int)

    def test_file_filter(self, built_graph):
        queries, _, _, _ = built_graph
        result = queries.get_dependency_graph(file_path="main.py")
        # Should only include edges involving main.py
        if result["edges"] > 0:
            content = result["content"]
            assert "main.py" in content

    def test_no_imports_returns_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "a.py").write_text("def foo(): pass\n")
            store = GraphStore(str(p))
            store.open()
            indexer = Indexer(str(p))
            indexer.build()
            builder = GraphBuilder(str(p), store)
            builder.build(indexer=indexer)
            queries = GraphQueries(store)
            result = queries.get_dependency_graph()
            assert result["edges"] == 0
            store.close()


class TestDependencyGraphTool:

    def test_tool_returns_mermaid(self, tmp_path):
        (tmp_path / "calc.py").write_text('def add(a, b):\n    return a + b\n')
        (tmp_path / "main.py").write_text('from calc import add\ndef main():\n    add(1, 2)\n')
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "get_dependency_graph")
        result = fn()
        assert isinstance(result, str)
        assert "files" in result
