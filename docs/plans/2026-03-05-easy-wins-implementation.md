# Easy Wins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add import extraction, docstring extraction, and syntax error reporting to codetree — the 3 highest-value features that most competitors have.

**Architecture:** Each feature adds a new method to `LanguagePlugin` ABC, implemented per-language plugin, exposed via `server.py` tools. Import extraction is a new tool; docstrings add a `doc` field to skeleton; syntax errors add a warning line to skeleton output. All follow existing patterns exactly.

**Tech Stack:** Python, tree-sitter 0.25.x, FastMCP 3.1.0

---

### Task 1: Add `extract_imports` to base class and Python plugin

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/languages/python.py`
- Create: `tests/test_imports.py`

**Step 1: Write the failing test**

In `tests/test_imports.py`:

```python
import pytest
from codetree.languages.python import PythonPlugin

PY = PythonPlugin()

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
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_imports.py -v`
Expected: FAIL with "AttributeError: extract_imports"

**Step 3: Add abstract method to base class**

In `src/codetree/languages/base.py`, add after `extract_symbol_usages`:

```python
@abstractmethod
def extract_imports(self, source: bytes) -> list[dict]:
    """Return import/use statements in the file.

    Each dict has keys:
      - line: int (1-based)
      - text: str (raw import statement text, stripped of trailing newline)
    """
```

**Step 4: Implement in Python plugin**

In `src/codetree/languages/python.py`, add method to `PythonPlugin`:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    tree = _parse(source)
    results = []
    for q_str in [
        "(module (import_statement) @imp)",
        "(module (import_from_statement) @imp)",
    ]:
        for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
            node = m["imp"]
            results.append({
                "line": node.start_point[0] + 1,
                "text": node.text.decode("utf-8", errors="replace").strip(),
            })
    results.sort(key=lambda x: x["line"])
    return results
```

**Step 5: Add stub to all other plugins so ABC doesn't break**

In each of `javascript.py`, `go.py`, `rust.py`, `java.py`, add temporarily:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    return []  # TODO: implement
```

TypeScript inherits from JavaScript, so only JS needs the stub.

**Step 6: Run test to verify it passes**

Run: `source .venv/bin/activate && pytest tests/test_imports.py -v`
Expected: PASS

**Step 7: Run full suite to check no regressions**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass

**Step 8: Commit**

```
feat: add extract_imports to base class and Python plugin
```

---

### Task 2: Implement `extract_imports` for JavaScript and TypeScript

**Files:**
- Modify: `src/codetree/languages/javascript.py`
- Modify: `tests/test_imports.py`

**Step 1: Write the failing tests**

Append to `tests/test_imports.py`:

```python
from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.typescript import TypeScriptPlugin

JS = JavaScriptPlugin()
TS = TypeScriptPlugin()

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
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_imports.py::test_js_imports_basic -v`
Expected: FAIL (returns empty list from stub)

**Step 3: Implement in JavaScript plugin**

Replace the `extract_imports` stub in `javascript.py`:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    lang = self._get_language()
    tree = self._get_parser().parse(source)
    results = []
    q = Query(lang, "(program (import_statement) @imp)")
    for _, m in _matches(q, tree.root_node):
        node = m["imp"]
        results.append({
            "line": node.start_point[0] + 1,
            "text": node.text.decode("utf-8", errors="replace").strip(),
        })
    results.sort(key=lambda x: x["line"])
    return results
```

TypeScript inherits this automatically.

**Step 4: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_imports.py -v`
Expected: PASS

**Step 5: Commit**

```
feat: add extract_imports for JavaScript and TypeScript
```

---

### Task 3: Implement `extract_imports` for Go, Rust, Java

**Files:**
- Modify: `src/codetree/languages/go.py`
- Modify: `src/codetree/languages/rust.py`
- Modify: `src/codetree/languages/java.py`
- Modify: `tests/test_imports.py`

**Step 1: Write the failing tests**

Append to `tests/test_imports.py`:

```python
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin

GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()

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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_imports.py::test_go_imports_grouped tests/test_imports.py::test_rust_imports_basic tests/test_imports.py::test_java_imports_basic -v`
Expected: FAIL (stubs return empty)

**Step 3: Implement Go**

Replace stub in `go.py`:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    tree = _parse(source)
    results = []
    q = Query(_LANGUAGE, "(source_file (import_declaration) @imp)")
    for _, m in _matches(q, tree.root_node):
        node = m["imp"]
        results.append({
            "line": node.start_point[0] + 1,
            "text": node.text.decode("utf-8", errors="replace").strip(),
        })
    results.sort(key=lambda x: x["line"])
    return results
```

**Step 4: Implement Rust**

Replace stub in `rust.py`:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    tree = _parse(source)
    results = []
    q = Query(_LANGUAGE, "(source_file (use_declaration) @imp)")
    for _, m in _matches(q, tree.root_node):
        node = m["imp"]
        results.append({
            "line": node.start_point[0] + 1,
            "text": node.text.decode("utf-8", errors="replace").strip(),
        })
    results.sort(key=lambda x: x["line"])
    return results
```

**Step 5: Implement Java**

Replace stub in `java.py`:

```python
def extract_imports(self, source: bytes) -> list[dict]:
    tree = _parse(source)
    results = []
    q = Query(_LANGUAGE, "(program (import_declaration) @imp)")
    for _, m in _matches(q, tree.root_node):
        node = m["imp"]
        results.append({
            "line": node.start_point[0] + 1,
            "text": node.text.decode("utf-8", errors="replace").strip(),
        })
    results.sort(key=lambda x: x["line"])
    return results
```

**Step 6: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_imports.py -v`
Expected: PASS

**Step 7: Commit**

```
feat: add extract_imports for Go, Rust, and Java
```

---

### Task 4: Add `get_imports` MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_imports.py`

**Step 1: Write the failing test**

Append to `tests/test_imports.py`:

```python
from codetree.server import create_server

def test_get_imports_tool(tmp_path):
    (tmp_path / "calc.py").write_text("import os\nfrom math import sqrt\n\ndef calc(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_imports@"].fn
    output = fn(file_path="calc.py")
    assert "import os" in output
    assert "from math import sqrt" in output

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
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_imports.py::test_get_imports_tool -v`
Expected: FAIL (tool not registered)

**Step 3: Add tool to server.py**

In `server.py`, add after the `get_call_graph` tool definition:

```python
@mcp.tool()
def get_imports(file_path: str) -> str:
    """Get import/use statements from a source file.

    Args:
        file_path: path relative to the repo root (e.g., "src/main.py" or "calculator.py")
    """
    entry = indexer._index.get(file_path)
    if entry is None:
        return f"File not found: {file_path}"
    imports = entry.plugin.extract_imports(entry.source)
    if not imports:
        return f"No imports found in {file_path}"
    lines = [f"Imports in {file_path}:"]
    for imp in imports:
        lines.append(f"  {imp['line']}: {imp['text']}")
    return "\n".join(lines)
```

**Step 4: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_imports.py -v`
Expected: PASS

**Step 5: Run full suite**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass

**Step 6: Commit**

```
feat: add get_imports MCP tool
```

---

### Task 5: Add `doc` field to skeleton — Python

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/languages/python.py`
- Create: `tests/test_docstrings.py`

**Step 1: Write the failing test**

In `tests/test_docstrings.py`:

```python
import pytest
from codetree.languages.python import PythonPlugin

PY = PythonPlugin()

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
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py -v`
Expected: FAIL with KeyError: 'doc'

**Step 3: Add `_extract_doc_for_node` helper to base.py**

In `base.py`, add a default helper (not abstract — languages override if needed):

```python
def _extract_doc_for_node(self, node) -> str:
    """Extract first line of a doc comment for a definition node.

    Default: checks the previous named sibling for a comment node
    starting with '/**', '///', or '//'.
    Python overrides this to check the first statement in the body.
    Returns empty string if no doc found.
    """
    prev = node.prev_named_sibling
    if prev is None:
        return ""
    text = prev.text.decode("utf-8", errors="replace")
    if prev.type in ("comment", "line_comment", "block_comment"):
        # Strip comment markers and get first meaningful line
        return _clean_doc(text)
    return ""
```

