"""
Exhaustive tests for the Go plugin covering every realistic code pattern.

Code style categories:
  - Structs: plain, exported, unexported
  - Interfaces: plain, exported, multiple methods
  - Methods: value receiver, pointer receiver
  - Functions: plain, exported, init, main, variadic
  - Multiple types in one file
  - extract_symbol_source and extract_calls_in_function
"""
import pytest
from codetree.languages.go import GoPlugin

P = GoPlugin()


# ─── Struct styles ─────────────────────────────────────────────────────────────

def test_plain_struct():
    src = b"package main\n\ntype Config struct {\n\tHost string\n}\n"
    assert any(x["type"] == "struct" and x["name"] == "Config" for x in P.extract_skeleton(src))


def test_exported_struct():
    src = b"package main\n\ntype Server struct { port int }\n"
    assert any(x["name"] == "Server" for x in P.extract_skeleton(src))


def test_unexported_struct():
    src = b"package main\n\ntype connection struct { host string }\n"
    assert any(x["name"] == "connection" for x in P.extract_skeleton(src))


def test_empty_struct():
    src = b"package main\n\ntype Empty struct{}\n"
    assert any(x["name"] == "Empty" for x in P.extract_skeleton(src))


def test_struct_embedding():
    src = b"package main\n\ntype Writer struct {\n\tBase\n\tbuf []byte\n}\n"
    assert any(x["name"] == "Writer" for x in P.extract_skeleton(src))


# ─── Interface styles ──────────────────────────────────────────────────────────

def test_plain_interface():
    src = b"package main\n\ntype Reader interface {\n\tRead(p []byte) (int, error)\n}\n"
    assert any(x["type"] == "interface" and x["name"] == "Reader" for x in P.extract_skeleton(src))


def test_exported_interface():
    src = b"package io\n\ntype Writer interface {\n\tWrite(p []byte) (n int, err error)\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Writer" for x in result)


def test_unexported_interface():
    src = b"package main\n\ntype closer interface {\n\tclose() error\n}\n"
    assert any(x["name"] == "closer" for x in P.extract_skeleton(src))


def test_interface_with_multiple_methods():
    src = b"package main\n\ntype ReadWriter interface {\n\tRead(p []byte) (int, error)\n\tWrite(p []byte) (int, error)\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "ReadWriter" for x in result)


def test_empty_interface():
    src = b"package main\n\ntype Any interface{}\n"
    assert any(x["name"] == "Any" for x in P.extract_skeleton(src))


# ─── Method styles ─────────────────────────────────────────────────────────────

def test_value_receiver_method():
    src = b"package main\n\ntype Dog struct{}\nfunc (d Dog) Bark() string { return \"Woof\" }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Bark" and x["parent"] == "Dog" for x in result)


def test_pointer_receiver_method():
    src = b"package main\n\ntype Counter struct { n int }\nfunc (c *Counter) Inc() { c.n++ }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Inc" and x["parent"] == "Counter" for x in result)


def test_method_with_multiple_params():
    src = b"package main\n\ntype Repo struct{}\nfunc (r *Repo) Find(id int, opts ...Option) (Result, error) { return nil, nil }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Find" and x["parent"] == "Repo" for x in result)


def test_unexported_method():
    src = b"package main\n\ntype Cache struct{}\nfunc (c *Cache) evict(key string) { }\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "evict" and x["parent"] == "Cache" for x in result)


# ─── Function styles ───────────────────────────────────────────────────────────

def test_plain_function():
    src = b"package main\n\nfunc helper(x int) int { return x * 2 }\n"
    assert any(x["name"] == "helper" and x["parent"] is None for x in P.extract_skeleton(src))


def test_exported_function():
    src = b"package main\n\nfunc NewServer(port int) *Server { return &Server{port: port} }\n"
    assert any(x["name"] == "NewServer" for x in P.extract_skeleton(src))


def test_unexported_function():
    src = b"package main\n\nfunc validate(s string) bool { return len(s) > 0 }\n"
    assert any(x["name"] == "validate" for x in P.extract_skeleton(src))


def test_init_function():
    src = b"package main\n\nfunc init() { setup() }\n"
    assert any(x["name"] == "init" for x in P.extract_skeleton(src))


def test_main_function():
    src = b"package main\n\nfunc main() { run() }\n"
    assert any(x["name"] == "main" for x in P.extract_skeleton(src))


def test_variadic_function():
    src = b"package main\n\nfunc sum(nums ...int) int { return 0 }\n"
    result = P.extract_skeleton(src)
    fn = next(x for x in result if x["name"] == "sum")
    assert "nums" in fn["params"]


def test_function_multiple_return_values():
    src = b"package main\n\nfunc divide(a, b int) (int, error) { return a / b, nil }\n"
    assert any(x["name"] == "divide" for x in P.extract_skeleton(src))


# ─── Mixed file ────────────────────────────────────────────────────────────────

MIXED_SRC = b"""\
package main

type Animal interface {
\tSpeak() string
}

type Dog struct {
\tName string
\tBreed string
}

func (d Dog) Speak() string {
\treturn "Woof"
}

func (d *Dog) Train(cmd string) bool {
\treturn true
}

func NewDog(name, breed string) *Dog {
\treturn &Dog{Name: name, Breed: breed}
}

func main() {
\tdog := NewDog("Rex", "Lab")
\tdog.Train("sit")
}
"""


def test_mixed_interface_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "interface" and x["name"] == "Animal" for x in result)


def test_mixed_struct_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "struct" and x["name"] == "Dog" for x in result)


def test_mixed_value_receiver():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "Speak" and x["parent"] == "Dog" for x in result)


def test_mixed_pointer_receiver():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "Train" and x["parent"] == "Dog" for x in result)


def test_mixed_constructor_function():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "NewDog" and x["parent"] is None for x in result)


def test_mixed_sorted_by_line():
    result = P.extract_skeleton(MIXED_SRC)
    lines = [x["line"] for x in result]
    assert lines == sorted(lines)


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_function():
    src = b"package main\n\nfunc greet(name string) string {\n\treturn \"Hello \" + name\n}\n"
    source, line = P.extract_symbol_source(src, "greet")
    assert "func greet" in source
    assert line == 3


def test_symbol_source_struct():
    src = b"package main\n\ntype Config struct {\n\tHost string\n\tPort int\n}\n"
    source, line = P.extract_symbol_source(src, "Config")
    assert "Config" in source
    assert line == 3


def test_symbol_source_none_for_missing():
    src = b"package main\n\nfunc foo() {}\n"
    assert P.extract_symbol_source(src, "bar") is None


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_direct_call():
    src = b"package main\n\nfunc process() {\n\tinit()\n\tvalidate()\n}\n"
    calls = P.extract_calls_in_function(src, "process")
    assert "init" in calls
    assert "validate" in calls


def test_calls_method_on_receiver():
    src = b"package main\n\nfunc run(db *DB) {\n\tdb.Connect()\n\tdb.Query(\"SELECT 1\")\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "Connect" in calls
    assert "Query" in calls


def test_calls_package_function():
    src = b"package main\n\nfunc log() {\n\tfmt.Println(\"hi\")\n\tos.Exit(1)\n}\n"
    calls = P.extract_calls_in_function(src, "log")
    assert "Println" in calls
    assert "Exit" in calls


def test_calls_empty_for_unknown():
    src = b"package main\n\nfunc foo() {}\n"
    assert P.extract_calls_in_function(src, "nonexistent") == []
