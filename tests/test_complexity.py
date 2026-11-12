"""Tests for cyclomatic complexity metrics."""
import pytest
from codetree.languages.python import PythonPlugin

PY = PythonPlugin()


class TestPythonComplexity:

    def test_simple_function_complexity_1(self):
        src = b"def simple():\n    return 1\n"
        result = PY.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1
        assert result["breakdown"] == {}

    def test_single_if(self):
        src = b"def check(x):\n    if x > 0:\n        return x\n    return 0\n"
        result = PY.compute_complexity(src, "check")
        assert result["total"] == 2
        assert result["breakdown"].get("if", 0) == 1

    def test_if_elif_else(self):
        src = b"""\
def classify(x):
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"
"""
        result = PY.compute_complexity(src, "classify")
        assert result["total"] == 3
        assert result["breakdown"]["if"] == 1
        assert result["breakdown"]["elif"] == 1

    def test_for_loop(self):
        src = b"def loop(items):\n    for x in items:\n        print(x)\n"
        result = PY.compute_complexity(src, "loop")
        assert result["total"] == 2

    def test_while_loop(self):
        src = b"def wait():\n    while True:\n        pass\n"
        result = PY.compute_complexity(src, "wait")
        assert result["total"] == 2

    def test_try_except(self):
        src = b"""\
def safe():
    try:
        return 1
    except ValueError:
        return 0
    except Exception:
        return -1
"""
        result = PY.compute_complexity(src, "safe")
        assert result["total"] == 3

    def test_boolean_operators(self):
        src = b"def check(a, b):\n    if a and b or a:\n        return 1\n"
        result = PY.compute_complexity(src, "check")
        assert result["total"] == 4

    def test_with_statement(self):
        src = b"def read():\n    with open('f') as f:\n        return f.read()\n"
        result = PY.compute_complexity(src, "read")
        assert result["total"] == 2

    def test_nested_complexity(self):
        src = b"""\
def nested(items):
    for x in items:
        if x > 0:
            while x > 10:
                x -= 1
"""
        result = PY.compute_complexity(src, "nested")
        assert result["total"] == 4

    def test_function_not_found(self):
        src = b"def foo(): pass\n"
        result = PY.compute_complexity(src, "nonexistent")
        assert result is None

    def test_empty_function(self):
        src = b"def empty(): pass\n"
        result = PY.compute_complexity(src, "empty")
        assert result is not None
        assert result["total"] == 1

    def test_method_in_class(self):
        src = b"""\
class Calc:
    def process(self, x):
        if x > 0:
            for i in range(x):
                print(i)
"""
        result = PY.compute_complexity(src, "process")
        assert result["total"] == 3


from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin

JS = JavaScriptPlugin()
TS = TypeScriptPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()


class TestJSComplexity:

    def test_simple_function(self):
        src = b"function simple() { return 1; }\n"
        result = JS.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for_while(self):
        src = b"""\
function complex(items) {
    if (items.length > 0) {
        for (let i = 0; i < items.length; i++) {
            while (items[i] > 0) {
                items[i]--;
            }
        }
    }
}
"""
        result = JS.compute_complexity(src, "complex")
        assert result["total"] == 4

    def test_ternary_and_logical(self):
        src = b"function check(a, b) { return a && b ? 1 : 0; }\n"
        result = JS.compute_complexity(src, "check")
        assert result["total"] >= 3

    def test_switch_case(self):
        src = b"""\
function handle(x) {
    switch(x) {
        case 1: return 'one';
        case 2: return 'two';
        default: return 'other';
    }
}
"""
        result = JS.compute_complexity(src, "handle")
        assert result["total"] >= 3

    def test_try_catch(self):
        src = b"function safe() { try { return 1; } catch(e) { return 0; } }\n"
        result = JS.compute_complexity(src, "safe")
        assert result["total"] == 2

    def test_not_found(self):
        src = b"function foo() {}\n"
        assert JS.compute_complexity(src, "bar") is None

    def test_arrow_function(self):
        src = b"const check = (x) => { if (x > 0) { return x; } return 0; };\n"
        result = JS.compute_complexity(src, "check")
        assert result is not None
        assert result["total"] == 2


