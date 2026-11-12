import pytest
from codetree.languages.c import CPlugin

PLUGIN = CPlugin()

SAMPLE = b"""\
#include <stdio.h>
#include "myheader.h"

/// A calculator.
struct Calculator {
    int value;
};

typedef struct {
    int x;
    int y;
} Point;

int add(int a, int b) {
    return a + b;
}

void process(struct Calculator* calc) {
    int result = add(calc->value, 1);
    printf("%d", result);
}
"""


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "struct"


def test_skeleton_finds_typedef_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    point = next(item for item in result if item["name"] == "Point")
    assert point["type"] == "struct"


def test_skeleton_finds_functions():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "process" in names


def test_skeleton_function_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "int a" in add["params"]
    assert "int b" in add["params"]


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "A calculator."


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, line = result
    assert "int add" in source
    assert "return a + b" in source


def test_extract_symbol_finds_struct():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "process")
    assert "add" in calls
    assert "printf" in calls


def test_extract_calls_missing_function():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "add")
    assert len(usages) >= 2


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) == 2
    assert "<stdio.h>" in result[0]["text"]
    assert "myheader.h" in result[1]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"int main() { return 0; }\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"int main() { return 0; }\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"int main( { return 0; }\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []
    assert PLUGIN.extract_imports(b"") == []
    assert PLUGIN.check_syntax(b"") is False


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
