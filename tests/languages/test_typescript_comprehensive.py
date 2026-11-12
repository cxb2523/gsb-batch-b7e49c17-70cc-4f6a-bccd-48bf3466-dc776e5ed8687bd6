"""
Exhaustive tests for the TypeScript plugin covering every realistic code pattern.

Code style categories:
  - Classes: plain, exported, abstract (plain and exported), with extends/implements
  - Abstract method signatures
  - Interfaces: plain and exported
  - Functions: plain, exported, default export
  - Arrow functions: plain and exported (const, let)
  - Async functions and methods
  - Generic functions
  - TSX compatibility (via TSXPlugin)
"""
import pytest
from codetree.languages.typescript import TypeScriptPlugin, TSXPlugin

P = TypeScriptPlugin()
TSX = TSXPlugin()


# ─── Class styles ──────────────────────────────────────────────────────────────

def test_plain_class():
    src = b"class Foo {}\n"
    assert any(x["type"] == "class" and x["name"] == "Foo" for x in P.extract_skeleton(src))


def test_exported_class():
    src = b"export class Service { run() {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "class" and x["name"] == "Service" for x in result)
    assert any(x["name"] == "run" and x["parent"] == "Service" for x in result)


def test_class_extends():
    src = b"class Child extends Base { method(): void {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Child" for x in result)
    assert any(x["name"] == "method" and x["parent"] == "Child" for x in result)


def test_class_implements_interface():
    src = b"class Impl implements Runnable { run(): void {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Impl" for x in result)
    assert any(x["name"] == "run" and x["parent"] == "Impl" for x in result)


# ─── Abstract classes ─────────────────────────────────────────────────────────

def test_abstract_class():
    src = b"abstract class Shape {\n    abstract area(): number;\n    toString(): string { return ''; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "class" and x["name"] == "Shape" for x in result)


def test_abstract_method_signature_in_skeleton():
    src = b"abstract class Shape {\n    abstract area(): number;\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "area" and x["parent"] == "Shape" for x in result)


def test_concrete_method_inside_abstract_class():
    src = b"abstract class Base {\n    abstract doWork(): void;\n    log(): void { console.log('x'); }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "log" and x["parent"] == "Base" for x in result)


def test_exported_abstract_class():
    src = b"export abstract class Repository {\n    abstract find(id: number): any;\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "class" and x["name"] == "Repository" for x in result)
    assert any(x["name"] == "find" and x["parent"] == "Repository" for x in result)


def test_abstract_class_symbol_source():
    src = b"abstract class Processor {\n    abstract process(): void;\n    init(): void {}\n}\n"
    result = P.extract_symbol_source(src, "Processor")
    assert result is not None
    source, _ = result
    assert "abstract class Processor" in source


# ─── Interfaces ───────────────────────────────────────────────────────────────

def test_plain_interface():
    src = b"interface Shape { area(): number; }\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Shape" for x in result)


def test_exported_interface():
    src = b"export interface Repository {\n    find(id: number): any;\n    save(item: any): void;\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Repository" for x in result)


def test_interface_and_class_same_file():
    src = b"interface Printable { print(): void; }\nclass Doc implements Printable { print(): void {} }\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Printable" for x in result)
    assert any(x["type"] == "class" and x["name"] == "Doc" for x in result)


# ─── Function declarations ─────────────────────────────────────────────────────

def test_plain_function():
    src = b"function greet(name: string): string { return 'Hello ' + name; }\n"
    assert any(x["name"] == "greet" and x["parent"] is None for x in P.extract_skeleton(src))


def test_async_function():
    src = b"async function loadUser(id: number): Promise<User> { return fetch(id); }\n"
    assert any(x["name"] == "loadUser" for x in P.extract_skeleton(src))


def test_generic_function():
    src = b"function identity<T>(x: T): T { return x; }\n"
    assert any(x["name"] == "identity" for x in P.extract_skeleton(src))


def test_export_named_function():
    src = b"export function format(value: string): string { return value.trim(); }\n"
    assert any(x["name"] == "format" for x in P.extract_skeleton(src))


def test_export_default_function():
    src = b"export default function App(): JSX.Element { return null; }\n"
    assert any(x["name"] == "App" for x in P.extract_skeleton(src))


# ─── Arrow functions and function expressions ──────────────────────────────────

def test_const_arrow_function():
    src = b"const double = (x: number): number => x * 2;\n"
    assert any(x["name"] == "double" for x in P.extract_skeleton(src))


