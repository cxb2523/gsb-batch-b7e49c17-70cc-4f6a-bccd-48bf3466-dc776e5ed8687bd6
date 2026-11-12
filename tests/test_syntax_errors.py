"""Tests for syntax error detection across all languages."""
import pytest
from codetree.languages.python import PythonPlugin
from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin
from codetree.languages.c import CPlugin
from codetree.languages.cpp import CppPlugin
from codetree.languages.ruby import RubyPlugin
from codetree.server import create_server
from codetree.indexer import Indexer

PY = PythonPlugin()
JS = JavaScriptPlugin()
TS = TypeScriptPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()
CC = CPlugin()
CPP = CppPlugin()
RB = RubyPlugin()

ALL_PLUGINS = [PY, JS, TS, GO, RS, JV, CC, CPP, RB]


# --- Clean files (no errors) ---

def test_python_clean_no_errors():
    assert PY.check_syntax(b"def foo(): pass\n") is False


def test_js_clean_no_errors():
    assert JS.check_syntax(b"function foo() {}\n") is False


def test_ts_clean_no_errors():
    assert TS.check_syntax(b"function foo(): void {}\n") is False


def test_go_clean():
    assert GO.check_syntax(b"package main\nfunc main() {}\n") is False


def test_rust_clean():
    assert RS.check_syntax(b"fn main() {}\n") is False


def test_java_clean():
    assert JV.check_syntax(b"class Foo {}\n") is False


# --- Syntax errors ---

def test_python_syntax_error():
    assert PY.check_syntax(b"def foo(:\n    pass\n") is True


def test_js_syntax_error():
    assert JS.check_syntax(b"function foo({ {}\n") is True


def test_ts_syntax_error():
    assert TS.check_syntax(b"function foo({ {}\n") is True


def test_go_syntax_error():
    assert GO.check_syntax(b"package main\nfunc main( {}\n") is True


def test_rust_syntax_error():
    assert RS.check_syntax(b"fn main( {}\n") is True


def test_java_syntax_error():
    assert JV.check_syntax(b"class Foo { void bar( {} }\n") is True


def test_c_clean():
    assert CC.check_syntax(b"int main() { return 0; }\n") is False


def test_c_syntax_error():
    assert CC.check_syntax(b"int main( { return 0; }\n") is True


def test_cpp_clean():
    assert CPP.check_syntax(b"int main() { return 0; }\n") is False


def test_cpp_syntax_error():
    assert CPP.check_syntax(b"int main( { return 0; }\n") is True


def test_ruby_clean():
    assert RB.check_syntax(b"def foo\n  42\nend\n") is False


def test_ruby_syntax_error():
    assert RB.check_syntax(b"def class end end end {\n") is True


# --- Edge cases ---

@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_no_errors(plugin):
    """Empty files should not report syntax errors."""
    assert plugin.check_syntax(b"") is False


# --- Indexer has_errors field ---

def test_indexer_sets_has_errors_true(tmp_path):
    """FileEntry.has_errors should be True for files with syntax errors."""
    (tmp_path / "broken.py").write_text("def foo(:\n    pass\n")
    indexer = Indexer(str(tmp_path))
    indexer.build()
    entry = indexer._index.get("broken.py")
    assert entry is not None
    assert entry.has_errors is True


def test_indexer_sets_has_errors_false(tmp_path):
    """FileEntry.has_errors should be False for clean files."""
    (tmp_path / "clean.py").write_text("def foo(): pass\n")
    indexer = Indexer(str(tmp_path))
    indexer.build()
    entry = indexer._index.get("clean.py")
    assert entry is not None
    assert entry.has_errors is False


# --- MCP tool skeleton warning ---

def test_skeleton_warns_on_syntax_error(tmp_path):
    (tmp_path / "broken.py").write_text("def foo(:\n    pass\n\ndef bar():\n    return 1\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="broken.py")
    assert "syntax error" in output.lower()
    # bar should still appear in the skeleton despite the error
    assert "bar" in output


def test_skeleton_no_warning_on_clean(tmp_path):
    (tmp_path / "clean.py").write_text("def foo(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="clean.py")
    assert "syntax error" not in output.lower()


def test_skeleton_warning_with_js(tmp_path):
    # Use a mild syntax error that still allows bar to be parsed
    (tmp_path / "broken.js").write_text("function foo() { return ; ; ; }\nvar = ;\nfunction bar() {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="broken.js")
    assert "syntax error" in output.lower()
    assert "bar" in output
