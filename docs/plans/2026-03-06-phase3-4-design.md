# Phase 3-4 Design: Dead Code, Blast Radius, Clone Detection, Raw AST, Structural Search

Date: 2026-03-06

## Overview

Five features that make codetree a serious code analysis platform:

1. **Dead code detection** — find symbols defined but never referenced elsewhere
2. **Blast radius / impact analysis** — "if I change this function, what breaks?"
3. **Clone detection** — find duplicate/near-duplicate functions (Type 1+2)
4. **Raw AST access** — expose tree-sitter S-expressions to agents
5. **Structural search** — query symbols by type, name pattern, complexity, language

## Shared Infrastructure

### Symbol Definition Index

Pre-built during `Indexer.build()` from skeleton data:

```python
self._definitions: dict[str, list[tuple[str, int]]]
# symbol_name → [(file_path, line), ...]
```

Cheap to build — just reads existing skeleton entries. Enables instant lookup of where any symbol is defined.

### Repo-wide Call Graph (lazy)

Built on first use of dead code or blast radius tools, then cached in memory:

```python
self._call_graph: dict[str, set[str]]      # function → {functions it calls}
self._reverse_graph: dict[str, set[str]]    # function → {functions that call it}
self._call_graph_built: bool = False
```

Built by iterating all files, running `extract_calls_in_function()` for every function/method in each file's skeleton. Invalidated when index is rebuilt.

**Rationale for lazy computation:** Startup stays fast (~1s). The heavy analysis only runs when the agent actually calls a tool that needs it. For a 100-file repo with 500 functions, building the call graph is ~500 calls × ~0.1ms each = ~50ms — fast enough to be imperceptible.

## Feature 1: Dead Code Detection

### New MCP tool

```
find_dead_code(file_path: str | None = None) -> str
```

- If `file_path` given: report dead symbols in that file only
- If omitted: scan entire repo

### Algorithm

1. Collect all definitions from every file's skeleton
2. For each defined symbol, call `find_references(name)` across the repo
3. A symbol is **dead** if:
   - It has zero references outside its own definition site (same file + same line)
   - AND it's not in the exclusion list
4. **Exclusions** (never reported as dead):
   - Entry points: `main`, `__init__`, `__main__`, `__new__`, `__del__`
   - Test symbols: names starting with `test_` or `Test`
   - Public API: symbols in `__init__.py` files
   - Dunder methods: `__str__`, `__repr__`, `__eq__`, etc.
   - Go/Rust/Java `main` functions

### Output format

```
Dead code in calculator.py:
  function unused_helper() → line 15
  method Calculator.old_method() → line 23

Dead code in utils.py:
  class OldParser → line 5

Summary: 3 dead symbols across 2 files
```

### New indexer method

```python
def find_dead_code(self, file_path: str | None = None) -> list[dict]
```

Returns `[{"file": str, "name": str, "type": str, "line": int, "parent": str | None}, ...]`

### Performance

For a 100-file repo with 500 symbols: iterates all files per symbol to check references. Each `extract_symbol_usages` call is a tree-sitter query (~0.1ms), so 500 symbols × 100 files × 0.1ms = ~5 seconds. Acceptable for on-demand analysis.

### Edge cases

- Overloaded names: if `add` exists in two files, it's not dead if referenced anywhere (name-based matching)
- Methods: check `parent.method` patterns in usages, but also standalone name matches
- Dynamically called code: can't detect — this is a fundamental limitation of static analysis

## Feature 2: Blast Radius / Impact Analysis

### New MCP tool

```
get_blast_radius(file_path: str, symbol_name: str) -> str
```

### Algorithm

1. Ensure call graph is built (lazy `_ensure_call_graph()`)
2. **Downstream (what breaks):** BFS through reverse graph from target symbol
   - Level 0: the symbol itself
   - Level 1: direct callers
   - Level 2: callers of callers
   - Continue until no new symbols found
3. **Upstream (what this depends on):** BFS through forward graph
   - What does this function call? What do those call?
4. Use `visited` set for cycle handling

### Output format

