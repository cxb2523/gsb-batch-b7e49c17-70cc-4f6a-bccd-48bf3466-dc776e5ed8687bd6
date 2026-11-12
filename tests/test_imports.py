"""Tests for import/use statement extraction across all languages."""
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

# --- Empty file: all plugins ---

@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_imports(plugin):
    """Empty file should return empty imports."""
    assert plugin.extract_imports(b"") == []


# --- Python ---

PY_IMPORTS = b"""\
import os
from pathlib import Path
from typing import Optional, List
import json as j

def foo():
    pass
"""


def test_python_imports_basic():
    result = PY.extract_imports(PY_IMPORTS)
    assert len(result) == 4
    assert result[0] == {"line": 1, "text": "import os"}
    assert result[1] == {"line": 2, "text": "from pathlib import Path"}
    assert result[2] == {"line": 3, "text": "from typing import Optional, List"}
    assert result[3] == {"line": 4, "text": "import json as j"}


def test_python_imports_empty():
    result = PY.extract_imports(b"def foo(): pass\n")
    assert result == []


def test_python_imports_sorted_by_line():
    result = PY.extract_imports(PY_IMPORTS)
    lines = [r["line"] for r in result]
    assert lines == sorted(lines)


def test_python_future_imports():
    src = b"from __future__ import annotations\nimport os\n"
    result = PY.extract_imports(src)
    assert len(result) == 2
    assert "__future__" in result[0]["text"]


def test_python_relative_imports():
    src = b"from . import utils\nfrom ..models import Base\n"
    result = PY.extract_imports(src)
    assert len(result) == 2
    assert "from . import utils" in result[0]["text"]
    assert "from ..models import Base" in result[1]["text"]


# --- JavaScript ---

JS_IMPORTS = b"""\
import { foo, bar } from './utils';
import baz from 'baz';
const x = require('old-module');

function greet() {}
"""


def test_js_imports_basic():
    result = JS.extract_imports(JS_IMPORTS)
    assert len(result) == 2  # require() is not an import_statement
    assert "foo, bar" in result[0]["text"]
    assert result[1]["text"] == "import baz from 'baz';"


def test_js_imports_empty():
    result = JS.extract_imports(b"function foo() {}\n")
    assert result == []


def test_js_import_star():
    src = b"import * as React from 'react';\n"
    result = JS.extract_imports(src)
    assert len(result) == 1
    assert "* as React" in result[0]["text"]


def test_js_import_side_effect():
    src = b"import './polyfill';\n"
    result = JS.extract_imports(src)
    assert len(result) == 1
    assert "'./polyfill'" in result[0]["text"]


# --- TypeScript ---

TS_IMPORTS = b"""\
import { Component } from 'react';
import type { Props } from './types';

class App {}
"""


def test_ts_imports_basic():
    result = TS.extract_imports(TS_IMPORTS)
    assert len(result) == 2
    assert "Component" in result[0]["text"]
    assert "type" in result[1]["text"]


def test_ts_imports_empty():
    result = TS.extract_imports(b"class App {}\n")
    assert result == []


# --- Go ---

GO_IMPORTS = b"""\
package main

import (
    "fmt"
    "os"
)

import "strings"

func main() {}
"""


def test_go_imports_grouped():
    result = GO.extract_imports(GO_IMPORTS)
    assert len(result) == 2  # two import_declaration nodes
    assert '"fmt"' in result[0]["text"]
    assert '"os"' in result[0]["text"]
    assert '"strings"' in result[1]["text"]


def test_go_imports_empty():
    result = GO.extract_imports(b"package main\n\nfunc main() {}\n")
    assert result == []


def test_go_imports_aliased():
    src = b'package main\n\nimport f "fmt"\n'
    result = GO.extract_imports(src)
    assert len(result) == 1
    assert '"fmt"' in result[0]["text"]


# --- Rust ---

RUST_IMPORTS = b"""\
use std::io::Read;
use std::collections::{HashMap, HashSet};

fn main() {}
"""


def test_rust_imports_basic():
    result = RS.extract_imports(RUST_IMPORTS)
    assert len(result) == 2
    assert "std::io::Read" in result[0]["text"]
    assert "HashMap" in result[1]["text"]


