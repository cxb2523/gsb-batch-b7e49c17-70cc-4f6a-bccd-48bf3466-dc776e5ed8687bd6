# Phase 5 Implementation Plan: Token Optimization, Symbol Importance, Test Discovery, Variable Listing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 features to codetree that improve agent efficiency and completeness — compressed output modes for token savings, PageRank-based symbol importance, test function discovery, and local variable extraction. Brings the tool count from 13 to 17.

**Architecture:** These features are largely independent. Token optimization adds an alternative formatter in `server.py`. Symbol importance runs PageRank over the existing `_definitions` + `find_references` data. Test discovery uses naming conventions + reference matching over cached skeleton data. Variable listing adds a new plugin method `extract_variables` that queries assignment/declaration nodes inside a function body.

**Tech Stack:** Python 3.10+, tree-sitter 0.25.x, FastMCP 3.1.0, pytest. No new dependencies — PageRank is a simple iterative algorithm (no numpy/networkx needed).

**Key files the implementer MUST read before starting:**
- `src/codetree/indexer.py` — the `Indexer` class, `FileEntry` dataclass, `_definitions` dict, `search_symbols`
- `src/codetree/server.py` — how MCP tools are defined, especially `get_file_skeleton` and `search_symbols`
- `src/codetree/languages/base.py` — the `LanguagePlugin` ABC and existing method patterns
- `src/codetree/languages/python.py` — reference implementation of plugin methods
- `tests/conftest.py` — the `sample_repo`, `rich_py_repo`, and `multi_lang_repo` fixtures

**How to run tests:**
```bash
source .venv/bin/activate
pytest                                    # all tests
pytest tests/test_token_opt.py -v         # one file
pytest tests/test_token_opt.py::test_name # one test
```

**How tools are accessed in tests:**
```python
from codetree.server import create_server
mcp = create_server(str(tmp_path))
fn = mcp.local_provider._components["tool:tool_name@"].fn
result = fn(param="value")
```

---

## Feature 1: Token-efficient output mode

### Why this matters

Skeleton output is currently verbose — each line has full formatting, doc quotes, and arrow separators. For large repos with 200+ symbols, a single `get_file_skeleton` call can produce 500+ tokens. The competitive analysis notes that tree-sitter-analyzer claims **95% token reduction** with their TOON format.

We don't need 95%, but adding a compact mode that cuts tokens by 50-70% makes codetree viable for large codebases where agents operate under tight context budgets.

### Design decisions

**Approach: `format` parameter on existing tools, not a new tool.**

Rationale: Adding separate `get_file_skeleton_compact()` tools doubles the API surface. Instead, add an optional `format` parameter to `get_file_skeleton`, `get_skeletons`, and `search_symbols`. Default is `"full"` (current output), alternative is `"compact"`.

**Compact format rules:**
1. One symbol per line, no blank lines
2. Type abbreviations: `cls` for class, `fn` for function, `mth` for method, `str` for struct, `ifc` for interface, `trt` for trait, `enm` for enum, `typ` for type
3. Drop the arrow (`→`), use colon: `cls Calculator:1` instead of `class Calculator → line 1`
4. Methods indented with `.` prefix instead of `def ... (in Parent)`: `.add(self,a,b):3` instead of `  def add(self, a, b) (in Calculator) → line 3`
5. Params stripped of spaces: `(self,a,b)` not `(self, a, b)`
6. Doc shown inline with `#` separator: `.add(self,a,b):3 # Add two numbers.`
7. No syntax error warning (still available in full mode)

**Example — current full output:**
```
class Calculator → line 1
  "A simple calculator."
  def add(self, a, b) (in Calculator) → line 3
    "Add two numbers."
  def divide(self, a, b) (in Calculator) → line 5
def helper() → line 8
```

**Example — compact output:**
```
cls Calculator:1 # A simple calculator.
.add(self,a,b):3 # Add two numbers.
.divide(self,a,b):5
fn helper():8
```

That's 7 lines → 4 lines, and significantly fewer tokens per line. The compact form is still human-readable and parseable by agents.

**Where the formatter lives:** A helper function `_format_skeleton_item(item, format)` in `server.py`, used by both `get_file_skeleton` and `get_skeletons` and `search_symbols`. This avoids duplicating formatting logic across 3 tools.

### Implementation tasks

This feature spans **Tasks 1-2**.

---

## Feature 2: Symbol importance ranking (PageRank)

### Why this matters

When an agent explores a new codebase, it doesn't know where to start. "What are the most important symbols?" is a question only RepoMapper answers today. By running PageRank on the reference graph, we can rank symbols by how central they are — heavily-referenced classes bubble to the top, leaf helper functions sink to the bottom.

This is how Aider's repo map works, and it's a proven approach for giving agents a high-signal overview of unfamiliar code.

### Design decisions

**Graph construction:** We already have `_definitions` (symbol → definition locations) and `find_references` (symbol → all usage locations). The PageRank graph treats each symbol as a node and each reference as an edge. A symbol that's referenced by many other symbols gets a high rank.

**Algorithm:** Simple iterative PageRank, no external dependencies. 20-30 iterations with damping factor 0.85 converges for typical repos. This is ~50 lines of Python.

**Why not use `_call_graph`?** The call graph only has function→function edges. The reference graph also captures class instantiation, constant usage, type references — a more complete picture of symbol importance.

**Building the adjacency matrix:** For each symbol `S` in `_definitions`:
1. Find all references to `S` via `find_references(S)`
2. For each reference at `(file, line)`, find which function/class definition contains that line (by checking skeleton items for that file)
3. That containing symbol → S is an edge

This means "if function `foo` references class `Bar`, then `foo→Bar` is an edge, and `Bar` gets importance from `foo`."

**Caching:** PageRank computation walks the entire index. For a 500-file repo this takes ~1-2s. We cache the result and invalidate when the index changes (same `_call_graph_built` pattern — a `_pagerank_computed` flag).

**Output:** The tool returns the top-N symbols (default 20) ranked by score, with their file location and type. This gives agents a "map" of the codebase.

