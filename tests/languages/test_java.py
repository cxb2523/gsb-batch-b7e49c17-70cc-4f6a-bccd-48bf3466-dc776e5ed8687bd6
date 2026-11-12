import pytest
from codetree.languages.java import JavaPlugin

PLUGIN = JavaPlugin()

SAMPLE = b"""\
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
    public int divide(int a, int b) {
        if (b == 0) throw new IllegalArgumentException("div by zero");
        return a / b;
    }
}

public class Helper {
    public int run() {
        Calculator calc = new Calculator();
        return calc.add(1, 2);
    }
}
"""


def test_skeleton_finds_classes():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Calculator" in names
    assert "Helper" in names


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names and "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "class Calculator" in source


def test_extract_symbol_finds_method():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, _ = result
    assert "add" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "run")
    assert "add" in calls or "Calculator" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1


CONSTRUCTOR_SAMPLE = b"""\
public class Service {
    private String name;
    public Service(String name) {
        this.name = name;
        init();
    }
    public void init() {}
}
"""


def test_skeleton_finds_constructor():
    result = PLUGIN.extract_skeleton(CONSTRUCTOR_SAMPLE)
    names = [item["name"] for item in result]
    assert "Service" in names
    ctors = [item for item in result if item["name"] == "Service" and item["parent"] == "Service"]
    assert len(ctors) == 1


def test_extract_calls_in_constructor():
    calls = PLUGIN.extract_calls_in_function(CONSTRUCTOR_SAMPLE, "Service")
    assert "init" in calls
