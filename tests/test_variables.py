"""Tests for variable listing in functions."""
import pytest
from codetree.indexer import Indexer
from codetree.languages.python import PythonPlugin


PY = PythonPlugin()


# ─── Python variable extraction ─────────────────────────────────────────────

class TestPythonVariables:

    def test_simple_assignments(self):
        src = b"def foo():\n    x = 1\n    y = 'hello'\n    return x + y\n"
        result = PY.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_annotated_assignment(self):
        src = b"def foo():\n    x: int = 42\n    return x\n"
        result = PY.extract_variables(src, "foo")
        item = next(v for v in result if v["name"] == "x")
        assert item["type"] == "int"

    def test_parameters_included(self):
        src = b"def foo(a, b, c=1):\n    return a + b + c\n"
        result = PY.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "a" in names
        assert "b" in names
        assert "c" in names
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 3

    def test_loop_variables(self):
        src = b"def foo(data):\n    for item in data:\n        pass\n"
        result = PY.extract_variables(src, "foo")
        item = next(v for v in result if v["name"] == "item")
        assert item["kind"] == "loop_var"

    def test_ignores_self(self):
        src = b"class Foo:\n    def bar(self):\n        x = 1\n        return x\n"
        result = PY.extract_variables(src, "bar")
        names = [v["name"] for v in result]
        assert "self" not in names

    def test_ignores_attribute_assignments(self):
        src = b"class Foo:\n    def __init__(self):\n        self.x = 1\n        y = 2\n"
        result = PY.extract_variables(src, "__init__")
        names = [v["name"] for v in result]
        assert "x" not in names  # self.x is not a local var
        assert "y" in names

    def test_deduplicates(self):
        src = b"def foo():\n    x = 1\n    x = 2\n    x += 3\n"
        result = PY.extract_variables(src, "foo")
        x_entries = [v for v in result if v["name"] == "x"]
        assert len(x_entries) == 1
        assert x_entries[0]["line"] == 2  # first assignment

    def test_function_not_found(self):
        src = b"def foo(): pass\n"
        result = PY.extract_variables(src, "nonexistent")
        assert result == []

    def test_has_line_numbers(self):
        src = b"def foo():\n    x = 1\n    y = 2\n"
        result = PY.extract_variables(src, "foo")
        item = next(v for v in result if v["name"] == "x")
        assert item["line"] == 2


# ─── Indexer integration ────────────────────────────────────────────────────

