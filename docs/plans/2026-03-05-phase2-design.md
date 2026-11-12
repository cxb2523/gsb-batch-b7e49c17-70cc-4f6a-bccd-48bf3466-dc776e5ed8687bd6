# Phase 2 Design: Batch Operations, Complexity Metrics, More Languages

Date: 2026-03-05

## Overview

Three features that make codetree significantly more useful for agents and expand language coverage:

1. **Batch operations** — reduce round-trips for multi-file exploration
2. **Complexity metrics** — help agents gauge function complexity without reading source
3. **More languages** — C, C++, Ruby (adds 3 languages to the current 7)

## Feature 1: Batch Operations

### New tools

**`get_skeletons(file_paths: list[str])`** — returns skeletons for multiple files in one call.

Output format:
```
=== calc.py ===
class Calculator → line 1
  def add(self, a, b) (in Calculator) → line 2

=== utils.py ===
def helper() → line 1
```

**`get_symbols(symbols: list[dict])`** — takes `[{"file_path": "...", "symbol_name": "..."}, ...]`.

Output format:
```
# calc.py:1
class Calculator:
    def add(self, a, b):
        return a + b

# utils.py:5
def helper():
    return 42
```

### Implementation

Both are thin wrappers around existing `indexer.get_skeleton()` and `indexer.get_symbol()`. Each item in the batch is processed independently — a missing file/symbol gets an inline error (`File not found: x.py`) without failing the whole batch.

The `symbols` parameter for `get_symbols` uses a JSON list of `{file_path, symbol_name}` dicts. FastMCP handles the JSON parsing.

### Edge cases

- Empty list → return helpful message ("No files/symbols requested")
- All files missing → return all error messages, no crash
- Mixed found/not-found → inline errors alongside successful results

## Feature 2: Complexity Metrics

### New plugin method

```python
def compute_complexity(self, source: bytes, fn_name: str) -> dict | None:
    """Return complexity breakdown for a function.

    Returns None if function not found.
    Returns dict with keys:
      - total: int (cyclomatic complexity)
      - breakdown: dict[str, int] (node_type → count)
    """
```

Not abstract — provide a default implementation in `base.py` that returns None. Each language plugin overrides with its specific branching node types.

### Branching nodes per language

| Language | Branch nodes |
|---|---|
| Python | `if_statement`, `elif_clause`, `for_statement`, `while_statement`, `except_clause`, `with_statement`, `boolean_operator` (and/or) |
| JS/TS | `if_statement`, `for_statement`, `for_in_statement`, `while_statement`, `do_statement`, `switch_case`, `catch_clause`, `ternary_expression`, `binary_expression` (&&/\|\|) |
| Go | `if_statement`, `for_statement`, `select_statement`, `communication_case`, `default_case`, `expression_case` |
| Rust | `if_expression`, `for_expression`, `while_expression`, `match_arm`, `try_expression` |
| Java | `if_statement`, `for_statement`, `enhanced_for_statement`, `while_statement`, `do_statement`, `catch_clause`, `switch_block_statement_group`, `ternary_expression`, `binary_expression` (&&/\|\|) |

### Algorithm

1. Find the function node (reuse the same pattern as `extract_calls_in_function` — find function by name)
2. Walk all descendant nodes recursively
3. Count nodes whose type is in the branching set
4. Base complexity = 1
5. Total = 1 + branch count

### New MCP tool

```
get_complexity(file_path: str, function_name: str) -> str
```

Output format:
```
Complexity of calculate() in calc.py: 5
  if: 2, for: 1, except: 1, or: 1
```

Or: `Function 'foo' not found in bar.py`

## Feature 3: More Languages

### C (`languages/c.py`)

| Extension | `.c`, `.h` |
|---|---|
| Grammar | `tree-sitter-c` |
| Skeleton types | `function` (function_definition), `struct` (struct_specifier in type_definition) |
| Key nodes | `function_definition`, `struct_specifier`, `declaration`, `call_expression`, `preproc_include` |
| Import query | `preproc_include` for `#include` statements |
| Doc comments | `comment` starting with `/**` or `///` as prev_named_sibling |

C has no classes or methods — only top-level functions and structs. `#include` is handled via `preproc_include` nodes. Parameters come from `parameter_list` inside `function_definition`.

### C++ (`languages/cpp.py`)

| Extension | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` |
|---|---|
| Grammar | `tree-sitter-cpp` |
| Inherits from | CPlugin (like TS inherits from JS) |
| Additional skeleton types | `class` (class_specifier), `method` (function_definition inside class), `namespace` |
| Key additions | `class_specifier`, `namespace_definition`, `template_declaration`, `using_declaration` |

C++ inherits all C functionality and adds classes, namespaces, and templates. The C++ grammar is a superset of C.

### Ruby (`languages/ruby.py`)

| Extension | `.rb` |
|---|---|
| Grammar | `tree-sitter-ruby` |
| Skeleton types | `class`, `method`, `function` (module-level `def`) |
| Key nodes | `class`, `module`, `method`, `singleton_method` (def self.foo), `call` |
| Import query | `call` nodes where method is `require` or `require_relative` |
| Doc comments | `comment` starting with `#` as prev_named_sibling |

Ruby has modules (treated like classes for skeleton purposes), singleton methods (`def self.foo`), and uses `require`/`require_relative` for imports. The `call` node for `require` is different from other languages' dedicated import nodes — need to match on method name.

## Files to modify/create

| File | Changes |
|---|---|
| `server.py` | Add `get_skeletons`, `get_symbols`, `get_complexity` tools |
| `base.py` | Add `compute_complexity` default method |
| All 6 existing plugins | Implement `compute_complexity` |
| `languages/c.py` | New — CPlugin |
| `languages/cpp.py` | New — CppPlugin (inherits CPlugin) |
| `languages/ruby.py` | New — RubyPlugin |
| `registry.py` | Register C, C++, Ruby |
| `_template.py` | Add `compute_complexity` stub |
| `pyproject.toml` | Add tree-sitter-c, tree-sitter-cpp, tree-sitter-ruby deps |

## Tests to write

| Test file | Coverage |
|---|---|
| `tests/test_batch.py` | get_skeletons, get_symbols — normal, empty, mixed found/not-found |
| `tests/test_complexity.py` | Per-language complexity, edge cases (empty fn, deeply nested) |
| `tests/languages/test_c.py` | C skeleton, symbol, calls, usages, imports |
| `tests/languages/test_cpp.py` | C++ classes, methods, namespaces, inheritance from C |
| `tests/languages/test_ruby.py` | Ruby classes, modules, methods, singleton methods, require |
