"""Tests for clone detection."""
import pytest
from codetree.indexer import Indexer
from codetree.languages.python import PythonPlugin
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


PY = PythonPlugin()


# ─── Normalization ────────────────────────────────────────────────────────────

class TestNormalization:

    def test_identical_functions_same_hash(self):
        src = b"def foo(a, b):\n    return a + b\n"
        h1 = PY.normalize_source_for_clones(src)
        h2 = PY.normalize_source_for_clones(src)
        assert h1 == h2

    def test_renamed_vars_same_hash(self):
        src1 = b"def foo(a, b):\n    return a + b\n"
        src2 = b"def bar(x, y):\n    return x + y\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2

    def test_different_logic_different_hash(self):
        src1 = b"def foo(a, b):\n    return a + b\n"
        src2 = b"def bar(a, b):\n    return a * b\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 != h2

    def test_different_strings_same_hash(self):
        src1 = b'def foo():\n    return "hello"\n'
        src2 = b'def bar():\n    return "world"\n'
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2

    def test_different_numbers_same_hash(self):
        src1 = b"def foo():\n    return 42\n"
        src2 = b"def bar():\n    return 99\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2


# ─── Clone detection (indexer) ───────────────────────────────────────────────

class TestDetectClones:

    def test_finds_exact_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert len(clones) >= 1
        group = clones[0]
        names = [f["name"] for f in group["functions"]]
        assert "foo" in names
        assert "bar" in names

    def test_finds_renamed_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def add(x, y):\n    return x + y\n")
        (tmp_path / "b.py").write_text("def sum(a, b):\n    return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert len(clones) >= 1

    def test_no_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a * b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones()
        assert clones == []

    def test_min_lines_filter(self, tmp_path):
        (tmp_path / "a.py").write_text("def f(): pass\n")
        (tmp_path / "b.py").write_text("def g(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones_strict = indexer.detect_clones(min_lines=5)
        assert clones_strict == []
        clones_loose = indexer.detect_clones(min_lines=1)
        assert len(clones_loose) >= 1

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a + b\n")
        (tmp_path / "c.py").write_text("def baz(x):\n    return x * 2\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(file_path="a.py", min_lines=1)
        assert len(clones) >= 1

    def test_clone_group_has_line_count(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert clones[0]["line_count"] >= 1

    def test_single_function_not_clone(self, tmp_path):
        (tmp_path / "a.py").write_text("def unique(x):\n    return x ** 3 + x ** 2 + x\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert clones == []


# ─── MCP tool: detect_clones ─────────────────────────────────────────────────

class TestDetectClonesTool:

    def test_finds_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "clone group" in result.lower() or "Clone" in result
        assert "foo" in result
        assert "bar" in result

    def test_no_clones_message(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a * b\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "no clones" in result.lower()

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(file_path="a.py", min_lines=1)
        assert "foo" in result

    def test_summary(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "summary" in result.lower() or "group" in result.lower()