Also add a module-level helper in `base.py`:

```python
def _clean_doc(text: str) -> str:
    """Extract the first meaningful line from a doc comment."""
    lines = text.strip().splitlines()
    for line in lines:
        stripped = line.strip().lstrip("/*#!> ").rstrip("*/").strip()
        if stripped:
            return stripped
    return ""
```

**Step 4: Override in Python plugin — docstrings are in the body, not siblings**

Add to `PythonPlugin` class:

```python
def _extract_doc_for_node(self, node) -> str:
    """Python: docstring is the first expression_statement in the body."""
    body = None
    for child in node.children:
        if child.type == "block":
            body = child
            break
    if body is None:
        return ""
    first = body.children[0] if body.children else None
    if first is None:
        return ""
    # Skip the ":" that starts the block
    for child in body.children:
        if child.type == "expression_statement":
            first = child
            break
    else:
        return ""
    # Check if it's a string literal (docstring)
    if first.type == "expression_statement" and first.children:
        str_node = first.children[0]
        if str_node.type == "string":
            text = str_node.text.decode("utf-8", errors="replace")
            # Strip triple quotes
            for q in ('"""', "'''"):
                if text.startswith(q) and text.endswith(q):
                    text = text[3:-3]
                    break
            return text.strip().splitlines()[0].strip() if text.strip() else ""
    return ""
```

**Step 5: Add `doc` field to all skeleton items in Python plugin**

In `python.py`'s `extract_skeleton`, after each `results.append(...)`, add the `doc` field. The pattern for each item:

For classes (both plain and decorated), add doc lookup. The class definition node is available from the query match. For the plain query, the `@def` capture is the class node. For decorated, the `@def` capture is the `decorated_definition` — we need the inner class.

Update each `results.append(...)` block to include `"doc"`. For classes:
```python
"doc": self._extract_doc_for_node(m["name"].parent),  # class_definition node
```

Actually, simpler approach: after building the full results list and before dedup, do a second pass to fill in docs. This avoids touching every append call.

Add right before the dedup section in `extract_skeleton`:

```python
# Fill in doc fields
tree = _parse(source)  # already parsed above — reuse
for item in results:
    item.setdefault("doc", "")
# Use queries to find doc for each definition node
for q_str in [
    '(class_definition name: (identifier) @name body: (block . (expression_statement (string) @doc)))',
    '(function_definition name: (identifier) @name body: (block . (expression_statement (string) @doc)))',
]:
    for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
        name = m["name"].text.decode("utf-8", errors="replace")
        line = m["name"].start_point[0] + 1
        doc_text = m["doc"].text.decode("utf-8", errors="replace")
        # Strip triple quotes
        for q in ('"""', "'''"):
            if doc_text.startswith(q) and doc_text.endswith(q):
                doc_text = doc_text[3:-3]
                break
        first_line = doc_text.strip().splitlines()[0].strip() if doc_text.strip() else ""
        for item in results:
            if item["name"] == name and item["line"] == line:
                item["doc"] = first_line
                break
```