**Scope filtering:** Optional `file_path` parameter to rank symbols only within a single file — useful for understanding a specific module.

### Implementation tasks

This feature spans **Tasks 3-4**.

---

## Feature 3: Test discovery

### Why this matters

When an agent modifies a function, it needs to know what tests to run. Currently the agent has to grep for test files or guess. A `find_tests` tool answers "what tests exist for this function?" directly.

CodeRLM and CKB both offer this. It's a high-value feature for test-driven development workflows.

### Design decisions

**Strategy: Convention matching + reference matching.**

Test functions follow naming conventions across all languages:
- Python: `test_<name>`, `Test<Name>`, `<Name>Test`
- JS/TS: `describe('<name>')`, `it('...<name>...')`, `test('<name>')`
- Go: `Test<Name>`
- Java: `@Test` methods in `<Name>Test` classes
- Rust: `#[test]` functions in `mod tests`

But naming conventions alone produce false positives. We combine with **reference matching**: a test function that actually calls or references the target symbol is a stronger match than one that just shares a name prefix.

**Matching tiers:**
1. **Direct reference** (highest confidence): The test function's source contains a reference to the target symbol name (via `extract_symbol_usages`). Example: `test_add` calls `calculator.add()`.
2. **Name convention** (medium confidence): The test function name contains the target name. Example: `test_add_two_numbers` for function `add`.
3. **File convention** (lower confidence): The test file name matches the source file. Example: `test_calculator.py` tests `calculator.py`.

**Return format:** List of `{"file", "name", "line", "confidence", "reason"}` dicts, sorted by confidence descending.

**Where this lives:**
- `Indexer.find_tests(file_path, symbol_name)` — the core logic
- `find_tests` MCP tool in `server.py` — formatting layer

**Test file detection:** A file is considered a test file if:
- Its name starts with `test_` or ends with `_test` (Python, Go)
- Its name ends with `.test.js`, `.test.ts`, `.spec.js`, `.spec.ts` (JS/TS)
- Its name ends with `Test.java` (Java)
- Its path contains `/test/`, `/tests/`, `/spec/`, `/__tests__/`

This is simple heuristic matching on the file path, not language-specific logic. It works across all supported languages without needing per-plugin code.

### Implementation tasks

This feature spans **Tasks 5-6**.

---

## Feature 4: Variable listing in functions

### Why this matters

When an agent reads a function's source, it sees the full code. But when it reads just the skeleton, it loses all information about local state. Knowing that `process()` declares `result: list`, `count: int`, and `total` helps agents understand function behavior without reading the full source.

CodeRLM offers this. It fills the gap between skeleton (too little detail) and full source (too much detail).

### Design decisions

**New plugin method: `extract_variables(source, fn_name) -> list[dict]`**

Each variable dict has:
```python
{
    "name": str,       # variable name
    "line": int,       # 1-based line number
    "type": str,       # type annotation if present, else ""
    "kind": str,       # "local" | "parameter" | "loop_var"
}
```

**What counts as a variable:**
- **Parameters**: Already in the skeleton's `params` field, but including them here gives a complete picture. These have `kind: "parameter"`.
- **Assignments**: `x = ...` in Python, `const x = ...` / `let x = ...` / `var x = ...` in JS/TS, `:=` in Go, `let` in Rust. These have `kind: "local"`.
- **Loop variables**: `for x in ...` in Python, `for (const x of ...)` in JS, `for _, x := range ...` in Go. These have `kind: "loop_var"`.
- **Type annotations**: `x: int = ...` in Python, `x: number` in TS. The `type` field captures this.

**What does NOT count:**
- Attributes/fields (`self.x = ...` in Python, `this.x` in JS) — these are instance state, not local variables
- Global/module-level assignments — these are already in the skeleton as top-level symbols
- Destructuring targets beyond the first level — too complex for diminishing returns

**Deduplication:** If a variable appears on multiple lines (e.g., `count = 0` then `count += 1`), only the first assignment is reported.

**Language-specific tree-sitter node types:**

| Language | Assignment node | Const/Let | Loop var | Type annotation |
|---|---|---|---|---|
| Python | `assignment` → `identifier` | — | `for_statement` → `identifier` | `assignment` with `type` child |
| JS/TS | `variable_declarator` → `identifier` | `lexical_declaration` (const/let), `variable_declaration` (var) | `for_in_statement` → `identifier` | TypeScript: `type_annotation` child |
| Go | `short_var_declaration` → `expression_list` | `var_declaration` | `range_clause` → `expression_list` | Not needed (type inference) |
| Rust | `let_declaration` → `identifier` | — | `for_expression` → `identifier` | `let_declaration` with type child |
| Java | `local_variable_declaration` → `variable_declarator` | — | `enhanced_for_statement` → `identifier` | Type is in `local_variable_declaration` |
| C/C++ | `declaration` → `init_declarator` → `identifier` | — | `for_statement` → `declaration` | Type is in `declaration` |
| Ruby | `assignment` → `identifier` | — | `for` → `identifier` | — (no type annotations) |

**Where this lives:**
- `LanguagePlugin.extract_variables(source, fn_name) -> list[dict]` — abstract method in base, implemented per plugin
- `Indexer.get_variables(file_path, fn_name) -> list[dict] | None` — thin wrapper
- `get_variables` MCP tool in `server.py` — formatting layer

**Why a new abstract method instead of a default in base?** Variable declaration syntax varies dramatically across languages — Python uses `assignment`, JS uses `lexical_declaration` + `variable_declaration`, Go uses `short_var_declaration`, etc. There's no single tree-sitter query that works across languages. Each plugin needs its own query set. Providing a default that returns `[]` (like `compute_complexity`) lets us add language support incrementally — Python and JS first, others later.

### Implementation tasks

This feature spans **Tasks 7-10**.

---

## Task 1: Token-efficient skeleton formatter

**Files:**
- Modify: `src/codetree/server.py`
- Create: `tests/test_token_opt.py`

**Step 1: Write the failing tests**

Create `tests/test_token_opt.py`:

