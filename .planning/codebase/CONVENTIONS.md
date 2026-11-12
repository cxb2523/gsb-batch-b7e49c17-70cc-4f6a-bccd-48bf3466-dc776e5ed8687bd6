# Coding Conventions

**Analysis Date:** 2026-04-03

## Naming Patterns

**Files:**
- Modules use lowercase with underscores: `indexer.py`, `registry.py`, `cache.py`
- Plugin modules follow pattern: `{language}.py` (e.g., `python.py`, `javascript.py`, `base.py`)
- Test files follow pattern: `test_{module}.py` (e.g., `test_indexer.py`, `test_server.py`)
- Template file for new code: `_template.py` as boilerplate

**Functions:**
- Lowercase with underscores: `get_plugin()`, `extract_skeleton()`, `extract_symbol_source()`
- Private/internal functions prefixed with underscore: `_matches()`, `_clean_doc()`, `_should_skip()`
- Boolean predicates start with `is_` or `check_`: `check_syntax()`, `is_valid()`
- Getter functions use `get_` prefix: `get_skeleton()`, `get_symbol()`, `get_imports()`
- Setter functions use `set_` prefix: `set()` for simple assignment
- Extraction functions use `extract_` prefix: `extract_skeleton()`, `extract_calls_in_function()`
- MCP tool functions decorated with `@mcp.tool()` use clear action verbs: `get_file_skeleton()`, `find_references()`

**Variables:**
- Lowercase with underscores: `file_entry`, `rel_path`, `source`, `skeleton`
- Class instances: `indexer`, `plugin`, `cache`, `store`
- Dictionaries/collections singular or plural as appropriate: `results`, `definitions`, `call_graph`
- Constants: UPPERCASE with underscores: `SKIP_DIRS`, `_EXCLUDED_NAMES`
- Module-level parser/language globals: `_PARSER`, `_LANGUAGE`
- Private instance variables: `_index`, `_definitions`, `_call_graph`, `_root`
- Loop counters use full names not `i`: `for rel_path, entry in ...` or `for item in skeleton:`

**Types:**
- Classes use PascalCase: `LanguagePlugin`, `FileEntry`, `Calculator`
- Plugin classes follow pattern: `{Language}Plugin` (e.g., `PythonPlugin`, `JavaScriptPlugin`, `GoPlugin`)
- Abstract base class: `LanguagePlugin` (ABC)
- Dataclass fields documented inline with type hints and brief purpose
- Type unions use modern syntax: `str | Path` not `Union[str, Path]`

## Code Style

**Formatting:**
- No automatic linter or formatter configured (`.eslintrc`, `.prettierrc`, `biome.json` not present)
- Implicit convention: 4-space indentation (Python standard)
- Line length: no strict limit enforced, but code is reasonably sized
- Imports grouped: standard library, third-party, local
- Blank lines: 2 between top-level definitions, 1 between methods

**Linting:**
- No linting tool configured in `pyproject.toml`
- Code quality maintained through convention and testing
- Type hints are used throughout: `extract_skeleton(source: bytes) -> list[dict]`

## Import Organization

**Order:**
1. Standard library: `import json`, `from pathlib import Path`, `from abc import ABC, abstractmethod`
2. Third-party: `from tree_sitter import Query, QueryCursor`, `from fastmcp import FastMCP`
3. Local/relative: `from .indexer import Indexer`, `from .languages.base import LanguagePlugin`

**Path Aliases:**
- No path aliases configured (no `jsconfig.json`, `tsconfig.json` paths)
- Relative imports used throughout: `from .indexer import ...`, `from ..graph.store import ...`
- All paths are relative to package root: `src/codetree/`

## Error Handling

