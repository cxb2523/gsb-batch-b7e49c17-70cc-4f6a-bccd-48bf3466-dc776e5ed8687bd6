"""Tests for blast radius / impact analysis."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Call graph infrastructure ────────────────────────────────────────────────

class TestCallGraph:

    def test_call_graph_built(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        assert indexer._call_graph_built is True

    def test_forward_graph_has_calls(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        # helper() calls Calculator() and calc.add()
        key = "calculator.py::helper"
        assert key in indexer._call_graph
        callees = indexer._call_graph[key]
        assert any("add" in c for c in callees)

    def test_reverse_graph_has_callers(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        # add is called by helper
        # Find any reverse graph key containing "add"
        add_keys = [k for k in indexer._reverse_graph if "add" in k]
        assert len(add_keys) >= 1
        callers = set()
        for k in add_keys:
            callers.update(indexer._reverse_graph[k])
        assert any("helper" in c for c in callers)

    def test_idempotent(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        graph1 = dict(indexer._call_graph)
        indexer._ensure_call_graph()
        graph2 = dict(indexer._call_graph)
        assert graph1 == graph2

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        indexer._ensure_call_graph()
        assert indexer._call_graph_built is True


# ─── Blast radius (indexer) ──────────────────────────────────────────────────

class TestGetBlastRadius:

    def test_direct_callers(self, tmp_path):
        (tmp_path / "lib.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "app.py").write_text("from lib import add\ndef main(): return add(1, 2)\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("lib.py", "add")
        caller_names = [c["name"] for c in result["callers"]]
        assert "main" in caller_names

    def test_transitive_callers(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        (tmp_path / "top.py").write_text("from mid import middle\ndef top(): return middle()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("core.py", "base")
        caller_names = [c["name"] for c in result["callers"]]
        assert "middle" in caller_names
        assert "top" in caller_names

    def test_callers_have_depth(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        (tmp_path / "top.py").write_text("from mid import middle\ndef top(): return middle()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("core.py", "base")
        depths = {c["name"]: c["depth"] for c in result["callers"]}
        assert depths["middle"] == 1
        assert depths["top"] == 2

    def test_dependencies(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "app.py").write_text("from lib import helper\ndef process(): return helper()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "process")
        call_names = [c["name"] for c in result["calls"]]
        assert "helper" in call_names

    def test_leaf_function_no_calls(self, tmp_path):
        (tmp_path / "app.py").write_text("def leaf(): return 42\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "leaf")
        assert result["calls"] == []

    def test_cycle_handling(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def ping():
    pong()

def pong():
    ping()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "ping")
        # Should not infinite loop; pong calls ping but we handle cycles
        caller_names = [c["name"] for c in result["callers"]]
        assert "pong" in caller_names

    def test_symbol_not_found(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "nonexistent")
        assert result["callers"] == []
        assert result["calls"] == []


# ─── MCP tool: get_blast_radius ──────────────────────────────────────────────

class TestGetBlastRadiusTool:

    def test_shows_callers(self, tmp_path):
        (tmp_path / "lib.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "app.py").write_text("from lib import add\ndef main(): return add(1, 2)\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="lib.py", symbol_name="add")
        assert "main" in result
        assert "depth 1" in result.lower() or "Direct" in result

    def test_shows_dependencies(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "app.py").write_text("from lib import helper\ndef process(): return helper()\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="app.py", symbol_name="process")
        assert "helper" in result

    def test_leaf_function_output(self, tmp_path):
        (tmp_path / "app.py").write_text("def leaf(): return 42\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="app.py", symbol_name="leaf")
        assert "no callers" in result.lower() or "0 functions" in result.lower() or "none" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="ghost.py", symbol_name="foo")
        assert "not found" in result.lower()

    def test_summary_line(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="core.py", symbol_name="base")
        assert "impact" in result.lower() or "summary" in result.lower() or "affected" in result.lower()
