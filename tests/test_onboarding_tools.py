import pytest
import tempfile
from pathlib import Path
from codetree.server import create_server


def _tool(mcp, name):
    key = f"tool:{name}@"
    tool = mcp.local_provider._components.get(key)
    return tool.fn


@pytest.fixture
def mcp_with_graph():
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
        (p / "test_calc.py").write_text(
            'def test_add():\n'
            '    assert 1 + 2 == 3\n'
        )
        mcp = create_server(str(p))
        yield mcp


class TestIndexStatus:
    def test_returns_graph_info(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "index_status")
        result = fn()
        assert "files" in result
        assert "symbols" in result
        assert "graph_exists" in result


class TestGetRepositoryMap:
    def test_returns_overview(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "get_repository_map")
        result = fn()
        assert "languages" in result
        assert "entry_points" in result
        assert "hotspots" in result
        assert "start_here" in result
        assert "stats" in result

    def test_max_items(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "get_repository_map")
        result = fn(max_items=1)
        assert len(result["hotspots"]) <= 1


class TestResolveSymbol:
    def test_finds_symbol(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "resolve_symbol")
        result = fn(query="Calculator")
        assert "matches" in result
        assert len(result["matches"]) >= 1
        assert result["matches"][0]["name"] == "Calculator"

    def test_no_match(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "resolve_symbol")
        result = fn(query="nonexistent_xyz")
        assert len(result["matches"]) == 0


class TestSearchGraph:
    def test_search_by_query(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(query="add")
        assert result["total"] > 0

    def test_search_by_kind(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(kind="class")
        assert all(r["kind"] == "class" for r in result["results"])

    def test_pagination(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(limit=1)
        assert len(result["results"]) <= 1
        assert "has_more" in result
