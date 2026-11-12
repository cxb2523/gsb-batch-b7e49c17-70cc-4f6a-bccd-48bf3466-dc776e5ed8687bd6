import pytest
from codetree.languages.typescript import TypeScriptPlugin

PLUGIN = TypeScriptPlugin()

SAMPLE = b"""\
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  divide(a: number, b: number): number {
    if (b === 0) throw new Error('div by zero');
    return a / b;
  }
}

function helper(): number {
  const calc = new Calculator();
  return calc.add(1, 2);
}

interface Shape {
  area(): number;
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names and "divide" in names


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_finds_interface():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["name"] == "Shape" for item in result)


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, _ = result
    assert "function helper" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
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


# --- Arrow function / const function support (TypeScript) ---

TS_ARROW_SAMPLE = b"""\
export const double = (x: number): number => x * 2;

export const add = (a: number, b: number): number => {
    return a + b;
};

export default function App() {
    return null;
}

const noop = () => {};
"""


def test_ts_skeleton_arrow_function():
    result = PLUGIN.extract_skeleton(TS_ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "double" in names
    assert "add" in names


def test_ts_skeleton_arrow_no_params():
    result = PLUGIN.extract_skeleton(TS_ARROW_SAMPLE)
    noop = next(item for item in result if item["name"] == "noop")
    assert noop["params"] == "()"


def test_ts_skeleton_export_default_function():
    result = PLUGIN.extract_skeleton(TS_ARROW_SAMPLE)
    names = [item["name"] for item in result]
    assert "App" in names


def test_ts_no_duplicates_arrow():
    result = PLUGIN.extract_skeleton(TS_ARROW_SAMPLE)
    keys = [(item["name"], item["line"]) for item in result]
    assert len(keys) == len(set(keys))


def test_ts_extract_symbol_arrow_function():
    result = PLUGIN.extract_symbol_source(TS_ARROW_SAMPLE, "double")
    assert result is not None
    source, _ = result
    assert "double" in source


def test_ts_extract_calls_arrow_function():
    source = b"""\
const process = (data: number[]): number => {
    const total = sum(data);
    return format(total);
};
"""
    calls = PLUGIN.extract_calls_in_function(source, "process")
    assert "sum" in calls
    assert "format" in calls