```python
"""Tests for token-efficient output modes."""
import pytest
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Compact skeleton ────────────────────────────────────────────────────────

class TestCompactSkeleton:

    def test_default_is_full(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py")
        # Full mode uses "class ... → line"
        assert "→ line" in result

    def test_compact_class(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        assert "cls Calculator:1" in result

    def test_compact_method(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        # Methods use dot prefix, no "(in Parent)"
        assert ".add(self,a,b):" in result

    def test_compact_function(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="calculator.py", format="compact")
        assert "fn helper():" in result

    def test_compact_strips_param_spaces(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(a, b, c=1): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_file_skeleton")
        result = fn(file_path="app.py", format="compact")
        assert "(a,b,c=1)" in result

    def test_compact_inline_doc(self, tmp_path):
        (tmp_path / "app.py").write_text('def foo():\n    """A helper."""\n    pass\n')
        fn = _tool(create_server(str(tmp_path)), "get_file_skeleton")
        result = fn(file_path="app.py", format="compact")
        assert "# A helper." in result

    def test_compact_fewer_tokens(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        full = fn(file_path="calculator.py")
        compact = fn(file_path="calculator.py", format="compact")
        # Compact should be meaningfully shorter
        assert len(compact) < len(full) * 0.8

    def test_compact_struct(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_file_skeleton")
        result = fn(file_path="server.go", format="compact")
        assert "str Server:" in result

    def test_compact_interface(self, multi_lang_repo):
        fn = _tool(create_server(str(multi_lang_repo)), "get_file_skeleton")
        result = fn(file_path="server.go", format="compact")
        assert "ifc Handler:" in result

    def test_compact_file_not_found(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
        result = fn(file_path="nonexistent.py", format="compact")
        assert "not found" in result.lower() or "empty" in result.lower()


class TestCompactSkeletons:

    def test_batch_compact(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py", "main.py"], format="compact")
        assert "cls Calculator:" in result
        assert "fn run():" in result

    def test_batch_default_is_full(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "get_skeletons")
        result = fn(file_paths=["calculator.py"])
        assert "→ line" in result


class TestCompactSearch:

    def test_search_compact(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "search_symbols")
        result = fn(query="calc", format="compact")
        assert "cls Calculator:" in result
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_token_opt.py -v`
Expected: FAIL — `format` parameter not accepted

**Step 3: Implement the compact formatter**

Add a helper function in `server.py`, before the first `@mcp.tool()` decorator (but inside `create_server`):

```python
# ── Skeleton formatting helpers ──────────────────────────────────────────
_TYPE_ABBREV = {
    "class": "cls", "struct": "str", "interface": "ifc",
    "trait": "trt", "enum": "enm", "type": "typ",
    "function": "fn", "method": "mth",
}

def _format_skeleton(skeleton, fmt="full", has_errors=False):
    """Format skeleton items as a string.

    fmt="full": current verbose format (default, backward-compatible)
    fmt="compact": abbreviated one-liner format for token savings
    """
    if fmt == "compact":
        return _format_skeleton_compact(skeleton)
    return _format_skeleton_full(skeleton, has_errors)

def _format_skeleton_full(skeleton, has_errors=False):
    lines = []
    if has_errors:
        lines.append("WARNING: File has syntax errors — skeleton may be incomplete\n")
    for item in skeleton:
        kind = item["type"]
        if kind in ("class", "struct", "interface", "trait", "enum", "type"):
            lines.append(f"{kind} {item['name']} → line {item['line']}")
        else:
            prefix = "  " if item["parent"] else ""
            parent_info = f" (in {item['parent']})" if item["parent"] else ""
            lines.append(f"{prefix}def {item['name']}{item['params']}{parent_info} → line {item['line']}")
        doc = item.get("doc", "")
        if doc:
            indent = "  " if item.get("parent") else ""
            extra = "  " if kind not in ("class", "struct", "interface", "trait", "enum", "type") else ""
            lines.append(f"{indent}{extra}\"{doc}\"")
    return "\n".join(lines)

def _format_skeleton_compact(skeleton):
    lines = []
    for item in skeleton:
        kind = item["type"]
        abbrev = _TYPE_ABBREV.get(kind, kind[:3])
        name = item["name"]
        line = item["line"]
        doc = item.get("doc", "")
        doc_suffix = f" # {doc}" if doc else ""

        if kind in ("class", "struct", "interface", "trait", "enum", "type"):
            lines.append(f"{abbrev} {name}:{line}{doc_suffix}")
        elif item.get("parent"):
            # Method: dot prefix, strip param spaces
            params = item["params"].replace(", ", ",")
            lines.append(f".{name}{params}:{line}{doc_suffix}")
        else:
            # Top-level function
            params = item["params"].replace(", ", ",")
            lines.append(f"{abbrev} {name}{params}:{line}{doc_suffix}")
    return "\n".join(lines)
```

**Step 4: Update `get_file_skeleton` to accept `format` parameter**

Replace the existing `get_file_skeleton` function with:

```python
@mcp.tool()
def get_file_skeleton(file_path: str, format: str = "full") -> str:
    """Get all classes and function signatures in a source file without their bodies.

    Args:
        file_path: path relative to the repo root (e.g., "src/main.py" or "calculator.py")
        format: "full" (default, verbose) or "compact" (abbreviated, fewer tokens)
    """
    skeleton = indexer.get_skeleton(file_path)
    if not skeleton:
        return f"File not found or empty: {file_path}"

    entry = indexer._index.get(file_path)
    has_errors = entry.has_errors if entry else False
    return _format_skeleton(skeleton, fmt=format, has_errors=has_errors)
```

**Step 5: Update `get_skeletons` to accept `format` parameter**

Replace the existing `get_skeletons` function with:

```python
@mcp.tool()
def get_skeletons(file_paths: list[str], format: str = "full") -> str:
    """Get skeletons for multiple files in one call.

    Args:
        file_paths: list of paths relative to the repo root
        format: "full" (default) or "compact" (abbreviated)
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
        has_errors = entry.has_errors if entry else False
        parts.append(_format_skeleton(skeleton, fmt=format, has_errors=has_errors))
        parts.append("")
    return "\n".join(parts).rstrip()
```

