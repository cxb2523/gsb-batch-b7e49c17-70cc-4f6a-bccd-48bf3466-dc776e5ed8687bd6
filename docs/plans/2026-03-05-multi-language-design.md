# codetree v2 — Multi-Language Support Design

**Date:** 2026-03-05
**Status:** Approved

## Goal

Extend codetree from Python-only to supporting Python, JavaScript/TypeScript, Go, Rust, and Java/Kotlin — with a clean plugin architecture that makes adding new languages straightforward for any developer or agent.

## Languages

| Language | Extensions | Grammar package |
|---|---|---|
| Python | `.py` | `tree-sitter-python` (already installed) |
| JavaScript | `.js`, `.jsx` | `tree-sitter-javascript` |
| TypeScript | `.ts`, `.tsx` | `tree-sitter-typescript` |
| Go | `.go` | `tree-sitter-go` |
| Rust | `.rs` | `tree-sitter-rust` |
| Java/Kotlin | `.java`, `.kt` | `tree-sitter-java`, `tree-sitter-kotlin` |

## Architecture: Language Plugin

### New file structure

```
src/codetree/
├── languages/
│   ├── __init__.py
│   ├── base.py           ← LanguagePlugin abstract base class
│   ├── _template.py      ← copy-paste boilerplate for new languages
│   ├── python.py         ← Python plugin (from current queries.py)
│   ├── javascript.py     ← JS + JSX
│   ├── typescript.py     ← TS + TSX (extends JavaScriptPlugin)
│   ├── go.py
│   ├── rust.py
│   └── java.py           ← Java + Kotlin
├── registry.py           ← maps extensions → plugin instances
├── queries.py            ← thin router, delegates to registry
├── indexer.py            ← updated: language-aware FileEntry + routing
├── cache.py              ← UNCHANGED
└── server.py             ← UNCHANGED
```

### LanguagePlugin contract (`base.py`)

Every language plugin implements this interface:

```python
class LanguagePlugin(ABC):
    extensions: tuple[str, ...]

    @abstractmethod
    def extract_skeleton(self, source: bytes) -> list[dict]:
        """Top-level symbols: classes, functions, methods.
        Each dict: {type, name, line, parent, params}
        """

    @abstractmethod
    def extract_symbol_source(self, source: bytes, name: str) -> tuple[str, int] | None:
        """(source_text, start_line) for a named function/class. None if not found."""

    @abstractmethod
    def extract_calls_in_function(self, source: bytes, fn_name: str) -> list[str]:
        """Names of all functions/methods called inside fn_name."""

    @abstractmethod
    def extract_symbol_usages(self, source: bytes, name: str) -> list[dict]:
        """All occurrences of name. Each dict: {line, col}"""
```

### Registry (`registry.py`)

Single source of truth for extension → plugin mapping:

```python
PLUGINS: dict[str, LanguagePlugin] = {
    ".py":   PythonPlugin(),
    ".js":   JavaScriptPlugin(),
    ".jsx":  JavaScriptPlugin(),
    ".ts":   TypeScriptPlugin(),
    ".tsx":  TypeScriptPlugin(),
    ".go":   GoPlugin(),
    ".rs":   RustPlugin(),
    ".java": JavaPlugin(),
    ".kt":   JavaPlugin(),
}

def get_plugin(path: Path) -> LanguagePlugin | None:
    return PLUGINS.get(path.suffix)
```

### Indexer changes

- `FileEntry` gains a `language: str` field
- `build()` uses `get_plugin(path)` instead of `rglob("*.py")` — indexes all supported extensions, skips unsupported ones
- All query calls pass the plugin stored in the `FileEntry`

### queries.py becomes a thin router

```python
def extract_skeleton(source, plugin): return plugin.extract_skeleton(source)
def extract_symbol_source(source, name, plugin): return plugin.extract_symbol_source(source, name)
def extract_calls_in_function(source, fn_name, plugin): return plugin.extract_calls_in_function(source, fn_name)
def extract_symbol_usages(source, name, plugin): return plugin.extract_symbol_usages(source, name)
```

### server.py and cache.py

**Completely unchanged.** They never know about languages. This is the value of the plugin boundary.

## Developer Boilerplate (`_template.py`)

The `_template.py` file is what any developer copies to add a new language. It contains:

1. **Step-by-step checklist** at the top — install grammar, copy file, fill in TODOs, register in registry, add to pyproject.toml, write tests
2. **Inline comments** explaining what each query must capture
3. **Real examples** from a nearby language (Go examples shown for unfamiliar syntax)
4. **Link to `docs/language-nodes.md`** — a cheatsheet of node type names per language

The goal: a developer should be able to add a new language in under an hour with zero prior tree-sitter knowledge.

## Testing strategy

- `tests/languages/` directory with one test file per language
- Each test file uses an inline source string (no files needed) and asserts all 4 functions
- `tests/languages/test_python.py` is the reference — all other language tests follow the same structure
- A shared `tests/languages/conftest.py` provides common assertion helpers

## How to add a new language (summary for docs)

1. `pip install tree-sitter-LANG`
2. Copy `src/codetree/languages/_template.py` → `src/codetree/languages/LANG.py`
3. Fill in the 4 query strings and `extensions` tuple
4. Add to `registry.py`: `".ext": LANGPlugin()`
5. Add to `pyproject.toml` dependencies
6. Copy `tests/languages/test_python.py` → `tests/languages/test_LANG.py`, update sample code
7. Run `pytest tests/languages/test_LANG.py` — all tests should pass
