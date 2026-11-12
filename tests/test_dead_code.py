"""Tests for dead code detection."""
import pytest
from codetree.indexer import Indexer


# ─── Definition index ────────────────────────────────────────────────────────

class TestDefinitionIndex:

    def test_definitions_built_from_skeleton(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        # _definitions now uses qualified "file::name" keys (DATA-03 fix)
        all_names = {key.split("::", 1)[1] for key in indexer._definitions}
        assert "Calculator" in all_names
        assert "helper" in all_names
        assert "run" in all_names

    def test_definitions_contain_file_and_line(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        # Use qualified key: "calculator.py::Calculator"
        defs = indexer._definitions["calculator.py::Calculator"]
        assert len(defs) == 1
        assert defs[0][0] == "calculator.py"  # file
        assert isinstance(defs[0][1], int)     # line

    def test_same_name_different_files(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(): pass\n")
        (tmp_path / "b.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        # DATA-03 fix: separate qualified keys instead of merged bare-name entry
        assert "a.py::foo" in indexer._definitions
        assert "b.py::foo" in indexer._definitions
        assert len(indexer._definitions["a.py::foo"]) == 1
        assert len(indexer._definitions["b.py::foo"]) == 1

    def test_methods_included(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        # _definitions uses qualified keys; check via _name_to_qualified
        assert "add" in indexer._name_to_qualified
        assert "divide" in indexer._name_to_qualified


from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Dead code detection (indexer) ───────────────────────────────────────────

class TestFindDeadCode:

    def test_finds_unused_function(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def used():
    return 1

def unused():
    return 2

def main():
    used()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "unused" in dead_names

    def test_used_function_not_dead(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def used():
    return 1

def main():
    used()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "used" not in dead_names

    def test_cross_file_usage_not_dead(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "main.py").write_text("from lib import helper\nx = helper()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "helper" not in dead_names

    def test_main_excluded(self, tmp_path):
        (tmp_path / "app.py").write_text("def main(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "main" not in dead_names

    def test_test_functions_excluded(self, tmp_path):
        (tmp_path / "test_app.py").write_text("def test_something(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "test_something" not in dead_names

    def test_dunder_methods_excluded(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
class Foo:
    def __init__(self): pass
    def __str__(self): return ""
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "__init__" not in dead_names
        assert "__str__" not in dead_names

    def test_init_py_symbols_excluded(self, tmp_path):
        pkg = tmp_path / "pkg"
        pkg.mkdir()
        (pkg / "__init__.py").write_text("def public_api(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "public_api" not in dead_names

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def unused_a(): pass\n")
        (tmp_path / "b.py").write_text("def unused_b(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code(file_path="a.py")
        dead_names = [d["name"] for d in dead]
        assert "unused_a" in dead_names
        assert "unused_b" not in dead_names

    def test_dead_code_returns_type_and_line(self, tmp_path):
        (tmp_path / "app.py").write_text("def unused(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        item = next(d for d in dead if d["name"] == "unused")
        assert item["type"] == "function"
        assert item["line"] == 1
        assert item["file"] == "app.py"

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        assert dead == []

    def test_class_used_cross_file(self, tmp_path):
        (tmp_path / "models.py").write_text("class User:\n    pass\n")
        (tmp_path / "main.py").write_text("from models import User\nu = User()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "User" not in dead_names


# ─── Dead code MCP tool ───────────────────────────────────────────────────────

class TestFindDeadCodeTool:

    def test_finds_dead_function(self, tmp_path):
        (tmp_path / "app.py").write_text("def unused(): return 1\n")
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_dead_code")
        result = fn()
        assert "unused" in result

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def unused_a(): pass\n")
        (tmp_path / "b.py").write_text("def unused_b(): pass\n")
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_dead_code")
        result = fn(file_path="a.py")
        assert "unused_a" in result
        assert "unused_b" not in result

    def test_no_dead_code_message(self, tmp_path):
        (tmp_path / "app.py").write_text("x = 1\n")
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_dead_code")
        result = fn()
        assert "No dead code found" in result

    def test_output_has_summary(self, tmp_path):
        (tmp_path / "app.py").write_text("def unused(): return 1\n")
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_dead_code")
        result = fn()
        assert "Summary:" in result
        assert "dead symbol" in result

    def test_file_not_found(self, tmp_path):
        mcp = create_server(str(tmp_path))
        fn = _tool(mcp, "find_dead_code")
        result = fn(file_path="nonexistent.py")
        assert "File not found" in result