```
Blast radius for Calculator.add() in calculator.py:

Direct callers (depth 1):
  calculator.py: helper() → line 10
  main.py: run() → line 4

Indirect callers (depth 2):
  app.py: start() → line 20

Calls (dependencies):
  (none — leaf function)

Impact summary: 3 functions in 3 files may be affected
```

### New indexer methods

```python
def _ensure_call_graph(self)
def get_blast_radius(self, file_path: str, symbol_name: str) -> dict
```

Returns:
```python
{
    "callers": [{"file": str, "name": str, "line": int, "depth": int}, ...],
    "calls": [{"file": str, "name": str, "line": int, "depth": int}, ...],
}
```

### Call graph key format

Functions are keyed as `"file_path::function_name"` in the graph dicts to handle same-named functions in different files.

### Cycle handling

BFS with `visited: set[str]`. If a node is already visited, skip. This correctly handles mutual recursion and self-recursion.

## Feature 3: Clone Detection

### New MCP tool

```
detect_clones(file_path: str | None = None, min_lines: int = 5) -> str
```

- If `file_path` given: find clones of functions in that file (comparing against all repo functions)
- If omitted: find all clone groups across repo

### Algorithm (Type 1+2)

1. **Extract all function bodies:** For each function/method in every file's skeleton, get source via `extract_symbol_source`

2. **Normalize each body:**
   - Walk the tree-sitter AST
   - Replace all identifier/name nodes with `_ID_`
   - Replace all string literal nodes with `_STR_`
   - Replace all number literal nodes with `_NUM_`
   - Keep structural tokens (keywords, operators, punctuation)
   - Collapse whitespace
   - This makes `add(a, b) { return a + b; }` and `sum(x, y) { return x + y; }` hash identically

3. **Hash normalized bodies:** SHA-256 of normalized text

4. **Group by hash:** Functions with identical hashes are clones

5. **Filter:** Skip functions shorter than `min_lines` lines

### New base method

```python
def normalize_source_for_clones(self, source: bytes) -> str
```

Default implementation in `base.py`. Walks tree-sitter AST of the given source bytes, replacing identifiers/strings/numbers with placeholders. Language-agnostic since tree-sitter node types for literals are similar across languages.

Identifier node types to normalize: `identifier`, `type_identifier`, `field_identifier`, `property_identifier`, `shorthand_property_identifier`, `constant`.

String node types: `string`, `string_literal`, `template_string`, `raw_string_literal`, `interpreted_string_literal`.

Number node types: `integer`, `float`, `number`, `integer_literal`, `float_literal`.

### Output format

```
Clone group 1 (3 functions, 12 lines each):
  calculator.py: add() → line 5
  math_utils.py: sum() → line 10
  helpers.py: combine() → line 3

Clone group 2 (2 functions, 8 lines each):
  parser.py: parse_int() → line 20
  validator.py: validate_int() → line 15

Summary: 2 clone groups, 5 functions
```

### New indexer method

```python
def detect_clones(self, file_path: str | None = None, min_lines: int = 5) -> list[dict]
```

Returns:
```python
[
    {
        "hash": str,
        "line_count": int,
        "functions": [{"file": str, "name": str, "line": int}, ...]
    },
    ...
]
```

