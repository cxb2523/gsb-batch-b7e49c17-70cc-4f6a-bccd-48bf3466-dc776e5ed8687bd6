# Testing Patterns

**Analysis Date:** 2026-04-03

## Test Framework

**Runner:**
- pytest (configured in `pyproject.toml`)
- Config: `[tool.pytest.ini_options]` sets `testpaths = ["tests"]`

**Assertion Library:**
- pytest built-in assertions: `assert x == y`, `assert "text" in result`
- No additional assertion library (pytest sufficient)

**Run Commands:**
```bash
pytest                                           # Run all tests (~1070 tests, ~35s)
pytest tests/languages/test_python.py -v         # Run single test file with verbose output
pytest tests/languages/test_python.py::test_skeleton_finds_class -v  # Run single test
pytest tests/languages/test_rust_comprehensive.py -v  # Run comprehensive tests for one language
```

## Test File Organization

**Location:**
- Co-located in `tests/` directory parallel to `src/`
- Subdirectory `tests/languages/` for per-language tests
- Layout matches package structure: `tests/test_indexer.py` mirrors `src/codetree/indexer.py`

**Naming:**
- Test files: `test_{module}.py` (e.g., `test_indexer.py`, `test_server.py`)
- Per-language tests: `tests/languages/test_{language}.py` (e.g., `test_python.py`, `test_rust.py`)
- Comprehensive language tests: `tests/languages/test_{language}_comprehensive.py`
- Test classes: `Test{Subject}` (e.g., `TestIndexerBuild`, `TestGetFileSkeleton`, `TestDataflow`)
- Test methods: `test_{scenario}` (e.g., `test_finds_class`, `test_unknown_file_returns_not_found`)

**Structure:**
```
tests/
├── conftest.py                        # Shared fixtures: sample_repo, rich_py_repo, multi_lang_repo
├── test_server.py                     # MCP tool tests (get_file_skeleton, get_symbol, find_references, get_call_graph)
├── test_indexer.py                    # Indexer core tests (build, skeleton, symbol, refs, call graph)
├── test_cache.py                      # Cache load/save/invalidation
├── test_edge_cases.py                 # Empty files, comments, syntax errors, nesting
├── test_syntax_errors.py              # Syntax error detection per-language
├── test_new_features.py               # Method extraction, advanced node types
├── test_imports.py                    # Import extraction per-language
├── test_docstrings.py                 # Doc comment extraction
├── test_dead_code.py                  # Dead code detection
├── test_blast_radius.py               # Blast radius analysis
├── test_clones.py                     # Clone detection
├── test_complexity.py                 # Cyclomatic complexity per-language
├── test_search.py                     # Symbol search across repo
├── test_ast.py                        # AST S-expression output
├── test_variables.py                  # Variable extraction per-language
├── test_importance.py                 # PageRank scoring
├── test_discovery.py                  # Test function discovery
├── test_token_opt.py                  # Compact skeleton format
├── test_graph_store.py                # SQLite graph CRUD
├── test_graph_builder.py              # Incremental graph building
├── test_graph_queries.py              # Graph query functions
├── test_onboarding_tools.py           # MCP onboarding tools
├── test_change_impact.py              # Git-aware change impact
├── test_dataflow.py                   # Dataflow tracking and taint analysis
├── test_dataflow_tools.py             # MCP dataflow tools
├── test_git_analysis.py               # Git blame, churn, coupling
├── test_doc_suggestions.py            # Doc suggestion engine
├── test_batch.py                      # Batch tools (get_skeletons, get_symbols)
├── languages/
│   ├── test_python.py                 # Python plugin core tests
│   ├── test_python_comprehensive.py   # Exhaustive Python patterns
│   ├── test_javascript.py
│   ├── test_javascript_comprehensive.py
│   ├── test_typescript.py
│   ├── test_typescript_comprehensive.py
│   ├── test_go.py
│   ├── test_go_comprehensive.py
│   ├── test_rust.py
│   ├── test_rust_comprehensive.py
│   ├── test_java.py
│   ├── test_java_comprehensive.py
│   ├── test_c.py
│   ├── test_c_comprehensive.py
│   ├── test_cpp.py
│   ├── test_cpp_comprehensive.py
│   ├── test_ruby.py
│   └── test_ruby_comprehensive.py
└── __init__.py                        # Empty marker
```

## Test Structure

