# Architecture

**Analysis Date:** 2026-04-03

## Pattern Overview

**Overall:** Modular MCP (Model Context Protocol) server with multi-language plugin architecture and persistent graph-based code analysis.

**Key Characteristics:**
- **FastMCP 3.1.0 framework** - MCP tools exposed as JSON-RPC endpoints over stdio
- **Multi-language plugin system** - Tree-sitter-based parsers for 10 languages (Python, JavaScript, TypeScript, Go, Rust, Java, C, C++, Ruby)
- **Three-tier indexing** - File discovery → skeleton extraction → graph construction
- **Persistent SQLite graph** - `.codetree/graph.db` for cross-session analysis without re-parsing
- **Cache optimization** - `.codetree/index.json` with mtime-based invalidation to skip unchanged files

## Layers

**Entry Point (CLI):**
- Purpose: Parse command-line arguments and invoke the server
- Location: `src/codetree/__main__.py`
- Contains: argparse setup, root directory resolution
- Triggers: Called by `codetree --root /path/to/repo` command
- Responsibilities: Accept `--root` argument, invoke `server.run()`

**Server Layer (MCP Exposure):**
- Purpose: Expose 23 MCP tools over FastMCP protocol
- Location: `src/codetree/server.py`
- Contains: Tool definitions, result formatting, caching/indexing/graph initialization
- Depends on: Indexer, Cache, GraphStore, GraphQueries
- Used by: Claude Code via stdio MCP transport
- Key function: `create_server(root: str) → FastMCP`, `run(root: str)` entry point

**Indexer Layer (File Discovery & Skeleton Extraction):**
- Purpose: Discover all supported files, extract symbol skeletons, build definition/call graphs
- Location: `src/codetree/indexer.py`
- Contains: `Indexer` class with methods for skeleton, symbol source, references, call graphs, dead code, blast radius, clones, search
- Depends on: Language plugins, registry
- Used by: Server, GraphBuilder
- Key dataclass: `FileEntry` (path, source, skeleton, mtime, language, plugin, has_errors)

**Cache Layer (Mtime-Based Invalidation):**
- Purpose: Store pre-computed skeletons with modification time checks to skip unchanged files
- Location: `src/codetree/cache.py`
- Contains: `Cache` class (load, save, get, set, is_valid methods)
- Stores: `.codetree/index.json` (JSON dict of `rel_path → {mtime, skeleton}`)
- Used by: Server on startup to inject cached entries into indexer

**Language Plugin System (Tree-Sitter AST Analysis):**
- Purpose: Abstract language-specific AST parsing behind common interface
- Location: `src/codetree/languages/`
- Contains: 10 plugin classes inheriting from `LanguagePlugin` base
- Each plugin implements:
  1. `extract_skeleton()` - classes/functions with line numbers, doc comments, params
  2. `extract_symbol_source()` - full source text of a symbol with start line
  3. `extract_calls_in_function()` - callees sorted by name
  4. `extract_symbol_usages()` - all occurrences (line, col) including definitions
  5. `extract_imports()` - import statements with line numbers
  6. Optional: `check_syntax()`, `compute_complexity()`, `extract_variables()`, `get_ast_sexp()`, `normalize_source_for_clones()`
- Plugins: `PythonPlugin`, `JavaScriptPlugin`, `TypeScriptPlugin`, `TSXPlugin`, `GoPlugin`, `RustPlugin`, `JavaPlugin`, `CPlugin`, `CppPlugin`, `RubyPlugin`

**Plugin Registry (File Extension → Plugin Mapping):**
- Purpose: Route files to correct language plugin
- Location: `src/codetree/registry.py`
- Contains: `PLUGINS` dict (extension → singleton plugin instance), `get_plugin(path) → LanguagePlugin | None`
- Used by: Indexer during file discovery

