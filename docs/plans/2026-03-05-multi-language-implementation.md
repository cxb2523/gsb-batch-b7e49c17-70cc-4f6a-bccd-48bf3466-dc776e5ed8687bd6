# Multi-Language Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend codetree from Python-only to supporting Python, JavaScript/TypeScript, Go, Rust, and Java via a language plugin architecture — with a boilerplate template that lets any developer add a new language in under an hour.

**Architecture:** A `languages/` directory where each file is a self-contained `LanguagePlugin` implementation. A `registry.py` maps file extensions to plugin instances. `indexer.py` stores the plugin on each `FileEntry` and calls it directly — `server.py` and `cache.py` are untouched.

**Tech Stack:** `tree-sitter>=0.23`, `tree-sitter-python`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `fastmcp>=2.0`, `pytest`

---

## Task 1: Install grammars + update pyproject.toml

**Files:**
- Modify: `pyproject.toml`

Grammar packages are already installed in `.venv`. This task updates `pyproject.toml` so they're declared as dependencies.

**Step 1: Update pyproject.toml dependencies**

Replace the `dependencies` block in `pyproject.toml` with:

```toml
dependencies = [
    "tree-sitter>=0.23.0",
    "tree-sitter-python>=0.23.0",
    "tree-sitter-javascript>=0.23.0",
    "tree-sitter-typescript>=0.23.0",
    "tree-sitter-go>=0.23.0",
    "tree-sitter-rust>=0.23.0",
    "tree-sitter-java>=0.23.0",
    "fastmcp>=2.0.0",
]
```

**Step 2: Verify install still works**

```bash
cd /Users/kartik/Developer/understandCode
source .venv/bin/activate
pip install -e . -q
python -c "import tree_sitter_javascript, tree_sitter_typescript, tree_sitter_go, tree_sitter_rust, tree_sitter_java; print('all grammars ok')"
```

Expected: `all grammars ok`

**Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "feat: add multi-language grammar dependencies"
```

---

## Task 2: LanguagePlugin base class

**Files:**
- Create: `src/codetree/languages/__init__.py`
- Create: `src/codetree/languages/base.py`
- Test: `tests/languages/__init__.py`

**Step 1: Create directory structure**

```bash
mkdir -p src/codetree/languages tests/languages
touch src/codetree/languages/__init__.py tests/languages/__init__.py
```

**Step 2: Write failing test**

Create `tests/languages/test_base.py`:

```python
import pytest
from codetree.languages.base import LanguagePlugin


def test_language_plugin_is_abstract():
    """LanguagePlugin cannot be instantiated directly."""
    with pytest.raises(TypeError):
        LanguagePlugin()


def test_concrete_plugin_must_implement_all_methods():
    """A subclass missing any method cannot be instantiated."""
    class Incomplete(LanguagePlugin):
        extensions = (".x",)
        def extract_skeleton(self, source): return []
        # missing the other 3 methods

    with pytest.raises(TypeError):
        Incomplete()


def test_concrete_plugin_with_all_methods_works():
    class Complete(LanguagePlugin):
        extensions = (".x",)
        def extract_skeleton(self, source): return []
        def extract_symbol_source(self, source, name): return None
        def extract_calls_in_function(self, source, fn_name): return []
        def extract_symbol_usages(self, source, name): return []

    plugin = Complete()
    assert plugin.extensions == (".x",)
    assert plugin.extract_skeleton(b"") == []
```

**Step 3: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_base.py -v
```

Expected: FAIL with `ImportError`

**Step 4: Implement base.py**

```python
from abc import ABC, abstractmethod


class LanguagePlugin(ABC):
    """Abstract base class for all language plugins.

    To add a new language, copy `languages/_template.py`, implement all
    4 abstract methods, and register your plugin in `registry.py`.
    """

    extensions: tuple[str, ...]  # e.g. (".py",) or (".js", ".jsx")

    @abstractmethod
    def extract_skeleton(self, source: bytes) -> list[dict]:
        """Return top-level symbols in the file.

        Each dict must have keys:
          - type: "class" | "function" | "method" | "struct" | "interface"
          - name: str
          - line: int (1-based)
          - parent: str | None  (class name for methods, None for top-level)
          - params: str  (parameter list as string, e.g. "(a, b)" or "")
        """

    @abstractmethod
    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        """Return (source_text, start_line) for a named function/class.

        Returns None if the symbol is not found.
        start_line is 1-based.
        """

    @abstractmethod
    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        """Return sorted list of function/method names called inside fn_name.

        Returns empty list if fn_name is not found.
        """

    @abstractmethod
    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        """Return all occurrences of name as an identifier.

        Each dict has keys:
          - line: int (1-based)
          - col: int (0-based)

        Includes definition sites. Use find_references in the indexer for
        cross-file usage.
        """
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_base.py -v
```

Expected: 3 PASS

**Step 6: Commit**

```bash
git add src/codetree/languages/ tests/languages/
git commit -m "feat: add LanguagePlugin abstract base class"
```

---

## Task 3: Python plugin + migrate tests