**Step 6: Update `search_symbols` to accept `format` parameter**

Add `format: str = "full"` parameter. In the result formatting section, if `format == "compact"`, use abbreviated format:

```python
@mcp.tool()
def search_symbols(query: str | None = None, type: str | None = None,
                   parent: str | None = None, has_doc: bool | None = None,
                   min_complexity: int | None = None,
                   language: str | None = None,
                   format: str = "full") -> str:
    # ... existing filter logic unchanged ...
    if not results:
        # ... existing no-results logic unchanged ...

    if format == "compact":
        lines = []
        for r in results:
            abbrev = _TYPE_ABBREV.get(r["type"], r["type"][:3])
            doc_suffix = f" # {r['doc']}" if r["doc"] else ""
            if r["parent"]:
                lines.append(f"{r['file']}:.{r['name']}:{r['line']}{doc_suffix}")
            else:
                lines.append(f"{r['file']}:{abbrev} {r['name']}:{r['line']}{doc_suffix}")
        lines.append(f"\n{len(results)} results")
        return "\n".join(lines)

    # ... existing full format logic unchanged ...
```

**Step 7: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_token_opt.py -v`
Expected: All PASS

**Step 8: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass (existing tests use default `format="full"`, so no regressions)

**Step 9: Commit**

```bash
git add src/codetree/server.py tests/test_token_opt.py
git commit -m "feat: add compact output format to skeleton and search tools"
```

---

## Task 2: Compact format for remaining tools (not needed)

The `find_dead_code`, `get_blast_radius`, `detect_clones`, and `get_ast` tools produce structured analysis output that's already fairly compact. No compact format needed for these — they're used for specific queries, not bulk browsing.

This task is intentionally skipped to avoid scope creep. If token optimization for analysis tools is desired later, it can be added as a separate effort.

---

## Task 3: Symbol importance — indexer method (PageRank)

**Files:**
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_importance.py`

### Algorithm explanation

PageRank models the codebase as a graph where each symbol is a node and each reference is a directed edge. A symbol that's referenced by many important symbols gets a high rank. The algorithm iterates:

```
rank[node] = (1 - d) / N + d * sum(rank[referrer] / out_degree[referrer])
```

Where `d = 0.85` (damping factor) and `N` = total symbols. After 20-30 iterations, ranks converge.

We build the graph from skeleton data: for each symbol in `_definitions`, find all references via `find_references`, then determine which other symbol each reference site lives inside (by checking skeleton items for that file — the symbol whose line range contains the reference line is the "referrer").

**Step 1: Write the failing tests**

Create `tests/test_importance.py`:

```python
"""Tests for symbol importance ranking."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── PageRank (indexer) ─────────────────────────────────────────────────────

class TestSymbolImportance:

    def test_heavily_used_ranks_higher(self, tmp_path):
        (tmp_path / "core.py").write_text("def base(): return 1\n")
        (tmp_path / "a.py").write_text("from core import base\ndef a(): return base()\n")
        (tmp_path / "b.py").write_text("from core import base\ndef b(): return base()\n")
        (tmp_path / "c.py").write_text("from core import base\ndef c(): return base()\n")
        (tmp_path / "leaf.py").write_text("def unused(): return 42\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        ranked = indexer.rank_symbols()
        names = [r["name"] for r in ranked]
        # base is referenced by 3 files, should rank higher than unused
        assert names.index("base") < names.index("unused")

    def test_returns_file_and_line(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        ranked = indexer.rank_symbols()
        assert len(ranked) >= 1
        item = ranked[0]
        assert "file" in item
        assert "name" in item
        assert "line" in item
        assert "type" in item
        assert "score" in item

    def test_top_n_parameter(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\ndef bar(): pass\ndef baz(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        ranked = indexer.rank_symbols(top_n=2)
        assert len(ranked) <= 2

    def test_file_scope(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(): pass\n")
        (tmp_path / "b.py").write_text("def bar(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        ranked = indexer.rank_symbols(file_path="a.py")
        files = {r["file"] for r in ranked}
        assert files == {"a.py"}

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        ranked = indexer.rank_symbols()
        assert ranked == []

    def test_class_ranks_high_when_used(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        ranked = indexer.rank_symbols()
        names = [r["name"] for r in ranked]
        # Calculator is used in both files, should be near top
        assert "Calculator" in names[:5]

    def test_scores_sum_roughly_to_one(self, sample_repo):
        indexer = Indexer(str(sample_repo))
        indexer.build()
        ranked = indexer.rank_symbols(top_n=100)
        total = sum(r["score"] for r in ranked)
        # PageRank scores should sum to ~1.0 (within rounding)
        assert 0.5 < total < 1.5
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_importance.py::TestSymbolImportance -v`
Expected: FAIL — `rank_symbols` not found

**Step 3: Implement rank_symbols in indexer.py**

Add to `Indexer` class, after `search_symbols`:

