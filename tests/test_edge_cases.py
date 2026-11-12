"""Edge case tests that apply across all languages.

Covers: empty files, comment-only files, syntax errors, deeply nested code,
files with no definitions, and special characters in symbol names.
"""
import pytest
from codetree.languages.python import PythonPlugin
from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin


PY = PythonPlugin()
JS = JavaScriptPlugin()
TS = TypeScriptPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()

ALL_PLUGINS = [PY, JS, TS, GO, RS, JV]


# --- Empty files ---

@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_skeleton(plugin):
    """Empty file should return empty skeleton, not crash."""
    assert plugin.extract_skeleton(b"") == []


@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_symbol_source(plugin):
    """Empty file should return None for any symbol."""
    assert plugin.extract_symbol_source(b"", "anything") is None


@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_calls(plugin):
    """Empty file should return empty call list."""
    assert plugin.extract_calls_in_function(b"", "anything") == []


@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_usages(plugin):
    """Empty file should return empty usages list."""
    assert plugin.extract_symbol_usages(b"", "anything") == []


# --- Comment-only files ---

def test_python_comment_only():
    src = b"# This file is intentionally left blank\n# Another comment\n"
    assert PY.extract_skeleton(src) == []


def test_js_comment_only():
    src = b"// This file is intentionally left blank\n/* block comment */\n"
    assert JS.extract_skeleton(src) == []


def test_go_comment_only():
    src = b"package main\n\n// just a comment\n"
    skel = GO.extract_skeleton(src)
    assert skel == []


def test_rust_comment_only():
    src = b"// just a comment\n/// doc comment\n"
    assert RS.extract_skeleton(src) == []


def test_java_comment_only():
    src = b"// just a comment\n/* block */\n"
    assert JV.extract_skeleton(src) == []


# --- Files with only imports/use statements ---

def test_python_imports_only():
    src = b"import os\nfrom pathlib import Path\n"
    assert PY.extract_skeleton(src) == []


def test_js_imports_only():
    src = b"import { foo } from './foo';\nconst x = require('bar');\n"
    assert JS.extract_skeleton(src) == []


def test_go_imports_only():
    src = b'package main\n\nimport "fmt"\n'
    assert GO.extract_skeleton(src) == []


def test_rust_use_only():
    src = b"use std::io::Read;\nuse std::collections::HashMap;\n"
    assert RS.extract_skeleton(src) == []


# --- Syntax errors / incomplete code ---

def test_python_syntax_error_partial():
    """Incomplete Python code should return whatever is parseable."""
    src = b"def foo(:\n    pass\n\ndef bar():\n    return 1\n"
    skel = PY.extract_skeleton(src)
    # bar should still be found even if foo is broken
    names = [s["name"] for s in skel]
    assert "bar" in names


def test_js_syntax_error_partial():
    """JS with a syntax error in one function — other functions should still parse."""
    src = b"function foo() { return ; ; ; }\nfunction bar() { return 2; }\n"
    skel = JS.extract_skeleton(src)
    names = [s["name"] for s in skel]
    assert "bar" in names
    assert "foo" in names


def test_rust_syntax_error_partial():
    src = b"fn broken( { }\nfn valid() -> i32 { 42 }\n"
    skel = RS.extract_skeleton(src)
    names = [s["name"] for s in skel]
    assert "valid" in names


# --- Nonexistent symbol lookup ---

@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_nonexistent_symbol_source(plugin):
    """Looking up a symbol that doesn't exist should return None, not crash."""
    src = b"x = 1\n" if plugin is PY else b"const x = 1;\n"
    assert plugin.extract_symbol_source(src, "nonexistent_symbol_xyz") is None


@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_nonexistent_function_calls(plugin):
    """Getting calls for a nonexistent function should return empty list."""
    src = b"x = 1\n" if plugin is PY else b"const x = 1;\n"
    assert plugin.extract_calls_in_function(src, "nonexistent_fn") == []


# --- Deeply nested code ---

def test_python_nested_functions():
    """Nested functions inside functions should not appear in top-level skeleton."""
    src = b"""\
def outer():
    def inner():
        def deep():
            return 1
        return deep()
    return inner()
"""
    skel = PY.extract_skeleton(src)
    names = [s["name"] for s in skel if s["type"] == "function"]
    assert "outer" in names
    # inner and deep are nested, not top-level
    assert "inner" not in names
    assert "deep" not in names


def test_python_nested_function_symbol_source():
    """extract_symbol_source should still find nested functions."""
    src = b"""\
def outer():
    def inner():
        return 1
    return inner()
"""
    result = PY.extract_symbol_source(src, "inner")
    assert result is not None
    source, _ = result
    assert "def inner" in source


def test_js_nested_functions_in_function():
    """Nested function declarations in JS."""
    src = b"""\
function outer() {
    function inner() {
        return 1;
    }
    return inner();
}
"""
    skel = JS.extract_skeleton(src)
    names = [s["name"] for s in skel if s["type"] == "function"]
    assert "outer" in names
    # inner is nested inside outer, not top-level
    assert "inner" not in names


# --- Multiple symbols with same name ---

def test_python_same_name_different_classes():
    """Two methods named 'run' in different classes."""
    src = b"""\
class A:
    def run(self):
        pass

class B:
    def run(self):
        pass
"""
    skel = PY.extract_skeleton(src)
    runs = [s for s in skel if s["name"] == "run"]
    assert len(runs) == 2
    parents = {s["parent"] for s in runs}
    assert parents == {"A", "B"}


def test_java_same_method_different_classes():
    """Two methods named 'execute' in different Java classes."""
    src = b"""\
class TaskA {
    void execute() {}
}
class TaskB {
    void execute() {}
}
"""
    skel = JV.extract_skeleton(src)
    execs = [s for s in skel if s["name"] == "execute"]
    assert len(execs) == 2
    parents = {s["parent"] for s in execs}
    assert parents == {"TaskA", "TaskB"}


# --- Unicode in source code ---

def test_python_unicode_strings():
    """Files with unicode string content should parse fine."""
    src = "def greet():\n    return '你好世界'\n".encode("utf-8")
    skel = PY.extract_skeleton(src)
    assert any(s["name"] == "greet" for s in skel)


def test_js_unicode_strings():
    src = "function greet() { return '日本語'; }\n".encode("utf-8")
    skel = JS.extract_skeleton(src)
    assert any(s["name"] == "greet" for s in skel)


# --- Large parameter lists ---

def test_python_many_params():
    src = b"def many(a, b, c, d, e, f, g, h, i, j, k=None, **kw):\n    pass\n"
    skel = PY.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "many")
    assert "a" in fn["params"]
    assert "**kw" in fn["params"]


def test_java_generic_params():
    """Methods with generic parameters should parse correctly."""
    src = b"""\
class Container {
    <T extends Comparable<T>> T max(T a, T b) {
        return a.compareTo(b) > 0 ? a : b;
    }
}
"""
    skel = JV.extract_skeleton(src)
    assert any(s["name"] == "max" for s in skel)
