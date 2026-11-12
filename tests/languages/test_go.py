import pytest
from codetree.languages.go import GoPlugin

PLUGIN = GoPlugin()

SAMPLE = b"""\
package main

type Calculator struct{}

func (c Calculator) Add(a, b int) int {
    return a + b
}

func (c Calculator) Divide(a, b int) int {
    if b == 0 {
        panic("div by zero")
    }
    return a / b
}

func Helper() int {
    calc := Calculator{}
    return calc.Add(1, 2)
}
"""


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Add" in names and "Divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "Add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Helper" in names


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Helper")
    assert result is not None
    source, _ = result
    assert "func Helper" in source


def test_extract_symbol_finds_struct():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "Helper")
    assert "Add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1


INTERFACE_SAMPLE = b"""\
package io

type Reader interface {
    Read(p []byte) (n int, err error)
}

type ReadWriter interface {
    Read(p []byte) (n int, err error)
    Write(p []byte) (n int, err error)
}
"""


def test_skeleton_finds_interface():
    result = PLUGIN.extract_skeleton(INTERFACE_SAMPLE)
    assert any(item["type"] == "interface" and item["name"] == "Reader" for item in result)
    assert any(item["type"] == "interface" and item["name"] == "ReadWriter" for item in result)