**Step 6: Run test**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py -v`
Expected: PASS

**Step 7: Run full suite**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass (existing tests shouldn't break — they don't check for `doc` key absence)

**Step 8: Commit**

```
feat: add docstring extraction to Python skeleton
```

---

### Task 6: Add `doc` field to skeleton — JS, TS, Go, Rust, Java

**Files:**
- Modify: `src/codetree/languages/javascript.py`
- Modify: `src/codetree/languages/typescript.py`
- Modify: `src/codetree/languages/go.py`
- Modify: `src/codetree/languages/rust.py`
- Modify: `src/codetree/languages/java.py`
- Modify: `tests/test_docstrings.py`

**Step 1: Write the failing tests**

Append to `tests/test_docstrings.py`:

```python
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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py::test_js_function_doc tests/test_docstrings.py::test_go_function_doc tests/test_docstrings.py::test_rust_function_doc tests/test_docstrings.py::test_java_class_doc -v`
Expected: FAIL with KeyError: 'doc'

**Step 3: Implement for all languages**

The pattern is the same for JS/TS/Go/Rust/Java: for each skeleton item, look at the definition node's `prev_named_sibling`. If it's a doc comment, extract the first line.

Since the skeleton is built from query matches (which give us the definition nodes via `@def` or class/function nodes), we need to find the definition node for each skeleton item to check its previous sibling.

The cleanest approach: after building the results list, use `_clean_doc` from `base.py` to find docs. Add to each plugin's `extract_skeleton`, before the sort/dedup, a loop that sets `item["doc"] = ""` as default. Then use a separate query pass to find definition nodes and check their siblings.

Simpler: just set `"doc": ""` in every `results.append(...)` call across all language plugins, then add a doc-filling pass per language.

For **JS/TS/Go/Rust/Java**, the doc pass works the same way:
1. Re-walk the tree to find function/class/struct/etc. definition nodes
2. For each, check `prev_named_sibling` for a doc comment
3. Match to skeleton items by `(name, line)`

Add a shared helper to `base.py`:

```python
def _fill_docs_from_siblings(results: list[dict], tree_root, lang, queries: list[str]) -> None:
    """Fill 'doc' field in skeleton items by checking prev_named_sibling of definition nodes."""
    for q_str in queries:
        for _, m in _matches(Query(lang, q_str), tree_root):
            node = m["def"]
            name = m["name"].text.decode("utf-8", errors="replace")
            line = m["name"].start_point[0] + 1
            prev = node.prev_named_sibling
            doc = ""
            if prev and prev.type in ("comment", "line_comment", "block_comment"):
                doc = _clean_doc(prev.text.decode("utf-8", errors="replace"))
            for item in results:
                if item["name"] == name and item["line"] == line:
                    item["doc"] = doc
                    break
```

Then in each plugin's `extract_skeleton`, after building results and before dedup:
1. Set `"doc": ""` as default on all items
2. Call `_fill_docs_from_siblings` with the right queries

For **JavaScript**, add after building results:

```python
for item in results:
    item.setdefault("doc", "")
_fill_docs_from_siblings(results, tree.root_node, lang, [
    "(function_declaration name: (identifier) @name) @def",
    "(class_declaration name: (identifier) @name) @def",
    "(export_statement (function_declaration name: (identifier) @name) @def)",
    "(export_statement (class_declaration name: (identifier) @name) @def)",
])
```

For **TypeScript**, same but with `type_identifier` for classes:

```python
for item in results:
    item.setdefault("doc", "")
_fill_docs_from_siblings(results, tree.root_node, lang, [
    "(function_declaration name: (identifier) @name) @def",
    "(class_declaration name: (type_identifier) @name) @def",
    "(abstract_class_declaration name: (type_identifier) @name) @def",
    "(interface_declaration name: (type_identifier) @name) @def",
    "(type_alias_declaration name: (type_identifier) @name) @def",
    "(export_statement (function_declaration name: (identifier) @name) @def)",
    "(export_statement (class_declaration name: (type_identifier) @name) @def)",
    "(export_statement (interface_declaration name: (type_identifier) @name) @def)",
    "(export_statement (type_alias_declaration name: (type_identifier) @name) @def)",
])
```

For **Go**:

```python
for item in results:
    item.setdefault("doc", "")
_fill_docs_from_siblings(results, tree.root_node, _LANGUAGE, [
    "(function_declaration name: (identifier) @name) @def",
    "(type_declaration (type_spec name: (type_identifier) @name)) @def",
    "(method_declaration name: (field_identifier) @name) @def",
])
```

For **Rust**:

```python
for item in results:
    item.setdefault("doc", "")
_fill_docs_from_siblings(results, tree.root_node, _LANGUAGE, [
    "(source_file (function_item name: (identifier) @name) @def)",
    "(source_file (struct_item name: (type_identifier) @name) @def)",
    "(source_file (enum_item name: (type_identifier) @name) @def)",
    "(source_file (trait_item name: (type_identifier) @name) @def)",
])
```

For **Java**:

```python
for item in results:
    item.setdefault("doc", "")
