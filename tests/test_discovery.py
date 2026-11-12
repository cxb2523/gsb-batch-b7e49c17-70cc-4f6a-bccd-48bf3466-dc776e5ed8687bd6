"""Tests for test discovery."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Test discovery (indexer) ────────────────────────────────────────────────

class TestFindTests:

    def test_finds_by_naming_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        names = [t["name"] for t in tests]
        assert "test_add" in names

    def test_finds_by_reference(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("""\
from calc import add

def test_addition():
    assert add(1, 2) == 3
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        names = [t["name"] for t in tests]
        assert "test_addition" in names

    def test_finds_by_file_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("def multiply(a, b): return a * b\n")
        (tmp_path / "test_calc.py").write_text("def test_something_unrelated(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "multiply")
        files = [t["file"] for t in tests]
        assert "test_calc.py" in files

    def test_reference_ranked_higher(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("""\
from calc import add

def test_add_works():
    assert add(1, 2) == 3

def test_other_stuff():
    pass
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        # test_add_works has both name match + reference, should rank first
        assert tests[0]["name"] == "test_add_works"

    def test_no_tests_found(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        assert tests == []

    def test_class_test_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("class Calculator:\n    def add(self, a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("class TestCalculator:\n    def test_add(self): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "Calculator")
        names = [t["name"] for t in tests]
        assert "TestCalculator" in names

    def test_has_confidence_field(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        assert all("confidence" in t for t in tests)
        assert all("reason" in t for t in tests)

    def test_js_spec_file(self, tmp_path):
        (tmp_path / "utils.js").write_text("function add(a, b) { return a + b; }\n")
        (tmp_path / "utils.spec.js").write_text("function testAdd() { add(1, 2); }\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("utils.js", "add")
        assert len(tests) >= 1

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("nonexistent.py", "foo")
        assert tests == []


# ─── MCP tool: find_tests ───────────────────────────────────────────────────

class TestFindTestsTool:

    def test_finds_tests(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "test_add" in result

    def test_shows_confidence(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("from calc import add\ndef test_add(): add(1,2)\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "reference" in result.lower() or "name" in result.lower()

    def test_no_tests_message(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "no test" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="ghost.py", symbol_name="foo")
        assert "not found" in result.lower()