```python
def rank_symbols(self, top_n: int = 20, file_path: str | None = None) -> list[dict]:
    """Rank symbols by importance using PageRank on the reference graph.

    Args:
        top_n: number of top symbols to return (default 20)
        file_path: if given, only rank symbols in this file
    Returns:
        list of {"file", "name", "type", "line", "score"}, sorted by score descending.
    """
    # Collect all symbols as nodes
    nodes: list[tuple[str, str, str, int]] = []  # (file, name, type, line)
    for rel_path, entry in self._index.items():
        for item in entry.skeleton:
            nodes.append((rel_path, item["name"], item["type"], item["line"]))

    if not nodes:
        return []

    # Build symbol → index mapping
    node_keys = [(f, n) for f, n, _, _ in nodes]
    key_to_idx = {k: i for i, k in enumerate(node_keys)}
    n = len(nodes)

    # Build adjacency: for each symbol, find what references it
    # inbound[target_idx] = list of source_idx
    inbound: dict[int, list[int]] = {i: [] for i in range(n)}
    outbound_count: dict[int, int] = {i: 0 for i in range(n)}

    for target_idx, (t_file, t_name, t_type, t_line) in enumerate(nodes):
        refs = self.find_references(t_name)
        for ref in refs:
            # Skip self-references (definition site)
            if ref["file"] == t_file and ref["line"] == t_line:
                continue
            # Find which symbol contains this reference
            ref_file = ref["file"]
            ref_line = ref["line"]
            entry = self._index.get(ref_file)
            if not entry:
                continue
            # Find the enclosing symbol by checking skeleton items
            containing = None
            for item in reversed(entry.skeleton):
                if item["line"] <= ref_line:
                    containing = (ref_file, item["name"])
                    break
            if containing and containing in key_to_idx:
                src_idx = key_to_idx[containing]
                inbound[target_idx].append(src_idx)
                outbound_count[src_idx] = outbound_count.get(src_idx, 0) + 1

    # Run PageRank
    d = 0.85
    rank = [1.0 / n] * n
    for _ in range(25):
        new_rank = [(1.0 - d) / n] * n
        for target_idx in range(n):
            for src_idx in inbound[target_idx]:
                out = outbound_count[src_idx]
                if out > 0:
                    new_rank[target_idx] += d * rank[src_idx] / out
        rank = new_rank

    # Build results
    results = []
    for i, (f, name, typ, line) in enumerate(nodes):
        if file_path and f != file_path:
            continue
        results.append({
            "file": f,
            "name": name,
            "type": typ,
            "line": line,
            "score": round(rank[i], 6),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_n]
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_importance.py::TestSymbolImportance -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_importance.py
git commit -m "feat: add PageRank-based symbol importance ranking to Indexer"
```

---

## Task 4: Symbol importance — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_importance.py`

**Step 1: Write the failing tests**

Append to `tests/test_importance.py`:

```python

# ─── MCP tool: rank_symbols ─────────────────────────────────────────────────

class TestRankSymbolsTool:

    def test_returns_ranked_list(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "rank_symbols")
        result = fn()
        assert "Calculator" in result
        assert "score" in result.lower() or "importance" in result.lower()

    def test_top_n(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "rank_symbols")
        result = fn(top_n=2)
        # Should have at most 2 entries
        lines = [l for l in result.strip().split("\n") if l.strip().startswith(("1.", "2.", "3."))]
        assert len(lines) <= 2

    def test_file_scope(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "rank_symbols")
        result = fn(file_path="calculator.py")
        assert "calculator.py" in result
        assert "main.py" not in result

    def test_empty_repo(self, tmp_path):
        (tmp_path / "empty.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "rank_symbols")
        result = fn()
        assert "no symbols" in result.lower()

    def test_shows_file_and_line(self, sample_repo):
        fn = _tool(create_server(str(sample_repo)), "rank_symbols")
        result = fn()
        assert "line" in result.lower() or ":" in result
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_importance.py::TestRankSymbolsTool -v`
Expected: FAIL — tool "rank_symbols" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after `search_symbols`:

```python
@mcp.tool()
def rank_symbols(top_n: int = 20, file_path: str | None = None) -> str:
    """Rank symbols by importance using reference-based PageRank.

    Returns the most central/important symbols in the codebase — useful for
    understanding unfamiliar code. Heavily-referenced symbols rank highest.

    Args:
        top_n: number of top symbols to return (default 20)
        file_path: optional — if given, only rank symbols in this file
    """
    if file_path and file_path not in indexer._index:
        return f"File not found: {file_path}"
    ranked = indexer.rank_symbols(top_n=top_n, file_path=file_path)
    if not ranked:
        scope = file_path if file_path else "the repo"
        return f"No symbols found in {scope}."
    lines = ["Symbol importance ranking:"]
    for i, r in enumerate(ranked, 1):
        score_pct = f"{r['score'] * 100:.1f}%"
        lines.append(f"  {i}. {r['file']}: {r['type']} {r['name']} → line {r['line']}  (importance: {score_pct})")
    scope = f" in {file_path}" if file_path else ""
    lines.append(f"\nTop {len(ranked)} symbols{scope} by reference-based importance")
    return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_importance.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_importance.py
git commit -m "feat: add rank_symbols MCP tool for PageRank-based importance"
```

---

## Task 5: Test discovery — indexer method

**Files:**
- Modify: `src/codetree/indexer.py`
- Create: `tests/test_discovery.py`

**Step 1: Write the failing tests**

Create `tests/test_discovery.py`:

```python
"""Tests for test discovery."""
import pytest
from codetree.indexer import Indexer
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


# ─── Test discovery (indexer) ────────────────────────────────────────────────

class TestFindTests:

    def test_finds_by_naming_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        names = [t["name"] for t in tests]
        assert "test_add" in names

    def test_finds_by_reference(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("""\
from calc import add

def test_addition():
    assert add(1, 2) == 3
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        names = [t["name"] for t in tests]
        assert "test_addition" in names

    def test_finds_by_file_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("def multiply(a, b): return a * b\n")
        (tmp_path / "test_calc.py").write_text("def test_something_unrelated(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "multiply")
        files = [t["file"] for t in tests]
        assert "test_calc.py" in files

    def test_reference_ranked_higher(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("""\
from calc import add

def test_add_works():
    assert add(1, 2) == 3

def test_other_stuff():
    pass
""")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        # test_add_works has both name match + reference, should rank first
        assert tests[0]["name"] == "test_add_works"

    def test_no_tests_found(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        assert tests == []

    def test_class_test_convention(self, tmp_path):
        (tmp_path / "calc.py").write_text("class Calculator:\n    def add(self, a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("class TestCalculator:\n    def test_add(self): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "Calculator")
        names = [t["name"] for t in tests]
        assert "TestCalculator" in names

    def test_has_confidence_field(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("calc.py", "add")
        assert all("confidence" in t for t in tests)
        assert all("reason" in t for t in tests)

    def test_js_spec_file(self, tmp_path):
        (tmp_path / "utils.js").write_text("function add(a, b) { return a + b; }\n")
        (tmp_path / "utils.spec.js").write_text("function testAdd() { add(1, 2); }\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("utils.js", "add")
        assert len(tests) >= 1

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        indexer = Indexer(str(tmp_path))
        indexer.build()
        tests = indexer.find_tests("nonexistent.py", "foo")
        assert tests == []
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_discovery.py::TestFindTests -v`
Expected: FAIL — `find_tests` not found