_fill_docs_from_siblings(results, tree.root_node, _LANGUAGE, [
    "(class_declaration name: (identifier) @name) @def",
    "(interface_declaration name: (identifier) @name) @def",
    "(enum_declaration name: (identifier) @name) @def",
    "(method_declaration name: (identifier) @name) @def",
])
```

**Step 4: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py -v`
Expected: PASS

**Step 5: Run full suite**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass

**Step 6: Commit**

```
feat: add doc comment extraction to skeleton for all languages
```

---

### Task 7: Display docs in `get_file_skeleton` MCP tool output

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_docstrings.py`

**Step 1: Write the failing test**

Append to `tests/test_docstrings.py`:

```python
from codetree.server import create_server

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
    # Should NOT have an empty doc line
    assert '""' not in output
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py::test_skeleton_shows_docs -v`
Expected: FAIL

**Step 3: Update server.py skeleton formatting**

In `server.py`'s `get_file_skeleton` function, after each symbol line, add the doc line if present:

```python
lines = []
for item in skeleton:
    kind = item["type"]
    if kind in ("class", "struct", "interface", "trait", "enum", "type"):
        lines.append(f"{kind} {item['name']} → line {item['line']}")
    else:
        prefix = "  " if item["parent"] else ""
        parent_info = f" (in {item['parent']})" if item["parent"] else ""
        lines.append(f"{prefix}def {item['name']}{item['params']}{parent_info} → line {item['line']}")
    # Show doc on next line, indented, if present
    doc = item.get("doc", "")
    if doc:
        indent = "  " if item.get("parent") else ""
        extra = "  " if kind not in ("class", "struct", "interface", "trait", "enum", "type") else ""
        lines.append(f"{indent}{extra}\"{doc}\"")
return "\n".join(lines)
```

**Step 4: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_docstrings.py -v`
Expected: PASS

**Step 5: Run full suite**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass

**Step 6: Commit**

```
feat: display doc comments in get_file_skeleton output
```

---

### Task 8: Add syntax error reporting

**Files:**
- Modify: `src/codetree/indexer.py`
- Modify: `src/codetree/languages/base.py`
- Modify: all language plugins (add `check_syntax`)
- Modify: `src/codetree/server.py`
- Create: `tests/test_syntax_errors.py`

**Step 1: Write the failing test**

In `tests/test_syntax_errors.py`:

```python
import pytest
from codetree.languages.python import PythonPlugin
from codetree.languages.javascript import JavaScriptPlugin
from codetree.languages.go import GoPlugin
from codetree.languages.rust import RustPlugin
from codetree.languages.java import JavaPlugin

PY = PythonPlugin()
JS = JavaScriptPlugin()
GO = GoPlugin()
RS = RustPlugin()
JV = JavaPlugin()

def test_python_clean_no_errors():
    assert PY.check_syntax(b"def foo(): pass\n") is False

def test_python_syntax_error():
    assert PY.check_syntax(b"def foo(:\n    pass\n") is True

def test_js_clean_no_errors():
    assert JS.check_syntax(b"function foo() {}\n") is False

def test_js_syntax_error():
    assert JS.check_syntax(b"function foo({ {}\n") is True

def test_go_clean():
    assert GO.check_syntax(b"package main\nfunc main() {}\n") is False

def test_rust_clean():
    assert RS.check_syntax(b"fn main() {}\n") is False

def test_java_clean():
    assert JV.check_syntax(b"class Foo {}\n") is False
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_syntax_errors.py -v`
Expected: FAIL with AttributeError

**Step 3: Add `check_syntax` to base and all plugins**

In `base.py`, add (NOT abstract — provide a default):

```python
def check_syntax(self, source: bytes) -> bool:
    """Return True if the source has syntax errors.
    Subclasses should override if they have a different parser setup.
    """
    return False  # Default: no errors detectable
```

In each plugin, add the method. For **Python**:

```python
def check_syntax(self, source: bytes) -> bool:
    return _parse(source).root_node.has_error
```

