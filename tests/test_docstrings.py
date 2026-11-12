"""Tests for docstring/doc-comment extraction across all languages."""
import pytest
from codetree.languages.python import PythonPlugin
from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin
from codetree.languages.c import CPlugin
from codetree.languages.cpp import CppPlugin
from codetree.languages.ruby import RubyPlugin
from codetree.server import create_server

PY = PythonPlugin()
JS = JavaScriptPlugin()
TS = TypeScriptPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()
CC = CPlugin()
CPP = CppPlugin()
RB = RubyPlugin()

ALL_PLUGINS = [PY, JS, TS, GO, RS, JV, CC, CPP, RB]


# --- All plugins: empty file has no doc field issues ---

@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_skeleton_has_no_items(plugin):
    """Empty files produce empty skeleton — no doc field issues."""
    assert plugin.extract_skeleton(b"") == []


# --- Python ---

PY_DOC = b'''\
class Calculator:
    """A simple calculator."""
    def add(self, a, b):
        """Add two numbers."""
        return a + b

    def no_doc(self):
        return 1

def helper():
    """Helper function."""
    pass

def bare():
    pass
'''


def test_python_class_doc():
    skel = PY.extract_skeleton(PY_DOC)
    cls = next(s for s in skel if s["name"] == "Calculator")
    assert cls["doc"] == "A simple calculator."


def test_python_method_doc():
    skel = PY.extract_skeleton(PY_DOC)
    add = next(s for s in skel if s["name"] == "add")
    assert add["doc"] == "Add two numbers."


def test_python_no_doc():
    skel = PY.extract_skeleton(PY_DOC)
    no_doc = next(s for s in skel if s["name"] == "no_doc")
    assert no_doc["doc"] == ""


def test_python_function_doc():
    skel = PY.extract_skeleton(PY_DOC)
    helper = next(s for s in skel if s["name"] == "helper")
    assert helper["doc"] == "Helper function."


def test_python_bare_function_no_doc():
    skel = PY.extract_skeleton(PY_DOC)
    bare = next(s for s in skel if s["name"] == "bare")
    assert bare["doc"] == ""


def test_python_multiline_docstring():
    """Multi-line docstring: should extract only the first line."""
    src = b'''\
def complex():
    """This is the first line.

    This is more detail.
    And even more.
    """
    pass
'''
    skel = PY.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "complex")
    assert fn["doc"] == "This is the first line."


def test_python_single_quote_docstring():
    src = b"""\
def func():
    '''Single-quoted docstring.'''
    pass
"""
    skel = PY.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "func")
    assert fn["doc"] == "Single-quoted docstring."


def test_python_decorated_function_doc():
    """Decorated functions should still get their docstring."""
    src = b'''\
@staticmethod
def decorated():
    """Decorated function doc."""
    pass
'''
    skel = PY.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "decorated")
    assert fn["doc"] == "Decorated function doc."


def test_python_doc_key_always_present():
    """Every skeleton item must have a 'doc' key, even if empty."""
    src = b"def foo(): pass\ndef bar(): pass\n"
    skel = PY.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- JavaScript ---

JS_DOC = b"""\
/** Greets a person. */
function greet(name) { return name; }

function plain() {}
"""


def test_js_function_doc():
    skel = JS.extract_skeleton(JS_DOC)
    greet = next(s for s in skel if s["name"] == "greet")
    assert greet["doc"] == "Greets a person."


def test_js_no_doc():
    skel = JS.extract_skeleton(JS_DOC)
    plain = next(s for s in skel if s["name"] == "plain")
    assert plain["doc"] == ""


def test_js_class_doc():
    src = b"""\
/** A simple calculator. */
class Calculator {
    add(a, b) { return a + b; }
}
"""
    skel = JS.extract_skeleton(src)
    cls = next(s for s in skel if s["name"] == "Calculator")
    assert cls["doc"] == "A simple calculator."


def test_js_multiline_jsdoc():
    """Multi-line JSDoc block: should extract first meaningful line."""
    src = b"""\
/**
 * Creates a new server.
 * @param port The port number
 */
function createServer(port) {}
"""
    skel = JS.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "createServer")
    assert fn["doc"] == "Creates a new server."


def test_js_doc_key_always_present():
    src = b"function a() {}\nfunction b() {}\n"
    skel = JS.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- TypeScript ---

def test_ts_function_doc():
    src = b"""\
/** Greets a person. */
function greet(name: string) { return name; }

function plain() {}
"""
    skel = TS.extract_skeleton(src)
    greet = next(s for s in skel if s["name"] == "greet")
    assert greet["doc"] == "Greets a person."