**Files:**
- Create: `src/codetree/languages/python.py`
- Create: `tests/languages/test_python.py`

The Python plugin is the existing `queries.py` logic moved into a class.

**Step 1: Write failing tests**

Create `tests/languages/test_python.py`:

```python
import pytest
from codetree.languages.python import PythonPlugin

PLUGIN = PythonPlugin()

SAMPLE = b"""\
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
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_includes_line_numbers():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["line"] == 1


def test_skeleton_includes_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "a" in add["params"] and "b" in add["params"]


def test_extract_symbol_finds_function():
    source, line = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert "def add" in source
    assert "return a + b" in source


def test_extract_symbol_finds_class():
    source, line = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert "class Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "add")
    assert len(usages) >= 1
    assert any(u["line"] > 1 for u in usages)
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_python.py -v
```

Expected: FAIL with `ImportError`

**Step 3: Create languages/python.py**

```python
from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_python as tspython
from .base import LanguagePlugin

_LANGUAGE = Language(tspython.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    """Run a query and return matches with captures unwrapped to single nodes."""
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class PythonPlugin(LanguagePlugin):
    extensions = (".py",)

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Top-level classes
        q = Query(_LANGUAGE, "(module (class_definition name: (identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods inside classes
        q = Query(_LANGUAGE, """
            (class_definition
                name: (identifier) @class_name
                body: (block
                    (function_definition
                        name: (identifier) @method_name
                        parameters: (parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level functions
        q = Query(_LANGUAGE, """
            (module (function_definition
                name: (identifier) @name
                parameters: (parameters) @params))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)
        for node_type in ("function_definition", "class_definition"):
            q = Query(_LANGUAGE, f"({node_type} name: (identifier) @name) @def")
            for _, m in _matches(q, tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == name:
                    node = m["def"]
                    return (
                        source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"),
                        node.start_point[0] + 1,
                    )
        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        q = Query(_LANGUAGE, "(function_definition name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        q = Query(_LANGUAGE, """
            (call function: [
                (identifier) @called
                (attribute attribute: (identifier) @called)
            ])
        """)
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        q = Query(_LANGUAGE, f'((identifier) @name (#eq? @name "{name}"))')
        usages = []
        for _, m in _matches(q, tree.root_node):
            node = m["name"]
            usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        return usages
```

**Step 4: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_python.py -v
```

Expected: 11 PASS

**Step 5: Commit**

```bash
git add src/codetree/languages/python.py tests/languages/test_python.py
git commit -m "feat: add Python language plugin"
```

---

## Task 4: registry.py + rewire indexer.py + delete queries.py

**Files:**
- Create: `src/codetree/registry.py`
- Modify: `src/codetree/indexer.py`
- Delete: `src/codetree/queries.py`
- Delete: `tests/test_queries.py`

This task wires the plugin system through the indexer. After this, all 28 existing tests must still pass (test_indexer, test_server, test_cache).

**Step 1: Create registry.py**

```python
from pathlib import Path
from .languages.base import LanguagePlugin
from .languages.python import PythonPlugin

# All supported file extensions mapped to plugin instances.
# To add a new language: import its plugin and add its extensions here.
PLUGINS: dict[str, LanguagePlugin] = {
    ".py": PythonPlugin(),
}


def get_plugin(path: Path) -> LanguagePlugin | None:
    """Return the plugin for this file's extension, or None if unsupported."""
    return PLUGINS.get(path.suffix)
```

**Step 2: Rewrite indexer.py**

```python
from pathlib import Path
from dataclasses import dataclass
from .languages.base import LanguagePlugin
from .registry import get_plugin


@dataclass
class FileEntry:
    path: Path
    source: bytes
    skeleton: list[dict]
    mtime: float
    language: str
    plugin: LanguagePlugin


