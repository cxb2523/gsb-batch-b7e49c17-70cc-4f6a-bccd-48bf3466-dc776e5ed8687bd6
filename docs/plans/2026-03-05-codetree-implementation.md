# codetree Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Python MCP server called `codetree` that gives coding agents structured code understanding via Tree-sitter, exposing 4 tools: file skeleton, symbol fetch, find references, and call graph.

**Architecture:** FastMCP server that walks a repo on startup, parses all `.py` files with tree-sitter, builds an in-memory index, and caches extracted facts to `.codetree/index.json` keyed by file path + mtime. Each of the 4 tools queries the in-memory index and returns clean structured text.

**Tech Stack:** `tree-sitter>=0.23`, `tree-sitter-python>=0.23`, `fastmcp>=2.0`, `pytest`

---

## Task 1: Project Scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `src/codetree/__init__.py`
- Create: `src/codetree/__main__.py`
- Create: `src/codetree/server.py`
- Create: `src/codetree/indexer.py`
- Create: `src/codetree/cache.py`
- Create: `src/codetree/queries.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "codetree"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "tree-sitter>=0.23.0",
    "tree-sitter-python>=0.23.0",
    "fastmcp>=2.0.0",
]

[project.scripts]
codetree = "codetree.__main__:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 2: Create all empty `__init__.py` files and stub modules**

`src/codetree/__init__.py` — empty

`src/codetree/__main__.py`:
```python
import argparse
from .server import run

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="Path to repo root")
    args = parser.parse_args()
    run(args.root)

if __name__ == "__main__":
    main()
```

`tests/__init__.py` — empty

`tests/conftest.py`:
```python
import pytest
from pathlib import Path

@pytest.fixture
def sample_repo(tmp_path):
    """Creates a minimal fake Python repo for testing."""
    (tmp_path / "calculator.py").write_text("""\
class Calculator:
    def add(self, a, b):
        return a + b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("cannot divide by zero")
        return a / b

def helper():
    calc = Calculator()
    return calc.add(1, 2)
""")
    (tmp_path / "main.py").write_text("""\
from calculator import Calculator

def run():
    calc = Calculator()
    result = calc.divide(10, 2)
    return result
""")
    return tmp_path
```

**Step 3: Install dependencies**

```bash
cd /Users/kartik/Developer/understandCode
pip install -e ".[dev]" 2>/dev/null || pip install -e .
pip install pytest
```

Expected: installs without errors.

**Step 4: Verify structure**

```bash
find src tests -name "*.py" | sort
```

Expected output:
```
src/codetree/__init__.py
src/codetree/__main__.py
src/codetree/cache.py
src/codetree/indexer.py
src/codetree/queries.py
src/codetree/server.py
tests/__init__.py
tests/conftest.py
```

**Step 5: Commit**

```bash
git init
git add pyproject.toml src/ tests/
git commit -m "feat: scaffold codetree project structure"
```

---

## Task 2: Tree-sitter Queries Module

**Files:**
- Create: `src/codetree/queries.py`
- Create: `tests/test_queries.py`

Tree-sitter queries use a Lisp-like pattern language. This module centralizes all of them.

**Step 1: Write the failing tests**

Create `tests/test_queries.py`:
```python
import pytest
from codetree.queries import (
    extract_skeleton,
    extract_symbol_source,
    extract_calls_in_function,
    extract_symbol_usages,
)

SAMPLE_CODE = b"""\
class Calculator:
    def add(self, a, b):
        return a + b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("cannot divide by zero")
        return a / b

def helper():
    calc = Calculator()
    return calc.add(1, 2)
"""


