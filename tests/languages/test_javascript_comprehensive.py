"""
Exhaustive tests for the JavaScript plugin covering every realistic code pattern.

Code style categories:
  - Classes: plain, exported, extends, with static/async/getter/setter methods
  - Functions: declaration, async, generator, export default, named export
  - Arrow functions: plain, bare param, async, exported
  - Function expressions: regular, exported
  - extract_symbol_source for each declaration form
  - extract_calls_in_function: direct, method, constructor, chained
"""
import pytest
from codetree.languages.javascript import JavaScriptPlugin

P = JavaScriptPlugin()


# ─── Class declarations ────────────────────────────────────────────────────────

def test_plain_class():
    src = b"class Foo {}\n"
    assert any(x["type"] == "class" and x["name"] == "Foo" for x in P.extract_skeleton(src))


def test_class_with_extends():
    src = b"class Child extends Parent { method() {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Child" for x in result)
    assert any(x["name"] == "method" and x["parent"] == "Child" for x in result)


def test_exported_class():
    src = b"export class Widget { render() {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "class" and x["name"] == "Widget" for x in result)
    assert any(x["name"] == "render" and x["parent"] == "Widget" for x in result)


def test_static_class_method():
    src = b"class Utils { static format(x) { return x; } }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "format" and x["parent"] == "Utils" for x in result)


def test_async_class_method():
    src = b"class Api { async fetch(url) { return await get(url); } }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "fetch" and x["parent"] == "Api" for x in result)


def test_getter_in_class():
    src = b"class Box { get value() { return this._v; } }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "value" and x["parent"] == "Box" for x in result)


def test_setter_in_class():
    src = b"class Box { set value(v) { this._v = v; } }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "value" and x["parent"] == "Box" for x in result)


def test_constructor_in_class():
    src = b"class Service { constructor(db) { this.db = db; } }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "constructor" and x["parent"] == "Service" for x in result)


# ─── Function declarations ─────────────────────────────────────────────────────

def test_plain_function_declaration():
    src = b"function greet(name) { return 'Hello ' + name; }\n"
    assert any(x["name"] == "greet" and x["parent"] is None for x in P.extract_skeleton(src))


def test_async_function_declaration():
    src = b"async function fetchData(url) { return await get(url); }\n"
    assert any(x["name"] == "fetchData" for x in P.extract_skeleton(src))


def test_generator_function():
    src = b"function* range(n) { for (let i = 0; i < n; i++) yield i; }\n"
    assert any(x["name"] == "range" for x in P.extract_skeleton(src))


def test_export_named_function():
    src = b"export function transform(data) { return data; }\n"
    assert any(x["name"] == "transform" for x in P.extract_skeleton(src))


def test_export_default_function():
    src = b"export default function App() { return null; }\n"
    assert any(x["name"] == "App" for x in P.extract_skeleton(src))


def test_export_generator_function():
    src = b"export function* stream() { yield 1; }\n"
    assert any(x["name"] == "stream" for x in P.extract_skeleton(src))


# ─── Arrow functions and function expressions ──────────────────────────────────

def test_arrow_function_with_params():
    src = b"const add = (a, b) => a + b;\n"
    assert any(x["name"] == "add" for x in P.extract_skeleton(src))


def test_arrow_function_bare_param():
    src = b"const double = x => x * 2;\n"
    result = P.extract_skeleton(src)
    item = next(x for x in result if x["name"] == "double")
    assert item["params"] == "(x)"


def test_arrow_function_no_params():
    src = b"const noop = () => {};\n"
    result = P.extract_skeleton(src)
    item = next(x for x in result if x["name"] == "noop")
    assert item["params"] == "()"


def test_async_arrow_function():
    src = b"const loadUser = async (id) => { return fetch(id); };\n"
    assert any(x["name"] == "loadUser" for x in P.extract_skeleton(src))


def test_exported_arrow_function():
    src = b"export const formatDate = (d) => d.toISOString();\n"
    assert any(x["name"] == "formatDate" for x in P.extract_skeleton(src))


def test_function_expression():
    src = b"const compute = function(x) { return x * x; };\n"
    assert any(x["name"] == "compute" for x in P.extract_skeleton(src))


