"""
Exhaustive tests for the Java plugin covering every realistic code pattern.

Code style categories:
  - Classes: plain, public, abstract, with extends/implements
  - Interfaces: plain, public, with methods
  - Constructors: default, parameterized
  - Methods: regular, static, public, private, void, return-typed
  - Methods in interfaces (default and abstract)
  - Overridden methods (@Override)
  - Multiple classes in one file (inner class not tested - tree-sitter top-level only)
  - extract_symbol_source and extract_calls_in_function
"""
import pytest
from codetree.languages.java import JavaPlugin

P = JavaPlugin()


# ─── Class styles ──────────────────────────────────────────────────────────────

def test_plain_class():
    src = b"class Foo {}\n"
    assert any(x["type"] == "class" and x["name"] == "Foo" for x in P.extract_skeleton(src))


def test_public_class():
    src = b"public class Service {}\n"
    assert any(x["name"] == "Service" for x in P.extract_skeleton(src))


def test_abstract_class():
    src = b"public abstract class Shape {\n    public abstract double area();\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Shape" for x in result)


def test_class_extends():
    src = b"public class Dog extends Animal {}\n"
    assert any(x["name"] == "Dog" for x in P.extract_skeleton(src))


def test_class_implements():
    src = b"public class ServiceImpl implements Service {}\n"
    assert any(x["name"] == "ServiceImpl" for x in P.extract_skeleton(src))


def test_class_extends_and_implements():
    src = b"public class Worker extends Base implements Runnable {\n    public void run() {}\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Worker" for x in result)
    assert any(x["name"] == "run" and x["parent"] == "Worker" for x in result)


# ─── Interface styles ─────────────────────────────────────────────────────────

def test_plain_interface():
    src = b"interface Printable {\n    void print();\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Printable" for x in result)


def test_public_interface():
    src = b"public interface Repository {\n    Object find(int id);\n    void save(Object item);\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["type"] == "interface" and x["name"] == "Repository" for x in result)


def test_interface_methods_in_skeleton():
    src = b"public interface Dao {\n    String load(int id);\n    void store(String v);\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "load" and x["parent"] == "Dao" for x in result)
    assert any(x["name"] == "store" and x["parent"] == "Dao" for x in result)


def test_interface_extends():
    src = b"public interface ReadWriter extends Reader, Writer {\n    void flush();\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "ReadWriter" for x in result)


# ─── Constructor styles ────────────────────────────────────────────────────────

def test_default_constructor():
    src = b"public class Widget {\n    public Widget() {}\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Widget" and x["parent"] == "Widget" for x in result)


def test_parameterized_constructor():
    src = b"public class Server {\n    public Server(int port, String host) { this.port = port; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "Server" and x["parent"] == "Server" for x in result)


# ─── Method styles ────────────────────────────────────────────────────────────

def test_void_method():
    src = b"public class Logger {\n    public void log(String msg) { System.out.println(msg); }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "log" and x["parent"] == "Logger" for x in result)


def test_return_typed_method():
    src = b"public class Calc {\n    public int add(int a, int b) { return a + b; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "add" and x["parent"] == "Calc" for x in result)


def test_static_method():
    src = b"public class Utils {\n    public static String format(String s) { return s.trim(); }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "format" and x["parent"] == "Utils" for x in result)


def test_private_method():
    src = b"public class Cache {\n    private void evict(String key) {}\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "evict" and x["parent"] == "Cache" for x in result)


def test_override_method():
    src = b"public class Dog extends Animal {\n    @Override\n    public String toString() { return \"Dog\"; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "toString" and x["parent"] == "Dog" for x in result)


def test_method_with_multiple_params():
    src = b"public class Repo {\n    public List<String> find(int page, int size, String filter) { return null; }\n}\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "find" and x["parent"] == "Repo" for x in result)


# ─── Mixed file ────────────────────────────────────────────────────────────────

MIXED_SRC = b"""
public interface Drawable {
    void draw();
    default String describe() { return "drawable"; }
}

public abstract class Shape {
    protected String color;
    public Shape(String color) { this.color = color; }
    public abstract double area();
}

public class Circle extends Shape implements Drawable {
    private double radius;

    public Circle(double radius) {
        super("red");
        this.radius = radius;
    }

    @Override
    public double area() { return Math.PI * radius * radius; }

    @Override
    public void draw() { System.out.println("Drawing circle"); }
}
"""


def test_mixed_interface_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["type"] == "interface" and x["name"] == "Drawable" for x in result)


def test_mixed_abstract_class_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "Shape" for x in result)


def test_mixed_concrete_class_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "Circle" for x in result)


def test_mixed_interface_methods():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "draw" and x["parent"] == "Drawable" for x in result)


def test_mixed_constructor_found():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "Circle" and x["parent"] == "Circle" for x in result)


def test_mixed_override_methods():
    result = P.extract_skeleton(MIXED_SRC)
    assert any(x["name"] == "area" and x["parent"] == "Circle" for x in result)
    assert any(x["name"] == "draw" and x["parent"] == "Circle" for x in result)


def test_mixed_sorted_by_line():
    result = P.extract_skeleton(MIXED_SRC)
    lines = [x["line"] for x in result]
    assert lines == sorted(lines)


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_class():
    src = b"public class Calc {\n    public int add(int a, int b) { return a + b; }\n}\n"
    source, line = P.extract_symbol_source(src, "Calc")
    assert "class Calc" in source
    assert line == 1


def test_symbol_source_interface():
    src = b"public interface Dao {\n    String load(int id);\n}\n"
    result = P.extract_symbol_source(src, "Dao")
    assert result is not None
    source, line = result
    assert "Dao" in source
    assert line == 1


def test_symbol_source_method():
    src = b"public class Service {\n    public void run() { start(); }\n}\n"
    result = P.extract_symbol_source(src, "run")
    assert result is not None
    source, _ = result
    assert "void run" in source


def test_symbol_source_constructor():
    src = b"public class Server {\n    public Server(int port) { this.port = port; }\n}\n"
    result = P.extract_symbol_source(src, "Server")
    # May match class or constructor — both are valid
    assert result is not None


def test_symbol_source_none_for_missing():
    src = b"public class Foo {}\n"
    assert P.extract_symbol_source(src, "Bar") is None


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_method_invocation():
    src = b"public class App {\n    public void run() {\n        init();\n        start();\n    }\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "init" in calls
    assert "start" in calls


def test_calls_on_object():
    src = b"public class App {\n    public void run(Db db) {\n        db.connect();\n        db.query(\"x\");\n    }\n}\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "connect" in calls
    assert "query" in calls


def test_calls_object_creation():
    src = b"public class Factory {\n    public Object create() {\n        return new Widget();\n    }\n}\n"
    calls = P.extract_calls_in_function(src, "create")
    assert "Widget" in calls


def test_calls_empty_for_unknown():
    src = b"public class Foo {\n    public void bar() {}\n}\n"
    assert P.extract_calls_in_function(src, "nonexistent") == []
