# Codebase Structure

**Analysis Date:** 2026-04-03

## Directory Layout

```
understandCode/
├── src/codetree/                    # Main package
│   ├── __init__.py                  # Package init
│   ├── __main__.py                  # CLI entry point (argparse, server.run)
│   ├── server.py                    # FastMCP server with 23 MCP tools
│   ├── indexer.py                   # Indexer class: file discovery, skeleton extraction, call graphs
│   ├── cache.py                     # Cache class: .codetree/index.json mtime-based invalidation
│   ├── registry.py                  # Plugin registry: extension → plugin mapping
│   ├── languages/                   # Language plugins (tree-sitter AST parsers)
│   │   ├── __init__.py
│   │   ├── base.py                  # LanguagePlugin ABC + shared helpers (_matches, _clean_doc)
│   │   ├── python.py                # PythonPlugin
│   │   ├── javascript.py            # JavaScriptPlugin
│   │   ├── typescript.py            # TypeScriptPlugin, TSXPlugin
│   │   ├── go.py                    # GoPlugin
│   │   ├── rust.py                  # RustPlugin
│   │   ├── java.py                  # JavaPlugin
│   │   ├── c.py                     # CPlugin
│   │   ├── cpp.py                   # CppPlugin
│   │   ├── ruby.py                  # RubyPlugin
│   │   └── _template.py             # Boilerplate for adding new languages
│   └── graph/                       # Persistent graph layer (SQLite)
│       ├── __init__.py
│       ├── models.py                # SymbolNode, Edge, make_qualified_name()
│       ├── store.py                 # GraphStore: SQLite CRUD (.codetree/graph.db)
│       ├── builder.py               # GraphBuilder: incremental graph construction
│       ├── queries.py               # GraphQueries: onboarding, search, impact analysis
│       ├── dataflow.py              # Variable tracking, taint analysis
│       └── git_analysis.py          # Blame, churn, change coupling
├── tests/                           # Test suite (~1070 tests)
│   ├── conftest.py                  # pytest fixtures (sample_repo, rich_py_repo, multi_lang_repo)
│   ├── languages/                   # Language plugin tests
│   │   ├── test_python.py           # Core Python tests
│   │   ├── test_python_comprehensive.py  # Exhaustive Python patterns
│   │   ├── test_javascript.py       # Core JS tests
│   │   ├── test_javascript_comprehensive.py  # JS patterns
│   │   ├── test_typescript.py       # TS tests
│   │   ├── test_typescript_comprehensive.py  # TS patterns
│   │   ├── test_go.py, test_go_comprehensive.py
│   │   ├── test_rust.py, test_rust_comprehensive.py
│   │   ├── test_java.py, test_java_comprehensive.py
│   │   ├── test_c.py, test_cpp.py, test_ruby.py
│   │   └── test_base.py             # Shared LanguagePlugin tests
│   ├── test_server.py               # FastMCP tool output formatting, cross-language
│   ├── test_indexer.py              # Indexer build, skeleton, symbol, references, call graph
│   ├── test_cache.py                # Cache load/save/invalidation
│   ├── test_edge_cases.py           # Empty files, syntax errors, unicode, nested code
│   ├── test_new_features.py         # Methods, traits, enums, type aliases
│   ├── test_imports.py              # Import extraction per-language
│   ├── test_docstrings.py           # Doc comment extraction
│   ├── test_syntax_errors.py        # Syntax error detection + warning
│   ├── test_dead_code.py            # Definition index, dead code detection
│   ├── test_blast_radius.py         # Call graph blast radius
│   ├── test_clones.py               # Clone detection (Type 1 & 2)
│   ├── test_complexity.py           # Cyclomatic complexity
│   ├── test_ast.py                  # AST S-expression output
│   ├── test_search.py               # Symbol search with filters
│   ├── test_token_opt.py            # Compact format for skeletons
│   ├── test_importance.py           # PageRank symbol importance
│   ├── test_discovery.py            # Test function discovery
│   ├── test_variables.py            # Variable extraction
│   ├── test_graph_store.py          # SQLite CRUD operations
│   ├── test_graph_builder.py        # Incremental graph build
│   ├── test_graph_queries.py        # Graph query functions
│   ├── test_onboarding_tools.py     # Index status, repo map, resolve, search
│   ├── test_change_impact.py        # Change impact analysis
│   ├── test_dataflow_tools.py       # Dataflow tool
│   ├── test_dataflow.py             # Dataflow engine
│   ├── test_git_analysis.py         # Git blame, churn, coupling
│   ├── test_doc_suggestions.py      # Doc suggestion generation
│   ├── test_server_new_types.py     # MCP server type formatting
│   └── test_batch.py                # Batch operations
├── docs/                            # Documentation
│   ├── plans/                       # Implementation phase plans
│   │   ├── 2026-03-05-*.md          # Design/implementation docs for phases 1-6
│   │   ├── 2026-03-10-*.md          # Phase 6 design/implementation
│   │   └── ...
│   ├── LANDING_PAGE.md              # Marketing copy
│   ├── TOOLS_GUIDE.md               # User guide for all 23 tools
│   └── language-nodes.md            # Tree-sitter node type reference
├── dist/                            # Wheels and sdist builds
├── .planning/codebase/              # GSD analysis documents (this file lives here)
├── .codetree/                       # Generated at runtime
│   ├── index.json                   # Cache: rel_path → {mtime, skeleton}
│   └── graph.db                     # Persistent graph: symbols, edges, files
├── pyproject.toml                   # Project metadata, dependencies
├── README.md                        # Project overview
└── CLAUDE.md                        # Claude-specific instructions (this one!)
```