**Suite Organization:**
```python
class TestIndexerBuild:
    """Group related test methods in classes by subject."""

    def test_indexes_python_files(self, sample_repo):
        """Each test method has a docstring explaining what it validates."""
        # Arrange
        idx = Indexer(str(sample_repo))

        # Act
        idx.build()

        # Assert
        assert "calculator.py" in [p.name for p in idx.files]
```

**Patterns:**
- Setup uses pytest fixtures: `sample_repo`, `rich_py_repo`, `multi_lang_repo`, `tmp_path`
- Teardown via fixture cleanup (tempfile context managers)
- Assertion uses pytest `assert` statements with clear messages
- Each test is atomic and doesn't depend on test execution order

**Fixture Pattern from `conftest.py`:**
```python
@pytest.fixture
def sample_repo(tmp_path):
    """Minimal Python repo — used by existing indexer/server tests."""
    (tmp_path / "calculator.py").write_text("""\
class Calculator:
    def add(self, a, b):
        return a + b
    ...
""")
    (tmp_path / "main.py").write_text("""\
from calculator import Calculator
...
""")
    return tmp_path
```

## Mocking

**Framework:** pytest fixtures and temporary directories (no external mocking library)

**Patterns:**
```python
# Mock via fixture-created temporary repo
def test_indexes_python_files(self, sample_repo):
    idx = Indexer(str(sample_repo))
    idx.build()
    assert "calculator.py" in [p.name for p in idx.files]

# Mock file system with tmp_path
def test_skips_venv(self, tmp_path):
    (tmp_path / "app.py").write_text("def main(): pass")
    venv = tmp_path / ".venv" / "lib"
    venv.mkdir(parents=True)
    (venv / "util.py").write_text("def venv_fn(): pass")
    idx = Indexer(str(tmp_path))
    idx.build()
    assert not any(".venv" in k for k in idx._index)

# Mock MCP tool access
def _tool(mcp, name):
    key = f"tool:{name}@"
    tool = mcp.local_provider._components.get(key)
    if tool is None:
        raise KeyError(f"Tool '{name}' not registered...")
    return tool.fn

def test_finds_class(self, sample_repo):
    fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
    assert "Calculator" in fn(file_path="calculator.py")
```

**What to Mock:**
- File systems: use `tmp_path` and write test files
- MCP tools: access via `_tool()` helper from `mcp.local_provider._components`
- Plugin instances: import directly and instantiate (no mocking needed)
- External services: not applicable in this codebase

**What NOT to Mock:**
- Plugin behavior (test actual tree-sitter parsing)
- File I/O (use temp directories)
- In-memory data structures (test real indexer/graph)

## Fixtures and Factories

**Test Data:**

From `conftest.py`:
```python
@pytest.fixture
def rich_py_repo(tmp_path):
    """Python repo with decorators, cross-file references, and realistic patterns."""
    (tmp_path / "models.py").write_text("""\
from dataclasses import dataclass

@dataclass
class User:
    name: str
    email: str
""")
    (tmp_path / "services.py").write_text("""\
from models import User, get_user_by_email

class UserService:
    def create(self, name: str, email: str):
        return User(name=name, email=email)

    @staticmethod
    def validate(email: str) -> bool:
        return '@' in email
""")
    return tmp_path

@pytest.fixture
def multi_lang_repo(tmp_path):
    """Repo with Python, JS, TS, Go, and Rust files to exercise multi-language indexing."""
    (tmp_path / "calc.py").write_text("def add(a, b): return a + b\nclass Calc: ...")
    (tmp_path / "utils.js").write_text("const double = x => x * 2; ...")
    (tmp_path / "types.ts").write_text("export interface Shape { ... }")
    (tmp_path / "server.go").write_text("package main\ntype Server struct { ... }")
    (tmp_path / "config.rs").write_text("pub struct Config { ... }")
    return tmp_path
```

**Location:**
- Fixtures in `tests/conftest.py` (shared across all tests)
- Each fixture sets up a temporary repo with realistic code
- Fixtures use `tmp_path` (pytest-provided) for temp directory management

## Coverage

**Requirements:** No coverage enforcement (not configured in `pyproject.toml`)

**View Coverage:**
```bash
# Coverage not configured; manual inspection of test count via pytest
pytest --co -q | wc -l  # Count total tests
pytest -v | tail -1      # See summary
```

