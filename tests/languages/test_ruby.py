import pytest
from codetree.languages.ruby import RubyPlugin

PLUGIN = RubyPlugin()

SAMPLE = b"""\
require "json"
require_relative "utils"

# Calculator class.
class Calculator
  def initialize(value)
    @value = value
  end

  def self.create(val)
    Calculator.new(val)
  end

  def add(a, b)
    a + b
  end
end

module MathHelpers
  def self.double(x)
    x * 2
  end
end

def helper
  calc = Calculator.new(0)
  calc.add(1, 2)
end
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "class"


def test_skeleton_finds_module():
    result = PLUGIN.extract_skeleton(SAMPLE)
    mod = next(item for item in result if item["name"] == "MathHelpers")
    assert mod["type"] == "class"  # modules treated as class for skeleton


def test_skeleton_finds_instance_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    init = next(item for item in result if item["name"] == "initialize")
    assert init["type"] == "method"
    assert init["parent"] == "Calculator"

    add = next(item for item in result if item["name"] == "add")
    assert add["type"] == "method"
    assert add["parent"] == "Calculator"


def test_skeleton_finds_singleton_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    create = next(item for item in result if item["name"] == "create")
    assert create["type"] == "method"
    assert create["parent"] == "Calculator"


def test_skeleton_finds_module_singleton_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    double = next(item for item in result if item["name"] == "double")
    assert double["type"] == "method"
    assert double["parent"] == "MathHelpers"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    helper = next(item for item in result if item["name"] == "helper")
    assert helper["type"] == "function"
    assert helper["parent"] is None


def test_skeleton_method_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "a" in add["params"]
    assert "b" in add["params"]


def test_skeleton_no_param_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    helper = next(item for item in result if item["name"] == "helper")
    assert helper["params"] == ""


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "Calculator class."


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "class Calculator" in source
    assert "def add" in source


def test_extract_symbol_finds_method():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, _ = result
    assert "def add" in source


def test_extract_symbol_finds_top_level():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, _ = result
    assert "def helper" in source


def test_extract_symbol_returns_none():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "new" in calls
    assert "add" in calls


def test_extract_calls_missing():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 2  # class def + usage in helper


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) == 2
    assert "require" in result[0]["text"]
    assert "json" in result[0]["text"]
    assert "require_relative" in result[1]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"def foo\n  42\nend\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"def foo\n  42\nend\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"def class end end end {\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []
    assert PLUGIN.extract_imports(b"") == []


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
