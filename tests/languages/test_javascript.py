import pytest
from codetree.languages.javascript import JavaScriptPlugin

PLUGIN = JavaScriptPlugin()

SAMPLE = b"""\
class Calculator {
  add(a, b) {
    return a + b;
  }
  divide(a, b) {
    if (b === 0) throw new Error('div by zero');
    return a / b;
  }
}

function helper() {
  const calc = new Calculator();
  return calc.add(1, 2);
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_includes_line_numbers():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["line"] == 1


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, line = result
    assert "function helper" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, line = result
    assert "class Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1


# --- Arrow function / const function support ---

ARROW_SAMPLE = b"""\
const greet = (name) => {
  return 'Hello ' + name;
};

const double = x => x * 2;

const noop = () => {};

export const fetchUser = async (id) => {
  return await db.get(id);
};

export default function App() {
  return null;
}

const add = function(a, b) {
  return a + b;
};
"""


def test_skeleton_arrow_function():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "greet" in names


def test_skeleton_arrow_bare_param():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    double = next(item for item in result if item["name"] == "double")
    assert double["params"] == "(x)"


def test_skeleton_arrow_no_params():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    noop = next(item for item in result if item["name"] == "noop")
    assert noop["params"] == "()"


def test_skeleton_exported_arrow():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "fetchUser" in names


def test_skeleton_export_default_function():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "App" in names


def test_skeleton_function_expression():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names


def test_skeleton_no_duplicates():
    result = PLUGIN.extract_skeleton(ARROW_SAMPLE)
    keys = [(item["name"], item["line"]) for item in result]
    assert len(keys) == len(set(keys))


def test_extract_symbol_arrow_function():
    result = PLUGIN.extract_symbol_source(ARROW_SAMPLE, "greet")
    assert result is not None
    source, line = result
    assert "greet" in source


def test_extract_calls_arrow_function():
    source = b"""\
const process = (data) => {
  const x = transform(data);
  return validate(x);
};
"""
    calls = PLUGIN.extract_calls_in_function(source, "process")
    assert "transform" in calls
    assert "validate" in calls