class Indexer:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self._index: dict[str, FileEntry] = {}

    @property
    def files(self) -> list[Path]:
        return [entry.path for entry in self._index.values()]

    SKIP_DIRS = {
        ".venv", "venv", "env", ".env",
        "__pycache__", ".git", ".hg", ".svn",
        "node_modules", ".tox", ".mypy_cache",
        ".pytest_cache", "dist", "build", "*.egg-info",
    }

    def _should_skip(self, path: Path) -> bool:
        return any(part in self.SKIP_DIRS for part in path.parts)

    def build(self, cached_mtimes: dict[str, float] | None = None):
        """Index all supported files under root, skipping non-project dirs.

        Files whose path+mtime appear in cached_mtimes are skipped;
        the caller injects them via inject_cached().
        """
        cached_mtimes = cached_mtimes or {}
        for candidate in self.root.rglob("*"):
            if not candidate.is_file():
                continue
            plugin = get_plugin(candidate)
            if plugin is None:
                continue
            if self._should_skip(candidate.relative_to(self.root)):
                continue
            rel = str(candidate.relative_to(self.root))
            mtime = candidate.stat().st_mtime
            if cached_mtimes.get(rel) == mtime:
                continue
            source = candidate.read_bytes()
            skeleton = plugin.extract_skeleton(source)
            self._index[rel] = FileEntry(
                path=candidate,
                source=source,
                skeleton=skeleton,
                mtime=mtime,
                language=candidate.suffix.lstrip("."),
                plugin=plugin,
            )

    def inject_cached(self, rel_path: str, py_file: Path, source: bytes,
                      skeleton: list[dict], mtime: float):
        """Inject a pre-computed entry (from cache) without re-parsing."""
        plugin = get_plugin(py_file)
        if plugin is None:
            return
        self._index[rel_path] = FileEntry(
            path=py_file,
            source=source,
            skeleton=skeleton,
            mtime=mtime,
            language=py_file.suffix.lstrip("."),
            plugin=plugin,
        )

    def get_skeleton(self, rel_path: str) -> list[dict]:
        entry = self._index.get(rel_path)
        return entry.skeleton if entry else []

    def get_symbol(self, rel_path: str, symbol_name: str) -> tuple[str, int] | None:
        entry = self._index.get(rel_path)
        if entry is None:
            return None
        return entry.plugin.extract_symbol_source(entry.source, symbol_name)

    def find_references(self, symbol_name: str) -> list[dict]:
        results = []
        for rel_path, entry in self._index.items():
            for u in entry.plugin.extract_symbol_usages(entry.source, symbol_name):
                results.append({"file": rel_path, "line": u["line"], "col": u["col"]})
        return results

    def get_call_graph(self, rel_path: str, function_name: str) -> dict:
        entry = self._index.get(rel_path)
        calls = entry.plugin.extract_calls_in_function(entry.source, function_name) if entry else []
        callers = []
        for rp, e in self._index.items():
            for u in e.plugin.extract_symbol_usages(e.source, function_name):
                callers.append({"file": rp, "line": u["line"]})
        return {"calls": calls, "callers": callers}
```

**Step 3: Delete old files**

```bash
rm src/codetree/queries.py tests/test_queries.py
```

**Step 4: Run existing tests**

```bash
source .venv/bin/activate && pytest tests/test_indexer.py tests/test_server.py tests/test_cache.py -v
```

Expected: all 19 tests PASS (6 indexer + 8 server + 5 cache). Fix any failures before continuing.

**Step 5: Run full suite**

```bash
source .venv/bin/activate && pytest -v
```

Expected: test_queries.py is gone; remaining tests pass.

**Step 6: Commit**

```bash
git add src/codetree/registry.py src/codetree/indexer.py
git rm src/codetree/queries.py tests/test_queries.py
git commit -m "feat: wire language plugin registry through indexer"
```

---

## Task 5: JavaScript plugin

**Files:**
- Create: `src/codetree/languages/javascript.py`
- Create: `tests/languages/test_javascript.py`
- Modify: `src/codetree/registry.py`

**Confirmed node types** (verified from tree-sitter parse output):
- Class: `class_declaration` → name: `identifier`
- Method: `method_definition` → name: `property_identifier`, params: `formal_parameters`
- Function: `function_declaration` → name: `identifier`, params: `formal_parameters`
- Calls: `call_expression` → function: `identifier` OR `member_expression` property: `property_identifier`
- Identifiers: `identifier`

**Step 1: Write failing tests**

Create `tests/languages/test_javascript.py`:

```python
import pytest
from codetree.languages.javascript import JavaScriptPlugin

PLUGIN = JavaScriptPlugin()