## Directory Purposes

**`src/codetree/`:**
- Purpose: Main package containing server, indexer, plugins, and graph layer
- Contains: Python source files for MCP server implementation
- Key files: `server.py` (MCP tool definitions), `indexer.py` (file discovery), `languages/` (AST parsers)

**`src/codetree/languages/`:**
- Purpose: Language-specific tree-sitter plugins
- Contains: One plugin per language, each implementing the `LanguagePlugin` interface
- Key file: `base.py` (abstract base class + shared helpers like `_matches()` and `_clean_doc()`)
- Pattern: Each plugin implements 5 abstract methods + optional 5 methods

**`src/codetree/graph/`:**
- Purpose: Persistent symbol graph and analysis queries
- Contains: SQLite store, incremental builder, query layer, dataflow/git analysis
- Key file: `store.py` (SQLite schema), `builder.py` (file→symbol→edge pipeline), `queries.py` (onboarding/search/impact)

**`tests/`:**
- Purpose: Test suite covering all languages, features, and edge cases
- Contains: ~1070 tests across language-specific, feature-specific, and integration test files
- Pattern: Per-language core tests + per-language comprehensive tests + feature tests

**`tests/languages/`:**
- Purpose: Language plugin tests
- Pattern: `test_{lang}.py` (core tests) + `test_{lang}_comprehensive.py` (exhaustive pattern coverage)
- Contains: Skeleton extraction, symbol source, calls, usages, imports, complexity, variables for each language

**`docs/`:**
- Purpose: Planning, design, and user documentation
- Contains: Implementation phase plans, marketing copy, tool guide, language reference
- Key file: `TOOLS_GUIDE.md` (user documentation for all 23 MCP tools)

**`.codetree/` (generated at runtime):**
- Purpose: Cache and persistent graph storage
- Files:
  - `index.json` - Skeleton cache with mtime invalidation
  - `graph.db` - SQLite persistent graph (symbols, edges, files, metadata)
- Created by: Server on first run; skip in `.gitignore`

## Key File Locations

**Entry Points:**
- `src/codetree/__main__.py` - CLI entry point; parses `--root` argument, invokes `server.run()`
- `src/codetree/server.py::create_server()` - Server factory; initializes indexer, cache, graph, returns FastMCP
- `src/codetree/server.py::run()` - Server runner; calls `mcp.run()` to listen on stdio

**Core Indexing:**
- `src/codetree/indexer.py` - Main indexer class; holds all indexed files in `_index` dict
- `src/codetree/cache.py` - Cache manager for `.codetree/index.json`
- `src/codetree/registry.py` - Plugin registry; maps file extensions to plugin instances

**Language Plugins:**
- `src/codetree/languages/base.py` - Abstract base class + helpers
- `src/codetree/languages/python.py` - Python plugin (most complete)
- `src/codetree/languages/typescript.py` - TS/TSX plugins (handles both)
- `src/codetree/languages/{go,rust,java,c,cpp,ruby}.py` - Other language plugins

**Graph Layer:**
- `src/codetree/graph/models.py` - `SymbolNode`, `Edge`, `make_qualified_name()`
- `src/codetree/graph/store.py` - SQLite connection, schema, CRUD
- `src/codetree/graph/builder.py` - Incremental build: file hash check, symbol/edge creation
- `src/codetree/graph/queries.py` - Query functions: `repository_map()`, `resolve_symbol()`, `search_graph()`, etc.
- `src/codetree/graph/dataflow.py` - Variable/taint analysis
- `src/codetree/graph/git_analysis.py` - Blame, churn, change coupling

**Configuration:**
- `pyproject.toml` - Project metadata, dependencies (tree-sitter, tree-sitter-LANG packages, fastmcp)
- `CLAUDE.md` - Claude instructions (this file!)

**Testing:**
- `tests/conftest.py` - pytest fixtures and repo setup
- `tests/languages/test_*.py` - Language plugin tests (core + comprehensive)
- `tests/test_*.py` - Feature tests (server, indexer, cache, dead code, etc.)

## Naming Conventions