**Coverage Stats (observed):**
- ~1070 tests passing
- Test distribution:
  - Core tools: 20+ tests each
  - Per-language support: 15-30 tests per language
  - Edge cases: 30+ tests
  - Graph operations: 50+ tests
  - Dataflow/taint: 30+ tests
  - Git analysis: 20+ tests

## Test Types

**Unit Tests:**
- Scope: Individual function/method behavior
- Approach: Test plugin extraction methods in isolation
- Examples: `test_finds_class()`, `test_unknown_file_returns_not_found()`
- Located: `tests/languages/test_{lang}.py`, `tests/test_*.py`
- Typical count: 5-15 per test file

**Integration Tests:**
- Scope: Multi-module workflows (indexer + plugins + server)
- Approach: Create temp repo, call high-level functions
- Examples: `test_indexes_python_files()`, `test_full_build()`, `test_graph_builder.py::TestGraphBuilder`
- Located: `test_indexer.py`, `test_server.py`, `test_graph_builder.py`
- Typical count: 10-20 per test file

**E2E Tests:**
- Framework: Not formally structured as E2E
- Approach: Some server tests exercise full pipeline (temp repo → indexing → tool invocation)
- Examples: `test_server.py::TestGetFileSkeleton` creates server and calls tools
- Location: Subset of `test_server.py` and `test_graph_builder.py`

## Common Patterns

**Async Testing:**
Not used (synchronous codebase)

**Error Testing:**
```python
def test_unknown_file_returns_not_found(self, sample_repo):
    """Test graceful handling of missing files."""
    fn = _tool(create_server(str(sample_repo)), "get_file_skeleton")
    result = fn(file_path="nonexistent.py")
    assert "not found" in result.lower()

def test_function_not_found(self, py_indexer):
    """Test graceful handling of missing symbol."""
    idx, _ = py_indexer
    entry = idx._index["simple.py"]
    result = extract_dataflow(entry.plugin, entry.source, "nonexistent")
    assert result is None

def test_empty_file_skeleton(plugin):
    """Empty file should return empty skeleton, not crash."""
    assert plugin.extract_skeleton(b"") == []
```

**Parametrized Testing:**
```python
@pytest.mark.parametrize("plugin", ALL_PLUGINS)
def test_empty_file_skeleton(plugin):
    """Test empty file handling across all language plugins."""
    assert plugin.extract_skeleton(b"") == []

@pytest.mark.parametrize("plugin", [PY, JS, TS, GO, RS, JV])
def test_empty_file_symbol_source(plugin):
    """Test symbol extraction from empty files."""
    assert plugin.extract_symbol_source(b"", "anything") is None
```

**Assertion Patterns:**
```python
# Membership checks
assert "Calculator" in fn(file_path="calculator.py")
assert "add" in result
assert "(in Calculator)" in result

# Line number accuracy
assert "class Calculator → line 1" in result
assert "→ line 10" in result

# Sorted order validation
nums = [int(m) for m in re.findall(r"→ line (\d+)", result)]
assert nums == sorted(nums)

# Empty/None handling
assert result is None
assert plugin.extract_skeleton(b"") == []
assert not any(".venv" in k for k in idx._index)

# Collection sizes
assert result["files_indexed"] > 0
assert len(safe_paths) > 0
```

## Test Execution Behavior

**Setup Fixtures:**
- `sample_repo(tmp_path)` — creates minimal Python repo (calculator.py, main.py)
- `rich_py_repo(tmp_path)` — creates Python with decorators, dataclasses, cross-file calls
- `multi_lang_repo(tmp_path)` — creates Python, JS, TS, Go, Rust, C, C++, Ruby files
- All use `tmp_path` (cleanup automatic)

**Teardown:**
- Pytest fixtures handle cleanup automatically via context managers
- Temporary directories deleted after test
- `GraphStore.close()` called explicitly in graph tests via fixture

**Isolation:**
- Each test function gets fresh fixtures (not shared)
- No global state modified
- Tests can run in any order (no dependencies)

## Running Tests

**Command Examples:**
```bash
# All tests
pytest

# Verbose output
pytest -v

# Single file
pytest tests/test_indexer.py

# Single test
pytest tests/test_indexer.py::TestIndexerBuild::test_indexes_python_files -v

# Match pattern
pytest -k "test_finds" -v

# Show output (don't capture)
pytest -s

# Show slowest tests
pytest --durations=10
```

---

*Testing analysis: 2026-04-03*
