"""Tests for newly added features:
- extract_symbol_source finding methods inside classes (JS, TS, Go)
- extract_calls_in_function for methods (JS, TS, Go)
- Rust traits and enums
- Java enums
- TypeScript type aliases
- Indexer egg-info and symlink fixes
"""
import os
import pytest
from pathlib import Path

from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin, TSXPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin
from codetree.indexer import Indexer


JS = JavaScriptPlugin()
TS = TypeScriptPlugin()
TSX = TSXPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()


# ============================================================
# JS: extract_symbol_source and extract_calls_in_function for methods
# ============================================================

JS_CLASS_CODE = b"""\
class Calculator {
    add(a, b) { return a + b; }
    subtract(a, b) { return a - b; }
    process() {
        return this.add(1, 2) + this.subtract(3, 1);
    }
}

function helper() {
    const c = new Calculator();
    return c.add(1, 2);
}
"""


def test_js_extract_method_source():
    result = JS.extract_symbol_source(JS_CLASS_CODE, "add")
    assert result is not None
    source, line = result
    assert "add(a, b)" in source
    assert line == 2


def test_js_extract_method_source_subtract():
    result = JS.extract_symbol_source(JS_CLASS_CODE, "subtract")
    assert result is not None
    source, _ = result
    assert "subtract(a, b)" in source


def test_js_extract_method_calls():
    calls = JS.extract_calls_in_function(JS_CLASS_CODE, "process")
    assert "add" in calls
    assert "subtract" in calls


def test_js_extract_method_source_process():
    result = JS.extract_symbol_source(JS_CLASS_CODE, "process")
    assert result is not None
    source, _ = result
    assert "process()" in source


# ============================================================
# TS: extract_symbol_source for methods, interfaces, type aliases
# ============================================================

TS_CODE = b"""\
interface Shape {
    area(): number;
}

type Point = { x: number; y: number };

export type Result<T> = { ok: boolean; value: T };

abstract class Base {
    abstract doWork(): void;
}

class Circle implements Shape {
    constructor(public radius: number) {}
    area(): number {
        return Math.PI * this.radius ** 2;
    }
}
"""


def test_ts_extract_interface_source():
    result = TS.extract_symbol_source(TS_CODE, "Shape")
    assert result is not None
    source, _ = result
    assert "interface Shape" in source


def test_ts_extract_type_alias_source():
    result = TS.extract_symbol_source(TS_CODE, "Point")
    assert result is not None
    source, _ = result
    assert "Point" in source
    assert "x: number" in source


def test_ts_extract_exported_type_alias():
    result = TS.extract_symbol_source(TS_CODE, "Result")
    assert result is not None
    source, _ = result
    assert "Result" in source


def test_ts_extract_method_source():
    result = TS.extract_symbol_source(TS_CODE, "area")
    assert result is not None
    source, _ = result
    assert "area()" in source
    assert "Math.PI" in source


def test_ts_extract_abstract_method():
    result = TS.extract_symbol_source(TS_CODE, "doWork")
    assert result is not None
    source, _ = result
    assert "doWork" in source


def test_ts_skeleton_includes_type_aliases():
    skel = TS.extract_skeleton(TS_CODE)
    names = {s["name"]: s["type"] for s in skel}
    assert names.get("Point") == "type"
    assert names.get("Result") == "type"
    assert names.get("Shape") == "interface"


def test_tsx_type_alias():
    """TSX plugin should also handle type aliases."""
    code = b"type Props = { name: string };\nfunction App(props: Props) { return null; }\n"
    skel = TSX.extract_skeleton(code)
    names = {s["name"]: s["type"] for s in skel}
    assert names.get("Props") == "type"
    assert names.get("App") == "function"


def test_ts_method_calls():
    """extract_calls_in_function should work for methods."""
    code = b"""\
class Service {
    fetch() { return getData(); }
    process() {
        const raw = this.fetch();
        return transform(raw);
    }
}
"""
    calls = TS.extract_calls_in_function(code, "process")
    assert "fetch" in calls
    assert "transform" in calls