def test_ts_class_doc():
    src = b"""\
/** A base class. */
class Base {
    run() {}
}
"""
    skel = TS.extract_skeleton(src)
    cls = next(s for s in skel if s["name"] == "Base")
    assert cls["doc"] == "A base class."


def test_ts_interface_doc():
    src = b"""\
/** Describes a shape. */
interface Shape {
    area(): number;
}
"""
    skel = TS.extract_skeleton(src)
    iface = next(s for s in skel if s["name"] == "Shape")
    assert iface["doc"] == "Describes a shape."


def test_ts_type_alias_doc():
    src = b"""\
/** Props for the component. */
type Props = { name: string };
"""
    skel = TS.extract_skeleton(src)
    t = next(s for s in skel if s["name"] == "Props")
    assert t["doc"] == "Props for the component."


def test_ts_no_doc():
    src = b"function plain() {}\n"
    skel = TS.extract_skeleton(src)
    fn = next(s for s in skel if s["name"] == "plain")
    assert fn["doc"] == ""


def test_ts_doc_key_always_present():
    src = b"function a() {}\nclass B {}\n"
    skel = TS.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- Go ---

GO_DOC = b"""\
package main

// NewServer creates a server.
func NewServer() {}

func noDoc() {}
"""


def test_go_function_doc():
    skel = GO.extract_skeleton(GO_DOC)
    ns = next(s for s in skel if s["name"] == "NewServer")
    assert ns["doc"] == "NewServer creates a server."


def test_go_no_doc():
    skel = GO.extract_skeleton(GO_DOC)
    nd = next(s for s in skel if s["name"] == "noDoc")
    assert nd["doc"] == ""


def test_go_struct_doc():
    src = b"""\
package main

// Server handles HTTP requests.
type Server struct {
    port int
}
"""
    skel = GO.extract_skeleton(src)
    s = next(s for s in skel if s["name"] == "Server")
    assert s["doc"] == "Server handles HTTP requests."


def test_go_interface_doc():
    src = b"""\
package main

// Handler processes events.
type Handler interface {
    Handle()
}
"""
    skel = GO.extract_skeleton(src)
    h = next(s for s in skel if s["name"] == "Handler")
    assert h["doc"] == "Handler processes events."


def test_go_multiline_doc():
    """Go multi-line // comments: should extract the first line."""
    src = b"""\
package main

// NewServer creates a new server.
// It binds to the given port.
func NewServer() {}
"""
    skel = GO.extract_skeleton(src)
    ns = next(s for s in skel if s["name"] == "NewServer")
    assert ns["doc"] == "NewServer creates a new server."


def test_go_doc_key_always_present():
    src = b"package main\n\nfunc a() {}\nfunc b() {}\n"
    skel = GO.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- Rust ---

RUST_DOC = b"""\
/// Creates a new config.
pub fn new_config() {}

pub fn no_doc() {}
"""


def test_rust_function_doc():
    skel = RS.extract_skeleton(RUST_DOC)
    nc = next(s for s in skel if s["name"] == "new_config")
    assert nc["doc"] == "Creates a new config."


def test_rust_no_doc():
    skel = RS.extract_skeleton(RUST_DOC)
    nd = next(s for s in skel if s["name"] == "no_doc")
    assert nd["doc"] == ""


def test_rust_struct_doc():
    src = b"""\
/// A configuration object.
pub struct Config {
    port: u16,
}
"""
    skel = RS.extract_skeleton(src)
    c = next(s for s in skel if s["name"] == "Config")
    assert c["doc"] == "A configuration object."


def test_rust_trait_doc():
    src = b"""\
/// Handles events.
pub trait Handler {
    fn handle(&self);
}
"""
    skel = RS.extract_skeleton(src)
    h = next(s for s in skel if s["name"] == "Handler")
    assert h["doc"] == "Handles events."


def test_rust_enum_doc():
    src = b"""\
/// Color values.
pub enum Color { Red, Green, Blue }
"""
    skel = RS.extract_skeleton(src)
    c = next(s for s in skel if s["name"] == "Color")
    assert c["doc"] == "Color values."


def test_rust_multiline_doc():
    """Rust multi-line /// comments: should extract the first line."""
    src = b"""\
/// Creates a new config.
/// Uses default settings.
pub fn new_config() {}
"""
    skel = RS.extract_skeleton(src)
    nc = next(s for s in skel if s["name"] == "new_config")
    assert nc["doc"] == "Creates a new config."