**Step 3: Implement find_tests in indexer.py**

Add to `Indexer` class, after `rank_symbols`:

```python
_TEST_FILE_PATTERNS = {
    "test_", "_test.", ".test.", ".spec.", "Test",
}

def _is_test_file(self, rel_path: str) -> bool:
    """Check if a file path looks like a test file."""
    name = Path(rel_path).name
    parts = Path(rel_path).parts
    if any(d in ("test", "tests", "spec", "__tests__") for d in parts):
        return True
    return (name.startswith("test_") or
            "_test." in name or
            ".test." in name or
            ".spec." in name or
            name[0].isupper() and "Test" in name)

def find_tests(self, file_path: str, symbol_name: str) -> list[dict]:
    """Find test functions associated with a symbol.

    Uses three strategies:
    1. Direct reference: test function references the symbol (highest confidence)
    2. Name convention: test function name contains symbol name (medium)
    3. File convention: test file name matches source file (lower)

    Returns:
        list of {"file", "name", "line", "confidence", "reason"}, sorted by confidence.
    """
    if file_path not in self._index:
        return []

    source_stem = Path(file_path).stem  # e.g., "calculator" from "calculator.py"
    name_lower = symbol_name.lower()

    candidates: dict[tuple[str, str], dict] = {}  # (file, name) → best match

    for rel_path, entry in self._index.items():
        if not self._is_test_file(rel_path):
            continue

        for item in entry.skeleton:
            is_test_sym = (item["name"].startswith("test_") or
                           item["name"].startswith("Test") or
                           item["name"].endswith("Test"))
            if not is_test_sym and item["type"] != "class":
                continue

            key = (rel_path, item["name"])
            confidence = 0
            reasons = []

            # Strategy 1: Direct reference — test source references the symbol
            usages = entry.plugin.extract_symbol_usages(entry.source, symbol_name)
            if usages:
                confidence += 3
                reasons.append("references symbol")

            # Strategy 2: Name convention — test name contains symbol name
            if name_lower in item["name"].lower():
                confidence += 2
                reasons.append("name match")

            # Strategy 3: File convention — test file matches source file
            test_stem = Path(rel_path).stem
            if (test_stem == f"test_{source_stem}" or
                    test_stem == f"{source_stem}_test" or
                    test_stem == f"{source_stem}.test" or
                    test_stem == f"{source_stem}.spec"):
                confidence += 1
                reasons.append("file match")

            if confidence > 0:
                if key not in candidates or candidates[key]["confidence"] < confidence:
                    candidates[key] = {
                        "file": rel_path,
                        "name": item["name"],
                        "line": item["line"],
                        "confidence": confidence,
                        "reason": ", ".join(reasons),
                    }

    results = list(candidates.values())
    results.sort(key=lambda x: (-x["confidence"], x["file"], x["line"]))
    return results
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_discovery.py::TestFindTests -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/indexer.py tests/test_discovery.py
git commit -m "feat: add test discovery to Indexer with convention + reference matching"
```

---

## Task 6: Test discovery — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_discovery.py`

**Step 1: Write the failing tests**

Append to `tests/test_discovery.py`:

```python

# ─── MCP tool: find_tests ───────────────────────────────────────────────────

class TestFindTestsTool:

    def test_finds_tests(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("def test_add(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "test_add" in result

    def test_shows_confidence(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        (tmp_path / "test_calc.py").write_text("from calc import add\ndef test_add(): add(1,2)\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "reference" in result.lower() or "name" in result.lower()

    def test_no_tests_message(self, tmp_path):
        (tmp_path / "calc.py").write_text("def add(a, b): return a + b\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="calc.py", symbol_name="add")
        assert "no test" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "find_tests")
        result = fn(file_path="ghost.py", symbol_name="foo")
        assert "not found" in result.lower()
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_discovery.py::TestFindTestsTool -v`
Expected: FAIL — tool "find_tests" not registered

**Step 3: Implement the MCP tool**

Add to `server.py`, after `rank_symbols`:

```python
@mcp.tool()
def find_tests(file_path: str, symbol_name: str) -> str:
    """Find test functions associated with a symbol.

    Searches by naming convention (test_<name>), direct reference,
    and file convention (test_<module>). Results ranked by confidence.

    Args:
        file_path: path relative to the repo root
        symbol_name: name of the function/class to find tests for
    """
    if file_path not in indexer._index:
        return f"File not found: {file_path}"
    tests = indexer.find_tests(file_path, symbol_name)
    if not tests:
        return f"No tests found for '{symbol_name}' in {file_path}."
    lines = [f"Tests for {symbol_name}() in {file_path}:"]
    for t in tests:
        lines.append(f"  {t['file']}: {t['name']}() → line {t['line']}  ({t['reason']})")
    lines.append(f"\nFound {len(tests)} test{'s' if len(tests) != 1 else ''}")
    return "\n".join(lines)
```

**Step 4: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_discovery.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_discovery.py
git commit -m "feat: add find_tests MCP tool for test discovery"
```

---

## Task 7: Variable listing — base plugin method

**Files:**
- Modify: `src/codetree/languages/base.py`
- Modify: `src/codetree/languages/python.py`
- Create: `tests/test_variables.py`

This task adds the `extract_variables` method to the base class (with a default returning `[]`) and implements it for Python first. Other languages follow in Tasks 8-9.

**Step 1: Write the failing tests**

Create `tests/test_variables.py`:

```python
"""Tests for variable listing in functions."""
import pytest
from codetree.indexer import Indexer
from codetree.languages.python import PythonPlugin
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


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
```

**Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_variables.py -v`
Expected: FAIL — `extract_variables` not found