# ============================================================
# Go: extract_symbol_source and extract_calls_in_function for methods
# ============================================================

GO_CODE = b"""\
package main

type Server struct {
    port int
}

type Handler interface {
    Handle(req string) string
}

func (s *Server) Start() error {
    return Listen(s.port)
}

func (s Server) GetPort() int {
    return s.port
}

func NewServer(port int) *Server {
    return &Server{port: port}
}

func Listen(port int) error {
    return nil
}
"""


def test_go_extract_method_source_pointer_receiver():
    result = GO.extract_symbol_source(GO_CODE, "Start")
    assert result is not None
    source, _ = result
    assert "func (s *Server) Start()" in source


def test_go_extract_method_source_value_receiver():
    result = GO.extract_symbol_source(GO_CODE, "GetPort")
    assert result is not None
    source, _ = result
    assert "func (s Server) GetPort()" in source


def test_go_extract_interface_source():
    result = GO.extract_symbol_source(GO_CODE, "Handler")
    assert result is not None
    source, _ = result
    assert "Handler" in source


def test_go_method_calls():
    calls = GO.extract_calls_in_function(GO_CODE, "Start")
    assert "Listen" in calls


def test_go_method_calls_not_found():
    calls = GO.extract_calls_in_function(GO_CODE, "GetPort")
    assert calls == []


# ============================================================
# Rust: traits and enums
# ============================================================

RUST_TRAIT_CODE = b"""\
pub trait Drawable {
    fn draw(&self);
    fn bounds(&self) -> (u32, u32) {
        (0, 0)
    }
}

pub enum Shape {
    Circle(f64),
    Rectangle(f64, f64),
}

pub struct Canvas {
    shapes: Vec<Shape>,
}

impl Canvas {
    pub fn new() -> Self {
        Canvas { shapes: Vec::new() }
    }
    pub fn add(&mut self, shape: Shape) {
        self.shapes.push(shape);
    }
}

impl Drawable for Canvas {
    fn draw(&self) {
        for s in &self.shapes {
            render(s);
        }
    }
}

fn render(shape: &Shape) {}
"""


def test_rust_skeleton_trait():
    skel = RS.extract_skeleton(RUST_TRAIT_CODE)
    traits = [s for s in skel if s["type"] == "trait"]
    assert len(traits) == 1
    assert traits[0]["name"] == "Drawable"


def test_rust_skeleton_trait_methods():
    skel = RS.extract_skeleton(RUST_TRAIT_CODE)
    trait_methods = [s for s in skel if s["parent"] == "Drawable"]
    names = {s["name"] for s in trait_methods}
    assert "draw" in names
    assert "bounds" in names


def test_rust_skeleton_enum():
    skel = RS.extract_skeleton(RUST_TRAIT_CODE)
    enums = [s for s in skel if s["type"] == "enum"]
    assert len(enums) == 1
    assert enums[0]["name"] == "Shape"


def test_rust_skeleton_impl_methods():
    skel = RS.extract_skeleton(RUST_TRAIT_CODE)
    canvas_methods = [s for s in skel if s["parent"] == "Canvas"]
    names = {s["name"] for s in canvas_methods}
    assert "new" in names
    assert "add" in names
    # draw from 'impl Drawable for Canvas' should also show parent=Canvas
    assert "draw" in names


def test_rust_extract_trait_source():
    result = RS.extract_symbol_source(RUST_TRAIT_CODE, "Drawable")
    assert result is not None
    source, _ = result
    assert "trait Drawable" in source
    assert "fn draw" in source
    assert "fn bounds" in source


def test_rust_extract_enum_source():
    result = RS.extract_symbol_source(RUST_TRAIT_CODE, "Shape")
    assert result is not None
    source, _ = result
    assert "enum Shape" in source
    assert "Circle" in source
    assert "Rectangle" in source