def test_rust_doc_key_always_present():
    src = b"pub fn a() {}\npub fn b() {}\n"
    skel = RS.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- Java ---

JAVA_DOC = b"""\
/**
 * A calculator class.
 */
public class Calculator {
    /**
     * Adds two numbers.
     */
    public int add(int a, int b) { return a + b; }

    public int plain() { return 0; }
}
"""


def test_java_class_doc():
    skel = JV.extract_skeleton(JAVA_DOC)
    cls = next(s for s in skel if s["name"] == "Calculator")
    assert cls["doc"] == "A calculator class."


def test_java_method_doc():
    skel = JV.extract_skeleton(JAVA_DOC)
    add = next(s for s in skel if s["name"] == "add")
    assert add["doc"] == "Adds two numbers."


def test_java_no_doc():
    skel = JV.extract_skeleton(JAVA_DOC)
    plain = next(s for s in skel if s["name"] == "plain")
    assert plain["doc"] == ""


def test_java_interface_doc():
    src = b"""\
/** Describes a service. */
public interface Service {
    void run();
}
"""
    skel = JV.extract_skeleton(src)
    svc = next(s for s in skel if s["name"] == "Service")
    assert svc["doc"] == "Describes a service."


def test_java_enum_doc():
    src = b"""\
/** Status values. */
public enum Status { ACTIVE, INACTIVE }
"""
    skel = JV.extract_skeleton(src)
    s = next(s for s in skel if s["name"] == "Status")
    assert s["doc"] == "Status values."


def test_java_doc_key_always_present():
    src = b"class A {}\nclass B {}\n"
    skel = JV.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- C ---

C_DOC = b"""\
/// A calculator.
struct Calculator {
    int value;
};

int add(int a, int b) {
    return a + b;
}
"""


def test_c_struct_doc():
    skel = CC.extract_skeleton(C_DOC)
    calc = next(s for s in skel if s["name"] == "Calculator")
    assert calc["doc"] == "A calculator."


def test_c_no_doc():
    skel = CC.extract_skeleton(C_DOC)
    add = next(s for s in skel if s["name"] == "add")
    assert add["doc"] == ""


def test_c_doc_key_always_present():
    src = b"int foo() { return 0; }\n"
    skel = CC.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- C++ ---

CPP_DOC = b"""\
/// A calculator class.
class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

int plain() { return 0; }
"""


def test_cpp_class_doc():
    skel = CPP.extract_skeleton(CPP_DOC)
    calc = next(s for s in skel if s["name"] == "Calculator")
    assert calc["doc"] == "A calculator class."


def test_cpp_no_doc():
    skel = CPP.extract_skeleton(CPP_DOC)
    plain = next(s for s in skel if s["name"] == "plain")
    assert plain["doc"] == ""


def test_cpp_doc_key_always_present():
    src = b"int foo() { return 0; }\n"
    skel = CPP.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- Ruby ---

RB_DOC = b"""\
# Calculator class.
class Calculator
  def add(a, b)
    a + b
  end
end

def plain
  42
end
"""


def test_ruby_class_doc():
    skel = RB.extract_skeleton(RB_DOC)
    calc = next(s for s in skel if s["name"] == "Calculator")
    assert calc["doc"] == "Calculator class."


def test_ruby_no_doc():
    skel = RB.extract_skeleton(RB_DOC)
    plain = next(s for s in skel if s["name"] == "plain")
    assert plain["doc"] == ""


def test_ruby_doc_key_always_present():
    src = b"def foo\n  42\nend\n"
    skel = RB.extract_skeleton(src)
    for item in skel:
        assert "doc" in item


# --- MCP tool skeleton output ---

def test_skeleton_shows_docs(tmp_path):
    (tmp_path / "calc.py").write_text('''\
class Calculator:
    """A simple calculator."""
    def add(self, a, b):
        """Add two numbers."""
        return a + b
    def nodoc(self):
        return 1
''')
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="calc.py")
    assert "A simple calculator." in output
    assert "Add two numbers." in output


def test_skeleton_no_doc_no_extra_line(tmp_path):
    (tmp_path / "bare.py").write_text("def bare(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="bare.py")
    assert '""' not in output


def test_skeleton_shows_go_doc(tmp_path):
    (tmp_path / "main.go").write_text("package main\n\n// NewServer creates a server.\nfunc NewServer() {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="main.go")
    assert "NewServer creates a server." in output


def test_skeleton_shows_java_doc(tmp_path):
    (tmp_path / "Calc.java").write_text("/** A calculator. */\npublic class Calculator {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="Calc.java")
    assert "A calculator." in output