class TestTSComplexity:

    def test_ts_inherits_js_complexity(self):
        src = b"function check(x: number): number { if (x > 0) { return x; } return 0; }\n"
        result = TS.compute_complexity(src, "check")
        assert result is not None
        assert result["total"] == 2


class TestGoComplexity:

    def test_simple_function(self):
        src = b"package main\n\nfunc simple() int { return 1 }\n"
        result = GO.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for(self):
        src = b"""\
package main

func process(items []int) {
    if len(items) > 0 {
        for _, v := range items {
            _ = v
        }
    }
}
"""
        result = GO.compute_complexity(src, "process")
        assert result["total"] == 3

    def test_select(self):
        src = b"""\
package main

func listen(ch1, ch2 chan int) {
    select {
    case v := <-ch1:
        _ = v
    case v := <-ch2:
        _ = v
    default:
        return
    }
}
"""
        result = GO.compute_complexity(src, "listen")
        assert result["total"] >= 3

    def test_not_found(self):
        src = b"package main\n\nfunc foo() {}\n"
        assert GO.compute_complexity(src, "bar") is None

    def test_method(self):
        src = b"""\
package main

type Calc struct{}

func (c Calc) Add(a, b int) int {
    if a < 0 {
        return 0
    }
    return a + b
}
"""
        result = GO.compute_complexity(src, "Add")
        assert result is not None
        assert result["total"] == 2


class TestRustComplexity:

    def test_simple_function(self):
        src = b"fn simple() -> i32 { 1 }\n"
        result = RS.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for_while(self):
        src = b"""\
fn process(items: &[i32]) {
    if items.len() > 0 {
        for x in items {
            while *x > 0 {
                break;
            }
        }
    }
}
"""
        result = RS.compute_complexity(src, "process")
        assert result["total"] == 4

    def test_match_arms(self):
        src = b"""\
fn classify(x: i32) -> &'static str {
    match x {
        1 => "one",
        2 => "two",
        _ => "other",
    }
}
"""
        result = RS.compute_complexity(src, "classify")
        assert result["total"] >= 4

    def test_not_found(self):
        src = b"fn foo() {}\n"
        assert RS.compute_complexity(src, "bar") is None


class TestJavaComplexity:

    def test_simple_method(self):
        src = b"class Foo { int simple() { return 1; } }\n"
        result = JV.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for_while(self):
        src = b"""\
class Foo {
    void process(int[] items) {
        if (items.length > 0) {
            for (int x : items) {
                while (x > 0) {
                    x--;
                }
            }
        }
    }
}
"""
        result = JV.compute_complexity(src, "process")
        assert result["total"] == 4

    def test_switch_case(self):
        src = b"""\
class Foo {
    String handle(int x) {
        switch(x) {
            case 1: return "one";
            case 2: return "two";
            default: return "other";
        }
    }
}
"""
        result = JV.compute_complexity(src, "handle")
        assert result["total"] >= 3

    def test_try_catch(self):
        src = b"""\
class Foo {
    int safe() {
        try {
            return 1;
        } catch (Exception e) {
            return 0;
        }
    }
}
"""
        result = JV.compute_complexity(src, "safe")
        assert result["total"] == 2

    def test_ternary_and_logical(self):
        src = b"""\
class Foo {
    int check(boolean a, boolean b) {
        return a && b ? 1 : 0;
    }
}
"""
        result = JV.compute_complexity(src, "check")
        assert result["total"] >= 3

    def test_not_found(self):
        src = b"class Foo { void bar() {} }\n"
        assert JV.compute_complexity(src, "missing") is None


from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