**Files:**
- `test_{lang}.py` - Core language plugin tests
- `test_{lang}_comprehensive.py` - Exhaustive language pattern tests
- `test_{feature}.py` - Feature-specific tests (e.g., `test_dead_code.py`, `test_dataflow.py`)
- `{lang}.py` in `languages/` directory - Plugin file (e.g., `python.py`, `typescript.py`)

**Classes:**
- `{Lang}Plugin` - Language plugin class (e.g., `PythonPlugin`, `GoPlugin`, `TSXPlugin`)
- `LanguagePlugin` - Abstract base class
- `Indexer` - Main file discovery and skeleton extraction
- `Cache` - Cache management
- `GraphStore` - SQLite database operations
- `GraphBuilder` - Graph construction
- `GraphQueries` - Graph query functions
- `FileEntry` - Dataclass holding parsed file information
- `SymbolNode`, `Edge` - Graph element dataclasses

**Functions/Methods:**
- `extract_skeleton()` - Return list of dicts with symbols
- `extract_symbol_source()` - Return (source_text, start_line) tuple
- `extract_calls_in_function()` - Return list of callee names
- `extract_symbol_usages()` - Return list of {line, col} dicts
- `extract_imports()` - Return list of {line, text} dicts
- `get_plugin()` - Return plugin for file path
- `_matches()` - Helper to run tree-sitter query and unwrap captures
- `_clean_doc()` - Helper to extract first meaningful line from doc comment

**Test Functions:**
- `test_{feature}()` - Test a specific feature
- `test_{feature}_{case}()` - Test a specific case within a feature
- Sample code is generated inline with triple-quoted strings or in `conftest.py` fixtures

**Variables:**
- `rel_path` - Path relative to repo root (e.g., `"src/main.py"`)
- `file_path` - Same as rel_path (tool argument)
- `source` - Raw bytes of file content
- `skeleton` - List of extracted symbol dicts
- `plugin` - LanguagePlugin instance
- `entry` - FileEntry dataclass instance
- `_index` - Dict of indexed files (rel_path → FileEntry)
- `_definitions` - Dict of symbol definitions (name → list[(rel_path, line)])

## Where to Add New Code

**New Language Support:**
1. Copy `src/codetree/languages/_template.py` → `src/codetree/languages/{lang}.py`
2. Implement 5 abstract methods + optional `check_syntax()`
3. Register in `src/codetree/registry.py` (add to `PLUGINS` dict)
4. Add tests: Copy `tests/languages/test_python.py` → `tests/languages/test_{lang}.py`
5. Run tests: `pytest tests/languages/test_{lang}.py -v`

**New MCP Tool:**
1. Define tool function in `src/codetree/server.py` inside `create_server()`
2. Decorate with `@mcp.tool()`
3. Implement logic using `indexer` and `graph_queries` (already in scope)
4. Return string or dict (per FastMCP convention)
5. Add tests in `tests/test_server.py` or feature-specific test file
6. Update docs: README.md, TOOLS_GUIDE.md, LANDING_PAGE.md, CLAUDE.md, AGENTS.md

**New Indexer Method (e.g., new analysis):**
1. Add method to `Indexer` class in `src/codetree/indexer.py`
2. Use `self._index`, `self._definitions`, `self._call_graph` (lazily built)
3. Call appropriate plugin methods on `FileEntry` objects
4. Expose via MCP tool in `server.py` if user-facing

**New Graph Query:**
1. Add method to `GraphQueries` class in `src/codetree/graph/queries.py`
2. Use `self._store.execute(sql, params)` to query SQLite
3. Format result as dict or list suitable for return to tool caller
4. Expose via MCP tool in `server.py` if user-facing

**New Test:**
1. Create file: `tests/test_{feature}.py`
2. Use fixtures from `conftest.py` (e.g., `sample_repo`, `multi_lang_repo`)
3. Run: `pytest tests/test_{feature}.py -v`
4. For language-specific: use `tests/languages/test_{lang}.py`

## Special Directories

**`.codetree/` (Generated):**
- Purpose: Runtime cache and persistent graph
- Generated: Yes, created by server on first run
- Committed: No (in `.gitignore`)
- Contents:
  - `index.json` - Skeleton cache (mtime-based invalidation)
  - `graph.db` - SQLite database with symbols, edges, files

**`docs/plans/`:**
- Purpose: Historical implementation plans and design documents
- Contents: Phase 1-6 design/implementation docs dated 2026-03-05 through 2026-03-10
- Pattern: `{date}-{phase-name}-{design|implementation}.md`

**`.venv/` (Generated):**
- Purpose: Python virtual environment
- Generated: Yes, created by `python -m venv .venv`
- Committed: No (in `.gitignore`)
- Skipped: Yes, in `SKIP_DIRS` during indexing to avoid timeout

**`node_modules/`, `__pycache__/`, `.git/`, `dist/`, `build/` (Generated):**
- Purpose: Build artifacts, dependencies, version control
- Skipped: Yes, in `SKIP_DIRS` during indexing
- Committed: No (in `.gitignore`)

---

*Structure analysis: 2026-04-03*
