"""Tests for token-efficient output modes."""
import pytest
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Compact skeleton ────────────────────────────────────────────────────────

class TestCompactSkeleton:

    def test_default_is_full(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py")
        # Full mode uses "class ... → line"
        assert "→ line" in result

    def test_compact_class(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        assert "cls Calculator:1" in result

    def test_compact_method(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        # Methods use dot prefix, no "(in Parent)"
        assert ".add(self,a,b):" in result

    def test_compact_function(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        assert "fn helper():" in result

    def test_compact_strips_param_spaces(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(a, b, c=1): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_file_skeleton")
        result = fn(file_path="app.py", format="compact")
        assert "(a,b,c=1)" in result

    def test_compact_inline_doc(self, tmp_path):
        (tmp_path / "app.py").write_text('def foo():\n    """A helper."""\n    pass\n')
        fn = _tool(create_server(str(tmp_path)), "get_file_skeleton")
        result = fn(file_path="app.py", format="compact")
        assert "# A helper." in result

    def test_compact_fewer_tokens(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        full = fn(file_path="calculator.py")
        compact = fn(file_path="calculator.py", format="compact")
        # Compact should be meaningfully shorter
        assert len(compact) < len(full) * 0.8

    def test_compact_struct(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_file_skeleton")
        result = fn(file_path="server.go", format="compact")
        assert "str Server:" in result

    def test_compact_interface(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_file_skeleton")
        result = fn(file_path="server.go", format="compact")
        assert "ifc Handler:" in result

    def test_compact_file_not_found(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="nonexistent.py", format="compact")
        assert "not found" in result.lower() or "empty" in result.lower()


class TestCompactSkeletons:

    def test_batch_compact(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py", "main.py"], format="compact")
        assert "cls Calculator:" in result
        assert "fn run():" in result

    def test_batch_default_is_full(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py"])
        assert "→ line" in result


class TestCompactSearch:

    def test_search_compact(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="calc", format="compact")
        assert "cls Calculator:" in result
