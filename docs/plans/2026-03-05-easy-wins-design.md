# Easy Wins Design: Imports, Docstrings, Syntax Errors

Date: 2026-03-05

## Overview

Add 3 features to codetree that most competitors have and that are foundational for future work (dead code detection, impact analysis):

1. **Import/dependency extraction** — new tool + plugin method
2. **Docstring extraction** — new field in skeleton + improved symbol source
3. **Syntax error reporting** — warning flag in skeleton output

## Feature 1: Import Extraction

### Plugin method

Add to `LanguagePlugin` ABC:

```python
@abstractmethod
def extract_imports(self, source: bytes) -> list[dict]:
    """Return import/use statements.
    Each dict has keys: line (int, 1-based), text (str — raw import text)
    """
```

### Tree-sitter queries per language

| Language | Node types | Query |
|---|---|---|
| Python | `import_statement`, `import_from_statement` | `(module [(import_statement) (import_from_statement)] @imp)` |
| JS/TS | `import_statement` | `(program (import_statement) @imp)` |
| Go | `import_declaration` | `(source_file (import_declaration) @imp)` |
| Rust | `use_declaration` | `(source_file (use_declaration) @imp)` |
| Java | `import_declaration` | `(program (import_declaration) @imp)` |

### MCP tool

New tool `get_imports(file_path: str) -> str` in server.py:

```
Imports in calc.py:
  1: import os
  2: from pathlib import Path
  3: from typing import Optional
```

Returns "No imports found in {file_path}" or "File not found: {file_path}" for edge cases.

### Indexer

No indexer changes needed. The tool calls `plugin.extract_imports(source)` directly through the FileEntry, same pattern as other tools.

## Feature 2: Docstring Extraction

### Two changes

**A) Skeleton doc field:** Add `doc` key to skeleton items. Value is the first line of the doc comment, stripped of comment markers, or `""` if no doc.

**B) Symbol source with doc comments:** For Go/Rust/Java, `extract_symbol_source` currently returns only the definition node. Enhance it to include the preceding doc comment when present.

### Doc comment extraction per language

| Language | How to find doc | Node relationship |
|---|---|---|
| Python | First `expression_statement` in function/class body that is a string literal | Child of body block |
| JS/TS | `comment` starting with `/**` immediately before definition | Previous sibling |
| Go | `comment` node(s) immediately before declaration (no blank lines between) | Previous sibling(s) |
| Rust | `line_comment` starting with `///` immediately before item | Previous sibling(s) |
| Java | `block_comment` starting with `/**` immediately before declaration | Previous sibling |

### Plugin method

Add to `LanguagePlugin` ABC:

```python
def extract_doc_comment(self, node) -> str:
    """Extract the first line of a doc comment for a definition node.
    Returns empty string if no doc comment found.
    Not abstract — default implementation checks previous sibling for comment nodes.
    """
```

This is a helper called during `extract_skeleton` to populate the `doc` field. It's not abstract because the sibling-comment pattern works for most languages (JS, TS, Go, Rust, Java). Python overrides it to look inside the function body.

### Skeleton output change

```
class Calculator → line 5
  """A simple calculator."""
  def add(self, a, b) (in Calculator) → line 7
    """Add two numbers."""
  def divide(self, a, b) (in Calculator) → line 10
```

Doc lines are indented to match their symbol and only shown when non-empty.

### Cache impact

The `doc` field is added to skeleton dicts. Existing cache entries won't have it — they'll just show `""` until re-indexed. No migration needed.

## Feature 3: Syntax Error Reporting

### Implementation

Add `has_errors: bool` to the return data from `extract_skeleton`. Two options:

**Option A:** Change `extract_skeleton` return type to `tuple[list[dict], bool]`.
**Option B:** Store the flag on the FileEntry and check in server.py.

Go with **Option B** — less invasive, doesn't change the plugin interface.

In `indexer.py`, after parsing during `build()`:
```python
tree = plugin._parse(source)  # Not available — need different approach
```

Actually, simpler: add `has_errors` field to skeleton dicts as metadata, or just check in `extract_skeleton` and store it on the result list as an attribute. Simplest: add a new plugin method.

```python
def check_syntax(self, source: bytes) -> bool:
    """Return True if the file has syntax errors."""
```

Each plugin implements this as `_PARSER.parse(source).root_node.has_error`.

### Server output

Prepend warning line to `get_file_skeleton` output:

```
⚠ File has syntax errors — skeleton may be incomplete
def foo(self, a, b) → line 1
def bar() → line 5
```

### FileEntry change

Add `has_errors: bool` field to `FileEntry` dataclass. Populated during `build()`.

## Files to modify

| File | Changes |
|---|---|
| `languages/base.py` | Add `extract_imports` abstract method, `extract_doc_comment` default method, `check_syntax` method |
| `languages/python.py` | Implement `extract_imports`, override `extract_doc_comment` (body-based), `check_syntax`, add `doc` to skeleton |
| `languages/javascript.py` | Implement `extract_imports`, `check_syntax`, add `doc` to skeleton |
| `languages/typescript.py` | Inherit JS import logic, may need override for TS-specific import syntax |
| `languages/go.py` | Implement `extract_imports`, `check_syntax`, add `doc` to skeleton |
| `languages/rust.py` | Implement `extract_imports`, `check_syntax`, add `doc` to skeleton |
| `languages/java.py` | Implement `extract_imports`, `check_syntax`, add `doc` to skeleton |
| `languages/_template.py` | Add `extract_imports` stub |
| `indexer.py` | Add `has_errors` to FileEntry, populate during build |
| `server.py` | Add `get_imports` tool, add syntax warning to `get_file_skeleton`, add `doc` lines to skeleton output |
| `cache.py` | No changes (doc field auto-cached in skeleton dicts) |

## Tests to write

| Test file | Coverage |
|---|---|
| `tests/test_imports.py` | Per-language import extraction, edge cases (no imports, mixed imports) |
| `tests/test_docstrings.py` | Per-language docstring extraction, missing docs, multi-line docs |
| `tests/test_syntax_errors.py` | Syntax error detection per language, clean files, partial errors |
| `tests/test_server_new_tools.py` | MCP tool `get_imports` output format, skeleton doc display, syntax warnings |