**Patterns:**
- Graceful degradation: functions return `None` or empty list on error, not exceptions
- `extract_symbol_source(source, name) -> tuple[str, int] | None` returns None if symbol not found
- `get_plugin(path) -> LanguagePlugin | None` returns None for unsupported extensions
- `Cache.load()` catches `json.JSONDecodeError` and `OSError`, silently returns empty dict
- Skeleton parsing catches no exceptions — invalid syntax captured via `plugin.check_syntax()` flag
- String methods use `.decode("utf-8", errors="replace")` for safe UTF-8 handling across all languages
- File not found cases return user-friendly strings: `f"File not found: {file_path}"`, `f"Symbol '{symbol_name}' not found in {file_path}"`

**Validation:**
- `_should_skip(path: Path) -> bool` checks directory names against `SKIP_DIRS` set
- `is_valid(rel_path, current_mtime) -> bool` verifies cache freshness by mtime matching
- Skeleton results deduplicated by `(name, line)` before returning
- All paths validated as relative using pattern matching: no absolute paths in results

## Logging

**Framework:** No logging library configured; uses print to stdout for debug info

**Patterns:**
- Print-based debugging in utility functions
- No structured logging
- Docstrings used for user-facing documentation of tool behavior

## Comments

**When to Comment:**
- Class docstrings describe purpose and key responsibilities
- Method docstrings describe what it does, args, return value, and any side effects
- Inline comments rare — code is self-documenting via clear naming
- Section separators used in large files: `# ── Section Name ──────────────────────────`

**JSDoc/TSDoc:**
- Not used (Python codebase)
- Docstrings use triple quotes: `"""description."""`
- Parameter and return documentation in docstring body

**Example from `base.py`:**
```python
def extract_skeleton(self, source: bytes) -> list[dict]:
    """Return top-level symbols in the file.

    Each dict must have keys:
      - type: "class" | "function" | "method" | ...
      - name: str
      - line: int (1-based)
      - parent: str | None  (class name for methods, None for top-level)
      - params: str  (parameter list as string, e.g. "(a, b)" or "")
    """
```

## Function Design

**Size:**
- Functions are small and focused: 10-50 lines typical
- Extract helpers for complex operations: `_matches()`, `_fill_docs_from_siblings()`, `_clean_doc()`
- Core extraction methods in plugins are 50-150 lines (complex query logic)
- Main orchestration methods: `build()`, `create_server()` in 30-60 lines

**Parameters:**
- Positional parameters for required inputs: `extract_skeleton(source: bytes)`
- Keyword arguments with defaults for optional behavior: `format: str = "full"`
- Path parameters as `str | Path` for flexibility, converted to `Path` internally
- Multiple related params grouped: `extract_calls_in_function(source, fn_name)` not spread across calls

**Return Values:**
- Return meaningful types: `list[dict]`, `tuple[str, int] | None`, `dict[str, Any]`
- Return early on error/not-found: `if entry is None: return None`
- Return collections always (not None): `extract_calls_in_function() -> list[str]` (empty list if none)
- Tuples for related values: `extract_symbol_source() -> tuple[str, int] | None` (source + line)

**Example from `indexer.py`:**
```python
def get_symbol(self, rel_path: str, symbol_name: str) -> tuple[str, int] | None:
    entry = self._index.get(rel_path)
    if entry is None:
        return None
    return entry.plugin.extract_symbol_source(entry.source, symbol_name)
```

## Module Design

**Exports:**
- No explicit `__all__` lists; modules export all public (non-`_`) names
- Plugin classes instantiated at module level: `PythonPlugin()`, shared via registry
- Plugin registry: `PLUGINS: dict[str, LanguagePlugin]` in `registry.py`

**Barrel Files:**
- No barrel/index files (`__init__.py` is minimal)
- `src/codetree/__init__.py` is empty
- Language plugins imported individually: `from .languages.python import PythonPlugin`

**Module Responsibilities:**
- `indexer.py` — file discovery, parsing, skeleton building, cross-file analysis
- `languages/*.py` — language-specific AST parsing and extraction
- `server.py` — MCP tool registration and output formatting
- `cache.py` — skeleton caching with mtime invalidation
- `registry.py` — extension → plugin mapping
- `graph/*.py` — persistent graph building, queries, analysis

---

*Convention analysis: 2026-04-03*