For **JavaScript** (inherited by TypeScript):

```python
def check_syntax(self, source: bytes) -> bool:
    return self._get_parser().parse(source).root_node.has_error
```

For **Go**:

```python
def check_syntax(self, source: bytes) -> bool:
    return _parse(source).root_node.has_error
```

For **Rust**:

```python
def check_syntax(self, source: bytes) -> bool:
    return _parse(source).root_node.has_error
```

For **Java**:

```python
def check_syntax(self, source: bytes) -> bool:
    return _parse(source).root_node.has_error
```

**Step 4: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_syntax_errors.py -v`
Expected: PASS

**Step 5: Commit**

```
feat: add check_syntax method to all language plugins
```

---

### Task 9: Add `has_errors` to FileEntry and skeleton warning

**Files:**
- Modify: `src/codetree/indexer.py`
- Modify: `src/codetree/server.py`
- Modify: `tests/test_syntax_errors.py`

**Step 1: Write the failing test**

Append to `tests/test_syntax_errors.py`:

```python
from codetree.server import create_server

def test_skeleton_warns_on_syntax_error(tmp_path):
    (tmp_path / "broken.py").write_text("def foo(:\n    pass\n\ndef bar():\n    return 1\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="broken.py")
    assert "syntax error" in output.lower()

def test_skeleton_no_warning_on_clean(tmp_path):
    (tmp_path / "clean.py").write_text("def foo(): pass\n")
    mcp = create_server(str(tmp_path))
    fn = mcp.local_provider._components["tool:get_file_skeleton@"].fn
    output = fn(file_path="clean.py")
    assert "syntax error" not in output.lower()
```

**Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && pytest tests/test_syntax_errors.py::test_skeleton_warns_on_syntax_error -v`
Expected: FAIL

**Step 3: Add `has_errors` to FileEntry**

In `indexer.py`, update the `FileEntry` dataclass:

```python
@dataclass
class FileEntry:
    path: Path
    source: bytes
    skeleton: list[dict]
    mtime: float
    language: str
    plugin: LanguagePlugin
    has_errors: bool = False
```

In the `build` method, after `skeleton = plugin.extract_skeleton(source)`, add:

```python
has_errors = plugin.check_syntax(source)
```

And pass it to the FileEntry constructor:

```python
self._index[rel] = FileEntry(
    path=candidate,
    source=source,
    skeleton=skeleton,
    mtime=mtime,
    language=candidate.suffix.lstrip("."),
    plugin=plugin,
    has_errors=has_errors,
)
```

Also update `inject_cached` to accept and set `has_errors=False` (cached files were clean when cached).

**Step 4: Add warning to `get_file_skeleton` in server.py**

In `server.py`'s `get_file_skeleton`, before building the output lines:

```python
entry = indexer._index.get(file_path)
skeleton = indexer.get_skeleton(file_path)
if not skeleton:
    return f"File not found or empty: {file_path}"

lines = []
if entry and entry.has_errors:
    lines.append("WARNING: File has syntax errors — skeleton may be incomplete\n")
# ... rest of skeleton formatting
```

**Step 5: Run tests**

Run: `source .venv/bin/activate && pytest tests/test_syntax_errors.py -v`
Expected: PASS

**Step 6: Run full suite**

Run: `source .venv/bin/activate && pytest tests/ -q`
Expected: all pass

**Step 7: Commit**

```
feat: add syntax error warning to get_file_skeleton output
```

---

### Task 10: Update template, CLAUDE.md, and final verification

**Files:**
- Modify: `src/codetree/languages/_template.py`
- Modify: `CLAUDE.md`

**Step 1: Update `_template.py` with new methods**

Add `extract_imports` and `check_syntax` stubs to the template.

**Step 2: Update CLAUDE.md**

- Add `get_imports` to the tools table
- Update test count
- Note the `doc` field in skeleton
- Note syntax error warnings

**Step 3: Run full test suite**

Run: `source .venv/bin/activate && pytest tests/ -v`
Expected: all pass, no regressions

**Step 4: Commit**

```
docs: update template and CLAUDE.md for new features
```