Only returns groups with 2+ functions (a single function can't be a "clone").

## Feature 4: Raw AST Access

### New MCP tool

```
get_ast(file_path: str, symbol_name: str | None = None, max_depth: int = -1) -> str
```

- If `symbol_name` given: AST of just that symbol's node
- If omitted: AST of the entire file
- `max_depth`: limit tree depth (-1 = unlimited, 0 = root only, 1 = root + children, etc.)

### Implementation

tree-sitter already provides `node.sexp()` for S-expression output. We build a custom walker that:

1. Adds line:col positions to each node
2. Respects `max_depth` limit
3. Shows leaf node text values

### New base method

```python
def get_ast_sexp(self, source: bytes, symbol_name: str | None = None, max_depth: int = -1) -> str
```

Default implementation in `base.py`:
1. Parse source
2. If `symbol_name`, find the node using `extract_symbol_source` pattern
3. Walk tree recursively, building formatted S-expression with positions

### Output format

```
AST for add() in calculator.py:

(function_definition [5:0-7:0]
  name: (identifier [5:4-5:7] "add")
  parameters: (parameters [5:7-5:13]
    (identifier [5:8-5:9] "a")
    (identifier [5:11-5:12] "b"))
  body: (block [6:4-7:0]
    (return_statement [6:4-6:18]
      (binary_operator [6:11-6:18]
        left: (identifier [6:11-6:12] "a")
        operator: "+"
        right: (identifier [6:17-6:18] "b")))))
```

With `max_depth=1`:
```
(function_definition [5:0-7:0]
  name: (identifier ...)
  parameters: (parameters ...)
  body: (block ...))
```

### Why custom walker instead of `node.sexp()`

`node.sexp()` doesn't include line numbers or support depth limiting. The custom walker adds both, making output more useful for agents.

## Feature 5: Structural Search

### New MCP tool

```
search_symbols(
    query: str | None = None,
    type: str | None = None,
    parent: str | None = None,
    has_doc: bool | None = None,
    min_complexity: int | None = None,
    language: str | None = None,
) -> str
```

All parameters optional; combine for filtering. At least one must be provided.

### Algorithm

1. Iterate all files in index
2. If `language` specified, filter files by extension
3. For each file's skeleton entries, apply filters:
   - `query`: case-insensitive substring match on symbol name
   - `type`: exact match on type (function, class, method, struct, etc.)
   - `parent`: case-insensitive substring match on parent name
   - `has_doc`: True = only symbols with non-empty doc, False = only empty doc
   - `min_complexity`: compute complexity on the fly, include only if total >= threshold
4. Return matching symbols with file, line, type, doc info

### Output format

```
Search results (query="calc", type="class"):

  calculator.py: class Calculator → line 1
    "A simple calculator."
  math.py: class CalcEngine → line 5
    "Advanced calculation engine."

Found 2 symbols matching criteria
```

### New indexer method

```python
def search_symbols(self, query=None, type=None, parent=None, has_doc=None, min_complexity=None, language=None) -> list[dict]
```

Returns:
```python
[
    {"file": str, "name": str, "type": str, "line": int, "parent": str | None, "doc": str},
    ...
]
```

### Performance

Scans all skeleton entries — no tree-sitter parsing needed (except for `min_complexity` filter, which triggers `compute_complexity` per matching function). Fast for typical repos.

## Files to modify/create

| File | Changes |
|---|---|
| `indexer.py` | Add `_definitions`, `_call_graph`, `_reverse_graph`, `_ensure_call_graph()`, `find_dead_code()`, `get_blast_radius()`, `detect_clones()`, `search_symbols()` |
| `base.py` | Add `normalize_source_for_clones()`, `get_ast_sexp()` default methods |
| `server.py` | Add 5 new MCP tools |
| `CLAUDE.md` | Update tool count (13), add new tool descriptions |

## Tests to write

| Test file | Coverage |
|---|---|
| `tests/test_dead_code.py` | Dead symbol detection, exclusions, per-file mode, multi-language |
| `tests/test_blast_radius.py` | Direct/indirect callers, cycle handling, leaf functions, cross-file |
| `tests/test_clones.py` | Exact clones, renamed clones, min_lines filter, cross-language |
| `tests/test_ast.py` | Full file AST, symbol AST, max_depth, missing symbol |
| `tests/test_search.py` | Name query, type filter, parent filter, doc filter, complexity filter, language filter, combined filters |

## Implementation order

```
1. Shared infrastructure (definition index + lazy call graph)
2. Dead code detection (uses definition index + find_references)
3. Blast radius (uses call graph)
4. Clone detection (independent — normalize + hash)
5. Raw AST access (independent — tree walker)
6. Structural search (independent — skeleton queries)
7. Update CLAUDE.md and memory
```

Features 4, 5, 6 are independent and could be parallelized. Features 2 and 3 depend on the shared infrastructure from step 1.