class TestGetComplexityTool:

    def test_python_complexity_output(self, tmp_path):
        (tmp_path / "calc.py").write_text("""\
def calculate(x, items):
    if x > 0:
        for i in items:
            if i > 0:
                return i
    return 0
""")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="calc.py", function_name="calculate")
        assert "Complexity" in result
        assert "calculate" in result
        assert "4" in result

    def test_simple_function_shows_1(self, tmp_path):
        (tmp_path / "simple.py").write_text("def simple(): return 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="simple.py", function_name="simple")
        assert "1" in result

    def test_function_not_found(self, tmp_path):
        (tmp_path / "calc.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="calc.py", function_name="nonexistent")
        assert "not found" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="ghost.py", function_name="foo")
        assert "not found" in result.lower()

    def test_breakdown_in_output(self, tmp_path):
        (tmp_path / "calc.py").write_text("""\
def process(items):
    for x in items:
        if x > 0:
            return x
    return 0
""")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="calc.py", function_name="process")
        assert "for" in result.lower()
        assert "if" in result.lower()

    def test_go_complexity(self, tmp_path):
        (tmp_path / "main.go").write_text("""\
package main

func process(x int) int {
    if x > 0 {
        return x
    }
    return 0
}
""")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="main.go", function_name="process")
        assert "2" in result

    def test_js_complexity(self, tmp_path):
        (tmp_path / "app.js").write_text("function check(x) { if (x) { return x; } return 0; }\n")
        fn = _tool(create_server(str(tmp_path)), "get_complexity")
        result = fn(file_path="app.js", function_name="check")
        assert "2" in result


from codetree.languages.c import CPlugin
from codetree.languages.cpp import CppPlugin
from codetree.languages.ruby import RubyPlugin

C = CPlugin()
CPP = CppPlugin()
RB = RubyPlugin()


# ─── C complexity ────────────────────────────────────────────────────────────

class TestCComplexity:

    def test_simple_function(self):
        src = b"int simple() { return 1; }\n"
        result = C.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for_while(self):
        src = b"""\
void process(int* items, int len) {
    if (len > 0) {
        for (int i = 0; i < len; i++) {
            while (items[i] > 0) {
                items[i]--;
            }
        }
    }
}
"""
        result = C.compute_complexity(src, "process")
        assert result["total"] == 4

    def test_switch_case(self):
        src = b"""\
int handle(int x) {
    switch(x) {
        case 1: return 1;
        case 2: return 2;
        default: return 0;
    }
}
"""
        result = C.compute_complexity(src, "handle")
        assert result["total"] >= 3

    def test_not_found(self):
        src = b"int foo() { return 0; }\n"
        assert C.compute_complexity(src, "bar") is None


# ─── C++ complexity ──────────────────────────────────────────────────────────

class TestCppComplexity:

    def test_simple_function(self):
        src = b"int simple() { return 1; }\n"
        result = CPP.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_for(self):
        src = b"""\
void process(int x) {
    if (x > 0) {
        for (int i = 0; i < x; i++) {
            // do work
        }
    }
}
"""
        result = CPP.compute_complexity(src, "process")
        assert result["total"] == 3

    def test_not_found(self):
        src = b"int foo() { return 0; }\n"
        assert CPP.compute_complexity(src, "bar") is None


# ─── Ruby complexity ─────────────────────────────────────────────────────────

class TestRubyComplexity:

    def test_simple_method(self):
        src = b"def simple\n  42\nend\n"
        result = RB.compute_complexity(src, "simple")
        assert result is not None
        assert result["total"] == 1

    def test_if_each(self):
        src = b"""\
def process(items)
  if items.length > 0
    items.each do |x|
      puts x
    end
  end
end
"""
        result = RB.compute_complexity(src, "process")
        assert result["total"] >= 2  # base + if (each is a method call, not a branch node)

    def test_case_when(self):
        src = b"""\
def classify(x)
  case x
  when 1
    "one"
  when 2
    "two"
  else
    "other"
  end
end
"""
        result = RB.compute_complexity(src, "classify")
        assert result["total"] >= 3  # base + when clauses

    def test_while_until(self):
        src = b"""\
def wait(x)
  while x > 0
    x -= 1
  end
  until x < -10
    x -= 1
  end
end
"""
        result = RB.compute_complexity(src, "wait")
        assert result["total"] == 3  # base + while + until

    def test_not_found(self):
        src = b"def foo\n  42\nend\n"
        assert RB.compute_complexity(src, "bar") is None