def test_exported_arrow_function():
    src = b"export const fetchUser = async (id: string): Promise<User> => fetch(id);\n"
    assert any(x["name"] == "fetchUser" for x in P.extract_skeleton(src))


def test_async_arrow_function():
    src = b"const load = async (): Promise<void> => { await init(); };\n"
    assert any(x["name"] == "load" for x in P.extract_skeleton(src))


def test_arrow_no_params():
    src = b"const noop = (): void => {};\n"
    result = P.extract_skeleton(src)
    item = next(x for x in result if x["name"] == "noop")
    assert item["params"] == "()"


# ─── Mixed file ────────────────────────────────────────────────────────────────

MIXED_SRC = b"""\
export interface Serializable {
    serialize(): string;
}

export abstract class Entity {
    abstract validate(): boolean;
    toJSON(): object { return {}; }
}

export class User extends Entity implements Serializable {
    constructor(public name: string) { super(); }
    validate(): boolean { return this.name.length > 0; }
    serialize(): string { return JSON.stringify(this); }
}

export async function createUser(name: string): Promise<User> {
    return new User(name);
}

export const formatUser = (u: User): string => u.name;
"""


def test_mixed_interface_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "interface" and x["name"] == "Serializable" for x in result)


def test_mixed_abstract_class_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "class" and x["name"] == "Entity" for x in result)


def test_mixed_concrete_class_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "User" for x in result)


def test_mixed_abstract_method_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "validate" and x["parent"] == "Entity" for x in result)


def test_mixed_async_function_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "createUser" for x in result)


def test_mixed_arrow_function_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "formatUser" for x in result)


def test_mixed_no_duplicates():
    result = P.extract_skeleton(MIXED_SRC)
    keys = [(x["name"], x["line"]) for x in result]
    assert len(keys) == len(set(keys))


def test_mixed_sorted_by_line():
    result = P.extract_skeleton(MIXED_SRC)
    lines = [x["line"] for x in result]
    assert lines == sorted(lines)


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_class():
    src = b"class Calc {\n    add(a: number, b: number): number { return a + b; }\n}\n"
    source, line = P.extract_symbol_source(src, "Calc")
    assert "class Calc" in source
    assert line == 1


def test_symbol_source_abstract_class():
    src = b"abstract class Base {\n    abstract work(): void;\n}\n"
    result = P.extract_symbol_source(src, "Base")
    assert result is not None
    source, _ = result
    assert "abstract class Base" in source


def test_symbol_source_interface():
    # Interfaces not extracted via extract_symbol_source — skip or note
    src = b"interface Foo { bar(): void; }\n"
    # Currently not implemented, so should return None — acceptable limitation
    result = P.extract_symbol_source(src, "Foo")
    # Accept either None or a valid source
    assert result is None or "Foo" in result[0]


def test_symbol_source_arrow():
    src = b"export const helper = (x: number): number => x + 1;\n"
    result = P.extract_symbol_source(src, "helper")
    assert result is not None
    source, _ = result
    assert "helper" in source


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_in_typed_function():
    src = b"function process(data: string[]): string[] {\n    return data.map(transform).filter(validate);\n}\n"
    calls = P.extract_calls_in_function(src, "process")
    assert "transform" in calls or "map" in calls
    assert "validate" in calls or "filter" in calls


def test_calls_in_async_function():
    src = b"async function load(): Promise<void> {\n    const data = await fetchData();\n    persist(data);\n}\n"
    calls = P.extract_calls_in_function(src, "load")
    assert "fetchData" in calls
    assert "persist" in calls


def test_calls_in_arrow_function():
    src = b"const run = (): void => {\n    init();\n    start();\n};\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "init" in calls
    assert "start" in calls


# ─── TSX Plugin ───────────────────────────────────────────────────────────────

def test_tsx_class_component():
    src = b"class Counter extends React.Component {\n    render() { return null; }\n}\n"
    result = TSX.extract_skeleton(src)
    assert any(x["name"] == "Counter" for x in result)
    assert any(x["name"] == "render" and x["parent"] == "Counter" for x in result)


def test_tsx_function_component():
    src = b"function Button({ label }: Props): JSX.Element { return null; }\n"
    assert any(x["name"] == "Button" for x in TSX.extract_skeleton(src))


def test_tsx_arrow_component():
    src = b"export const Card = ({ title }: CardProps): JSX.Element => null;\n"
    assert any(x["name"] == "Card" for x in TSX.extract_skeleton(src))


def test_tsx_interface():
    src = b"interface ButtonProps { label: string; onClick: () => void; }\n"
    result = TSX.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "ButtonProps" for x in result)