def test_skeleton_finds_class():
    result = extract_skeleton(SAMPLE_CODE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = extract_skeleton(SAMPLE_CODE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "divide" in names


def test_skeleton_finds_top_level_function():
    result = extract_skeleton(SAMPLE_CODE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_includes_line_numbers():
    result = extract_skeleton(SAMPLE_CODE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["line"] == 1


def test_extract_symbol_finds_function():
    source, start_line = extract_symbol_source(SAMPLE_CODE, "add")
    assert "def add" in source
    assert "return a + b" in source


def test_extract_symbol_finds_class():
    source, start_line = extract_symbol_source(SAMPLE_CODE, "Calculator")
    assert "class Calculator" in source
    assert "def add" in source


def test_extract_symbol_returns_none_for_missing():
    result = extract_symbol_source(SAMPLE_CODE, "nonexistent")
    assert result is None


def test_extract_calls_in_function():
    calls = extract_calls_in_function(SAMPLE_CODE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages_finds_calls():
    usages = extract_symbol_usages(SAMPLE_CODE, "add")
    # "add" appears as a method call in helper()
    assert len(usages) >= 1
    assert any(u["line"] > 1 for u in usages)
```

**Step 2: Run to verify they fail**

```bash
pytest tests/test_queries.py -v
```

Expected: all tests FAIL with `ImportError: cannot import name 'extract_skeleton'`

**Step 3: Implement queries.py**

```python
from tree_sitter import Language, Parser, Node
import tree_sitter_python as tspython

PY_LANGUAGE = Language(tspython.language())
_parser = Parser(PY_LANGUAGE)


def _parse(source: bytes):
    return _parser.parse(source)


def extract_skeleton(source: bytes) -> list[dict]:
    """Return all classes and functions with name, type, line, parent_class."""
    tree = _parse(source)
    results = []

    # Top-level classes
    class_query = PY_LANGUAGE.query("""
        (module (class_definition name: (identifier) @name) @def)
    """)
    for _, match in class_query.matches(tree.root_node):
        name_node = match["name"]
        results.append({
            "type": "class",
            "name": name_node.text.decode(),
            "line": name_node.start_point[0] + 1,
            "parent": None,
        })

    # Methods inside classes
    method_query = PY_LANGUAGE.query("""
        (class_definition
            name: (identifier) @class_name
            body: (block
                (function_definition
                    name: (identifier) @method_name) @method_def))
    """)
    for _, match in method_query.matches(tree.root_node):
        method_node = match["method_name"]
        class_node = match["class_name"]
        results.append({
            "type": "method",
            "name": method_node.text.decode(),
            "line": method_node.start_point[0] + 1,
            "parent": class_node.text.decode(),
        })

    # Top-level functions (not inside a class)
    fn_query = PY_LANGUAGE.query("""
        (module (function_definition name: (identifier) @name) @def)
    """)
    for _, match in fn_query.matches(tree.root_node):
        name_node = match["name"]
        results.append({
            "type": "function",
            "name": name_node.text.decode(),
            "line": name_node.start_point[0] + 1,
            "parent": None,
        })

    results.sort(key=lambda x: x["line"])
    return results


def extract_symbol_source(source: bytes, symbol_name: str) -> tuple[str, int] | None:
    """Return (source_text, start_line) for a named function or class. None if not found."""
    tree = _parse(source)

    for node_type in ("function_definition", "class_definition"):
        query = PY_LANGUAGE.query(f"""
            ({node_type} name: (identifier) @name) @def
        """)
        for _, match in query.matches(tree.root_node):
            name_node = match["name"]
            if name_node.text.decode() == symbol_name:
                def_node = match["def"]
                start_line = def_node.start_point[0] + 1
                text = source[def_node.start_byte:def_node.end_byte].decode()
                return text, start_line

    return None


def extract_calls_in_function(source: bytes, function_name: str) -> list[str]:
    """Return all function/method names called inside a named function."""
    tree = _parse(source)

    # Find the function node
    fn_query = PY_LANGUAGE.query("""
        (function_definition name: (identifier) @name) @def
    """)
    fn_node = None
    for _, match in fn_query.matches(tree.root_node):
        if match["name"].text.decode() == function_name:
            fn_node = match["def"]
            break

    if fn_node is None:
        return []

    # Find all calls within that function
    call_query = PY_LANGUAGE.query("""
        (call function: [
            (identifier) @called
            (attribute attribute: (identifier) @called)
        ])
    """)
    calls = set()
    for _, match in call_query.matches(fn_node):
        calls.add(match["called"].text.decode())

    return sorted(calls)


def extract_symbol_usages(source: bytes, symbol_name: str) -> list[dict]:
    """Return all lines where symbol_name appears as an identifier."""
    tree = _parse(source)
    query = PY_LANGUAGE.query("""
        (identifier) @name
    """)
    usages = []
    for _, match in query.matches(tree.root_node):
        node = match["name"]
        if node.text.decode() == symbol_name:
            usages.append({
                "line": node.start_point[0] + 1,
                "col": node.start_point[1],
            })
    return usages
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_queries.py -v
```

Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/codetree/queries.py tests/test_queries.py
git commit -m "feat: add tree-sitter query functions for Python"
```

---

## Task 3: File Indexer

**Files:**
- Create: `src/codetree/indexer.py`
- Create: `tests/test_indexer.py`

The indexer walks the repo, parses each `.py` file, and builds the in-memory index.

**Step 1: Write the failing tests**

Create `tests/test_indexer.py`:
```python
import pytest
from codetree.indexer import Indexer


def test_indexer_finds_python_files(sample_repo):
    idx = Indexer(sample_repo)
    idx.build()
    assert "calculator.py" in [p.name for p in idx.files]


def test_indexer_ignores_non_python_files(sample_repo, tmp_path):
    (sample_repo / "notes.txt").write_text("hello")
    idx = Indexer(sample_repo)
    idx.build()
    assert "notes.txt" not in [p.name for p in idx.files]


def test_indexer_skeleton_for_file(sample_repo):
    idx = Indexer(sample_repo)
    idx.build()
    skeleton = idx.get_skeleton("calculator.py")
    names = [item["name"] for item in skeleton]
    assert "Calculator" in names
    assert "add" in names
    assert "divide" in names


def test_indexer_get_symbol(sample_repo):
    idx = Indexer(sample_repo)
    idx.build()
    result = idx.get_symbol("calculator.py", "add")
    assert result is not None
    source, line = result
    assert "def add" in source


def test_indexer_find_references_across_files(sample_repo):
    idx = Indexer(sample_repo)
    idx.build()
    refs = idx.find_references("Calculator")
    # Should appear in calculator.py (definition) and main.py (import + usage)
    files_with_refs = {r["file"] for r in refs}
    assert "calculator.py" in files_with_refs
    assert "main.py" in files_with_refs


def test_indexer_get_call_graph(sample_repo):
    idx = Indexer(sample_repo)
    idx.build()
    graph = idx.get_call_graph("calculator.py", "helper")
    assert "Calculator" in graph["calls"]
    assert "add" in graph["calls"]
```

**Step 2: Run to verify they fail**

```bash
pytest tests/test_indexer.py -v
```

Expected: FAIL with `ImportError: cannot import name 'Indexer'`

**Step 3: Implement indexer.py**

```python
from pathlib import Path
from dataclasses import dataclass, field
from .queries import (
    extract_skeleton,
    extract_symbol_source,
    extract_calls_in_function,
    extract_symbol_usages,
)


@dataclass
class FileEntry:
    path: Path
    source: bytes
    skeleton: list[dict]
    mtime: float


class Indexer:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self._index: dict[str, FileEntry] = {}

    @property
    def files(self) -> list[Path]:
        return [entry.path for entry in self._index.values()]

    def build(self, cached_mtimes: dict[str, float] | None = None):
        """Parse all .py files under root and build the index."""
        cached_mtimes = cached_mtimes or {}
        for py_file in self.root.rglob("*.py"):
            rel = str(py_file.relative_to(self.root))
            mtime = py_file.stat().st_mtime
            source = py_file.read_bytes()
            skeleton = extract_skeleton(source)
            self._index[rel] = FileEntry(
                path=py_file,
                source=source,
                skeleton=skeleton,
                mtime=mtime,
            )

    def get_skeleton(self, rel_path: str) -> list[dict]:
        entry = self._index.get(rel_path)
        if entry is None:
            return []
        return entry.skeleton

    def get_symbol(self, rel_path: str, symbol_name: str) -> tuple[str, int] | None:
        entry = self._index.get(rel_path)
        if entry is None:
            return None
        return extract_symbol_source(entry.source, symbol_name)

    def find_references(self, symbol_name: str) -> list[dict]:
        """Find all usages of symbol_name across all indexed files."""
        results = []
        for rel_path, entry in self._index.items():
            usages = extract_symbol_usages(entry.source, symbol_name)
            for u in usages:
                results.append({
                    "file": rel_path,
                    "line": u["line"],
                    "col": u["col"],
                })
        return results

    def get_call_graph(self, rel_path: str, function_name: str) -> dict:
        """Return what function_name calls and what calls function_name."""
        entry = self._index.get(rel_path)
        calls = []
        if entry:
            calls = extract_calls_in_function(entry.source, function_name)

        # Find callers across all files
        callers = []
        for rp, e in self._index.items():
            usages = extract_symbol_usages(e.source, function_name)
            for u in usages:
                callers.append({"file": rp, "line": u["line"]})

        return {"calls": calls, "callers": callers}
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_indexer.py -v
```

Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/codetree/indexer.py tests/test_indexer.py
git commit -m "feat: add repo indexer with cross-file reference lookup"
```

---

## Task 4: File-Based Cache

**Files:**
- Create: `src/codetree/cache.py`
- Create: `tests/test_cache.py`

Cache stores extracted skeleton data as JSON in `.codetree/index.json`, keyed by relative file path + mtime.

**Step 1: Write the failing tests**

Create `tests/test_cache.py`:
```python
import pytest
from codetree.cache import Cache


def test_cache_write_and_read(tmp_path):
    cache = Cache(tmp_path)
    data = {"mtime": 1234.0, "skeleton": [{"name": "foo", "type": "function", "line": 1}]}
    cache.set("src/foo.py", data)
    cache.save()

    cache2 = Cache(tmp_path)
    cache2.load()
    assert cache2.get("src/foo.py") == data


def test_cache_returns_none_for_missing_key(tmp_path):
    cache = Cache(tmp_path)
    cache.load()
    assert cache.get("nonexistent.py") is None


def test_cache_is_valid_when_mtime_matches(tmp_path):
    cache = Cache(tmp_path)
    cache.set("src/foo.py", {"mtime": 999.0, "skeleton": []})
    assert cache.is_valid("src/foo.py", 999.0) is True


def test_cache_is_invalid_when_mtime_differs(tmp_path):
    cache = Cache(tmp_path)
    cache.set("src/foo.py", {"mtime": 999.0, "skeleton": []})
    assert cache.is_valid("src/foo.py", 1000.0) is False


def test_cache_creates_directory_if_missing(tmp_path):
    cache_dir = tmp_path / ".codetree"
    assert not cache_dir.exists()
    cache = Cache(tmp_path)
    cache.save()
    assert cache_dir.exists()
```

**Step 2: Run to verify they fail**

```bash
pytest tests/test_cache.py -v
```

Expected: FAIL with `ImportError: cannot import name 'Cache'`

**Step 3: Implement cache.py**

```python
import json
from pathlib import Path


class Cache:
    def __init__(self, root: str | Path):
        self._root = Path(root)
        self._cache_file = self._root / ".codetree" / "index.json"
        self._data: dict = {}

    def load(self):
        if self._cache_file.exists():
            self._data = json.loads(self._cache_file.read_text())

    def save(self):
        self._cache_file.parent.mkdir(parents=True, exist_ok=True)
        self._cache_file.write_text(json.dumps(self._data, indent=2))

    def get(self, rel_path: str) -> dict | None:
        return self._data.get(rel_path)

    def set(self, rel_path: str, data: dict):
        self._data[rel_path] = data

    def is_valid(self, rel_path: str, current_mtime: float) -> bool:
        entry = self._data.get(rel_path)
        if entry is None:
            return False
        return entry.get("mtime") == current_mtime
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cache.py -v
```

Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/codetree/cache.py tests/test_cache.py
git commit -m "feat: add JSON file cache with mtime-based invalidation"
```

---

## Task 5: MCP Server + get_file_skeleton Tool

**Files:**
- Modify: `src/codetree/server.py`
- Create: `tests/test_server.py`

**Step 1: Write the failing test**

Create `tests/test_server.py`:
```python
import pytest
from codetree.server import create_server


def test_get_file_skeleton_returns_classes_and_functions(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_file_skeleton")
    result = tool.fn(file_path="calculator.py")
    assert "Calculator" in result
    assert "add" in result
    assert "divide" in result
    assert "line" in result.lower() or ":" in result


def test_get_file_skeleton_unknown_file(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_file_skeleton")
    result = tool.fn(file_path="nonexistent.py")
    assert "not found" in result.lower() or result.strip() == ""
```

**Step 2: Run to verify it fails**

```bash
pytest tests/test_server.py::test_get_file_skeleton_returns_classes_and_functions -v
```

Expected: FAIL with `ImportError`

**Step 3: Implement server.py with first tool**

```python
from fastmcp import FastMCP
from .indexer import Indexer


def create_server(root: str) -> FastMCP:
    mcp = FastMCP("codetree")
    indexer = Indexer(root)
    indexer.build()

    @mcp.tool()
    def get_file_skeleton(file_path: str) -> str:
        """Get all classes and function signatures in a Python file without their bodies."""
        skeleton = indexer.get_skeleton(file_path)
        if not skeleton:
            return f"File not found or empty: {file_path}"

        lines = []
        for item in skeleton:
            prefix = "  " if item["parent"] else ""
            parent_info = f" (in {item['parent']})" if item["parent"] else ""
            lines.append(f"{prefix}{item['type']} {item['name']}{parent_info} → line {item['line']}")
        return "\n".join(lines)

    return mcp


def run(root: str):
    mcp = create_server(root)
    mcp.run()
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_server.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/codetree/server.py tests/test_server.py
git commit -m "feat: add MCP server with get_file_skeleton tool"
```

---

## Task 6: get_symbol Tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_server.py`

**Step 1: Add the failing test**

Append to `tests/test_server.py`:
```python
def test_get_symbol_returns_function_source(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_symbol")
    result = tool.fn(file_path="calculator.py", symbol_name="divide")
    assert "def divide" in result
    assert "ValueError" in result


def test_get_symbol_not_found(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_symbol")
    result = tool.fn(file_path="calculator.py", symbol_name="nonexistent")
    assert "not found" in result.lower()
```

**Step 2: Run to verify it fails**

```bash
pytest tests/test_server.py::test_get_symbol_returns_function_source -v
```

Expected: FAIL — tool not defined yet

**Step 3: Add get_symbol to server.py**

Inside `create_server`, after the `get_file_skeleton` tool:

```python
    @mcp.tool()
    def get_symbol(file_path: str, symbol_name: str) -> str:
        """Get the full source code of a specific function or class by name."""
        result = indexer.get_symbol(file_path, symbol_name)
        if result is None:
            return f"Symbol '{symbol_name}' not found in {file_path}"
        source, line = result
        return f"# {file_path}:{line}\n{source}"
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_server.py -v
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/codetree/server.py tests/test_server.py
git commit -m "feat: add get_symbol tool to MCP server"
```

---

## Task 7: find_references Tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_server.py`

**Step 1: Add the failing test**

Append to `tests/test_server.py`:
```python
def test_find_references_finds_cross_file_usages(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "find_references")
    result = tool.fn(symbol_name="Calculator")
    assert "calculator.py" in result
    assert "main.py" in result


def test_find_references_no_results(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "find_references")
    result = tool.fn(symbol_name="ThisSymbolDoesNotExist")
    assert "no references" in result.lower() or result.strip() == ""
```

**Step 2: Run to verify it fails**

```bash
pytest tests/test_server.py::test_find_references_finds_cross_file_usages -v
```

Expected: FAIL

**Step 3: Add find_references to server.py**

```python
    @mcp.tool()
    def find_references(symbol_name: str) -> str:
        """Find all usages of a symbol (function, class, variable) across the entire repo."""
        refs = indexer.find_references(symbol_name)
        if not refs:
            return f"No references found for '{symbol_name}'"
        lines = [f"References to '{symbol_name}':"]
        for ref in refs:
            lines.append(f"  {ref['file']}:{ref['line']}")
        return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/test_server.py -v
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/codetree/server.py tests/test_server.py
git commit -m "feat: add find_references tool to MCP server"
```

---

## Task 8: get_call_graph Tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_server.py`

**Step 1: Add the failing test**

Append to `tests/test_server.py`:
```python
def test_get_call_graph_shows_outbound_calls(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_call_graph")
    result = tool.fn(file_path="calculator.py", function_name="helper")
    assert "Calculator" in result
    assert "add" in result


def test_get_call_graph_shows_callers(sample_repo):
    mcp = create_server(str(sample_repo))
    tool = next(t for t in mcp._tool_manager.list_tools() if t.name == "get_call_graph")
    result = tool.fn(file_path="calculator.py", function_name="divide")
    assert "main.py" in result
```

**Step 2: Run to verify it fails**

```bash
pytest tests/test_server.py::test_get_call_graph_shows_outbound_calls -v
```

Expected: FAIL

**Step 3: Add get_call_graph to server.py**

```python
    @mcp.tool()
    def get_call_graph(file_path: str, function_name: str) -> str:
        """Get what a function calls and what calls it across the repo."""
        graph = indexer.get_call_graph(file_path, function_name)
        lines = [f"Call graph for '{function_name}':"]

        if graph["calls"]:
            lines.append(f"\n  {function_name} calls:")
            for c in graph["calls"]:
                lines.append(f"    → {c}")
        else:
            lines.append(f"\n  {function_name} calls: (nothing detected)")

        if graph["callers"]:
            lines.append(f"\n  {function_name} is called by:")
            for caller in graph["callers"]:
                lines.append(f"    ← {caller['file']}:{caller['line']}")
        else:
            lines.append(f"\n  {function_name} is called by: (no callers found)")

        return "\n".join(lines)
```

**Step 4: Run all tests**

```bash
pytest -v
```

Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/codetree/server.py tests/test_server.py
git commit -m "feat: add get_call_graph tool to MCP server"
```

---

## Task 9: Wire Cache into Indexer + Manual Test

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `src/codetree/indexer.py`

**Step 1: Wire cache into server startup**

Update `create_server` in `server.py` to load/save cache:

```python
from fastmcp import FastMCP
from .indexer import Indexer
from .cache import Cache


def create_server(root: str) -> FastMCP:
    mcp = FastMCP("codetree")
    cache = Cache(root)
    cache.load()

    indexer = Indexer(root)
    indexer.build(cached_mtimes={
        k: v["mtime"] for k, v in (cache._data or {}).items()
    })
    cache.save()

    # ... tools unchanged ...
```

**Step 2: Run all tests to make sure nothing broke**

```bash
pytest -v
```

Expected: all PASS

**Step 3: Smoke test — run the server manually**

```bash
python -m codetree --root /Users/kartik/Developer/understandCode
```

Expected: server starts without errors, prints something like `Starting MCP server 'codetree'`

**Step 4: Add to Claude Code config**

Add to `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "codetree": {
      "command": "python",
      "args": ["-m", "codetree", "--root", "/Users/kartik/Developer/understandCode"]
    }
  }
}
```

Restart Claude Code and verify the 4 tools appear in the tool list.

**Step 5: Final commit**

```bash
git add src/codetree/server.py src/codetree/indexer.py
git commit -m "feat: wire cache into server startup for fast restarts"
```

---

## Done

All 4 tools are implemented and tested:
- `get_file_skeleton` — map any file instantly
- `get_symbol` — fetch exact source of any function/class
- `find_references` — cross-file symbol search
- `get_call_graph` — inbound and outbound calls

Future tasks (not v1): multi-language support, SQLite index, watch mode for live re-indexing.
