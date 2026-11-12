# Phase 2 Implementation Plan: Batch Operations, Complexity Metrics, More Languages

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add batch operations (get_skeletons, get_symbols), cyclomatic complexity metrics (get_complexity), and three new languages (C, C++, Ruby) to codetree.

**Architecture:** Batch tools are thin wrappers around existing indexer methods with inline error handling per item. Complexity is a new plugin method (`compute_complexity`) with a default None implementation in `base.py` — each language overrides with its branching node types. New languages follow the existing plugin pattern; C++ inherits from C like TypeScript inherits from JavaScript.

**Tech Stack:** Python 3.10+, tree-sitter 0.25.x, tree-sitter-c 0.24.1, tree-sitter-cpp 0.23.4, tree-sitter-ruby 0.23.1, FastMCP 3.1.0, pytest

---

## Task 1: Install new dependencies

**Files:**
- Modify: `pyproject.toml`

**Step 1: Add tree-sitter-c, tree-sitter-cpp, tree-sitter-ruby to pyproject.toml**

```toml
dependencies = [
    "tree-sitter>=0.23.0",
    "tree-sitter-python>=0.23.0",
    "tree-sitter-javascript>=0.23.0",
    "tree-sitter-typescript>=0.23.0",
    "tree-sitter-go>=0.23.0",
    "tree-sitter-rust>=0.23.0",
    "tree-sitter-java>=0.23.0",
    "tree-sitter-c>=0.23.0",
    "tree-sitter-cpp>=0.23.0",
    "tree-sitter-ruby>=0.23.0",
    "fastmcp>=2.0.0",
]
```

**Step 2: Install**

Run: `source .venv/bin/activate && pip install -e .`
Expected: Successfully installed

**Step 3: Verify imports**

Run: `python -c "import tree_sitter_c; import tree_sitter_cpp; import tree_sitter_ruby; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "chore: add tree-sitter-c, tree-sitter-cpp, tree-sitter-ruby dependencies"
```

---

## Task 2: Batch operations — get_skeletons tool

**Files:**
- Create: `tests/test_batch.py`
- Modify: `src/codetree/server.py`

**Step 1: Write the failing tests**

Create `tests/test_batch.py`:

```python
"""Tests for batch operations: get_skeletons and get_symbols."""
import pytest
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── get_skeletons ───────────────────────────────────────────────────────────

class TestGetSkeletons:

    def test_returns_skeletons_for_multiple_files(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py", "main.py"])
        assert "=== calculator.py ===" in result
        assert "=== main.py ===" in result
        assert "Calculator" in result
        assert "run" in result

    def test_single_file(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py"])
        assert "=== calculator.py ===" in result
        assert "Calculator" in result

    def test_empty_list_returns_message(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=[])
        assert "no files" in result.lower()

    def test_missing_file_shows_inline_error(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py", "nonexistent.py"])
        assert "=== calculator.py ===" in result
        assert "Calculator" in result
        assert "nonexistent.py" in result
        assert "not found" in result.lower()

    def test_all_files_missing(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["a.py", "b.py"])
        assert "not found" in result.lower()

    def test_includes_line_numbers(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py"])
        assert "→ line" in result

    def test_multi_language_files(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_skeletons")
        result = fn(file_paths=["calc.py", "utils.js", "server.go"])
        assert "=== calc.py ===" in result
        assert "=== utils.js ===" in result
        assert "=== server.go ===" in result
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_batch.py::TestGetSkeletons -v`
Expected: FAIL — tool "get_skeletons" not registered

**Step 3: Implement get_skeletons tool in server.py**

Add after the `get_imports` tool (before `return mcp`):

```python
@mcp.tool()
def get_skeletons(file_paths: list[str]) -> str:
    """Get skeletons for multiple files in one call.

    Args:
        file_paths: list of paths relative to the repo root
    """
    if not file_paths:
        return "No files requested."
    parts = []
    for fp in file_paths:
        parts.append(f"=== {fp} ===")
        skeleton = indexer.get_skeleton(fp)
        if not skeleton:
            parts.append(f"File not found or empty: {fp}")
            parts.append("")
            continue
        entry = indexer._index.get(fp)
        if entry and entry.has_errors:
            parts.append("WARNING: File has syntax errors — skeleton may be incomplete")
        for item in skeleton:
            kind = item["type"]
            if kind in ("class", "struct", "interface", "trait", "enum", "type"):
                parts.append(f"{kind} {item['name']} → line {item['line']}")
            else:
                prefix = "  " if item["parent"] else ""
                parent_info = f" (in {item['parent']})" if item["parent"] else ""
                parts.append(f"{prefix}def {item['name']}{item['params']}{parent_info} → line {item['line']}")
            doc = item.get("doc", "")
            if doc:
                indent = "  " if item.get("parent") else ""
                extra = "  " if kind not in ("class", "struct", "interface", "trait", "enum", "type") else ""
                parts.append(f"{indent}{extra}\"{doc}\"")
        parts.append("")
    return "\n".join(parts).rstrip()
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_batch.py::TestGetSkeletons -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All existing tests still pass

**Step 6: Commit**

```bash
git add tests/test_batch.py src/codetree/server.py
git commit -m "feat: add get_skeletons batch tool"
```

---

## Task 3: Batch operations — get_symbols tool

**Files:**
- Modify: `tests/test_batch.py`
- Modify: `src/codetree/server.py`

**Step 1: Write the failing tests**

Append to `tests/test_batch.py`:

```python
# ─── get_symbols ─────────────────────────────────────────────────────────────