**Step 3: Add default method to base.py**

Add to `LanguagePlugin` class in `base.py`, after `get_ast_sexp`:

```python
def extract_variables(self, source: bytes, fn_name: str) -> list[dict]:
    """Return local variables declared inside a function.

    Each dict has keys:
      - name: str (variable name)
      - line: int (1-based)
      - type: str (type annotation if present, else "")
      - kind: str ("local" | "parameter" | "loop_var")

    Default returns empty list. Override per language.
    """
    return []
```

**Step 4: Implement extract_variables in PythonPlugin**

Add to `PythonPlugin` in `python.py`, after `compute_complexity`:

```python
def extract_variables(self, source: bytes, fn_name: str) -> list[dict]:
    tree = _parse(source)

    # Find the function node
    fn_node = None
    for q_str in [
        "(decorated_definition definition: (function_definition name: (identifier) @name) @def)",
        "(function_definition name: (identifier) @name) @def",
    ]:
        for _, m in _matches(Query(_LANGUAGE, q_str), tree.root_node):
            if m["name"].text.decode("utf-8", errors="replace") == fn_name:
                fn_node = m["def"]
                break
        if fn_node:
            break
    if fn_node is None:
        return []

    results = []
    seen = set()

    def _add(name, line, var_type="", kind="local"):
        if name not in seen and name != "self" and name != "cls":
            seen.add(name)
            results.append({"name": name, "line": line, "type": var_type, "kind": kind})

    # Parameters
    # Find the function_definition node (may be inside decorated_definition)
    actual_fn = fn_node
    if fn_node.type == "decorated_definition":
        for child in fn_node.children:
            if child.type == "function_definition":
                actual_fn = child
                break

    params_node = None
    for child in actual_fn.children:
        if child.type == "parameters":
            params_node = child
            break
    if params_node:
        for child in params_node.children:
            if child.type == "identifier":
                name = child.text.decode("utf-8", errors="replace")
                _add(name, child.start_point[0] + 1, kind="parameter")
            elif child.type in ("default_parameter", "typed_parameter", "typed_default_parameter"):
                for sub in child.children:
                    if sub.type == "identifier":
                        name = sub.text.decode("utf-8", errors="replace")
                        # Check for type annotation
                        var_type = ""
                        for sib in child.children:
                            if sib.type == "type":
                                var_type = sib.text.decode("utf-8", errors="replace")
                                break
                        _add(name, sub.start_point[0] + 1, var_type=var_type, kind="parameter")
                        break
            elif child.type == "list_splat_pattern" or child.type == "dictionary_splat_pattern":
                for sub in child.children:
                    if sub.type == "identifier":
                        _add(sub.text.decode("utf-8", errors="replace"), sub.start_point[0] + 1, kind="parameter")
                        break

    # Local assignments and loop variables — walk the function body
    def walk(node):
        if node.type == "assignment":
            # Check it's not self.x or cls.x (attribute assignment)
            target = node.children[0] if node.children else None
            if target and target.type == "identifier":
                name = target.text.decode("utf-8", errors="replace")
                var_type = ""
                for child in node.children:
                    if child.type == "type":
                        var_type = child.text.decode("utf-8", errors="replace")
                        break
                _add(name, target.start_point[0] + 1, var_type=var_type)
        elif node.type == "for_statement":
            # Loop variable: for X in ...
            for child in node.children:
                if child.type == "identifier":
                    _add(child.text.decode("utf-8", errors="replace"),
                         child.start_point[0] + 1, kind="loop_var")
                    break
        # Recurse into children
        for child in node.children:
            walk(child)

    # Find the block (function body)
    for child in actual_fn.children:
        if child.type == "block":
            walk(child)
            break

    return results
```

**Step 5: Add get_variables to Indexer**

Add to `Indexer` class in `indexer.py`, after `get_ast`:

```python
def get_variables(self, rel_path: str, fn_name: str) -> list[dict] | None:
    """Return local variables in a function.

    Returns None if file not found.
    """
    entry = self._index.get(rel_path)
    if entry is None:
        return None
    return entry.plugin.extract_variables(entry.source, fn_name)
```

**Step 6: Run tests to verify they pass**

Run: `source .venv/bin/activate && pytest tests/test_variables.py -v`
Expected: All PASS

**Step 7: Run full test suite**

Run: `source .venv/bin/activate && pytest`
Expected: All pass

**Step 8: Commit**

```bash
git add src/codetree/languages/base.py src/codetree/languages/python.py src/codetree/indexer.py tests/test_variables.py
git commit -m "feat: add variable extraction (Python + base default)"
```

---

## Task 8: Variable listing — JavaScript/TypeScript implementation

**Files:**
- Modify: `src/codetree/languages/javascript.py`
- Modify: `src/codetree/languages/typescript.py`
- Modify: `tests/test_variables.py`

**Step 1: Write the failing tests**

Append to `tests/test_variables.py`:

```python
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
```

**Step 2: Implement extract_variables in JavaScriptPlugin and TypeScriptPlugin**

The JavaScript implementation queries `lexical_declaration` (const/let), `variable_declaration` (var), and `for_in_statement` (loop vars) inside the function node. TypeScript inherits from JS logic and additionally extracts type annotations from `type_annotation` children.

The implementation pattern is the same as Python: find function node → walk body → collect variable declarations → deduplicate.

**Key JS tree-sitter nodes:**
- `lexical_declaration` → `variable_declarator` → `identifier` (for const/let)
- `variable_declaration` → `variable_declarator` → `identifier` (for var)
- `for_in_statement` → `identifier` (for `for...of` / `for...in` loop vars)
- `formal_parameters` → `identifier` (for parameters)

**Key TS additions:**
- `type_annotation` child of `variable_declarator` or `required_parameter`

**Step 3: Run tests, commit**

Run: `source .venv/bin/activate && pytest tests/test_variables.py -v`
Expected: All PASS