SAMPLE = b"""\
class Calculator {
  add(a, b) {
    return a + b;
  }
  divide(a, b) {
    if (b === 0) throw new Error('div by zero');
    return a / b;
  }
}

function helper() {
  const calc = new Calculator();
  return calc.add(1, 2);
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_includes_line_numbers():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["line"] == 1


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, line = result
    assert "function helper" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, line = result
    assert "class Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_javascript.py -v
```

**Step 3: Implement javascript.py**

```python
from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_javascript as tsjs
from .base import LanguagePlugin

_LANGUAGE = Language(tsjs.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class JavaScriptPlugin(LanguagePlugin):
    extensions = (".js", ".jsx")
    _lang = _LANGUAGE
    _parser = _PARSER

    def _get_language(self):
        return self._lang

    def _get_parser(self):
        return self._parser

    def extract_skeleton(self, source: bytes) -> list[dict]:
        lang = self._get_language()
        tree = self._get_parser().parse(source)
        results = []

        # Top-level classes
        q = Query(lang, "(program (class_declaration name: (identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods inside classes (note: JS uses property_identifier for method names)
        q = Query(lang, """
            (class_declaration
                name: (identifier) @class_name
                body: (class_body
                    (method_definition
                        name: (property_identifier) @method_name
                        parameters: (formal_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level function declarations
        q = Query(lang, """
            (program (function_declaration
                name: (identifier) @name
                parameters: (formal_parameters) @params))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        lang = self._get_language()
        tree = self._get_parser().parse(source)
        for node_type, name_field in [
            ("function_declaration", "identifier"),
            ("class_declaration", "identifier"),
        ]:
            q = Query(lang, f"({node_type} name: ({name_field}) @name) @def")
            for _, m in _matches(q, tree.root_node):
                if m["name"].text.decode("utf-8", errors="replace") == name:
                    node = m["def"]
                    return (
                        source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"),
                        node.start_point[0] + 1,
                    )
        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        lang = self._get_language()
        tree = self._get_parser().parse(source)
        fn_node = None
        q = Query(lang, "(function_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        q = Query(lang, """
            (call_expression function: [
                (identifier) @called
                (member_expression property: (property_identifier) @called)
            ])
        """)
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        lang = self._get_language()
        tree = self._get_parser().parse(source)
        q = Query(lang, f'((identifier) @name (#eq? @name "{name}"))')
        usages = []
        for _, m in _matches(q, tree.root_node):
            node = m["name"]
            usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        return usages
```

**Step 4: Register in registry.py**

Add to `src/codetree/registry.py`:

```python
from .languages.javascript import JavaScriptPlugin

PLUGINS: dict[str, LanguagePlugin] = {
    ".py":  PythonPlugin(),
    ".js":  JavaScriptPlugin(),
    ".jsx": JavaScriptPlugin(),
}
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_javascript.py -v
```

Expected: 10 PASS

**Step 6: Commit**

```bash
git add src/codetree/languages/javascript.py tests/languages/test_javascript.py src/codetree/registry.py
git commit -m "feat: add JavaScript language plugin"
```

---

## Task 6: TypeScript plugin

**Files:**
- Create: `src/codetree/languages/typescript.py`
- Create: `tests/languages/test_typescript.py`
- Modify: `src/codetree/registry.py`

TypeScript is a superset of JavaScript. The TypeScript plugin reuses the JavaScript plugin's logic but with a different grammar (and separate grammars for `.ts` and `.tsx`).

**Note on tree-sitter-typescript API:**
```python
import tree_sitter_typescript as tsts
tsts.language_typescript()  # for .ts files
tsts.language_tsx()         # for .tsx files
```

**Step 1: Write failing tests**

Create `tests/languages/test_typescript.py`:

```python
import pytest
from codetree.languages.typescript import TypeScriptPlugin

PLUGIN = TypeScriptPlugin()

SAMPLE = b"""\
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  divide(a: number, b: number): number {
    if (b === 0) throw new Error('div by zero');
    return a / b;
  }
}

function helper(): number {
  const calc = new Calculator();
  return calc.add(1, 2);
}

interface Shape {
  area(): number;
}
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names and "divide" in names


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_finds_interface():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["name"] == "Shape" for item in result)


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, _ = result
    assert "function helper" in source


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "class Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_typescript.py -v
```

**Step 3: Implement typescript.py**

TypeScript inherits all JS logic — only the grammar object differs. Interfaces are an extra node type to add to skeleton.

```python
from tree_sitter import Language, Parser, Query
import tree_sitter_typescript as tsts
from .javascript import JavaScriptPlugin, _matches

_TS_LANGUAGE = Language(tsts.language_typescript())
_TS_PARSER = Parser(_TS_LANGUAGE)
_TSX_LANGUAGE = Language(tsts.language_tsx())
_TSX_PARSER = Parser(_TSX_LANGUAGE)


class TypeScriptPlugin(JavaScriptPlugin):
    """TypeScript plugin — inherits JS logic, adds interface support."""
    extensions = (".ts",)
    _lang = _TS_LANGUAGE
    _parser = _TS_PARSER

    def extract_skeleton(self, source: bytes) -> list[dict]:
        # Get JS skeleton (classes, methods, functions)
        results = super().extract_skeleton(source)

        # Add TypeScript interfaces
        lang = self._get_language()
        tree = self._get_parser().parse(source)
        q = Query(lang, "(program (interface_declaration name: (type_identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "interface",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        results.sort(key=lambda x: x["line"])
        return results


class TSXPlugin(TypeScriptPlugin):
    """TSX plugin — same as TypeScript but uses the tsx grammar."""
    extensions = (".tsx",)
    _lang = _TSX_LANGUAGE
    _parser = _TSX_PARSER
```

**Step 4: Register in registry.py**

```python
from .languages.typescript import TypeScriptPlugin, TSXPlugin

PLUGINS: dict[str, LanguagePlugin] = {
    ".py":  PythonPlugin(),
    ".js":  JavaScriptPlugin(),
    ".jsx": JavaScriptPlugin(),
    ".ts":  TypeScriptPlugin(),
    ".tsx": TSXPlugin(),
}
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_typescript.py -v
```

Expected: 9 PASS

**Step 6: Commit**

```bash
git add src/codetree/languages/typescript.py tests/languages/test_typescript.py src/codetree/registry.py
git commit -m "feat: add TypeScript language plugin"
```

---

## Task 7: Go plugin

**Files:**
- Create: `src/codetree/languages/go.py`
- Create: `tests/languages/test_go.py`
- Modify: `src/codetree/registry.py`

**Confirmed node types:**
- Struct: `type_declaration` → `type_spec` → name: `type_identifier`
- Method: `method_declaration` → receiver: `parameter_list` → `parameter_declaration` → type: `type_identifier` (receiver type = class name), name: `field_identifier`, params: `parameter_list`
- Function: `function_declaration` → name: `identifier`, params: `parameter_list`
- Calls: `call_expression` → function: `identifier` OR `selector_expression` field: `field_identifier`

**Step 1: Write failing tests**

Create `tests/languages/test_go.py`:

```python
import pytest
from codetree.languages.go import GoPlugin

PLUGIN = GoPlugin()

SAMPLE = b"""\
package main

type Calculator struct{}

func (c Calculator) Add(a, b int) int {
    return a + b
}

func (c Calculator) Divide(a, b int) int {
    if b == 0 {
        panic("div by zero")
    }
    return a / b
}

func Helper() int {
    calc := Calculator{}
    return calc.Add(1, 2)
}
"""


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Add" in names and "Divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "Add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Helper" in names


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Helper")
    assert result is not None
    source, _ = result
    assert "func Helper" in source


def test_extract_symbol_finds_struct():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "Helper")
    assert "Add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_go.py -v
```

**Step 3: Implement go.py**

```python
from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_go as tsgo
from .base import LanguagePlugin

_LANGUAGE = Language(tsgo.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class GoPlugin(LanguagePlugin):
    extensions = (".go",)

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Structs (Go's equivalent of classes)
        q = Query(_LANGUAGE, """
            (source_file
                (type_declaration
                    (type_spec name: (type_identifier) @name
                               type: (struct_type))) @def)
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "struct",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods (receiver functions)
        # Receiver type may be pointer (*T) or value (T)
        q = Query(_LANGUAGE, """
            (method_declaration
                receiver: (parameter_list
                    (parameter_declaration
                        type: [(type_identifier) @class_name
                               (pointer_type (type_identifier) @class_name)]))
                name: (field_identifier) @method_name
                parameters: (parameter_list) @params) @def
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level functions
        q = Query(_LANGUAGE, """
            (source_file
                (function_declaration
                    name: (identifier) @name
                    parameters: (parameter_list) @params) @def)
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)

        # Functions
        q = Query(_LANGUAGE, "(function_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Struct types
        q = Query(_LANGUAGE, "(type_declaration (type_spec name: (type_identifier) @name)) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        q = Query(_LANGUAGE, "(function_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        q = Query(_LANGUAGE, """
            (call_expression function: [
                (identifier) @called
                (selector_expression field: (field_identifier) @called)
            ])
        """)
        calls = set()
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        q = Query(_LANGUAGE, f'((identifier) @name (#eq? @name "{name}"))')
        usages = []
        for _, m in _matches(q, tree.root_node):
            node = m["name"]
            usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        return usages
```

**Step 4: Register**

```python
from .languages.go import GoPlugin

PLUGINS = {
    ...existing...,
    ".go": GoPlugin(),
}
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_go.py -v
```

Expected: 9 PASS. Fix any failures — Go method receiver queries are the trickiest part; adjust the query if the parent class isn't captured correctly.

**Step 6: Commit**

```bash
git add src/codetree/languages/go.py tests/languages/test_go.py src/codetree/registry.py
git commit -m "feat: add Go language plugin"
```

---

## Task 8: Rust plugin

**Files:**
- Create: `src/codetree/languages/rust.py`
- Create: `tests/languages/test_rust.py`
- Modify: `src/codetree/registry.py`

**Confirmed node types:**
- Struct: `struct_item` → name: `type_identifier`
- Method: inside `impl_item` (type: `type_identifier`) → `declaration_list` → `function_item` → name: `identifier`, params: `parameters`
- Function: `function_item` (top-level, direct child of `source_file`) → name: `identifier`, params: `parameters`
- Calls: `call_expression` → function: `identifier` OR `field_expression` field: `field_identifier`

**Step 1: Write failing tests**

Create `tests/languages/test_rust.py`:

```python
import pytest
from codetree.languages.rust import RustPlugin

PLUGIN = RustPlugin()

SAMPLE = b"""\
struct Calculator;

impl Calculator {
    fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }
    fn divide(&self, a: i32, b: i32) -> i32 {
        if b == 0 { panic!("div by zero"); }
        a / b
    }
}

fn helper() -> i32 {
    let calc = Calculator;
    calc.add(1, 2)
}
"""


def test_skeleton_finds_struct():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names and "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_extract_symbol_finds_function():
    result = PLUGIN.extract_symbol_source(SAMPLE, "helper")
    assert result is not None
    source, _ = result
    assert "fn helper" in source


def test_extract_symbol_finds_struct():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_rust.py -v
```

**Step 3: Implement rust.py**

```python
from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_rust as tsrust
from .base import LanguagePlugin

_LANGUAGE = Language(tsrust.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class RustPlugin(LanguagePlugin):
    extensions = (".rs",)

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Structs
        q = Query(_LANGUAGE, "(source_file (struct_item name: (type_identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "struct",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods inside impl blocks
        q = Query(_LANGUAGE, """
            (impl_item
                type: (type_identifier) @class_name
                body: (declaration_list
                    (function_item
                        name: (identifier) @method_name
                        parameters: (parameters) @params) @method_def))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        # Top-level functions (direct children of source_file)
        q = Query(_LANGUAGE, """
            (source_file
                (function_item
                    name: (identifier) @name
                    parameters: (parameters) @params) @def)
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "function",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)

        # Functions
        q = Query(_LANGUAGE, "(function_item name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Structs
        q = Query(_LANGUAGE, "(struct_item name: (type_identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        q = Query(_LANGUAGE, "(function_item name: (identifier) @name) @def")
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
        q = Query(_LANGUAGE, f'((identifier) @name (#eq? @name "{name}"))')
        usages = []
        for _, m in _matches(q, tree.root_node):
            node = m["name"]
            usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        return usages
```

**Step 4: Register**

```python
from .languages.rust import RustPlugin

PLUGINS = {
    ...existing...,
    ".rs": RustPlugin(),
}
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/languages/test_rust.py -v
```

Expected: 9 PASS

**Step 6: Commit**

```bash
git add src/codetree/languages/rust.py tests/languages/test_rust.py src/codetree/registry.py
git commit -m "feat: add Rust language plugin"
```

---

## Task 9: Java plugin

**Files:**
- Create: `src/codetree/languages/java.py`
- Create: `tests/languages/test_java.py`
- Modify: `src/codetree/registry.py`

**Confirmed node types:**
- Class: `class_declaration` → name: `identifier`
- Method: inside `class_body` → `method_declaration` → name: `identifier`, params: `formal_parameters`
- Top-level functions: Java doesn't have them — all functions are methods. Only classes at top level.
- Calls: `method_invocation` → name: `identifier`; `object_creation_expression` → type: `type_identifier`

**Step 1: Write failing tests**

Create `tests/languages/test_java.py`:

```python
import pytest
from codetree.languages.java import JavaPlugin

PLUGIN = JavaPlugin()

SAMPLE = b"""\
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
    public int divide(int a, int b) {
        if (b == 0) throw new IllegalArgumentException("div by zero");
        return a / b;
    }
}

public class Helper {
    public int run() {
        Calculator calc = new Calculator();
        return calc.add(1, 2);
    }
}
"""


def test_skeleton_finds_classes():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "Calculator" in names
    assert "Helper" in names


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names and "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_extract_symbol_finds_class():
    result = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert result is not None
    source, _ = result
    assert "class Calculator" in source


def test_extract_symbol_finds_method():
    result = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert result is not None
    source, _ = result
    assert "add" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "run")
    assert "add" in calls or "Calculator" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "Calculator")
    assert len(usages) >= 1
```

**Step 2: Run to confirm failure**

```bash
source .venv/bin/activate && pytest tests/languages/test_java.py -v
```

**Step 3: Implement java.py**

```python
from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_java as tsjava
from .base import LanguagePlugin

_LANGUAGE = Language(tsjava.language())
_PARSER = Parser(_LANGUAGE)


def _parse(source: bytes):
    return _PARSER.parse(source)


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class JavaPlugin(LanguagePlugin):
    extensions = (".java", ".kt")

    def extract_skeleton(self, source: bytes) -> list[dict]:
        tree = _parse(source)
        results = []

        # Top-level classes
        q = Query(_LANGUAGE, "(program (class_declaration name: (identifier) @name) @def)")
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "class",
                "name": m["name"].text.decode("utf-8", errors="replace"),
                "line": m["name"].start_point[0] + 1,
                "parent": None,
                "params": "",
            })

        # Methods inside classes
        q = Query(_LANGUAGE, """
            (class_declaration
                name: (identifier) @class_name
                body: (class_body
                    (method_declaration
                        name: (identifier) @method_name
                        parameters: (formal_parameters) @params)))
        """)
        for _, m in _matches(q, tree.root_node):
            results.append({
                "type": "method",
                "name": m["method_name"].text.decode("utf-8", errors="replace"),
                "line": m["method_name"].start_point[0] + 1,
                "parent": m["class_name"].text.decode("utf-8", errors="replace"),
                "params": m["params"].text.decode("utf-8", errors="replace"),
            })

        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        tree = _parse(source)

        # Classes
        q = Query(_LANGUAGE, "(class_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        # Methods
        q = Query(_LANGUAGE, "(method_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == name:
                node = m["def"]
                return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace"), node.start_point[0] + 1

        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        tree = _parse(source)
        fn_node = None
        q = Query(_LANGUAGE, "(method_declaration name: (identifier) @name) @def")
        for _, m in _matches(q, tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node is None:
            return []
        calls = set()
        # Method calls
        q = Query(_LANGUAGE, "(method_invocation name: (identifier) @called)")
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        # Object creation (new Calculator())
        q = Query(_LANGUAGE, "(object_creation_expression type: (type_identifier) @called)")
        for _, m in _matches(q, fn_node):
            calls.add(m["called"].text.decode("utf-8", errors="replace"))
        return sorted(calls)

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        tree = _parse(source)
        q = Query(_LANGUAGE, f'((identifier) @name (#eq? @name "{name}"))')
        usages = []
        for _, m in _matches(q, tree.root_node):
            node = m["name"]
            usages.append({"line": node.start_point[0] + 1, "col": node.start_point[1]})
        return usages
```

**Step 4: Register**

```python
from .languages.java import JavaPlugin

PLUGINS = {
    ...existing...,
    ".java": JavaPlugin(),
    ".kt":   JavaPlugin(),
}
```

**Step 5: Run all language tests**

```bash
source .venv/bin/activate && pytest tests/languages/ -v
```

Expected: all language tests pass

**Step 6: Run full suite**

```bash
source .venv/bin/activate && pytest -v
```

Expected: all tests pass (19 existing + all language tests)

**Step 7: Commit**

```bash
git add src/codetree/languages/java.py tests/languages/test_java.py src/codetree/registry.py
git commit -m "feat: add Java/Kotlin language plugin"
```

---

## Task 10: Developer boilerplate + language nodes cheatsheet

**Files:**
- Create: `src/codetree/languages/_template.py`
- Create: `docs/language-nodes.md`

This task creates the resources that let any developer add a new language in under an hour.

**Step 1: Create _template.py**

```python
# ============================================================
# HOW TO ADD A NEW LANGUAGE TO CODETREE
# ============================================================
#
# CHECKLIST — follow in order:
#
# 1. Install the grammar:
#       pip install tree-sitter-LANG
#    Add to pyproject.toml dependencies:
#       "tree-sitter-LANG>=0.23.0",
#
# 2. Copy this file:
#       cp src/codetree/languages/_template.py src/codetree/languages/LANG.py
#
# 3. Fill in every section marked TODO below
#
# 4. Register in src/codetree/registry.py:
#       from .languages.LANG import LANGPlugin
#       PLUGINS[".ext"] = LANGPlugin()
#
# 5. Copy and adapt tests:
#       cp tests/languages/test_python.py tests/languages/test_LANG.py
#    Replace the SAMPLE source with idiomatic code in your language.
#    Run: pytest tests/languages/test_LANG.py -v
#
# TIP: To see a file's node types, run:
#       python -c "
#       from tree_sitter import Language, Parser
#       import tree_sitter_LANG as tslang
#       L = Language(tslang.language())
#       p = Parser(L)
#       tree = p.parse(open('yourfile.ext','rb').read())
#       def show(n, i=0):
#           print(' '*i + n.type + ((' -> ' + repr(n.text.decode())) if not n.children else ''))
#           [show(c, i+2) for c in n.children]
#       show(tree.root_node)
#       "
#
# See docs/language-nodes.md for a cheatsheet of node types per language.
# ============================================================

from tree_sitter import Language, Parser, Query, QueryCursor

# TODO: replace with your grammar import
# import tree_sitter_LANG as tslang
# _LANGUAGE = Language(tslang.language())
# _PARSER = Parser(_LANGUAGE)

from .base import LanguagePlugin


def _matches(query: Query, node) -> list[tuple[int, dict]]:
    """Standard helper — copy this into your plugin as-is."""
    cursor = QueryCursor(query)
    result = []
    for pattern_idx, match in cursor.matches(node):
        unwrapped = {
            name: nodes[0] if isinstance(nodes, list) and nodes else nodes
            for name, nodes in match.items()
        }
        result.append((pattern_idx, unwrapped))
    return result


class TemplateLangPlugin(LanguagePlugin):
    # TODO: set your file extensions
    extensions = (".ext",)

    def extract_skeleton(self, source: bytes) -> list[dict]:
        """Return top-level symbols.

        Each result dict MUST have: type, name, line, parent, params.
        type values: "class" | "function" | "method" | "struct" | "interface"
        parent: class name for methods, None for top-level symbols
        params: parameter list as string e.g. "(a, b)" or ""

        TODO: write 2-3 tree-sitter queries:
          1. Top-level class/struct declarations
          2. Methods inside classes (capture class name as parent)
          3. Top-level functions

        Example (Python):
            q = Query(_LANGUAGE, "(module (class_definition name: (identifier) @name) @def)")
        """
        # tree = _PARSER.parse(source)
        results = []
        # TODO: add your queries
        results.sort(key=lambda x: x["line"])
        return results

    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        """Return (source_text, start_line) for a named symbol.

        TODO: write queries for function/class node types,
        match against `name`, return the node's text and start line.

        The node's byte range gives you the exact source:
            text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
            line = node.start_point[0] + 1  # convert 0-based to 1-based
        """
        # tree = _PARSER.parse(source)
        return None

    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        """Return sorted list of function/method names called inside fn_name.

        TODO:
          Step 1 — Find the function node by name (same query as extract_symbol_source)
          Step 2 — Query call_expression nodes inside that function node
          Step 3 — Capture called function names (usually (identifier) or method name)

        Example (JavaScript):
            q = Query(_LANGUAGE, '''
                (call_expression function: [
                    (identifier) @called
                    (member_expression property: (property_identifier) @called)
                ])
            ''')
        """
        # tree = _PARSER.parse(source)
        return []

    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        """Return all occurrences of name as an identifier.

        In most languages, identifiers are simply `(identifier)` nodes.
        Use the #eq? predicate to filter by name at the query level (faster
        than Python-level filtering for large files).

        This query works for Python, JavaScript, Go, Rust, Java:
            q = Query(_LANGUAGE, f'((identifier) @name (#eq? @name "{name}"))')

        Each result dict: {"line": int, "col": int}  (both 1-based and 0-based respectively)
        """
        # tree = _PARSER.parse(source)
        return []
```

**Step 2: Create docs/language-nodes.md**

```markdown
# Language Node Type Cheatsheet

Quick reference for tree-sitter node types used in codetree language plugins.
Use this when implementing a new plugin.

## How to discover node types for any file

```python
from tree_sitter import Language, Parser
import tree_sitter_LANG as tslang
L = Language(tslang.language())
p = Parser(L)
tree = p.parse(open("yourfile.ext", "rb").read())
def show(n, i=0):
    print(" "*i + n.type + (" -> " + repr(n.text.decode()) if not n.children else ""))
    [show(c, i+2) for c in n.children]
show(tree.root_node)
```

---

## Python

| Construct | Node type | Name field |
|---|---|---|
| Module root | `module` | — |
| Class | `class_definition` | `name: (identifier)` |
| Method | `function_definition` inside `class_body → block` | `name: (identifier)` |
| Function | `function_definition` inside `module` | `name: (identifier)` |
| Parameters | `parameters` | — |
| Call | `call` | `function: (identifier)` or `function: (attribute attribute: (identifier))` |
| Identifier | `identifier` | `#eq?` predicate |

---

## JavaScript

| Construct | Node type | Name field |
|---|---|---|
| Program root | `program` | — |
| Class | `class_declaration` | `name: (identifier)` |
| Method | `method_definition` inside `class_body` | `name: (property_identifier)` |
| Function | `function_declaration` | `name: (identifier)` |
| Parameters | `formal_parameters` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (member_expression property: (property_identifier))` |
| Identifier | `identifier` | `#eq?` predicate |

---

## TypeScript

Same as JavaScript plus:

| Construct | Node type | Name field |
|---|---|---|
| Interface | `interface_declaration` | `name: (type_identifier)` |
| Type alias | `type_alias_declaration` | `name: (type_identifier)` |
| Grammar API | `tsts.language_typescript()` / `tsts.language_tsx()` | — |

---

## Go

| Construct | Node type | Name field |
|---|---|---|
| Source root | `source_file` | — |
| Struct | `type_declaration → type_spec` | `name: (type_identifier)` |
| Method | `method_declaration` | `name: (field_identifier)`, receiver in `parameter_list` |
| Receiver type | inside `method_declaration → parameter_list → parameter_declaration` | `type: (type_identifier)` or `type: (pointer_type (type_identifier))` |
| Function | `function_declaration` | `name: (identifier)` |
| Parameters | `parameter_list` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (selector_expression field: (field_identifier))` |
| Identifier | `identifier` | `#eq?` predicate |

---

## Rust

| Construct | Node type | Name field |
|---|---|---|
| Source root | `source_file` | — |
| Struct | `struct_item` | `name: (type_identifier)` |
| Enum | `enum_item` | `name: (type_identifier)` |
| Impl block | `impl_item` | `type: (type_identifier)` |
| Method/fn in impl | `function_item` inside `impl_item → declaration_list` | `name: (identifier)` |
| Top-level function | `function_item` inside `source_file` | `name: (identifier)` |
| Parameters | `parameters` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (field_expression field: (field_identifier))` |
| Identifier | `identifier` | `#eq?` predicate |

---

## Java

| Construct | Node type | Name field |
|---|---|---|
| Program root | `program` | — |
| Class | `class_declaration` | `name: (identifier)` |
| Method | `method_declaration` inside `class_body` | `name: (identifier)` |
| Parameters | `formal_parameters` | — |
| Method call | `method_invocation` | `name: (identifier)` |
| Object creation | `object_creation_expression` | `type: (type_identifier)` |
| Identifier | `identifier` | `#eq?` predicate |

---

## Adding a new language

1. Find the grammar: search PyPI for `tree-sitter-LANG`
2. Use the discovery script above to map your file's constructs
3. Copy `src/codetree/languages/_template.py` → fill in the TODOs
4. Register in `registry.py`
5. Write tests in `tests/languages/test_LANG.py`
```

**Step 3: Commit**

```bash
git add src/codetree/languages/_template.py docs/language-nodes.md
git commit -m "docs: add language plugin template and node type cheatsheet"
```

---

## Done

All 6 language plugins implemented + full developer tooling for adding more:

| Language | Plugin | Extensions |
|---|---|---|
| Python | `PythonPlugin` | `.py` |
| JavaScript | `JavaScriptPlugin` | `.js`, `.jsx` |
| TypeScript | `TypeScriptPlugin`, `TSXPlugin` | `.ts`, `.tsx` |
| Go | `GoPlugin` | `.go` |
| Rust | `RustPlugin` | `.rs` |
| Java/Kotlin | `JavaPlugin` | `.java`, `.kt` |

To add any new language: copy `_template.py`, fill in 4 methods, register in `registry.py`.