class TestVariablesIndexer:

    def test_get_variables(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo():\n    x = 1\n    return x\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_variables("app.py", "foo")
        assert result is not None
        names = [v["name"] for v in result]
        assert "x" in names

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_variables("ghost.py", "foo")
        assert result is None


from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin

JS = JavaScriptPlugin()
TS = TypeScriptPlugin()


class TestJSVariables:

    def test_const_let_var(self):
        src = b"function foo() {\n  const x = 1;\n  let y = 2;\n  var z = 3;\n  return x + y + z;\n}\n"
        result = JS.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names
        assert "z" in names

    def test_parameters(self):
        src = b"function foo(a, b) { return a + b; }\n"
        result = JS.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 2

    def test_loop_variable(self):
        src = b"function foo(data) {\n  for (const item of data) {}\n}\n"
        result = JS.extract_variables(src, "foo")
        item = next(v for v in result if v["name"] == "item")
        assert item["kind"] == "loop_var"

    def test_deduplicates(self):
        src = b"function foo() {\n  let x = 1;\n  x = 2;\n}\n"
        result = JS.extract_variables(src, "foo")
        x_entries = [v for v in result if v["name"] == "x"]
        assert len(x_entries) == 1


class TestTSVariables:

    def test_type_annotation(self):
        src = b"function foo(): void {\n  const x: number = 42;\n}\n"
        result = TS.extract_variables(src, "foo")
        item = next(v for v in result if v["name"] == "x")
        assert item["type"] == "number"

    def test_parameters_with_types(self):
        src = b"function foo(a: string, b: number): void {}\n"
        result = TS.extract_variables(src, "foo")
        a = next(v for v in result if v["name"] == "a")
        assert a["type"] == "string"
        assert a["kind"] == "parameter"


from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin

GO = GoPlugin()
RUST = RustPlugin()
JAVA = JavaPlugin()


class TestGoVariables:

    def test_short_var_declaration(self):
        src = b"func foo() {\n\tx := 1\n\ty := \"hello\"\n\t_ = x + len(y)\n}\n"
        result = GO.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"func foo(a int, b string) int {\n\treturn 0\n}\n"
        result = GO.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 2

    def test_loop_variable(self):
        src = b"func foo(data []int) {\n\tfor _, item := range data {\n\t\t_ = item\n\t}\n}\n"
        result = GO.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "item" in names or "_" in names

    def test_function_not_found(self):
        src = b"func foo() {}\n"
        result = GO.extract_variables(src, "nonexistent")
        assert result == []


class TestRustVariables:

    def test_let_declaration(self):
        src = b"fn foo() {\n    let x = 1;\n    let y = \"hello\";\n    let _ = x;\n}\n"
        result = RUST.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"fn foo(a: i32, b: String) -> i32 {\n    a\n}\n"
        result = RUST.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 2

    def test_loop_variable(self):
        src = b"fn foo(data: Vec<i32>) {\n    for item in data {\n        let _ = item;\n    }\n}\n"
        result = RUST.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "item" in names

    def test_function_not_found(self):
        src = b"fn foo() {}\n"
        result = RUST.extract_variables(src, "nonexistent")
        assert result == []


class TestJavaVariables:

    def test_local_variable(self):
        src = b"class A {\n    void foo() {\n        int x = 1;\n        String y = \"hi\";\n    }\n}\n"
        result = JAVA.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"class A {\n    void foo(int a, String b) {}\n}\n"
        result = JAVA.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 2

    def test_enhanced_for(self):
        src = b"class A {\n    void foo(int[] data) {\n        for (int item : data) {}\n    }\n}\n"
        result = JAVA.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "item" in names

    def test_function_not_found(self):
        src = b"class A {\n    void foo() {}\n}\n"
        result = JAVA.extract_variables(src, "nonexistent")
        assert result == []


# ─── C variable extraction ──────────────────────────────────────────────────

from codetree.languages.c import CPlugin
C = CPlugin()


class TestCVariables:

    def test_local_variable(self):
        src = b"void foo() {\n    int x = 1;\n    float y = 2.0;\n}\n"
        result = C.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"void foo(int a, float b) {}\n"
        result = C.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 2
        names = [p["name"] for p in params]
        assert "a" in names
        assert "b" in names

    def test_parameter_types(self):
        src = b"void foo(int a, char *b) {}\n"
        result = C.extract_variables(src, "foo")
        a = next(v for v in result if v["name"] == "a")
        assert a["type"] == "int"

    def test_for_loop_var(self):
        src = b"void foo() {\n    for (int i = 0; i < 10; i++) {}\n}\n"
        result = C.extract_variables(src, "foo")
        i_var = next(v for v in result if v["name"] == "i")
        assert i_var["kind"] == "loop_var"

    def test_function_not_found(self):
        src = b"void foo() {}\n"
        result = C.extract_variables(src, "nonexistent")
        assert result == []


# ─── C++ variable extraction ───────────────────────────────────────────────

from codetree.languages.cpp import CppPlugin
CPP = CppPlugin()


class TestCppVariables:

    def test_local_variable(self):
        src = b"void foo() {\n    int x = 1;\n    auto y = 2.0;\n}\n"
        result = CPP.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"void foo(int a, const std::string& b) {}\n"
        result = CPP.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) >= 2

    def test_range_based_for(self):
        src = b"#include <vector>\nvoid foo(std::vector<int> data) {\n    for (auto item : data) {}\n}\n"
        result = CPP.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "item" in names
        item = next(v for v in result if v["name"] == "item")
        assert item["kind"] == "loop_var"

    def test_class_method(self):
        src = b"class MyClass {\n    void process(int x) {\n        int result = x * 2;\n    }\n};\n"
        result = CPP.extract_variables(src, "process")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "result" in names

    def test_function_not_found(self):
        src = b"void foo() {}\n"
        result = CPP.extract_variables(src, "nonexistent")
        assert result == []


# ─── Ruby variable extraction ──────────────────────────────────────────────

from codetree.languages.ruby import RubyPlugin
RUBY = RubyPlugin()


class TestRubyVariables:

    def test_local_variable(self):
        src = b"def foo\n  x = 1\n  y = 'hello'\n  x + y\nend\n"
        result = RUBY.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "x" in names
        assert "y" in names

    def test_parameters(self):
        src = b"def foo(a, b, c = 1)\n  a + b + c\nend\n"
        result = RUBY.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 3

    def test_block_parameters(self):
        src = b"def foo(data)\n  data.each do |item|\n    puts item\n  end\nend\n"
        result = RUBY.extract_variables(src, "foo")
        names = [v["name"] for v in result]
        assert "item" in names
        item = next(v for v in result if v["name"] == "item")
        assert item["kind"] == "loop_var"

    def test_splat_parameter(self):
        src = b"def foo(*args)\n  args\nend\n"
        result = RUBY.extract_variables(src, "foo")
        params = [v for v in result if v["kind"] == "parameter"]
        assert len(params) == 1
        assert params[0]["name"] == "args"

    def test_function_not_found(self):
        src = b"def foo\nend\n"
        result = RUBY.extract_variables(src, "nonexistent")
        assert result == []