```bash
git add src/codetree/languages/javascript.py src/codetree/languages/typescript.py tests/test_variables.py
git commit -m "feat: add variable extraction for JavaScript and TypeScript"
```

---

## Task 9: Variable listing — Go, Rust, Java implementations

**Files:**
- Modify: `src/codetree/languages/go.py`
- Modify: `src/codetree/languages/rust.py`
- Modify: `src/codetree/languages/java.py`
- Modify: `tests/test_variables.py`

Same pattern as Task 8 but for Go, Rust, and Java. Each uses their language-specific tree-sitter nodes:

**Go:** `short_var_declaration` (`:=`), `var_declaration`, `range_clause` (loop vars)
**Rust:** `let_declaration`, `for_expression` (loop vars)
**Java:** `local_variable_declaration` → `variable_declarator`, `enhanced_for_statement` (loop vars)

C, C++, and Ruby can be added later following the same pattern; the default `extract_variables` returns `[]` for them in the meantime.

```bash
git add src/codetree/languages/go.py src/codetree/languages/rust.py src/codetree/languages/java.py tests/test_variables.py
git commit -m "feat: add variable extraction for Go, Rust, and Java"
```

---

## Task 10: Variable listing — MCP tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_variables.py`

**Step 1: Write the failing tests**

Append to `tests/test_variables.py`:

```python

# ─── MCP tool: get_variables ────────────────────────────────────────────────

class TestGetVariablesTool:

    def test_shows_variables(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo():\n    x = 1\n    y = 'hello'\n    return x + y\n")
        fn = _tool(create_server(str(tmp_path)), "get_variables")
        result = fn(file_path="app.py", function_name="foo")
        assert "x" in result
        assert "y" in result

    def test_shows_types(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo():\n    x: int = 42\n    return x\n")
        fn = _tool(create_server(str(tmp_path)), "get_variables")
        result = fn(file_path="app.py", function_name="foo")
        assert "int" in result

    def test_shows_kinds(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(a):\n    x = 1\n    for i in range(10):\n        pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_variables")
        result = fn(file_path="app.py", function_name="foo")
        assert "parameter" in result.lower() or "param" in result.lower()
        assert "loop" in result.lower()

    def test_file_not_found(self, tmp_path):
        (tmp_path / "x.py").write_text("x = 1\n")
        fn = _tool(create_server(str(tmp_path)), "get_variables")
        result = fn(file_path="ghost.py", function_name="foo")
        assert "not found" in result.lower()

    def test_function_not_found(self, tmp_path):
        (tmp_path / "app.py").write_text("def foo(): pass\n")
        fn = _tool(create_server(str(tmp_path)), "get_variables")
        result = fn(file_path="app.py", function_name="nonexistent")
        assert "no variables" in result.lower() or "not found" in result.lower()
```

**Step 2: Implement the MCP tool**

Add to `server.py`, after `find_tests`:

```python
@mcp.tool()
def get_variables(file_path: str, function_name: str) -> str:
    """Get local variables declared inside a function.

    Shows parameters, local assignments, and loop variables with types when available.

    Args:
        file_path: path relative to the repo root
        function_name: name of the function to inspect
    """
    if file_path not in indexer._index:
        return f"File not found: {file_path}"
    variables = indexer.get_variables(file_path, function_name)
    if variables is None:
        return f"File not found: {file_path}"
    if not variables:
        return f"No variables found in {function_name}() in {file_path}."
    lines = [f"Variables in {function_name}() in {file_path}:"]

    # Group by kind
    by_kind: dict[str, list] = {}
    for v in variables:
        by_kind.setdefault(v["kind"], []).append(v)

    kind_labels = {"parameter": "Parameters", "local": "Local variables", "loop_var": "Loop variables"}
    for kind in ("parameter", "local", "loop_var"):
        items = by_kind.get(kind, [])
        if not items:
            continue
        lines.append(f"\n{kind_labels[kind]}:")
        for v in items:
            type_info = f": {v['type']}" if v["type"] else ""
            lines.append(f"  {v['name']}{type_info} → line {v['line']}")

    return "\n".join(lines)
```

**Step 3: Run tests, commit**

Run: `source .venv/bin/activate && pytest tests/test_variables.py -v`
Expected: All PASS

```bash
git add src/codetree/server.py tests/test_variables.py
git commit -m "feat: add get_variables MCP tool"
```

---

## Task 11: Update CLAUDE.md and template

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/codetree/languages/_template.py`

**Updates to make:**
1. Tool count: 13 → 17
2. Add 4 new tools to the tool table:
   - `get_file_skeleton` updated description: now accepts `format` parameter
   - `rank_symbols(top_n?, file_path?)` — PageRank importance ranking
   - `find_tests(file_path, symbol_name)` — test function discovery
   - `get_variables(file_path, function_name)` — local variable listing
3. Update test count (run `pytest` to get actual number)
4. Add `extract_variables` to the "Each plugin implements" list
5. Update `_template.py` with `extract_variables` stub

```bash
git add CLAUDE.md src/codetree/languages/_template.py
git commit -m "chore: update CLAUDE.md and template for Phase 5 features"
```

---

## Implementation order summary

| Task | Feature | Dependencies | Estimated tests |
|------|---------|-------------|----------------|
| 1 | Compact skeleton formatter | None | 13 |
| 2 | (Skipped — no compact needed for analysis tools) | — | — |
| 3 | Symbol importance — indexer (PageRank) | None | 7 |
| 4 | Symbol importance — MCP tool | Task 3 | 5 |
| 5 | Test discovery — indexer | None | 9 |
| 6 | Test discovery — MCP tool | Task 5 | 4 |
| 7 | Variable listing — base + Python | None | 11 |
| 8 | Variable listing — JS/TS | Task 7 | 6 |
| 9 | Variable listing — Go/Rust/Java | Task 7 | ~9 |
| 10 | Variable listing — MCP tool | Task 7 | 5 |
| 11 | Update docs | All above | 0 |

Tasks 1, 3, 5, and 7 are independent and can be parallelized.
Tasks 8 and 9 can run in parallel after Task 7.