def test_rust_imports_empty():
    result = RS.extract_imports(b"fn main() {}\n")
    assert result == []


def test_rust_pub_use():
    src = b"pub use crate::config::Settings;\n"
    result = RS.extract_imports(src)
    assert len(result) == 1
    assert "crate::config::Settings" in result[0]["text"]


# --- Java ---

JAVA_IMPORTS = b"""\
import java.util.List;
import java.util.Map;

public class Main {}
"""


def test_java_imports_basic():
    result = JV.extract_imports(JAVA_IMPORTS)
    assert len(result) == 2
    assert "java.util.List" in result[0]["text"]
    assert "java.util.Map" in result[1]["text"]


def test_java_imports_empty():
    result = JV.extract_imports(b"public class Main {}\n")
    assert result == []


def test_java_wildcard_import():
    src = b"import java.util.*;\n"
    result = JV.extract_imports(src)
    assert len(result) == 1
    assert "java.util.*" in result[0]["text"]


def test_java_static_import():
    src = b"import static java.lang.Math.PI;\n"
    result = JV.extract_imports(src)
    assert len(result) == 1
    assert "static" in result[0]["text"]
    assert "Math.PI" in result[0]["text"]


# --- C ---

C_IMPORTS = b"""\
#include <stdio.h>
#include "myheader.h"

int main() { return 0; }
"""


def test_c_imports_basic():
    result = CC.extract_imports(C_IMPORTS)
    assert len(result) == 2
    assert "<stdio.h>" in result[0]["text"]
    assert "myheader.h" in result[1]["text"]


def test_c_imports_empty():
    result = CC.extract_imports(b"int main() { return 0; }\n")
    assert result == []


# --- C++ ---

CPP_IMPORTS = b"""\
#include <iostream>
#include "utils.h"

int main() { return 0; }
"""


def test_cpp_imports_basic():
    result = CPP.extract_imports(CPP_IMPORTS)
    assert len(result) == 2
    assert "<iostream>" in result[0]["text"]
    assert "utils.h" in result[1]["text"]


def test_cpp_imports_empty():
    result = CPP.extract_imports(b"int main() { return 0; }\n")
    assert result == []


# --- Ruby ---

RB_IMPORTS = b"""\
require "json"
require_relative "utils"

def foo
  42
end
"""


def test_ruby_imports_basic():
    result = RB.extract_imports(RB_IMPORTS)
    assert len(result) == 2
    assert "require" in result[0]["text"]
    assert "json" in result[0]["text"]
    assert "require_relative" in result[1]["text"]


def test_ruby_imports_empty():
    result = RB.extract_imports(b"def foo\n  42\nend\n")
    assert result == []


# --- MCP tool tests ---

def test_get_imports_tool_python(tmp_path):
    (tmp_path / "calc.py").write_text("import os\nfrom math import sqrt\n\ndef calc(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="calc.py")
    assert "import os" in output
    assert "from math import sqrt" in output
    assert "Imports in calc.py:" in output


def test_get_imports_tool_js(tmp_path):
    (tmp_path / "app.js").write_text("import { foo } from './foo';\nfunction bar() {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="app.js")
    assert "import { foo }" in output


def test_get_imports_tool_go(tmp_path):
    (tmp_path / "main.go").write_text('package main\n\nimport "fmt"\n\nfunc main() {}\n')
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="main.go")
    assert '"fmt"' in output


def test_get_imports_tool_rust(tmp_path):
    (tmp_path / "lib.rs").write_text("use std::io;\n\nfn main() {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="lib.rs")
    assert "std::io" in output


def test_get_imports_tool_java(tmp_path):
    (tmp_path / "Main.java").write_text("import java.util.List;\n\npublic class Main {}\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="Main.java")
    assert "java.util.List" in output


def test_get_imports_no_imports(tmp_path):
    (tmp_path / "empty.py").write_text("def foo(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="empty.py")
    assert "No imports" in output


def test_get_imports_unknown_file(tmp_path):
    (tmp_path / "x.py").write_text("x = 1\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="nope.py")
    assert "not found" in output.lower()


def test_get_imports_line_numbers(tmp_path):
    (tmp_path / "calc.py").write_text("import os\nfrom math import sqrt\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="calc.py")
    assert "  1: import os" in output
    assert "  2: from math import sqrt" in output