**Graph Layer (Persistent Analysis):**
- Purpose: Build and query a persistent SQLite symbol graph for cross-session analysis
- Location: `src/codetree/graph/`
- Components:
  - **Models** (`models.py`): `SymbolNode`, `Edge`, `make_qualified_name()` data classes
  - **Store** (`store.py`): `GraphStore` SQLite CRUD (symbols, edges, files, meta tables); `check_same_thread=False` for async MCP safety
  - **Builder** (`builder.py`): `GraphBuilder` incremental build with sha256 content hashing; detects file changes, creates CALLS/CONTAINS/IMPORTS edges
  - **Queries** (`queries.py`): `GraphQueries` for repository_map, resolve_symbol, search_graph, change_impact, find_hot_paths, get_dependency_graph, suggest_docs
  - **Dataflow** (`dataflow.py`): Variable tracking, taint analysis, cross-function taint tracing
  - **Git Analysis** (`git_analysis.py`): Git blame, file churn, change coupling

## Data Flow

**Startup (Server Initialization):**

1. `__main__.py` → `server.run(root)` → `create_server(root)`
2. Load cache from `.codetree/index.json`
3. Build indexer (discover files, skip `.venv`/`node_modules`/`.git`/etc., skip files in cache with matching mtime)
4. For each discovered file: `plugin.extract_skeleton(source)` → store in `FileEntry`
5. Inject cached entries (unchanged files) via `indexer.inject_cached()`
6. Save updated cache to `.codetree/index.json`
7. Open SQLite graph store (WAL mode, foreign keys on)
8. `GraphBuilder.build(indexer)` → populate symbols and edges
9. Return `FastMCP` with 23 tools registered

**Query (MCP Tool Invocation):**

1. Claude Code sends `tool_call("get_file_skeleton", {"file_path": "src/main.py"})`
2. MCP server routes to `get_file_skeleton(file_path)` function
3. Function calls `indexer.get_skeleton(file_path)` → returns list of dicts
4. Format skeleton (full or compact) with syntax error warnings
5. Return formatted string to Claude Code

**Cross-File Analysis (e.g., find_references):**

1. Tool receives symbol name
2. Iterate all `FileEntry` objects in indexer
3. For each file: `plugin.extract_symbol_usages(source, name)` → collect all occurrences
4. Return deduplicated list of `{file, line, col}`

**Call Graph (Lazy Construction):**

1. Tool receives file path and function name
2. Indexer builds repo-wide call graph on first use via `_ensure_call_graph()`
3. For each function in skeleton: `plugin.extract_calls_in_function(source, fn_name)` → list of callees
4. Resolve callee names to definitions using `_definitions` index
5. Build `_call_graph` (caller → set of callees) and `_reverse_graph` (callee → set of callers)
6. Return BFS-traversed graph with depths

**Graph Persistence:**

1. `GraphBuilder` hashes each file with sha256
2. For each file: check if hash matches stored hash in graph
3. If unchanged: skip (use cached symbols/edges)
4. If changed: delete old symbols/edges, insert new ones, resolve CALLS edges via symbol definitions
5. CALLS edges weighted by import depth (local = weight 1.0, imported = weight 0.5)

## State Management

**Indexer State:**
- `_index: dict[rel_path → FileEntry]` - all indexed files (held in memory)
- `_definitions: dict[name → list[(file, line)]]` - definition locations for all symbols
- `_call_graph, _reverse_graph` - lazy-built, invalidated when files change
- `_call_graph_built: bool` - flag to defer call graph construction until first use

**Graph State:**
- Persistent SQLite database: `.codetree/graph.db`
- Tables: `meta`, `files`, `symbols`, `edges`, `file_symbols_index`
- Indices on: `symbols.name`, `symbols.file`, `symbols.kind`, `edges.source_qn`, `edges.target_qn`, `edges.type`
- Schema version tracked in `meta` table

**Cache State:**
- JSON file: `.codetree/index.json`
- Structure: `{rel_path → {mtime: float, skeleton: list[dict]}}`
- Invalidation: re-parse file if `stat().st_mtime` differs from cached mtime