def test_rust_extract_method_in_trait_impl():
    """extract_symbol_source should find methods inside impl blocks."""
    result = RS.extract_symbol_source(RUST_TRAIT_CODE, "add")
    assert result is not None
    source, _ = result
    assert "fn add" in source


def test_rust_trait_usages():
    usages = RS.extract_symbol_usages(RUST_TRAIT_CODE, "Drawable")
    assert len(usages) >= 2  # definition + impl


def test_rust_enum_usages():
    usages = RS.extract_symbol_usages(RUST_TRAIT_CODE, "Shape")
    assert len(usages) >= 2  # definition + usage in Canvas


# ============================================================
# Java: enums
# ============================================================

JAVA_ENUM_CODE = b"""\
public enum Direction {
    NORTH, SOUTH, EAST, WEST;

    public String display() {
        return name().toLowerCase();
    }
}

public enum Status {
    ACTIVE,
    INACTIVE;
}

public class Navigator {
    public Direction getDirection() {
        return Direction.NORTH;
    }
}
"""


def test_java_skeleton_enums():
    skel = JV.extract_skeleton(JAVA_ENUM_CODE)
    enums = [s for s in skel if s["type"] == "enum"]
    names = {s["name"] for s in enums}
    assert "Direction" in names
    assert "Status" in names


def test_java_enum_methods():
    skel = JV.extract_skeleton(JAVA_ENUM_CODE)
    enum_methods = [s for s in skel if s["parent"] == "Direction"]
    assert any(s["name"] == "display" for s in enum_methods)


def test_java_extract_enum_source():
    result = JV.extract_symbol_source(JAVA_ENUM_CODE, "Direction")
    assert result is not None
    source, _ = result
    assert "enum Direction" in source
    assert "NORTH" in source


def test_java_extract_enum_method_source():
    result = JV.extract_symbol_source(JAVA_ENUM_CODE, "display")
    assert result is not None
    source, _ = result
    assert "display()" in source


def test_java_enum_usages():
    usages = JV.extract_symbol_usages(JAVA_ENUM_CODE, "Direction")
    assert len(usages) >= 2  # definition + usage in Navigator


# ============================================================
# Indexer: egg-info and symlink
# ============================================================


def test_indexer_skips_egg_info(tmp_path):
    """The indexer should skip *.egg-info directories."""
    egg_dir = tmp_path / "mypackage.egg-info"
    egg_dir.mkdir()
    (egg_dir / "setup.py").write_text("def setup(): pass\n")
    (tmp_path / "real.py").write_text("def main(): pass\n")

    indexer = Indexer(tmp_path)
    indexer.build()
    files = {str(f.relative_to(tmp_path)) for f in indexer.files}
    assert "real.py" in files
    assert "mypackage.egg-info/setup.py" not in files


def test_indexer_skips_symlinks(tmp_path):
    """The indexer should skip symlinked files."""
    real = tmp_path / "real.py"
    real.write_text("def real_fn(): pass\n")
    link = tmp_path / "link.py"
    link.symlink_to(real)

    indexer = Indexer(tmp_path)
    indexer.build()
    files = {str(f.relative_to(tmp_path)) for f in indexer.files}
    assert "real.py" in files
    assert "link.py" not in files


def test_indexer_skips_symlinked_dirs(tmp_path):
    """The indexer should not follow symlinked directories."""
    real_dir = tmp_path / "src"
    real_dir.mkdir()
    (real_dir / "main.py").write_text("def main(): pass\n")

    link_dir = tmp_path / "linked_src"
    link_dir.symlink_to(real_dir)

    indexer = Indexer(tmp_path)
    indexer.build()
    files = {str(f.relative_to(tmp_path)) for f in indexer.files}
    assert "src/main.py" in files
    # Files under linked_src should not be indexed
    assert "linked_src/main.py" not in files
