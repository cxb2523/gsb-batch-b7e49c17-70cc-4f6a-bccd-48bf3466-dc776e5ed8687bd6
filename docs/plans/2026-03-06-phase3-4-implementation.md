# Phase 3-4 Implementation Plan: Dead Code, Blast Radius, Clones, AST, Search

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 advanced analysis tools to codetree — dead code detection, blast radius/impact analysis, clone detection, raw AST access, and structural symbol search — bringing the tool count from 8 to 13.

**Architecture:** The features share a lazy-built call graph infrastructure in `indexer.py`. Dead code and blast radius use it for cross-file analysis; clone detection normalizes AST nodes then hashes; raw AST exposes tree-sitter S-expressions; structural search queries cached skeleton data. All new logic lives in `indexer.py` (analysis methods) and `server.py` (MCP tool formatting). Two new optional plugin methods (`normalize_source_for_clones`, `get_ast_sexp`) go in `base.py` with default implementations.

**Tech Stack:** Python 3.10+, tree-sitter 0.25.x, FastMCP 3.1.0, hashlib (stdlib), pytest

**Key files the implementer MUST read before starting:**
- `src/codetree/indexer.py` — the `Indexer` class and `FileEntry` dataclass
- `src/codetree/server.py` — how MCP tools are defined and access the indexer
- `src/codetree/languages/base.py` — the `LanguagePlugin` ABC and `_matches()` helper
- `tests/conftest.py` — the `sample_repo`, `rich_py_repo`, and `multi_lang_repo` fixtures

**How to run tests:**
```bash
source .venv/bin/activate
pytest                                    # all tests
pytest tests/test_dead_code.py -v         # one file
pytest tests/test_dead_code.py::test_name # one test
```

**How tools are accessed in tests:**
```python
from codetree.server import create_server
mcp = create_server(str(tmp_path))
fn = mcp.local_provider._components["tool:tool_name@"].fn
result = fn(param="value")
```

---

## Task 1: Shared infrastructure — definition index

**Files:**
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_dead_code.py`

This task adds a `_definitions` dict to the Indexer that maps symbol names to their definition locations. Built cheaply from existing skeleton data during `build()`.

**Step 1: Write the failing tests**

Create `tests/test_dead_code.py`:

```python
"""Tests for dead code detection."""
import pytest
from codetree.indexer import Indexer


# ─── Definition index ────────────────────────────────────────────────────────

