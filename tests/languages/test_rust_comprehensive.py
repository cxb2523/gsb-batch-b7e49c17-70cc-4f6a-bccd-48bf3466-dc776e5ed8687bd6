"""
Exhaustive tests for the Rust plugin covering every realistic code pattern.

Code style categories:
  - Structs: plain, pub, tuple struct, unit struct
  - Impl blocks: plain methods, pub methods, self/&self/&mut self
  - Trait impl methods
  - Functions: plain, pub, pub(crate), async, const, unsafe
  - Multiple impl blocks for one struct
  - extract_symbol_source and extract_calls_in_function
"""
import pytest
from codetree.languages.rust import RustPlugin

P = RustPlugin()


# ─── Struct styles ─────────────────────────────────────────────────────────────

def test_plain_struct():
    src = b"struct Config { host: String }\n"
    assert any(x["type"] == "struct" and x["name"] == "Config" for x in P.extract_skeleton(src))


def test_pub_struct():
    src = b"pub struct Server { port: u16 }\n"
    assert any(x["name"] == "Server" for x in P.extract_skeleton(src))


def test_struct_with_multiple_fields():
    src = b"pub struct Point {\n    pub x: f64,\n    pub y: f64,\n}\n"
    assert any(x["name"] == "Point" for x in P.extract_skeleton(src))


def test_tuple_struct():
    src = b"struct Wrapper(u32);\n"
    assert any(x["name"] == "Wrapper" for x in P.extract_skeleton(src))


def test_unit_struct():
    src = b"struct Marker;\n"
    assert any(x["name"] == "Marker" for x in P.extract_skeleton(src))


def test_pub_crate_struct():
    src = b"pub(crate) struct Internal { val: i32 }\n"
    assert any(x["name"] == "Internal" for x in P.extract_skeleton(src))


# ─── Impl block methods ────────────────────────────────────────────────────────

def test_method_self_value():
    src = b"struct Dog;\nimpl Dog {\n    fn bark(self) -> String { String::new() }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "bark" and x["parent"] == "Dog" for x in result)


def test_method_self_ref():
    src = b"struct Dog;\nimpl Dog {\n    fn speak(&self) -> &str { \"Woof\" }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "speak" and x["parent"] == "Dog" for x in result)


def test_method_self_mut_ref():
    src = b"struct Counter { n: u32 }\nimpl Counter {\n    fn inc(&mut self) { self.n += 1; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "inc" and x["parent"] == "Counter" for x in result)


def test_pub_method():
    src = b"struct Repo;\nimpl Repo {\n    pub fn find(&self, id: u32) -> Option<String> { None }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "find" and x["parent"] == "Repo" for x in result)


def test_static_method_no_self():
    src = b"struct Builder;\nimpl Builder {\n    fn new() -> Self { Builder }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "new" and x["parent"] == "Builder" for x in result)


def test_async_method():
    src = b"struct Client;\nimpl Client {\n    async fn fetch(&self, url: &str) -> String { String::new() }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "fetch" and x["parent"] == "Client" for x in result)


# ─── Top-level function styles ─────────────────────────────────────────────────

def test_plain_function():
    src = b"fn helper(x: i32) -> i32 { x * 2 }\n"
    assert any(x["name"] == "helper" and x["parent"] is None for x in P.extract_skeleton(src))


def test_pub_function():
    src = b"pub fn greet(name: &str) -> String { format!(\"Hello {}\", name) }\n"
    assert any(x["name"] == "greet" for x in P.extract_skeleton(src))


def test_pub_crate_function():
    src = b"pub(crate) fn internal() {}\n"
    assert any(x["name"] == "internal" for x in P.extract_skeleton(src))


def test_async_function():
    src = b"async fn load(id: u32) -> Option<String> { None }\n"
    assert any(x["name"] == "load" for x in P.extract_skeleton(src))


def test_const_function():
    src = b"const fn max_value() -> u32 { u32::MAX }\n"
    assert any(x["name"] == "max_value" for x in P.extract_skeleton(src))


def test_unsafe_function():
    src = b"unsafe fn raw_ptr(p: *mut u8) {}\n"
    assert any(x["name"] == "raw_ptr" for x in P.extract_skeleton(src))


def test_pub_async_function():
    src = b"pub async fn serve(addr: &str) {}\n"
    assert any(x["name"] == "serve" for x in P.extract_skeleton(src))


# ─── Multiple impl blocks ──────────────────────────────────────────────────────

def test_multiple_impl_blocks():
    src = b"""
struct Engine;

impl Engine {
    fn start(&self) {}
}

impl Engine {
    fn stop(&self) {}
}
"""
    result = P.extract_skeleton(src)
    names = [x["name"] for x in result]
    assert "start" in names
    assert "stop" in names


# ─── Mixed file ────────────────────────────────────────────────────────────────

MIXED_SRC = b"""
pub struct Animal {
    pub name: String,
    kind: String,
}

impl Animal {
    pub fn new(name: &str, kind: &str) -> Self {
        Animal { name: name.to_string(), kind: kind.to_string() }
    }

    pub fn speak(&self) -> String {
        format!("{} says hello", self.name)
    }

    fn classify(&self) -> &str {
        &self.kind
    }
}

pub fn run() {
    let a = Animal::new("Rex", "Dog");
    println!("{}", a.speak());
}
"""


def test_mixed_struct_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "struct" and x["name"] == "Animal" for x in result)


def test_mixed_methods_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "new" and x["parent"] == "Animal" for x in result)
    assert any(x["name"] == "speak" and x["parent"] == "Animal" for x in result)
    assert any(x["name"] == "classify" and x["parent"] == "Animal" for x in result)


def test_mixed_top_level_function():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "run" and x["parent"] is None for x in result)


def test_mixed_sorted_by_line():
    result = P.extract_skeleton(MIXED_SRC)
    lines = [x["line"] for x in result]
    assert lines == sorted(lines)


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_function():
    src = b"fn greet(name: &str) -> String {\n    format!(\"Hello {}\", name)\n}\n"
    source, line = P.extract_symbol_source(src, "greet")
    assert "fn greet" in source
    assert line == 1


def test_symbol_source_struct():
    src = b"pub struct Config {\n    pub host: String,\n    pub port: u16,\n}\n"
    source, line = P.extract_symbol_source(src, "Config")
    assert "Config" in source
    assert line == 1


def test_symbol_source_method_in_impl():
    src = b"struct Calc;\nimpl Calc {\n    fn add(&self, a: i32, b: i32) -> i32 { a + b }\n}\n"
    result = P.extract_symbol_source(src, "add")
    assert result is not None
    source, _ = result
    assert "fn add" in source


def test_symbol_source_none_for_missing():
    src = b"fn foo() {}\n"
    assert P.extract_symbol_source(src, "bar") is None


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_direct_call():
    src = b"fn process() {\n    init();\n    validate();\n}\n"
    calls = P.extract_calls_in_function(src, "process")
    assert "init" in calls
    assert "validate" in calls


def test_calls_method_on_value():
    src = b"fn run(db: &Db) {\n    db.connect();\n    db.query();\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "connect" in calls
    assert "query" in calls


def test_calls_associated_function():
    src = b"fn build() -> Server {\n    Server::new()\n}\n"
    calls = P.extract_calls_in_function(src, "build")
    assert "new" in calls


def test_calls_empty_for_unknown():
    src = b"fn foo() {}\n"
    assert P.extract_calls_in_function(src, "nonexistent") == []