## Key Abstractions

**LanguagePlugin (Abstract Base Class):**
- Purpose: Define language-agnostic interface for code analysis
- Methods: 5 abstract (skeleton, symbol_source, calls, usages, imports) + 5 optional (syntax, complexity, variables, ast, normalize_for_clones)
- Example: `PythonPlugin` queries `function_definition` and `class_definition` tree-sitter nodes
- Pattern: Tree-sitter 0.25.x API with `Query()`, `QueryCursor()`, `_matches()` unwrapper

**FileEntry (Data Class):**
- Purpose: Hold all parsed information for a single file
- Fields: path, source (bytes), skeleton, mtime, language, plugin, has_errors
- Lifetime: Created during indexing, reused for all lookups without re-parsing

**SymbolNode & Edge (Graph Dataclasses):**
- Purpose: Define persistent graph schema
- SymbolNode: qualified_name, name, kind, file_path, start_line, end_line, parent_qn, doc, params, is_test, is_entry_point
- Edge: source_qn, target_qn, type (CALLS, IMPORTS, CONTAINS), weight
- Qualified names: `file_path::ClassName.method_name` or `file_path::function_name`

**Query Cursor (Tree-Sitter):**
- Purpose: Execute AST queries via S-expression patterns
- Pattern: Define queries as strings: `(function_definition name: (identifier) @name)`
- Matches returned as dicts with capture names unwrapped to nodes
- Helper: `_matches(query, node)` in `languages/base.py` for convenient capture unwrapping

## Entry Points

**CLI Entry Point:**
- Location: `src/codetree/__main__.py::main()`
- Triggers: `codetree --root /path/to/repo`
- Responsibilities: Parse args, invoke `server.run(root)`

**MCP Tool Entry Points (23 total):**
- **Structural:** `get_file_skeleton`, `get_symbol`, `find_references`, `get_call_graph`, `get_imports`, `get_skeletons`, `get_symbols`, `get_complexity`, `find_dead_code`, `get_blast_radius`, `detect_clones`, `search_symbols`, `find_tests`
- **Graph & Onboarding:** `index_status`, `get_repository_map`, `resolve_symbol`, `search_graph`, `get_change_impact`, `analyze_dataflow`, `find_hot_paths`, `get_dependency_graph`, `git_history`, `suggest_docs`
- All registered as `@mcp.tool()` decorators in `server.py`

## Error Handling

**Strategy:** Language plugins return empty results (not exceptions) for missing/invalid symbols; tools return user-friendly error messages.

**Patterns:**
- File not found: `"File not found or empty: {file_path}"`
- Symbol not found: `"Symbol '{name}' not found in {file_path}"`
- Syntax error: Skeleton includes warning header if `entry.has_errors == True`
- Empty results: `"No {X} found..."`

**Cross-thread Safety:** GraphStore uses `check_same_thread=False` for SQLite to allow async MCP tool calls

## Cross-Cutting Concerns

**Logging:** None configured (no linter/formatter/logger in repo). Errors communicated via return values.

**Validation:**
- File paths: Checked for existence in indexer during build
- Symbol names: Case-sensitive searches; substring matching optional in `search_symbols`
- Imports: Extracted as raw text; no semantic resolution (cross-module imports tracked by edge weights)

**Caching:**
- Skeleton cache: mtime-based invalidation per file
- Call graph: Lazy-built once, invalidated on file change via `_call_graph_built` flag
- Graph store: Content-hashed (sha256) per file to detect changes
- Import resolution: Graph builder caches file imports in `_file_imports` dict

**Complexity Calculation:** Tree-sitter node counting per language (if, for, while, case, ternary, boolean operators)

**Dead Code Detection:**
- Excludes dunder methods (`__init__`, `__str__`, etc.), test functions, `__init__.py` exports
- Counts external references only (same-file definitions at definition line don't count as usage)

---

*Architecture analysis: 2026-04-03*