class TestDefinitionIndex:

    def test_definitions_built_from_skeleton(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        assert "Calculator" in indexer._definitions
        assert "helper" in indexer._definitions
        assert "run" in indexer._definitions

    def test_definitions_contain_file_and_line(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        defs = indexer._definitions["Calculator"]
        assert len(defs) == 1
        assert defs[0][0] == "calculator.py"  # file
        assert isinstance(defs[0][1], int)     # line

    def test_same_name_different_files(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(): pass\n")
        (tmp_path / "b.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        assert len(indexer._definitions["foo"]) == 2

    def test_methods_included(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        assert "add" in indexer._definitions
        assert "divide" in indexer._definitions
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py::TestDefinitionIndex -v`
Expected: FAIL — `indexer._definitions` does not exist

**Step 3: Implement definition index in indexer.py**

In `Indexer.__init__`, add after `self._index`:

```python
self._definitions: dict[str, list[tuple[str, int]]] = {}
```

At the end of `Indexer.build()`, after the for-loop that populates `self._index`, add:

```python
# Build definition index from skeleton data
self._definitions = {}
for rel_path, entry in self._index.items():
    for item in entry.skeleton:
        name = item["name"]
        if name not in self._definitions:
            self._definitions[name] = []
        self._definitions[name].append((rel_path, item["line"]))
```

Also update `inject_cached` to rebuild the definition index. Add at the end of `inject_cached`:

```python
# Update definition index
for item in skeleton:
    name = item["name"]
    if name not in self._definitions:
        self._definitions[name] = []
    self._definitions[name].append((rel_path, item["line"]))
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py::TestDefinitionIndex -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass (no regressions)

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_dead_code.py
git commit -m "feat: add definition index to Indexer for dead code detection"
```

---

## Task 2: Shared infrastructure — lazy call graph

**Files:**
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_blast_radius.py`

This task adds `_call_graph` and `_reverse_graph` dicts, built lazily on first use.

**Step 1: Write the failing tests**

Create `tests/test_blast_radius.py`:

```python
"""Tests for blast radius / impact analysis."""
import pytest
from codetree.indexer import Indexer


# ─── Call graph infrastructure ────────────────────────────────────────────────

class TestCallGraph:

    def test_call_graph_built(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        assert indexer._call_graph_built is True

    def test_forward_graph_has_calls(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        # helper() calls Calculator() and calc.add()
        key = "calculator.py::helper"
        assert key in indexer._call_graph
        callees = indexer._call_graph[key]
        assert any("add" in c for c in callees)

    def test_reverse_graph_has_callers(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        # add is called by helper
        # Find any reverse graph key containing "add"
        add_keys = [k for k in indexer._reverse_graph if "add" in k]
        assert len(add_keys) >= 1
        callers = set()
        for k in add_keys:
            callers.update(indexer._reverse_graph[k])
        assert any("helper" in c for c in callers)

    def test_idempotent(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        indexer._ensure_call_graph()
        graph1 = dict(indexer._call_graph)
        indexer._ensure_call_graph()
        graph2 = dict(indexer._call_graph)
        assert graph1 == graph2

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        indexer._ensure_call_graph()
        assert indexer._call_graph_built is True
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py::TestCallGraph -v`
Expected: FAIL — `_ensure_call_graph` not found

**Step 3: Implement lazy call graph**

In `Indexer.__init__`, add after `self._definitions`:

```python
self._call_graph: dict[str, set[str]] = {}
self._reverse_graph: dict[str, set[str]] = {}
self._call_graph_built: bool = False
```

Add this method to `Indexer`, after `get_call_graph`:

```python
def _ensure_call_graph(self):
    """Build repo-wide call graph lazily on first use."""
    if self._call_graph_built:
        return
    self._call_graph = {}
    self._reverse_graph = {}
    for rel_path, entry in self._index.items():
        for item in entry.skeleton:
            if item["type"] in ("function", "method"):
                caller_key = f"{rel_path}::{item['name']}"
                callees = entry.plugin.extract_calls_in_function(
                    entry.source, item["name"]
                )
                callee_keys = set()
                for callee_name in callees:
                    # Resolve callee to its definition location(s)
                    if callee_name in self._definitions:
                        for def_file, _ in self._definitions[callee_name]:
                            callee_keys.add(f"{def_file}::{callee_name}")
                    else:
                        # External/unresolved — keep as bare name
                        callee_keys.add(f"?::{callee_name}")
                self._call_graph[caller_key] = callee_keys
                for ck in callee_keys:
                    if ck not in self._reverse_graph:
                        self._reverse_graph[ck] = set()
                    self._reverse_graph[ck].add(caller_key)
    self._call_graph_built = True
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py::TestCallGraph -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_blast_radius.py
git commit -m "feat: add lazy call graph infrastructure to Indexer"
```

---

## Task 3: Dead code detection — indexer method

**Files:**
- Modify: `src/codetree/indexer.py`
- Modify: `tests/test_dead_code.py`

**Step 1: Write the failing tests**

Append to `tests/test_dead_code.py`:

```python
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Dead code detection (indexer) ───────────────────────────────────────────

class TestFindDeadCode:

    def test_finds_unused_function(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def used():
    return 1

def unused():
    return 2

def main():
    used()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "unused" in dead_names

    def test_used_function_not_dead(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def used():
    return 1

def main():
    used()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "used" not in dead_names

    def test_cross_file_usage_not_dead(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "main.py").write_text("from lib import helper\nx = helper()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "helper" not in dead_names

    def test_main_excluded(self, tmp_path):
        (tmp_path / "app.py").write_text("def main(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "main" not in dead_names

    def test_test_functions_excluded(self, tmp_path):
        (tmp_path / "test_app.py").write_text("def test_something(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "test_something" not in dead_names

    def test_dunder_methods_excluded(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
class Foo:
    def __init__(self): pass
    def __str__(self): return ""
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "__init__" not in dead_names
        assert "__str__" not in dead_names

    def test_init_py_symbols_excluded(self, tmp_path):
        pkg = tmp_path / "pkg"
        pkg.mkdir()
        (pkg / "__init__.py").write_text("def public_api(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "public_api" not in dead_names

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def unused_a(): pass\n")
        (tmp_path / "b.py").write_text("def unused_b(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code(file_path="a.py")
        dead_names = [d["name"] for d in dead]
        assert "unused_a" in dead_names
        assert "unused_b" not in dead_names

    def test_dead_code_returns_type_and_line(self, tmp_path):
        (tmp_path / "app.py").write_text("def unused(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        item = next(d for d in dead if d["name"] == "unused")
        assert item["type"] == "function"
        assert item["line"] == 1
        assert item["file"] == "app.py"

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        assert dead == []

    def test_class_used_cross_file(self, tmp_path):
        (tmp_path / "models.py").write_text("class User:\n    pass\n")
        (tmp_path / "main.py").write_text("from models import User\nu = User()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        dead = indexer.find_dead_code()
        dead_names = [d["name"] for d in dead]
        assert "User" not in dead_names
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py::TestFindDeadCode -v`
Expected: FAIL — `find_dead_code` not found

**Step 3: Implement find_dead_code**

Add to `Indexer` class in `indexer.py`:

```python
# Symbols excluded from dead code detection
_EXCLUDED_NAMES = {
    "main", "__init__", "__main__", "__new__", "__del__",
    "__str__", "__repr__", "__eq__", "__ne__", "__lt__",
    "__le__", "__gt__", "__ge__", "__hash__", "__bool__",
    "__len__", "__getitem__", "__setitem__", "__delitem__",
    "__iter__", "__next__", "__contains__", "__enter__",
    "__exit__", "__call__", "__get__", "__set__", "__delete__",
    "__add__", "__sub__", "__mul__", "__truediv__", "__floordiv__",
    "__mod__", "__pow__", "__and__", "__or__", "__xor__",
    "__lshift__", "__rshift__", "__neg__", "__pos__", "__abs__",
    "__invert__", "__iadd__", "__isub__", "__imul__",
    "__getattr__", "__setattr__", "__delattr__",
    "__class_getitem__", "__init_subclass__",
    "setup", "teardown", "setUp", "tearDown",
}

def find_dead_code(self, file_path: str | None = None) -> list[dict]:
    """Find symbols that are defined but never referenced elsewhere.

    Args:
        file_path: if given, only report dead symbols in this file.
    Returns:
        list of {"file": str, "name": str, "type": str, "line": int, "parent": str | None}
    """
    dead = []
    # Determine which files to scan for definitions
    if file_path:
        files_to_check = {file_path: self._index[file_path]} if file_path in self._index else {}
    else:
        files_to_check = self._index

    for rel_path, entry in files_to_check.items():
        for item in entry.skeleton:
            name = item["name"]

            # Skip excluded names
            if name in self._EXCLUDED_NAMES:
                continue
            # Skip test functions/classes
            if name.startswith("test_") or name.startswith("Test"):
                continue
            # Skip symbols in __init__.py
            if rel_path.endswith("__init__.py"):
                continue

            # Find all references across the entire repo
            refs = self.find_references(name)

            # Filter out the definition site itself
            def_line = item["line"]
            external_refs = [
                r for r in refs
                if not (r["file"] == rel_path and r["line"] == def_line)
            ]

            if not external_refs:
                dead.append({
                    "file": rel_path,
                    "name": name,
                    "type": item["type"],
                    "line": def_line,
                    "parent": item.get("parent"),
                })
    return dead
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_dead_code.py
git commit -m "feat: add find_dead_code to Indexer"
```

---

## Task 4: Dead code detection — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_dead_code.py`

**Step 1: Write the failing tests**

Append to `tests/test_dead_code.py`:

```python

# ─── MCP tool: find_dead_code ────────────────────────────────────────────────

class TestFindDeadCodeTool:

    def test_finds_dead_function(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def used():
    return 1

def unused():
    return 2

def main():
    used()
""")
        fn = _tool(create_server(str(tmp_path)), "find_dead_code")
        result = fn()
        assert "unused" in result
        assert "used" not in result.split("unused")[0]  # "used" not reported as dead

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def unused_a(): pass\n")
        (tmp_path / "b.py").write_text("def unused_b(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "find_dead_code")
        result = fn(file_path="a.py")
        assert "unused_a" in result
        assert "unused_b" not in result

    def test_no_dead_code_message(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def main():
    pass
""")
        fn = _tool(create_server(str(tmp_path)), "find_dead_code")
        result = fn()
        assert "no dead code" in result.lower()

    def test_output_has_summary(self, tmp_path):
        (tmp_path / "app.py").write_text("def unused1(): pass\ndef unused2(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "find_dead_code")
        result = fn()
        assert "summary" in result.lower() or "2" in result

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "find_dead_code")
        result = fn(file_path="ghost.py")
        assert "not found" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py::TestFindDeadCodeTool -v`
Expected: FAIL — tool "find_dead_code" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after the `get_complexity` tool:

```python
@mcp.tool()
def find_dead_code(file_path: str | None = None) -> str:
    """Find symbols that are defined but never referenced elsewhere in the repo.

    Args:
        file_path: optional — if given, only check this file. Otherwise scans entire repo.
    """
    if file_path and file_path not in indexer._index:
        return f"File not found: {file_path}"
    dead = indexer.find_dead_code(file_path=file_path)
    if not dead:
        scope = file_path if file_path else "the repo"
        return f"No dead code found in {scope}."
    # Group by file
    by_file: dict[str, list] = {}
    for item in dead:
        by_file.setdefault(item["file"], []).append(item)
    lines = []
    for fp, items in sorted(by_file.items()):
        lines.append(f"Dead code in {fp}:")
        for item in items:
            parent = f"{item['parent']}." if item.get("parent") else ""
            lines.append(f"  {item['type']} {parent}{item['name']}() → line {item['line']}")
    total = len(dead)
    file_count = len(by_file)
    lines.append(f"\nSummary: {total} dead symbol{'s' if total != 1 else ''} across {file_count} file{'s' if file_count != 1 else ''}")
    return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_dead_code.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_dead_code.py
git commit -m "feat: add find_dead_code MCP tool"
```

---

## Task 5: Blast radius — indexer method

**Files:**
- Modify: `src/codetree/indexer.py`
- Modify: `tests/test_blast_radius.py`

**Step 1: Write the failing tests**

Append to `tests/test_blast_radius.py`:

```python
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Blast radius (indexer) ──────────────────────────────────────────────────

class TestGetBlastRadius:

    def test_direct_callers(self, tmp_path):
        (tmp_path / "lib.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "app.py").write_text("from lib import add\ndef main(): return add(1, 2)\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("lib.py", "add")
        caller_names = [c["name"] for c in result["callers"]]
        assert "main" in caller_names

    def test_transitive_callers(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        (tmp_path / "top.py").write_text("from mid import middle\ndef top(): return middle()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("core.py", "base")
        caller_names = [c["name"] for c in result["callers"]]
        assert "middle" in caller_names
        assert "top" in caller_names

    def test_callers_have_depth(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        (tmp_path / "top.py").write_text("from mid import middle\ndef top(): return middle()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("core.py", "base")
        depths = {c["name"]: c["depth"] for c in result["callers"]}
        assert depths["middle"] == 1
        assert depths["top"] == 2

    def test_dependencies(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "app.py").write_text("from lib import helper\ndef process(): return helper()\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "process")
        call_names = [c["name"] for c in result["calls"]]
        assert "helper" in call_names

    def test_leaf_function_no_calls(self, tmp_path):
        (tmp_path / "app.py").write_text("def leaf(): return 42\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "leaf")
        assert result["calls"] == []

    def test_cycle_handling(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def ping():
    pong()

def pong():
    ping()
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "ping")
        # Should not infinite loop; pong calls ping but we handle cycles
        caller_names = [c["name"] for c in result["callers"]]
        assert "pong" in caller_names

    def test_symbol_not_found(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_blast_radius("app.py", "nonexistent")
        assert result["callers"] == []
        assert result["calls"] == []
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py::TestGetBlastRadius -v`
Expected: FAIL — `get_blast_radius` not found

**Step 3: Implement get_blast_radius**

Add to `Indexer` class in `indexer.py`, after `_ensure_call_graph`:

```python
def get_blast_radius(self, file_path: str, symbol_name: str) -> dict:
    """Find all functions transitively affected by changes to a symbol.

    Returns:
        {"callers": [{"file", "name", "line", "depth"}, ...],
         "calls":   [{"file", "name", "line", "depth"}, ...]}
    """
    self._ensure_call_graph()

    target_key = f"{file_path}::{symbol_name}"

    def _bfs(graph: dict[str, set[str]], start: str) -> list[dict]:
        """BFS through graph, returning nodes with depth."""
        visited = {start}
        queue = [(start, 0)]
        results = []
        while queue:
            current, depth = queue.pop(0)
            neighbors = graph.get(current, set())
            for neighbor in neighbors:
                if neighbor not in visited and not neighbor.startswith("?::"):
                    visited.add(neighbor)
                    parts = neighbor.split("::", 1)
                    n_file = parts[0]
                    n_name = parts[1] if len(parts) > 1 else neighbor
                    # Look up line number
                    n_line = 0
                    if n_name in self._definitions:
                        for def_file, def_line in self._definitions[n_name]:
                            if def_file == n_file:
                                n_line = def_line
                                break
                    results.append({
                        "file": n_file,
                        "name": n_name,
                        "line": n_line,
                        "depth": depth + 1,
                    })
                    queue.append((neighbor, depth + 1))
        return results

    callers = _bfs(self._reverse_graph, target_key)
    calls = _bfs(self._call_graph, target_key)
    return {"callers": callers, "calls": calls}
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_blast_radius.py
git commit -m "feat: add get_blast_radius to Indexer with full transitive closure"
```

---

## Task 6: Blast radius — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_blast_radius.py`

**Step 1: Write the failing tests**

Append to `tests/test_blast_radius.py`:

```python

# ─── MCP tool: get_blast_radius ──────────────────────────────────────────────

class TestGetBlastRadiusTool:

    def test_shows_callers(self, tmp_path):
        (tmp_path / "lib.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "app.py").write_text("from lib import add\ndef main(): return add(1, 2)\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="lib.py", symbol_name="add")
        assert "main" in result
        assert "depth 1" in result.lower() or "Direct" in result

    def test_shows_dependencies(self, tmp_path):
        (tmp_path / "lib.py").write_text("def helper(): return 1\n")
        (tmp_path / "app.py").write_text("from lib import helper\ndef process(): return helper()\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="app.py", symbol_name="process")
        assert "helper" in result

    def test_leaf_function_output(self, tmp_path):
        (tmp_path / "app.py").write_text("def leaf(): return 42\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="app.py", symbol_name="leaf")
        assert "no callers" in result.lower() or "0 functions" in result.lower() or "none" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="ghost.py", symbol_name="foo")
        assert "not found" in result.lower()

    def test_summary_line(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "mid.py").write_text("from core import base\ndef middle(): return base()\n")
        fn = _tool(create_server(str(tmp_path)), "get_blast_radius")
        result = fn(file_path="core.py", symbol_name="base")
        assert "impact" in result.lower() or "summary" in result.lower() or "affected" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py::TestGetBlastRadiusTool -v`
Expected: FAIL — tool "get_blast_radius" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after `find_dead_code`:

```python
@mcp.tool()
def get_blast_radius(file_path: str, symbol_name: str) -> str:
    """Find all functions transitively affected if a symbol is changed.

    Shows direct and indirect callers (what breaks) and dependencies (what it relies on).

    Args:
        file_path: path relative to the repo root
        symbol_name: name of the function/method to analyze
    """
    if file_path not in indexer._index:
        return f"File not found: {file_path}"
    result = indexer.get_blast_radius(file_path, symbol_name)
    lines = [f"Blast radius for {symbol_name}() in {file_path}:"]

    callers = result["callers"]
    if callers:
        # Group by depth
        by_depth: dict[int, list] = {}
        for c in callers:
            by_depth.setdefault(c["depth"], []).append(c)
        for depth in sorted(by_depth):
            label = "Direct callers" if depth == 1 else f"Indirect callers (depth {depth})"
            lines.append(f"\n{label}:")
            for c in by_depth[depth]:
                lines.append(f"  {c['file']}: {c['name']}() → line {c['line']}")
    else:
        lines.append("\nCallers: (none — no functions call this)")

    calls = result["calls"]
    if calls:
        lines.append("\nDependencies (what it calls):")
        for c in calls:
            lines.append(f"  {c['file']}: {c['name']}() → line {c['line']}")
    else:
        lines.append("\nDependencies: (none — leaf function)")

    total_affected = len(callers)
    affected_files = len(set(c["file"] for c in callers))
    lines.append(f"\nImpact summary: {total_affected} function{'s' if total_affected != 1 else ''} in {affected_files} file{'s' if affected_files != 1 else ''} may be affected")
    return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_blast_radius.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_blast_radius.py
git commit -m "feat: add get_blast_radius MCP tool"
```

---

## Task 7: Clone detection — normalize method + indexer

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_clones.py`

**Step 1: Write the failing tests**

Create `tests/test_clones.py`:

```python
"""Tests for clone detection."""
import pytest
from codetree.indexer import Indexer
from codetree.languages.python import PythonPlugin
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


PY = PythonPlugin()


# ─── Normalization ────────────────────────────────────────────────────────────

class TestNormalization:

    def test_identical_functions_same_hash(self):
        src = b"def foo(a, b):\n    return a + b\n"
        h1 = PY.normalize_source_for_clones(src)
        h2 = PY.normalize_source_for_clones(src)
        assert h1 == h2

    def test_renamed_vars_same_hash(self):
        src1 = b"def foo(a, b):\n    return a + b\n"
        src2 = b"def bar(x, y):\n    return x + y\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2

    def test_different_logic_different_hash(self):
        src1 = b"def foo(a, b):\n    return a + b\n"
        src2 = b"def bar(a, b):\n    return a * b\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 != h2

    def test_different_strings_same_hash(self):
        src1 = b'def foo():\n    return "hello"\n'
        src2 = b'def bar():\n    return "world"\n'
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2

    def test_different_numbers_same_hash(self):
        src1 = b"def foo():\n    return 42\n"
        src2 = b"def bar():\n    return 99\n"
        h1 = PY.normalize_source_for_clones(src1)
        h2 = PY.normalize_source_for_clones(src2)
        assert h1 == h2


# ─── Clone detection (indexer) ───────────────────────────────────────────────

class TestDetectClones:

    def test_finds_exact_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones()
        assert len(clones) >= 1
        group = clones[0]
        names = [f["name"] for f in group["functions"]]
        assert "foo" in names
        assert "bar" in names

    def test_finds_renamed_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def add(x, y):\n    return x + y\n")
        (tmp_path / "b.py").write_text("def sum(a, b):\n    return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones()
        assert len(clones) >= 1

    def test_no_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a * b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones()
        assert clones == []

    def test_min_lines_filter(self, tmp_path):
        (tmp_path / "a.py").write_text("def f(): pass\n")
        (tmp_path / "b.py").write_text("def g(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones_strict = indexer.detect_clones(min_lines=5)
        assert clones_strict == []
        clones_loose = indexer.detect_clones(min_lines=1)
        assert len(clones_loose) >= 1

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a + b\n")
        (tmp_path / "c.py").write_text("def baz(x):\n    return x * 2\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(file_path="a.py")
        assert len(clones) >= 1
        # Should find that foo is cloned by bar

    def test_clone_group_has_line_count(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert clones[0]["line_count"] >= 1

    def test_single_function_not_clone(self, tmp_path):
        (tmp_path / "a.py").write_text("def unique(x):\n    return x ** 3 + x ** 2 + x\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        clones = indexer.detect_clones(min_lines=1)
        assert clones == []
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_clones.py -v`
Expected: FAIL — `normalize_source_for_clones` not found

**Step 3: Implement normalize_source_for_clones in base.py**

Add to `LanguagePlugin` class in `base.py`, after `check_syntax`:

```python
def normalize_source_for_clones(self, source: bytes) -> str:
    """Normalize source for clone detection.

    Replaces identifiers, strings, and numbers with placeholders
    so that structurally identical code with renamed variables
    produces the same normalized form.
    """
    # This requires a parser — subclasses with _get_language/_get_parser
    # will use the default implementation below. Plugins without those
    # methods can override.
    try:
        lang = self._get_language()
        parser = self._get_parser()
    except AttributeError:
        # Fallback: simple text normalization
        return source.decode("utf-8", errors="replace")

    tree = parser.parse(source)

    identifier_types = {
        "identifier", "type_identifier", "field_identifier",
        "property_identifier", "shorthand_property_identifier",
        "constant", "namespace_identifier",
    }
    string_types = {
        "string", "string_literal", "template_string",
        "raw_string_literal", "interpreted_string_literal",
        "string_content", "encapsed_string",
    }
    number_types = {
        "integer", "float", "number", "integer_literal",
        "float_literal", "decimal_integer_literal",
        "decimal_floating_point_literal",
    }
    comment_types = {"comment", "line_comment", "block_comment"}

    parts = []

    def walk(node):
        if node.type in comment_types:
            return  # skip comments entirely
        if not node.children or node.type in identifier_types | string_types | number_types:
            if node.type in identifier_types:
                parts.append("_ID_")
            elif node.type in string_types:
                parts.append("_STR_")
            elif node.type in number_types:
                parts.append("_NUM_")
            else:
                parts.append(node.text.decode("utf-8", errors="replace"))
        else:
            for child in node.children:
                walk(child)

    walk(tree.root_node)
    return " ".join(parts)
```

**Step 4: Implement detect_clones in indexer.py**

Add to `Indexer` class, after `get_blast_radius`:

```python
def detect_clones(self, file_path: str | None = None, min_lines: int = 5) -> list[dict]:
    """Find duplicate/near-duplicate functions across the repo.

    Uses AST normalization to detect Type 1 (exact) and Type 2 (renamed) clones.

    Args:
        file_path: if given, find clones of functions in this file.
        min_lines: minimum line count for a function to be considered.
    Returns:
        list of clone groups, each with "hash", "line_count", "functions".
    """
    import hashlib

    # Collect all function sources and normalize them
    function_hashes: dict[str, list[dict]] = {}  # hash → [{"file", "name", "line", "line_count"}]

    files_to_scan = self._index.items()

    for rel_path, entry in files_to_scan:
        for item in entry.skeleton:
            if item["type"] not in ("function", "method"):
                continue
            result = entry.plugin.extract_symbol_source(entry.source, item["name"])
            if result is None:
                continue
            src_text, src_line = result
            line_count = src_text.count("\n") + (0 if src_text.endswith("\n") else 1)
            if line_count < min_lines:
                continue
            # Normalize and hash
            normalized = entry.plugin.normalize_source_for_clones(src_text.encode("utf-8"))
            h = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
            if h not in function_hashes:
                function_hashes[h] = []
            function_hashes[h].append({
                "file": rel_path,
                "name": item["name"],
                "line": item["line"],
                "line_count": line_count,
            })

    # Filter: only groups with 2+ functions
    clone_groups = []
    for h, functions in function_hashes.items():
        if len(functions) < 2:
            continue
        # If file_path filter, only include groups that have a function from that file
        if file_path:
            if not any(f["file"] == file_path for f in functions):
                continue
        clone_groups.append({
            "hash": h,
            "line_count": functions[0]["line_count"],
            "functions": functions,
        })

    return clone_groups
```

**Step 5: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_clones.py -v`
Expected: All PASS

**Step 6: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 7: Commit**

```bash
git add src/codetree/languages/base.py src/codetree/indexer.py tests/test_clones.py
git commit -m "feat: add clone detection with AST normalization"
```

---

## Task 8: Clone detection — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_clones.py`

**Step 1: Write the failing tests**

Append to `tests/test_clones.py`:

```python

# ─── MCP tool: detect_clones ─────────────────────────────────────────────────

class TestDetectClonesTool:

    def test_finds_clones(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "clone group" in result.lower() or "Clone" in result
        assert "foo" in result
        assert "bar" in result

    def test_no_clones_message(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(a, b):\n    return a * b\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "no clones" in result.lower()

    def test_per_file_mode(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(file_path="a.py", min_lines=1)
        assert "foo" in result

    def test_summary(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(a, b):\n    return a + b\n")
        (tmp_path / "b.py").write_text("def bar(x, y):\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "detect_clones")
        result = fn(min_lines=1)
        assert "summary" in result.lower() or "group" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_clones.py::TestDetectClonesTool -v`
Expected: FAIL — tool "detect_clones" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after `get_blast_radius`:

```python
@mcp.tool()
def detect_clones(file_path: str | None = None, min_lines: int = 5) -> str:
    """Find duplicate or near-duplicate functions in the repo.

    Detects Type 1 (exact copies) and Type 2 (copies with renamed variables).

    Args:
        file_path: optional — if given, find clones of functions in this file.
        min_lines: minimum function line count to consider (default 5).
    """
    clones = indexer.detect_clones(file_path=file_path, min_lines=min_lines)
    if not clones:
        scope = file_path if file_path else "the repo"
        return f"No clones found in {scope} (min_lines={min_lines})."
    lines = []
    for i, group in enumerate(clones, 1):
        count = len(group["functions"])
        lc = group["line_count"]
        lines.append(f"Clone group {i} ({count} functions, {lc} lines each):")
        for fn in group["functions"]:
            lines.append(f"  {fn['file']}: {fn['name']}() → line {fn['line']}")
    total_groups = len(clones)
    total_fns = sum(len(g["functions"]) for g in clones)
    lines.append(f"\nSummary: {total_groups} clone group{'s' if total_groups != 1 else ''}, {total_fns} functions")
    return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_clones.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_clones.py
git commit -m "feat: add detect_clones MCP tool"
```

---

## Task 9: Raw AST access — base method + indexer

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_ast.py`

**Step 1: Write the failing tests**

Create `tests/test_ast.py`:

```python
"""Tests for raw AST access."""
import pytest
from codetree.indexer import Indexer
from codetree.languages.python import PythonPlugin
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


PY = PythonPlugin()


# ─── AST S-expression (plugin) ───────────────────────────────────────────────

class TestAstSexp:

    def test_full_file(self):
        src = b"def foo(): pass\n"
        result = PY.get_ast_sexp(src)
        assert "function_definition" in result
        assert "foo" in result

    def test_specific_symbol(self):
        src = b"def foo(): pass\ndef bar(): pass\n"
        result = PY.get_ast_sexp(src, symbol_name="foo")
        assert "foo" in result
        assert "bar" not in result

    def test_max_depth_0(self):
        src = b"def foo(): pass\n"
        result = PY.get_ast_sexp(src, max_depth=0)
        assert "module" in result
        assert "..." in result

    def test_max_depth_1(self):
        src = b"def foo(): pass\n"
        result = PY.get_ast_sexp(src, max_depth=1)
        assert "function_definition" in result
        assert "..." in result

    def test_has_line_numbers(self):
        src = b"def foo(): pass\n"
        result = PY.get_ast_sexp(src)
        # Should contain line:col positions like [1:0
        assert "[" in result

    def test_symbol_not_found(self):
        src = b"def foo(): pass\n"
        result = PY.get_ast_sexp(src, symbol_name="nonexistent")
        assert result is None

    def test_empty_file(self):
        result = PY.get_ast_sexp(b"")
        assert "module" in result


# ─── AST via indexer ─────────────────────────────────────────────────────────

class TestAstIndexer:

    def test_get_ast(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_ast("app.py")
        assert "function_definition" in result

    def test_get_ast_with_symbol(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\ndef bar(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_ast("app.py", symbol_name="foo")
        assert "foo" in result
        assert "bar" not in result

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        result = indexer.get_ast("ghost.py")
        assert result is None
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_ast.py -v`
Expected: FAIL — `get_ast_sexp` not found

**Step 3: Implement get_ast_sexp in base.py**

Add to `LanguagePlugin` class in `base.py`, after `normalize_source_for_clones`:

```python
def get_ast_sexp(self, source: bytes, symbol_name: str | None = None, max_depth: int = -1) -> str | None:
    """Return S-expression representation of the AST with line positions.

    Args:
        source: source code bytes
        symbol_name: if given, return AST for just this symbol
        max_depth: limit depth (-1 = unlimited)
    Returns:
        S-expression string, or None if symbol_name given but not found.
    """
    try:
        parser = self._get_parser()
    except AttributeError:
        return None

    tree = parser.parse(source)
    root = tree.root_node

    # If symbol_name given, find the symbol's node
    if symbol_name:
        result = self.extract_symbol_source(source, symbol_name)
        if result is None:
            return None
        # Find the actual node by matching start position
        _, start_line = result
        target_line = start_line - 1  # convert to 0-based

        def find_node(node, target_line):
            if node.start_point[0] == target_line and node.type not in ("module", "program", "translation_unit", "source_file"):
                return node
            for child in node.children:
                found = find_node(child, target_line)
                if found:
                    return found
            return None

        found = find_node(root, target_line)
        if found is None:
            return None
        root = found

    def format_node(node, depth=0, current_depth=0):
        indent = "  " * depth
        pos = f"[{node.start_point[0]+1}:{node.start_point[1]}-{node.end_point[0]+1}:{node.end_point[1]}]"

        if max_depth >= 0 and current_depth > max_depth:
            return None  # signal to show "..."

        if not node.children:
            # Leaf node — show text
            text = node.text.decode("utf-8", errors="replace")
            if node.is_named:
                return f"{indent}({node.type} {pos} {repr(text)})"
            else:
                return f"{indent}{repr(text)}"

        # Internal node with children
        if max_depth >= 0 and current_depth == max_depth:
            return f"{indent}({node.type} {pos} ...)"

        child_strs = []
        for child in node.children:
            cs = format_node(child, depth + 1, current_depth + 1)
            if cs:
                child_strs.append(cs)

        if child_strs:
            children = "\n".join(child_strs)
            return f"{indent}({node.type} {pos}\n{children})"
        else:
            return f"{indent}({node.type} {pos})"

    return format_node(root)
```

**Step 4: Implement get_ast in indexer.py**

Add to `Indexer` class, after `detect_clones`:

```python
def get_ast(self, rel_path: str, symbol_name: str | None = None, max_depth: int = -1) -> str | None:
    """Return AST S-expression for a file or symbol.

    Returns None if file not found.
    """
    entry = self._index.get(rel_path)
    if entry is None:
        return None
    return entry.plugin.get_ast_sexp(
        entry.source, symbol_name=symbol_name, max_depth=max_depth
    )
```

**Step 5: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_ast.py -v`
Expected: All PASS

**Step 6: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 7: Commit**

```bash
git add src/codetree/languages/base.py src/codetree/indexer.py tests/test_ast.py
git commit -m "feat: add raw AST access with S-expression output"
```

---

## Task 10: Raw AST access — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_ast.py`

**Step 1: Write the failing tests**

Append to `tests/test_ast.py`:

```python

# ─── MCP tool: get_ast ───────────────────────────────────────────────────────

class TestGetAstTool:

    def test_full_file(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_ast")
        result = fn(file_path="app.py")
        assert "function_definition" in result
        assert "foo" in result

    def test_specific_symbol(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\ndef bar(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_ast")
        result = fn(file_path="app.py", symbol_name="foo")
        assert "foo" in result

    def test_max_depth(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_ast")
        result = fn(file_path="app.py", max_depth=1)
        assert "..." in result

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_ast")
        result = fn(file_path="ghost.py")
        assert "not found" in result.lower()

    def test_symbol_not_found(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_ast")
        result = fn(file_path="app.py", symbol_name="nonexistent")
        assert "not found" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_ast.py::TestGetAstTool -v`
Expected: FAIL — tool "get_ast" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after `detect_clones`:

```python
@mcp.tool()
def get_ast(file_path: str, symbol_name: str | None = None, max_depth: int = -1) -> str:
    """Get the raw AST (abstract syntax tree) of a file or symbol as an S-expression.

    Args:
        file_path: path relative to the repo root
        symbol_name: optional — if given, show AST for just this symbol
        max_depth: optional — limit tree depth (-1 = unlimited, 0 = root only)
    """
    if file_path not in indexer._index:
        return f"File not found: {file_path}"
    result = indexer.get_ast(file_path, symbol_name=symbol_name, max_depth=max_depth)
    if result is None:
        if symbol_name:
            return f"Symbol '{symbol_name}' not found in {file_path}"
        return f"Could not parse AST for {file_path}"
    header = f"AST for {symbol_name + '() in ' if symbol_name else ''}{file_path}:"
    return f"{header}\n\n{result}"
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_ast.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_ast.py
git commit -m "feat: add get_ast MCP tool"
```

---

## Task 11: Structural search — indexer + MCP tool

**Files:**
- Modify: `src/codetree/indexer.py`
- Modify: `src/codetree/server.py`
- Create: `tests/test_search.py`

**Step 1: Write the failing tests**

Create `tests/test_search.py`:

```python
"""Tests for structural symbol search."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Search (indexer) ────────────────────────────────────────────────────────

class TestSearchSymbols:

    def test_query_by_name(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(query="calc")
        names = [r["name"] for r in results]
        assert "Calculator" in names

    def test_filter_by_type(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(type="class")
        for r in results:
            assert r["type"] == "class"

    def test_filter_by_parent(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(parent="Calculator")
        for r in results:
            assert r["parent"] is not None
            assert "Calculator" in r["parent"]

    def test_filter_has_doc_true(self, tmp_path):
        (tmp_path / "app.py").write_text('def documented():\n    """Has doc."""\n    pass\n\ndef bare(): pass\n')
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(has_doc=True)
        names = [r["name"] for r in results]
        assert "documented" in names
        assert "bare" not in names

    def test_filter_has_doc_false(self, tmp_path):
        (tmp_path / "app.py").write_text('def documented():\n    """Has doc."""\n    pass\n\ndef bare(): pass\n')
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(has_doc=False)
        names = [r["name"] for r in results]
        assert "bare" in names
        assert "documented" not in names

    def test_filter_by_language(self, multi_lang_repo):
        indexer = Indexer(str(multi_lang_repo))
        indexer.build()
        results = indexer.search_symbols(query="add", language="py")
        for r in results:
            assert r["file"].endswith(".py")

    def test_combined_filters(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        results = indexer.search_symbols(query="add", type="method")
        assert len(results) >= 1
        for r in results:
            assert "add" in r["name"].lower()
            assert r["type"] == "method"

    def test_min_complexity_filter(self, tmp_path):
        (tmp_path / "app.py").write_text("""\
def simple():
    return 1

def complex_fn(x):
    if x > 0:
        for i in range(x):
            if i > 10:
                return i
    return 0
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(min_complexity=3)
        names = [r["name"] for r in results]
        assert "complex_fn" in names
        assert "simple" not in names

    def test_no_results(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols(query="zzzzz")
        assert results == []

    def test_at_least_one_filter_required(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        results = indexer.search_symbols()
        # With no filters, returns all symbols
        assert len(results) >= 1


# ─── MCP tool: search_symbols ────────────────────────────────────────────────

class TestSearchSymbolsTool:

    def test_search_by_name(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="calc")
        assert "Calculator" in result

    def test_search_by_type(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(type="class")
        assert "Calculator" in result

    def test_no_results_message(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "search_symbols")
        result = fn(query="zzzzzz")
        assert "no" in result.lower() and ("found" in result.lower() or "match" in result.lower() or "result" in result.lower())

    def test_shows_doc(self, tmp_path):
        (tmp_path / "app.py").write_text('def foo():\n    """A helper."""\n    pass\n')
        fn = _tool(create_server(str(tmp_path)), "search_symbols")
        result = fn(query="foo")
        assert "A helper." in result

    def test_shows_file_and_line(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="Calculator")
        assert "calculator.py" in result
        assert "line" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_search.py -v`
Expected: FAIL — `search_symbols` not found

**Step 3: Implement search_symbols in indexer.py**

Add to `Indexer` class, after `get_ast`:

```python
def search_symbols(self, query: str | None = None, type: str | None = None,
                   parent: str | None = None, has_doc: bool | None = None,
                   min_complexity: int | None = None,
                   language: str | None = None) -> list[dict]:
    """Search symbols across the repo with flexible filters.

    All parameters optional; combine for powerful filtering.
    Returns list of {"file", "name", "type", "line", "parent", "doc"}.
    """
    results = []
    for rel_path, entry in self._index.items():
        # Language filter
        if language and entry.language != language:
            continue
        for item in entry.skeleton:
            # Name query (case-insensitive substring)
            if query and query.lower() not in item["name"].lower():
                continue
            # Type filter
            if type and item["type"] != type:
                continue
            # Parent filter (case-insensitive substring)
            if parent:
                item_parent = item.get("parent") or ""
                if parent.lower() not in item_parent.lower():
                    continue
            # Doc filter
            if has_doc is not None:
                doc = item.get("doc", "")
                if has_doc and not doc:
                    continue
                if not has_doc and doc:
                    continue
            # Complexity filter
            if min_complexity is not None:
                if item["type"] not in ("function", "method"):
                    continue
                cx = entry.plugin.compute_complexity(entry.source, item["name"])
                if cx is None or cx["total"] < min_complexity:
                    continue

            results.append({
                "file": rel_path,
                "name": item["name"],
                "type": item["type"],
                "line": item["line"],
                "parent": item.get("parent"),
                "doc": item.get("doc", ""),
            })
    return results
```

**Step 4: Implement the MCP tool in server.py**

Add to `server.py`, after `get_ast`:

```python
@mcp.tool()
def search_symbols(query: str | None = None, type: str | None = None,
                   parent: str | None = None, has_doc: bool | None = None,
                   min_complexity: int | None = None,
                   language: str | None = None) -> str:
    """Search for symbols across the repo with flexible filters.

    All parameters optional — combine for powerful filtering.

    Args:
        query: case-insensitive substring match on symbol name
        type: exact match on type (function, class, method, struct, etc.)
        parent: case-insensitive substring match on parent class name
        has_doc: True = only symbols with doc, False = only without
        min_complexity: minimum cyclomatic complexity
        language: filter by file extension without dot (e.g., "py", "js", "go")
    """
    results = indexer.search_symbols(
        query=query, type=type, parent=parent,
        has_doc=has_doc, min_complexity=min_complexity, language=language,
    )
    if not results:
        filters = []
        if query: filters.append(f'query="{query}"')
        if type: filters.append(f'type="{type}"')
        if parent: filters.append(f'parent="{parent}"')
        if has_doc is not None: filters.append(f'has_doc={has_doc}')
        if min_complexity: filters.append(f'min_complexity={min_complexity}')
        if language: filters.append(f'language="{language}"')
        return f"No symbols found matching {', '.join(filters) if filters else 'criteria'}."
    lines = ["Search results:"]
    for r in results:
        parent_info = f" (in {r['parent']})" if r["parent"] else ""
        lines.append(f"  {r['file']}: {r['type']} {r['name']}{parent_info} → line {r['line']}")
        if r["doc"]:
            lines.append(f"    \"{r['doc']}\"")
    lines.append(f"\nFound {len(results)} symbol{'s' if len(results) != 1 else ''}")
    return "\n".join(lines)
```

**Step 5: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_search.py -v`
Expected: All PASS

**Step 6: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 7: Commit**

```bash
git add src/codetree/indexer.py src/codetree/server.py tests/test_search.py
git commit -m "feat: add search_symbols with flexible filtering"
```

---

## Task 12: Update CLAUDE.md, template, and memory

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/codetree/languages/_template.py`

**Step 1: Update CLAUDE.md**

Update these sections:

a) Change tool count from **8 tools** to **13 tools**

b) Add 5 new tools to the tool table:

```
| `find_dead_code(file_path?)` | Symbols defined but never referenced | `Dead code in calc.py:\n  function unused() → line 15` |
| `get_blast_radius(file_path, symbol_name)` | Transitive impact analysis | `Direct callers (depth 1):\n  main.py: run() → line 4` |
| `detect_clones(file_path?, min_lines?)` | Duplicate/near-duplicate functions | `Clone group 1 (2 functions, 12 lines each):` |
| `get_ast(file_path, symbol_name?, max_depth?)` | Raw AST as S-expression | `(function_definition [5:0-7:0] ...)` |
| `search_symbols(query?, type?, parent?, ...)` | Flexible symbol search | `calc.py: class Calculator → line 1` |
```

c) Update test count (run `pytest` to get actual number)

d) In "Plugin system" section, update `base.py` description to mention `normalize_source_for_clones` and `get_ast_sexp`

e) Add to "Each plugin implements" list:
```
8. **`normalize_source_for_clones(source: bytes) -> str`** — AST-normalized source for clone detection (non-abstract, default in base)
9. **`get_ast_sexp(source: bytes, symbol_name?, max_depth?) -> str | None`** — S-expression AST output (non-abstract, default in base)
```

f) Update `indexer.py` description to mention definition index, call graph, dead code, blast radius, clone detection, AST, search

**Step 2: Update _template.py**

Add stubs for `normalize_source_for_clones` and `get_ast_sexp` (they have defaults in base.py so just add TODO comments mentioning them):

```python
# normalize_source_for_clones and get_ast_sexp have default implementations
# in base.py — no override needed unless your language has special needs.
```

**Step 3: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 4: Commit**

```bash
git add CLAUDE.md src/codetree/languages/_template.py
git commit -m "chore: update CLAUDE.md and template for Phase 3-4 features"
```

---

## Implementation order summary

| Task | Feature | Dependencies |
|------|---------|-------------|
| 1 | Definition index | None |
| 2 | Lazy call graph | Task 1 (uses _definitions) |
| 3 | Dead code indexer method | Task 1 |
| 4 | Dead code MCP tool | Task 3 |
| 5 | Blast radius indexer method | Task 2 |
| 6 | Blast radius MCP tool | Task 5 |
| 7 | Clone detection (normalize + indexer) | None (independent) |
| 8 | Clone detection MCP tool | Task 7 |
| 9 | Raw AST (base + indexer) | None (independent) |
| 10 | Raw AST MCP tool | Task 9 |
| 11 | Structural search (indexer + MCP) | None (independent) |
| 12 | Update docs | All above |

Tasks 7-11 are independent of each other and can be parallelized if desired.
