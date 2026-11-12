import pytest
from codetree.languages.cpp import CppPlugin

PLUGIN = CppPlugin()

SAMPLE = b"""\
#include <iostream>

/// A calculator class.
class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

struct Point {
    int x;
    int y;
};

namespace math {
    int helper() {
        return 42;
    }
}

int top_func(int x) {
    return x;
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "class"


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["type"] == "method"
    assert add["parent"] == "Calculator"


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    point = next(item for item in result if item["name"] == "Point")
    assert point["type"] == "struct"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "top_func" in names


def test_skeleton_finds_namespace_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "A calculator class."


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "top_func")
    assert result is not None
    source, _ = result
    assert "return x" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source
    assert "add" in source


def test_extract_symbol_returns_none():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    src = b"""\
int process(int x) {
    int result = add(x, 1);
    printf("%d", result);
    return result;
}

int add(int a, int b) { return a + b; }
"""
    calls = PLUGIN.extract_calls_in_function(src, "process")
    assert "add" in calls
    assert "printf" in calls


def test_extract_calls_missing_function():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) >= 1
    assert "<iostream>" in result[0]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"int main() { return 0; }\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"int main() { return 0; }\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"int main( { return 0; }\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []


def test_inherits_c_functions():
    """CppPlugin should handle plain C functions (inheriting C grammar)."""
    src = b"int add(int a, int b) { return a + b; }\n"
    result = PLUGIN.extract_skeleton(src)
    assert any(item["name"] == "add" for item in result)


def test_method_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "int a" in add["params"]


def test_extensions():
    assert ".cpp" in PLUGIN.extensions
    assert ".hpp" in PLUGIN.extensions
    assert ".cc" in PLUGIN.extensions


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