class TestGetSymbols:

    def test_returns_multiple_symbols(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calculator.py", "symbol_name": "Calculator"},
            {"file_path": "calculator.py", "symbol_name": "helper"},
        ])
        assert "# calculator.py:" in result
        assert "class Calculator" in result
        assert "def helper" in result

    def test_single_symbol(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calculator.py", "symbol_name": "helper"},
        ])
        assert "# calculator.py:" in result
        assert "def helper" in result

    def test_empty_list_returns_message(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[])
        assert "no symbols" in result.lower()

    def test_missing_symbol_inline_error(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calculator.py", "symbol_name": "helper"},
            {"file_path": "calculator.py", "symbol_name": "nonexistent"},
        ])
        assert "def helper" in result
        assert "not found" in result.lower()

    def test_missing_file_inline_error(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "ghost.py", "symbol_name": "anything"},
        ])
        assert "not found" in result.lower()

    def test_mixed_found_and_not_found(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calculator.py", "symbol_name": "helper"},
            {"file_path": "ghost.py", "symbol_name": "foo"},
            {"file_path": "calculator.py", "symbol_name": "missing"},
        ])
        assert "def helper" in result
        assert result.lower().count("not found") == 2

    def test_cross_file_symbols(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calculator.py", "symbol_name": "Calculator"},
            {"file_path": "main.py", "symbol_name": "run"},
        ])
        assert "# calculator.py:" in result
        assert "# main.py:" in result

    def test_multi_language(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_symbols")
        result = fn(symbols=[
            {"file_path": "calc.py", "symbol_name": "add"},
            {"file_path": "server.go", "symbol_name": "NewServer"},
        ])
        assert "def add" in result
        assert "func NewServer" in result
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_batch.py::TestGetSymbols -v`
Expected: FAIL — tool "get_symbols" not registered

**Step 3: Implement get_symbols tool in server.py**

Add after `get_skeletons`:

```python
@mcp.tool()
def get_symbols(symbols: list[dict]) -> str:
    """Get the full source code of multiple symbols in one call.

    Args:
        symbols: list of {"file_path": "...", "symbol_name": "..."} dicts
    """
    if not symbols:
        return "No symbols requested."
    parts = []
    for item in symbols:
        fp = item.get("file_path", "")
        name = item.get("symbol_name", "")
        result = indexer.get_symbol(fp, name)
        if result is None:
            parts.append(f"Symbol '{name}' not found in {fp}")
        else:
            source, line = result
            parts.append(f"# {fp}:{line}\n{source}")
    return "\n\n".join(parts)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_batch.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All tests pass

**Step 6: Commit**

```bash
git add tests/test_batch.py src/codetree/server.py
git commit -m "feat: add get_symbols batch tool"
```

---

## Task 4: Complexity — base method and Python implementation

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/languages/python.py`
- Create: `tests/test_complexity.py`

**Step 1: Write the failing tests**

Create `tests/test_complexity.py`:

```python
"""Tests for cyclomatic complexity metrics."""
import pytest
from codetree.languages.python import PythonPlugin

PY = PythonPlugin()


# ─── Python complexity ───────────────────────────────────────────────────────

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
        assert result["total"] == 3  # base 1 + if + elif
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
        # 1 (base) + 1 (if) + 2 (and, or)
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
        assert result["total"] == 4  # base + for + if + while

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
        assert result["total"] == 3  # base + if + for
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py::TestPythonComplexity -v`
Expected: FAIL — `compute_complexity` not found on PythonPlugin

**Step 3: Add compute_complexity to base.py**

Add to `LanguagePlugin` class in `base.py`, after `check_syntax`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    """Return cyclomatic complexity breakdown for a function.

    Returns None if function not found.
    Returns dict with keys:
      - total: int (cyclomatic complexity)
      - breakdown: dict[str, int] (readable_type → count)
    """
    return None
```

**Step 4: Implement compute_complexity for Python**

Add to `PythonPlugin` in `python.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    for q_str in [
        "(function_definition name: (identifier) @name) @def",
        "(decorated_definition (function_definition name: (identifier) @name)) @def",
    ]:
        for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is not None:
            break
    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "elif_clause": "elif",
        "for_statement": "for",
        "while_statement": "while",
        "except_clause": "except",
        "with_statement": "with",
        "boolean_operator": "boolean_op",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 5: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py::TestPythonComplexity -v`
Expected: All PASS

**Step 6: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 7: Commit**

```bash
git add src/codetree/languages/base.py src/codetree/languages/python.py tests/test_complexity.py
git commit -m "feat: add compute_complexity to base + Python implementation"
```

---

## Task 5: Complexity — JS/TS, Go, Rust, Java implementations

**Files:**
- Modify: `src/codetree/languages/javascript.py`
- Modify: `src/codetree/languages/go.py`
- Modify: `src/codetree/languages/rust.py`
- Modify: `src/codetree/languages/java.py`
- Modify: `tests/test_complexity.py`

**Step 1: Write the failing tests**

Append to `tests/test_complexity.py`:

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


# ─── JavaScript complexity ───────────────────────────────────────────────────

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
        assert result["total"] == 4  # base + if + for + while

    def test_ternary_and_logical(self):
        src = b"function check(a, b) { return a && b ? 1 : 0; }\n"
        result = JS.compute_complexity(src, "check")
        assert result["total"] >= 3  # base + && + ternary

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
        assert result["total"] >= 3  # base + 2 cases (default may or may not count)

    def test_try_catch(self):
        src = b"function safe() { try { return 1; } catch(e) { return 0; } }\n"
        result = JS.compute_complexity(src, "safe")
        assert result["total"] == 2  # base + catch

    def test_not_found(self):
        src = b"function foo() {}\n"
        assert JS.compute_complexity(src, "bar") is None

    def test_arrow_function(self):
        src = b"const check = (x) => { if (x > 0) { return x; } return 0; };\n"
        result = JS.compute_complexity(src, "check")
        assert result is not None
        assert result["total"] == 2


# ─── TypeScript complexity ───────────────────────────────────────────────────

class TestTSComplexity:

    def test_ts_inherits_js_complexity(self):
        src = b"function check(x: number): number { if (x > 0) { return x; } return 0; }\n"
        result = TS.compute_complexity(src, "check")
        assert result is not None
        assert result["total"] == 2


# ─── Go complexity ───────────────────────────────────────────────────────────

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
        assert result["total"] == 3  # base + if + for

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
        assert result["total"] >= 3  # base + cases

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


# ─── Rust complexity ─────────────────────────────────────────────────────────

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
        assert result["total"] >= 4  # base + 3 arms

    def test_not_found(self):
        src = b"fn foo() {}\n"
        assert RS.compute_complexity(src, "bar") is None


# ─── Java complexity ─────────────────────────────────────────────────────────

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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py -v -k "not TestPython"`
Expected: FAIL — `compute_complexity` returns None for JS/Go/Rust/Java

**Step 3: Implement compute_complexity for JavaScript**

Add to `JavaScriptPlugin` in `javascript.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    lang = self._get_language()
    tree = self._get_parser().parse(source)
    fn_node = None

    # function_declaration, generator_function_declaration (plain + exported)
    for q_str in [
        "(function_declaration name: (identifier) @name) @def",
        "(generator_function_declaration name: (identifier) @name) @def",
        "(export_statement (function_declaration name: (identifier) @name) @def)",
        "(export_statement (generator_function_declaration name: (identifier) @name) @def)",
    ]:
        for _, m in _matches(Query(lang, q_str), tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node:
            break

    # const/let foo = () => {} or function expression
    if fn_node is None:
        for q_str in [
            """(variable_declarator
                name: (identifier) @name
                value: [(arrow_function) @def (function_expression) @def])""",
        ]:
            for _, m in _matches(Query(lang, q_str), tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                    fn_node = m["def"]
                    break
            if fn_node:
                break

    # Methods
    if fn_node is None:
        q = Query(lang, "(method_definition name: (property_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break

    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "for_statement": "for",
        "for_in_statement": "for_in",
        "while_statement": "while",
        "do_statement": "do_while",
        "switch_case": "case",
        "catch_clause": "catch",
        "ternary_expression": "ternary",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        elif node.type == "binary_expression":
            op = None
            for child in node.children:
                if child.type in ("&&", "||"):
                    op = child.type
            if op:
                counts[op] = counts.get(op, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 4: Implement compute_complexity for Go**

Add to `GoPlugin` in `go.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    q = Query(_LANGUAGE, "(function_declaration name: (identifier) @name) @def")
    for _, m in _matches(q, tree.root_node):
        if m["name"].text.decode("utf-8", errors="replace") == fn_name:
            fn_node = m["def"]
            break
    if fn_node is None:
        q = Query(_LANGUAGE, "(method_declaration name: (field_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "for_statement": "for",
        "select_statement": "select",
        "communication_case": "case",
        "default_case": "default",
        "expression_case": "case",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 5: Implement compute_complexity for Rust**

Add to `RustPlugin` in `rust.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    q = Query(_LANGUAGE, "(function_item name: (identifier) @name) @def")
    for _, m in _matches(q, tree.root_node):
        if m["name"].text.decode("utf-8", errors="replace") == fn_name:
            fn_node = m["def"]
            break
    if fn_node is None:
        return None

    branch_map = {
        "if_expression": "if",
        "for_expression": "for",
        "while_expression": "while",
        "match_arm": "match_arm",
        "try_expression": "try",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 6: Implement compute_complexity for Java**

Add to `JavaPlugin` in `java.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    for q_str in [
        "(method_declaration name: (identifier) @name) @def",
        "(constructor_declaration name: (identifier) @name) @def",
    ]:
        for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node:
            break
    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "for_statement": "for",
        "enhanced_for_statement": "for_each",
        "while_statement": "while",
        "do_statement": "do_while",
        "catch_clause": "catch",
        "switch_block_statement_group": "case",
        "ternary_expression": "ternary",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        elif node.type == "binary_expression":
            op = None
            for child in node.children:
                if child.type in ("&&", "||"):
                    op = child.type
            if op:
                counts[op] = counts.get(op, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 7: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py -v`
Expected: All PASS

**Step 8: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 9: Commit**

```bash
git add src/codetree/languages/javascript.py src/codetree/languages/go.py src/codetree/languages/rust.py src/codetree/languages/java.py tests/test_complexity.py
git commit -m "feat: add compute_complexity for JS/TS, Go, Rust, Java"
```

---

## Task 6: Complexity — get_complexity MCP tool

**Files:**
- Modify: `tests/test_complexity.py`
- Modify: `src/codetree/server.py`

**Step 1: Write the failing tests**

Append to `tests/test_complexity.py`:

```python
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── MCP tool: get_complexity ────────────────────────────────────────────────

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
        assert "4" in result  # total = 1 + if + for + if

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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py::TestGetComplexityTool -v`
Expected: FAIL — tool "get_complexity" not registered

**Step 3: Implement get_complexity tool in server.py**

Add after `get_symbols` in `server.py`:

```python
@mcp.tool()
def get_complexity(file_path: str, function_name: str) -> str:
    """Get cyclomatic complexity of a function.

    Args:
        file_path: path relative to the repo root (e.g., "src/main.py" or "calculator.py")
        function_name: name of the function to analyze
    """
    entry = indexer._index.get(file_path)
    if entry is None:
        return f"File not found: {file_path}"
    result = entry.plugin.compute_complexity(entry.source, function_name)
    if result is None:
        return f"Function '{function_name}' not found in {file_path}"
    breakdown = result["breakdown"]
    line = f"Complexity of {function_name}() in {file_path}: {result['total']}"
    if breakdown:
        parts = [f"{k}: {v}" for k, v in sorted(breakdown.items())]
        line += f"\n  {', '.join(parts)}"
    return line
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_complexity.py
git commit -m "feat: add get_complexity MCP tool"
```

---

## Task 7: C language plugin

**Files:**
- Create: `src/codetree/languages/c.py`
- Create: `tests/languages/test_c.py`

**Step 1: Write the failing tests**

Create `tests/languages/test_c.py`:

```python
import pytest
from codetree.languages.c import CPlugin

PLUGIN = CPlugin()

SAMPLE = b"""\
#include <stdio.h>
#include "myheader.h"

/// A calculator.
struct Calculator {
    int value;
};

typedef struct {
    int x;
    int y;
} Point;

int add(int a, int b) {
    return a + b;
}

void process(struct Calculator* calc) {
    int result = add(calc->value, 1);
    printf("%d", result);
}
"""


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "struct"


def test_skeleton_finds_typedef_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    point = next(item for item in result if item["name"] == "Point")
    assert point["type"] == "struct"


def test_skeleton_finds_functions():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "process" in names


def test_skeleton_function_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "int a" in add["params"]
    assert "int b" in add["params"]


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "A calculator."


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, line = result
    assert "int add" in source
    assert "return a + b" in source


def test_extract_symbol_finds_struct():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "process")
    assert "add" in calls
    assert "printf" in calls


def test_extract_calls_missing_function():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "add")
    assert len(usages) >= 2  # definition + call in process


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) == 2
    assert "<stdio.h>" in result[0]["text"]
    assert "myheader.h" in result[1]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"int main() { return 0; }\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"int main() { return 0; }\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"int main( { return 0; }\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []
    assert PLUGIN.extract_imports(b"") == []
    assert PLUGIN.check_syntax(b"") is False


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/languages/test_c.py -v`
Expected: FAIL — cannot import CPlugin

**Step 3: Implement CPlugin**

Create `src/codetree/languages/c.py`:

```python
from tree_sitter import Language, Parser, Query
import tree_sitter_c as tsc
from .base import LanguagePlugin, _matches, _fill_docs_from_siblings

_LANGUAGE = Language(tsc.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


class CPlugin(LanguagePlugin):
    extensions = (".c", ".h")

    def _get_language(self):
        return _LANGUAGE

    def _get_parser(self):
        return _PARSER

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Named structs with body (struct Foo { ... })
        q = Query(_LANGUAGE, "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "struct",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Typedef structs: typedef struct { ... } Name;
        q = Query(_LANGUAGE, "(type_definition declarator: (type_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "struct",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Functions
        q = Query(_LANGUAGE, """
            (translation_unit
                (function_definition
                    declarator: (function_declarator
                        declarator: (identifier) @name
                        parameters: (parameter_list) @params)) @def)
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Fill doc fields
        for item in results:
            item.setdefault("doc", "")
        _fill_docs_from_siblings(results, tree.root_node, _LANGUAGE, [
            "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def",
            "(struct_specifier name: (type_identifier) @name) @def",
            "(type_definition declarator: (type_identifier) @name) @def",
        ])

        # Deduplicate by (name, line)
        seen = set()
        deduped = []
        for item in results:
            key = (item["name"], item["line"])
            if key not in seen:
                seen.add(key)
                deduped.append(item)

        deduped.sort(key=lambda x: x["line"])
        return deduped

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)

        # Functions
        q = Query(_LANGUAGE, "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Structs
        q = Query(_LANGUAGE, "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Typedef structs
        q = Query(_LANGUAGE, "(type_definition declarator: (type_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        q = Query(_LANGUAGE, "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        q = Query(_LANGUAGE, """
            (call_expression function: [
                (identifier) @called
                (field_expression field: (field_identifier) @called)
            ])
        """)
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        usages = []
        seen = set()
        for node_type in ("identifier", "type_identifier", "field_identifier"):
            q = Query(_LANGUAGE, f'(({node_type}) @name (#eq? @name "{name}"))')
            for _, m in _matches(q, tree.root_node):
                node = m["name"]
                key = (node.start_point[0], node.start_point[1])
                if key not in seen:
                    seen.add(key)
                    usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        usages.sort(key=lambda x: (x["line"], x["col"]))
        return usages

    def extract_imports(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []
        q = Query(_LANGUAGE, "(translation_unit (preproc_include) @imp)")
        for _, m in _matches(q, tree.root_node):
            node = m["imp"]
            results.append({
                "line": node.start_point[0] + 1,
                "text": node.text.decode("utf-8", errors="replace").strip(),
            })
        results.sort(key=lambda x: x["line"])
        return results

    def check_syntax(self, source: bytes) -> bool:
        return _parse(source).root_node.has_error
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/languages/test_c.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/languages/c.py tests/languages/test_c.py
git commit -m "feat: add C language plugin"
```

---

## Task 8: C++ language plugin

**Files:**
- Create: `src/codetree/languages/cpp.py`
- Create: `tests/languages/test_cpp.py`

**Step 1: Write the failing tests**

Create `tests/languages/test_cpp.py`:

```python
import pytest
from codetree.languages.cpp import CppPlugin

PLUGIN = CppPlugin()

SAMPLE = b"""\
#include <iostream>

/// A calculator class.
class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

struct Point {
    int x;
    int y;
};

namespace math {
    int helper() {
        return 42;
    }
}

int top_func(int x) {
    return x;
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "class"


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["type"] == "method"
    assert add["parent"] == "Calculator"


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    point = next(item for item in result if item["name"] == "Point")
    assert point["type"] == "struct"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "top_func" in names


def test_skeleton_finds_namespace_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "A calculator class."


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "top_func")
    assert result is not None
    source, _ = result
    assert "return x" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source
    assert "add" in source


def test_extract_symbol_returns_none():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    src = b"""\
int process(int x) {
    int result = add(x, 1);
    printf("%d", result);
    return result;
}

int add(int a, int b) { return a + b; }
"""
    calls = PLUGIN.extract_calls_in_function(src, "process")
    assert "add" in calls
    assert "printf" in calls


def test_extract_calls_missing_function():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) >= 1
    assert "<iostream>" in result[0]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"int main() { return 0; }\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"int main() { return 0; }\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"int main( { return 0; }\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []


def test_inherits_c_functions():
    """CppPlugin should handle plain C functions (inheriting C grammar)."""
    src = b"int add(int a, int b) { return a + b; }\n"
    result = PLUGIN.extract_skeleton(src)
    assert any(item["name"] == "add" for item in result)


def test_method_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "int a" in add["params"]


def test_extensions():
    assert ".cpp" in PLUGIN.extensions
    assert ".hpp" in PLUGIN.extensions
    assert ".cc" in PLUGIN.extensions


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/languages/test_cpp.py -v`
Expected: FAIL — cannot import CppPlugin

**Step 3: Implement CppPlugin**

Create `src/codetree/languages/cpp.py`:

```python
from tree_sitter import Language, Parser, Query
import tree_sitter_cpp as tscpp
from .c import CPlugin
from .base import _matches, _fill_docs_from_siblings

_LANGUAGE = Language(tscpp.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


class CppPlugin(CPlugin):
    """C++ plugin — inherits C functionality, adds classes, namespaces, methods."""

    extensions = (".cpp", ".cc", ".cxx", ".hpp", ".hh")

    def _get_language(self):
        return _LANGUAGE

    def _get_parser(self):
        return _PARSER

    def extract_skeleton(self, source: bytes) -> list[dict]:
        lang = _LANGUAGE
        tree = _parse(source)
        results = []

        # Classes
        q = Query(lang, "(class_specifier name: (type_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods inside classes (function_definition in field_declaration_list)
        q = Query(lang, """
            (class_specifier
                name: (type_identifier) @class_name
                body: (field_declaration_list
                    (function_definition
                        declarator: (function_declarator
                            declarator: (field_identifier) @method_name
                            parameters: (parameter_list) @params))))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Structs (C++ uses same struct_specifier as C)
        q = Query(lang, "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "struct",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Top-level functions (translation_unit direct children)
        q = Query(lang, """
            (translation_unit
                (function_definition
                    declarator: (function_declarator
                        declarator: (identifier) @name
                        parameters: (parameter_list) @params)) @def)
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Functions inside namespaces
        q = Query(lang, """
            (namespace_definition
                body: (declaration_list
                    (function_definition
                        declarator: (function_declarator
                            declarator: (identifier) @name
                            parameters: (parameter_list) @params)) @def))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Fill doc fields
        for item in results:
            item.setdefault("doc", "")
        _fill_docs_from_siblings(results, tree.root_node, lang, [
            "(class_specifier name: (type_identifier) @name) @def",
            "(struct_specifier name: (type_identifier) @name) @def",
            "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def",
        ])

        # Deduplicate
        seen = set()
        deduped = []
        for item in results:
            key = (item["name"], item["line"])
            if key not in seen:
                seen.add(key)
                deduped.append(item)

        deduped.sort(key=lambda x: x["line"])
        return deduped

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        lang = _LANGUAGE
        tree = _parse(source)

        # Functions (including namespace-scoped)
        q = Query(lang, "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Classes
        q = Query(lang, "(class_specifier name: (type_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Structs
        q = Query(lang, "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        lang = _LANGUAGE
        tree = _parse(source)
        fn_node = None
        q = Query(lang, "(function_definition declarator: (function_declarator declarator: [(identifier) @name (field_identifier) @name])) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        q = Query(lang, """
            (call_expression function: [
                (identifier) @called
                (field_expression field: (field_identifier) @called)
            ])
        """)
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        usages = []
        seen = set()
        for node_type in ("identifier", "type_identifier", "field_identifier", "namespace_identifier"):
            q = Query(_LANGUAGE, f'(({node_type}) @name (#eq? @name "{name}"))')
            for _, m in _matches(q, tree.root_node):
                node = m["name"]
                key = (node.start_point[0], node.start_point[1])
                if key not in seen:
                    seen.add(key)
                    usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        usages.sort(key=lambda x: (x["line"], x["col"]))
        return usages

    def extract_imports(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []
        # #include statements
        q = Query(_LANGUAGE, "(translation_unit (preproc_include) @imp)")
        for _, m in _matches(q, tree.root_node):
            node = m["imp"]
            results.append({
                "line": node.start_point[0] + 1,
                "text": node.text.decode("utf-8", errors="replace").strip(),
            })
        # using declarations
        q = Query(_LANGUAGE, "(translation_unit (using_declaration) @imp)")
        for _, m in _matches(q, tree.root_node):
            node = m["imp"]
            results.append({
                "line": node.start_point[0] + 1,
                "text": node.text.decode("utf-8", errors="replace").strip(),
            })
        results.sort(key=lambda x: x["line"])
        return results

    def check_syntax(self, source: bytes) -> bool:
        return _parse(source).root_node.has_error
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/languages/test_cpp.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/languages/cpp.py tests/languages/test_cpp.py
git commit -m "feat: add C++ language plugin"
```

---

## Task 9: Ruby language plugin

**Files:**
- Create: `src/codetree/languages/ruby.py`
- Create: `tests/languages/test_ruby.py`

**Step 1: Write the failing tests**

Create `tests/languages/test_ruby.py`:

```python
import pytest
from codetree.languages.ruby import RubyPlugin

PLUGIN = RubyPlugin()

SAMPLE = b"""\
require "json"
require_relative "utils"

# Calculator class.
class Calculator
  def initialize(value)
    @value = value
  end

  def self.create(val)
    Calculator.new(val)
  end

  def add(a, b)
    a + b
  end
end

module MathHelpers
  def self.double(x)
    x * 2
  end
end

def helper
  calc = Calculator.new(0)
  calc.add(1, 2)
end
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["type"] == "class"


def test_skeleton_finds_module():
    result = PLUGIN.extract_skeleton(SAMPLE)
    mod = next(item for item in result if item["name"] == "MathHelpers")
    assert mod["type"] == "class"  # modules treated as class for skeleton


def test_skeleton_finds_instance_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    init = next(item for item in result if item["name"] == "initialize")
    assert init["type"] == "method"
    assert init["parent"] == "Calculator"

    add = next(item for item in result if item["name"] == "add")
    assert add["type"] == "method"
    assert add["parent"] == "Calculator"


def test_skeleton_finds_singleton_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    create = next(item for item in result if item["name"] == "create")
    assert create["type"] == "method"
    assert create["parent"] == "Calculator"


def test_skeleton_finds_module_singleton_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    double = next(item for item in result if item["name"] == "double")
    assert double["type"] == "method"
    assert double["parent"] == "MathHelpers"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    helper = next(item for item in result if item["name"] == "helper")
    assert helper["type"] == "function"
    assert helper["parent"] is None


def test_skeleton_method_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "a" in add["params"]
    assert "b" in add["params"]


def test_skeleton_no_param_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    helper = next(item for item in result if item["name"] == "helper")
    assert helper["params"] == ""


def test_skeleton_doc_comment():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["doc"] == "Calculator class."


def test_skeleton_sorted_by_line():
    result = PLUGIN.extract_skeleton(SAMPLE)
    lines = [item["line"] for item in result]
    assert lines == sorted(lines)


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "class Calculator" in source
    assert "def add" in source


def test_extract_symbol_finds_method():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, _ = result
    assert "def add" in source


def test_extract_symbol_finds_top_level():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, _ = result
    assert "def helper" in source


def test_extract_symbol_returns_none():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "new" in calls
    assert "add" in calls


def test_extract_calls_missing():
    assert PLUGIN.extract_calls_in_function(SAMPLE, "nonexistent") == []


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 2  # class def + usage in helper


def test_extract_imports():
    result = PLUGIN.extract_imports(SAMPLE)
    assert len(result) == 2
    assert "require" in result[0]["text"]
    assert "json" in result[0]["text"]
    assert "require_relative" in result[1]["text"]


def test_extract_imports_empty():
    result = PLUGIN.extract_imports(b"def foo\n  42\nend\n")
    assert result == []


def test_check_syntax_clean():
    assert PLUGIN.check_syntax(b"def foo\n  42\nend\n") is False


def test_check_syntax_error():
    assert PLUGIN.check_syntax(b"def class end end end {\n") is True


def test_empty_file():
    assert PLUGIN.extract_skeleton(b"") == []
    assert PLUGIN.extract_imports(b"") == []


def test_doc_key_always_present():
    result = PLUGIN.extract_skeleton(SAMPLE)
    for item in result:
        assert "doc" in item
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/languages/test_ruby.py -v`
Expected: FAIL — cannot import RubyPlugin

**Step 3: Implement RubyPlugin**

Create `src/codetree/languages/ruby.py`:

```python
from tree_sitter import Language, Parser, Query
import tree_sitter_ruby as tsruby
from .base import LanguagePlugin, _matches, _fill_docs_from_siblings

_LANGUAGE = Language(tsruby.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


class RubyPlugin(LanguagePlugin):
    extensions = (".rb",)

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Classes
        q = Query(_LANGUAGE, "(program (class name: (constant) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Modules (treated as class for skeleton purposes)
        q = Query(_LANGUAGE, "(program (module name: (constant) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Instance methods inside classes (with params)
        q = Query(_LANGUAGE, """
            (class
                name: (constant) @class_name
                (body_statement
                    (method
                        name: (identifier) @method_name
                        parameters: (method_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Instance methods inside classes (no params)
        q = Query(_LANGUAGE, """
            (class
                name: (constant) @class_name
                (body_statement
                    (method
                        name: (identifier) @method_name) @mdef))
        """)
        for _, m in _matches(q, tree.root_node):
            method_node = m["mdef"]
            # Skip if it has params (already matched above)
            if not any(child.type == "method_parameters" for child in method_node.children):
                results.append({
                    "type": "method",
                    "name": m["method_name"].text.decode("utf-8", errors="replace"),
                    "line": m["method_name"].start_point[0] + 1,
                    "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                    "params": "",
                })

        # Singleton methods in classes (def self.foo) — with params
        q = Query(_LANGUAGE, """
            (class
                name: (constant) @class_name
                (body_statement
                    (singleton_method
                        name: (identifier) @method_name
                        parameters: (method_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Singleton methods in classes — no params
        q = Query(_LANGUAGE, """
            (class
                name: (constant) @class_name
                (body_statement
                    (singleton_method
                        name: (identifier) @method_name) @mdef))
        """)
        for _, m in _matches(q, tree.root_node):
            method_node = m["mdef"]
            if not any(child.type == "method_parameters" for child in method_node.children):
                results.append({
                    "type": "method",
                    "name": m["method_name"].text.decode("utf-8", errors="replace"),
                    "line": m["method_name"].start_point[0] + 1,
                    "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                    "params": "",
                })

        # Singleton methods in modules — with params
        q = Query(_LANGUAGE, """
            (module
                name: (constant) @class_name
                (body_statement
                    (singleton_method
                        name: (identifier) @method_name
                        parameters: (method_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Singleton methods in modules — no params
        q = Query(_LANGUAGE, """
            (module
                name: (constant) @class_name
                (body_statement
                    (singleton_method
                        name: (identifier) @method_name) @mdef))
        """)
        for _, m in _matches(q, tree.root_node):
            method_node = m["mdef"]
            if not any(child.type == "method_parameters" for child in method_node.children):
                results.append({
                    "type": "method",
                    "name": m["method_name"].text.decode("utf-8", errors="replace"),
                    "line": m["method_name"].start_point[0] + 1,
                    "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                    "params": "",
                })

        # Instance methods in modules — with params
        q = Query(_LANGUAGE, """
            (module
                name: (constant) @class_name
                (body_statement
                    (method
                        name: (identifier) @method_name
                        parameters: (method_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level functions (method at program level) — with params
        q = Query(_LANGUAGE, "(program (method name: (identifier) @name parameters: (method_parameters) @params) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level functions — no params
        q = Query(_LANGUAGE, "(program (method name: (identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            method_node = m["def"]
            if not any(child.type == "method_parameters" for child in method_node.children):
                results.append({
                    "type": "function",
                    "name": m["name"].text.decode("utf-8", errors="replace"),
                    "line": m["name"].start_point[0] + 1,
                    "parent": None,
                    "params": "",
                })

        # Fill doc fields
        for item in results:
            item.setdefault("doc", "")
        _fill_docs_from_siblings(results, tree.root_node, _LANGUAGE, [
            "(program (class name: (constant) @name) @def)",
            "(program (module name: (constant) @name) @def)",
            "(program (method name: (identifier) @name) @def)",
        ])

        # Deduplicate
        seen = set()
        deduped = []
        for item in results:
            key = (item["name"], item["line"])
            if key not in seen:
                seen.add(key)
                deduped.append(item)

        deduped.sort(key=lambda x: x["line"])
        return deduped

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)

        # Classes and modules
        for q_str in [
            "(class name: (constant) @name) @def",
            "(module name: (constant) @name) @def",
        ]:
            for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == name:
                    node = m["def"]
                    return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Methods (instance and singleton)
        for q_str in [
            "(method name: (identifier) @name) @def",
            "(singleton_method name: (identifier) @name) @def",
        ]:
            for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == name:
                    node = m["def"]
                    return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        for q_str in [
            "(method name: (identifier) @name) @def",
            "(singleton_method name: (identifier) @name) @def",
        ]:
            for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                    fn_node = m["def"]
                    break
            if fn_node:
                break
        if fn_node is None:
            return []

        q = Query(_LANGUAGE, "(call method: (identifier) @called)")
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        usages = []
        seen = set()
        for node_type in ("identifier", "constant"):
            q = Query(_LANGUAGE, f'(({node_type}) @name (#eq? @name "{name}"))')
            for _, m in _matches(q, tree.root_node):
                node = m["name"]
                key = (node.start_point[0], node.start_point[1])
                if key not in seen:
                    seen.add(key)
                    usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        usages.sort(key=lambda x: (x["line"], x["col"]))
        return usages

    def extract_imports(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []
        q = Query(_LANGUAGE, "(program (call method: (identifier) @method arguments: (argument_list (string) @path)) @imp)")
        for _, m in _matches(q, tree.root_node):
            method = m["method"].text.decode("utf-8", errors="replace")
            if method in ("require", "require_relative"):
                node = m["imp"]
                results.append({
                    "line": node.start_point[0] + 1,
                    "text": node.text.decode("utf-8", errors="replace").strip(),
                })
        results.sort(key=lambda x: x["line"])
        return results

    def check_syntax(self, source: bytes) -> bool:
        return _parse(source).root_node.has_error
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/languages/test_ruby.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/languages/ruby.py tests/languages/test_ruby.py
git commit -m "feat: add Ruby language plugin"
```

---

## Task 10: Register C, C++, Ruby + integration tests

**Files:**
- Modify: `src/codetree/registry.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_batch.py` (add C/C++/Ruby batch test)

**Step 1: Register in registry.py**

```python
from .languages.c import CPlugin
from .languages.cpp import CppPlugin
from .languages.ruby import RubyPlugin

# Add to PLUGINS dict:
".c":    CPlugin(),
".h":    CPlugin(),
".cpp":  CppPlugin(),
".cc":   CppPlugin(),
".cxx":  CppPlugin(),
".hpp":  CppPlugin(),
".hh":   CppPlugin(),
".rb":   RubyPlugin(),
```

**Step 2: Add C/C++/Ruby files to multi_lang_repo fixture in conftest.py**

Append to the `multi_lang_repo` fixture:

```python
(tmp_path / "math.c").write_text("""\
#include <stdio.h>

struct Calculator {
    int value;
};

int add(int a, int b) {
    return a + b;
}
""")
(tmp_path / "calculator.cpp").write_text("""\
#include <iostream>

class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

int helper() {
    Calculator c;
    return c.add(1, 2);
}
""")
(tmp_path / "calc.rb").write_text("""\
class Calculator
  def add(a, b)
    a + b
  end
end

def helper
  Calculator.new.add(1, 2)
end
""")
```

**Step 3: Add integration tests to test_batch.py**

Append a test to `TestGetSkeletons`:

```python
def test_c_cpp_ruby_files(self, multi_lang_repo):
    fn = _tool(create_server(str(multi_lang_repo)), "get_skeletons")
    result = fn(file_paths=["math.c", "calculator.cpp", "calc.rb"])
    assert "=== math.c ===" in result
    assert "=== calculator.cpp ===" in result
    assert "=== calc.rb ===" in result
    assert "add" in result
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_batch.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/registry.py tests/conftest.py tests/test_batch.py
git commit -m "feat: register C, C++, Ruby plugins + integration tests"
```

---

## Task 11: Complexity for C, C++, Ruby

**Files:**
- Modify: `src/codetree/languages/c.py`
- Modify: `src/codetree/languages/cpp.py`
- Modify: `src/codetree/languages/ruby.py`
- Modify: `tests/test_complexity.py`

**Step 1: Write the failing tests**

Append to `tests/test_complexity.py`:

```python
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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py -v -k "TestC or TestCpp or TestRuby"`
Expected: FAIL — compute_complexity returns None

**Step 3: Implement compute_complexity for C**

Add to `CPlugin` in `c.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    q = Query(_LANGUAGE, "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def")
    for _, m in _matches(q, tree.root_node):
        if m["name"].text.decode("utf-8", errors="replace") == fn_name:
            fn_node = m["def"]
            break
    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "for_statement": "for",
        "while_statement": "while",
        "do_statement": "do_while",
        "case_statement": "case",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        elif node.type == "binary_expression":
            op = None
            for child in node.children:
                if child.type in ("&&", "||"):
                    op = child.type
            if op:
                counts[op] = counts.get(op, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 4: Implement compute_complexity for C++**

Add to `CppPlugin` in `cpp.py` (override to use C++ parser):

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    q = Query(_LANGUAGE, "(function_definition declarator: (function_declarator declarator: [(identifier) @name (field_identifier) @name])) @def")
    for _, m in _matches(q, tree.root_node):
        if m["name"].text.decode("utf-8", errors="replace") == fn_name:
            fn_node = m["def"]
            break
    if fn_node is None:
        return None

    branch_map = {
        "if_statement": "if",
        "for_statement": "for",
        "for_range_loop": "for_range",
        "while_statement": "while",
        "do_statement": "do_while",
        "case_statement": "case",
        "catch_clause": "catch",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        elif node.type == "binary_expression":
            op = None
            for child in node.children:
                if child.type in ("&&", "||"):
                    op = child.type
            if op:
                counts[op] = counts.get(op, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 5: Implement compute_complexity for Ruby**

Add to `RubyPlugin` in `ruby.py`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    tree = _parse(source)
    fn_node = None
    for q_str in [
        "(method name: (identifier) @name) @def",
        "(singleton_method name: (identifier) @name) @def",
    ]:
        for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node:
            break
    if fn_node is None:
        return None

    branch_map = {
        "if": "if",
        "unless": "unless",
        "while": "while",
        "until": "until",
        "for": "for",
        "when": "when",
        "elsif": "elsif",
        "if_modifier": "if",
        "unless_modifier": "unless",
        "while_modifier": "while",
        "until_modifier": "until",
    }
    counts = {}
    def walk(node):
        if node.type in branch_map:
            label = branch_map[node.type]
            counts[label] = counts.get(label, 0) + 1
        elif node.type == "binary" and node.children:
            for child in node.children:
                if child.type in ("and", "or", "&&", "||"):
                    counts[child.type] = counts.get(child.type, 0) + 1
        for child in node.children:
            walk(child)
    walk(fn_node)
    total = 1 + sum(counts.values())
    return {"total": total, "breakdown": counts}
```

**Step 6: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_complexity.py -v`
Expected: All PASS

**Step 7: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 8: Commit**

```bash
git add src/codetree/languages/c.py src/codetree/languages/cpp.py src/codetree/languages/ruby.py tests/test_complexity.py
git commit -m "feat: add compute_complexity for C, C++, Ruby"
```

---

## Task 12: Update template, existing tests, CLAUDE.md, memory

**Files:**
- Modify: `src/codetree/languages/_template.py`
- Modify: `tests/test_syntax_errors.py`
- Modify: `tests/test_docstrings.py`
- Modify: `tests/test_imports.py`
- Modify: `CLAUDE.md`

**Step 1: Update _template.py with compute_complexity stub**

Add to `TemplateLangPlugin`:

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    """Return cyclomatic complexity breakdown for a function.

    Returns None if function not found.
    Returns dict with keys:
      - total: int (cyclomatic complexity)
      - breakdown: dict[str, int] (readable_type → count)

    TODO:
      1. Find the function node by name
      2. Walk all descendant nodes
      3. Count nodes matching branching types for this language
      4. Return {"total": 1 + count, "breakdown": {label: count, ...}}
    """
    return None
```

**Step 2: Add C/C++/Ruby to cross-language test files**

In `tests/test_syntax_errors.py`, add:

```python
from codetree.languages.c import CPlugin
from codetree.languages.cpp import CppPlugin
from codetree.languages.ruby import RubyPlugin

CC = CPlugin()
CPP = CppPlugin()
RB = RubyPlugin()

# Update ALL_PLUGINS:
ALL_PLUGINS = [PY, JS, TS, GO, RS, JV, CC, CPP, RB]

# Add clean/error tests:
def test_c_clean():
    assert CC.check_syntax(b"int main() { return 0; }\n") is False

def test_c_syntax_error():
    assert CC.check_syntax(b"int main( { return 0; }\n") is True

def test_cpp_clean():
    assert CPP.check_syntax(b"int main() { return 0; }\n") is False

def test_cpp_syntax_error():
    assert CPP.check_syntax(b"int main( { return 0; }\n") is True

def test_ruby_clean():
    assert RB.check_syntax(b"def foo\n  42\nend\n") is False

def test_ruby_syntax_error():
    assert RB.check_syntax(b"def class end end end {\n") is True
```

In `tests/test_imports.py`, add C/C++/Ruby import tests. In `tests/test_docstrings.py`, add C/C++/Ruby doc tests.

**Step 3: Update CLAUDE.md**

Update the tool count (now 8 tools: get_file_skeleton, get_symbol, find_references, get_call_graph, get_imports, get_skeletons, get_symbols, get_complexity), supported languages (now 10: Python, JS, TS, TSX, Go, Rust, Java, C, C++, Ruby), test count (re-count after adding all tests).

**Step 4: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 5: Commit**

```bash
git add src/codetree/languages/_template.py tests/test_syntax_errors.py tests/test_docstrings.py tests/test_imports.py CLAUDE.md
git commit -m "chore: update template, cross-language tests, CLAUDE.md for Phase 2"
```

---

## Summary

| Task | Description | New Tests (approx) |
|------|------------|-------------------|
| 1 | Install deps | 0 |
| 2 | get_skeletons batch tool | 7 |
| 3 | get_symbols batch tool | 8 |
| 4 | Complexity base + Python | 12 |
| 5 | Complexity JS/TS/Go/Rust/Java | 25 |
| 6 | get_complexity MCP tool | 7 |
| 7 | C language plugin | 19 |
| 8 | C++ language plugin | 20 |
| 9 | Ruby language plugin | 20 |
| 10 | Register + integration | 5 |
| 11 | Complexity C/C++/Ruby | 12 |
| 12 | Template + cross-lang tests | 10 |

**Total new tests: ~145**
**Total expected test count: ~750**
