import pytest
import subprocess
import tempfile
from pathlib import Path
from codetree.graph.store import GraphStore
from codetree.graph.builder import GraphBuilder
from codetree.graph.queries import GraphQueries
from codetree.server import create_server


def _tool(mcp, name):
    key = f"tool:{name}@"
    return mcp.local_provider._components.get(key).fn


@pytest.fixture
def impact_repo():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'def add(a, b):\n    return a + b\n'
            'def sub(a, b):\n    return a - b\n'
        )
        (p / "checkout.py").write_text(
            'from calc import add\n'
            'def process_order(items):\n'
            '    total = add(0, len(items))\n'
            '    return total\n'
        )
        (p / "api.py").write_text(
            'from checkout import process_order\n'
            'def handle_request(req):\n'
            '    return process_order(req["items"])\n'
        )
        (p / "test_calc.py").write_text(
            'from calc import add\n'
            'def test_add():\n'
            '    assert add(1, 2) == 3\n'
        )
        # Init git repo for diff tests
        subprocess.run(["git", "init"], cwd=tmp, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=tmp, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=tmp, capture_output=True,
                       env={"GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "t@t",
                            "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "t@t",
                            "HOME": tmp, "PATH": "/usr/bin:/bin:/usr/local/bin"})
        store = GraphStore(str(p))
        store.open()
        builder = GraphBuilder(str(p), store)
        builder.build()
        queries = GraphQueries(store)
        yield queries, store, p
        store.close()


class TestChangeImpactBySymbol:
    def test_direct_callers(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add")
        assert "impact" in result
        # process_order calls add, so it should be CRITICAL (hop 1)
        critical_names = [i["name"] for i in result["impact"].get("CRITICAL", [])]
        assert "process_order" in critical_names

    def test_transitive_callers(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add", depth=3)
        # handle_request calls process_order which calls add (hop 2 = HIGH)
        high_names = [i["name"] for i in result["impact"].get("HIGH", [])]
        assert "handle_request" in high_names

    def test_affected_tests(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add")
        test_names = [t["name"] for t in result.get("affected_tests", [])]
        assert "test_add" in test_names

    def test_changed_symbols_info(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add")
        assert len(result["changed_symbols"]) > 0
        changed_names = [s["name"] for s in result["changed_symbols"]]
        assert "add" in changed_names

    def test_no_match_returns_empty(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="nonexistent")
        assert result["changed_symbols"] == []
        assert result["impact"] == {}
        assert result["affected_tests"] == []

    def test_depth_limit(self, impact_repo):
        queries, _, _ = impact_repo
        # depth=1 should only get direct callers, not transitive
        result = queries.change_impact(symbol_query="add", depth=1)
        all_names = []
        for entries in result["impact"].values():
            all_names.extend(e["name"] for e in entries)
        for t in result["affected_tests"]:
            all_names.append(t["name"])
        # handle_request is at hop 2, so it should NOT appear with depth=1
        assert "handle_request" not in all_names

    def test_risk_labels(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add", depth=3)
        # Hop 1 = CRITICAL, hop 2 = HIGH
        if result["impact"].get("CRITICAL"):
            for entry in result["impact"]["CRITICAL"]:
                assert entry["hop"] == 1
        if result["impact"].get("HIGH"):
            for entry in result["impact"]["HIGH"]:
                assert entry["hop"] == 2


class TestChangeImpactByDiff:
    def test_working_tree_changes(self, impact_repo):
        queries, _, repo_dir = impact_repo
        # Modify calc.py (working tree change)
        (repo_dir / "calc.py").write_text(
            'def add(a, b):\n    return a + b + 0  # changed\n'
            'def sub(a, b):\n    return a - b\n'
        )
        result = queries.change_impact(diff_scope="working", root=str(repo_dir))
        assert len(result["changed_symbols"]) > 0

    def test_no_diff_returns_empty(self, impact_repo):
        queries, _, repo_dir = impact_repo
        # No working tree changes
        result = queries.change_impact(diff_scope="working", root=str(repo_dir))
        assert result["changed_symbols"] == []

    def test_diff_scope_without_root_returns_empty(self, impact_repo):
        queries, _, _ = impact_repo
        # diff_scope without root should produce empty result
        result = queries.change_impact(diff_scope="working")
        assert result["changed_symbols"] == []


class TestChangeImpactMCPTool:
    def test_tool_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "calc.py").write_text('def add(a, b):\n    return a + b\n')
            mcp = create_server(str(p))
            fn = _tool(mcp, "get_change_impact")
            result = fn(symbol_query="add")
            assert "impact" in result

    def test_tool_returns_changed_symbols(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "calc.py").write_text('def add(a, b):\n    return a + b\n')
            (p / "main.py").write_text(
                'from calc import add\n'
                'def run():\n'
                '    return add(1, 2)\n'
            )
            mcp = create_server(str(p))
            fn = _tool(mcp, "get_change_impact")
            result = fn(symbol_query="add")
            assert len(result["changed_symbols"]) > 0
            assert result["changed_symbols"][0]["name"] == "add"

    def test_tool_nonexistent_symbol(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "calc.py").write_text('def add(a, b):\n    return a + b\n')
            mcp = create_server(str(p))
            fn = _tool(mcp, "get_change_impact")
            result = fn(symbol_query="nonexistent")
            assert result["changed_symbols"] == []