def test_let_arrow_function():
    src = b"let handler = (e) => e.preventDefault();\n"
    assert any(x["name"] == "handler" for x in P.extract_skeleton(src))


# ─── Mixed file: everything together ──────────────────────────────────────────

MIXED_SRC = b"""\
export class EventEmitter {
    constructor() { this.listeners = {}; }
    on(event, fn) { this.listeners[event] = fn; }
    static create() { return new EventEmitter(); }
}

async function bootstrap(config) {
    const emitter = EventEmitter.create();
    return emitter;
}

export const middleware = (req, res, next) => {
    next();
};

function* idGenerator() {
    let id = 0;
    while (true) yield ++id;
}

export default function App() { return null; }
"""


def test_mixed_file_all_classes_found():
    names = [x["name"] for x in P.extract_skeleton(MIXED_SRC)]
    assert "EventEmitter" in names


def test_mixed_file_all_functions_found():
    names = [x["name"] for x in P.extract_skeleton(MIXED_SRC)]
    assert "bootstrap" in names
    assert "middleware" in names
    assert "idGenerator" in names
    assert "App" in names


def test_mixed_file_methods_with_correct_parent():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "on" and x["parent"] == "EventEmitter" for x in result)
    assert any(x["name"] == "create" and x["parent"] == "EventEmitter" for x in result)


def test_mixed_no_duplicates():
    result = P.extract_skeleton(MIXED_SRC)
    keys = [(x["name"], x["line"]) for x in result]
    assert len(keys) == len(set(keys))


def test_mixed_sorted_by_line():
    result = P.extract_skeleton(MIXED_SRC)
    lines = [x["line"] for x in result]
    assert lines == sorted(lines)


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_function_declaration():
    src = b"function greet(name) {\n    return 'Hello ' + name;\n}\n"
    source, line = P.extract_symbol_source(src, "greet")
    assert "function greet" in source
    assert line == 1


def test_symbol_source_class_includes_body():
    src = b"class Calc {\n    add(a, b) { return a + b; }\n}\n"
    source, line = P.extract_symbol_source(src, "Calc")
    assert "class Calc" in source
    assert "add" in source


def test_symbol_source_exported_class():
    src = b"export class Service {\n    run() {}\n}\n"
    source, line = P.extract_symbol_source(src, "Service")
    assert "Service" in source


def test_symbol_source_arrow_function():
    src = b"const process = (data) => {\n    return transform(data);\n};\n"
    source, line = P.extract_symbol_source(src, "process")
    assert "process" in source


def test_symbol_source_generator():
    src = b"function* gen() {\n    yield 1;\n    yield 2;\n}\n"
    source, line = P.extract_symbol_source(src, "gen")
    assert "function*" in source
    assert line == 1


def test_symbol_source_none_for_missing():
    src = b"function foo() {}\n"
    assert P.extract_symbol_source(src, "bar") is None


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_in_function_declaration():
    src = b"function run() {\n    init();\n    const x = build();\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "init" in calls
    assert "build" in calls


def test_calls_method_on_object():
    src = b"function run() {\n    db.connect();\n    db.query('x');\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "connect" in calls
    assert "query" in calls


def test_calls_constructor_new():
    src = b"function setup() {\n    const s = new Server();\n}\n"
    calls = P.extract_calls_in_function(src, "setup")
    assert "Server" in calls


def test_calls_in_arrow_function():
    src = b"const process = (data) => {\n    const r = transform(data);\n    return validate(r);\n};\n"
    calls = P.extract_calls_in_function(src, "process")
    assert "transform" in calls
    assert "validate" in calls


def test_calls_async_function():
    src = b"async function load() {\n    const data = await fetch('/api');\n    return parse(data);\n}\n"
    calls = P.extract_calls_in_function(src, "load")
    assert "fetch" in calls
    assert "parse" in calls


def test_calls_generator_function():
    src = b"function* produce() {\n    const items = getItems();\n    for (const x of items) yield transform(x);\n}\n"
    calls = P.extract_calls_in_function(src, "produce")
    assert "getItems" in calls
    assert "transform" in calls


def test_calls_empty_for_unknown():
    src = b"function foo() {}\n"
    assert P.extract_calls_in_function(src, "nonexistent") == []
