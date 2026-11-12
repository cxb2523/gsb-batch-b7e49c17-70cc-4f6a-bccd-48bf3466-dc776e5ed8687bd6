# Phase 6 Design: Persistent Graph + Onboarding + Dataflow Analysis

**Date:** 2026-03-10
**Status:** Approved
**Goal:** Evolve codetree from a file/symbol inspector into a workflow-first code understanding tool with persistent graph storage, repo onboarding, git-aware change impact, and intra-function dataflow/taint analysis.

## Product Positioning

- **Serena** = LSP wrapper (semantic types, rename refactoring, 30+ languages)
- **codebase-memory-mcp** = persistent graph database (architecture, clustering, Cypher queries)
- **codetree** = structural analysis + dataflow + security taint tracking

No other MCP server combines structural code analysis with dataflow tracking. This is codetree's differentiator.

## Current State

- 16 MCP tools, 10 languages, 921 tests
- In-memory indexer with JSON skeleton cache
- Short-name-based symbol resolution (collisions when two files define `add()`)
- Call graph rebuilt from scratch every session (~3s)
- No "where do I start?" tool
- No git integration
- No dataflow or security analysis

## Target State

- 22 MCP tools (+6 new)
- Persistent SQLite graph at `.codetree/graph.db`
- Qualified-name symbol identity (no collisions)
- Incremental re-index via sha256 content hashing
- Agent orients to unfamiliar repo in 1 tool call (~300 tokens vs ~12,700 today)
- Git-diff-aware change impact with risk classification
- Intra-function dataflow tracking (unique in MCP space)
- Security taint analysis (unique in MCP space)

## Architecture

```
MCP tool call
  → server.py (22 tools)
    ├── Legacy path: indexer.py → plugin → tree-sitter (existing 16 tools)
    └── Graph path: graph/ package → SQLite .codetree/graph.db
          ├── store.py    — SQLite CRUD, schema, migrations
          ├── builder.py  — incremental build from indexer data
          ├── queries.py  — repo map, symbol resolution, search, impact
          └── models.py   — SymbolNode, Edge, QualifiedName dataclasses
```

The graph layer sits on top of the existing indexer. The indexer still does tree-sitter parsing. The graph persists results and adds relationship queries. Legacy tools keep working throughout.

## Data Model

### SQLite Schema (stdlib sqlite3, repo-local)

```sql
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE files (
    file_path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    language TEXT,
    is_test INTEGER DEFAULT 0,
    indexed_at REAL
);

CREATE TABLE symbols (
    qualified_name TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    parent_qn TEXT,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER,
    doc TEXT,
    params TEXT,
    is_test INTEGER DEFAULT 0,
    is_entry_point INTEGER DEFAULT 0
);

CREATE TABLE edges (
    source_qn TEXT NOT NULL,
    target_qn TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    PRIMARY KEY (source_qn, target_qn, type)
);

CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_edges_source ON edges(source_qn);
CREATE INDEX idx_edges_target ON edges(target_qn);
CREATE INDEX idx_edges_type ON edges(type);
```

### Edge Types

- `CALLS` — function A calls function B
- `IMPORTS` — file A imports from file B
- `CONTAINS` — class A contains method B
- `TESTS` — test function A tests function B
- `DATA_FLOWS` — variable flows from expression A to expression B (Phase 4)

### Qualified Name Format

- Top-level function: `src/server.py::create_server`
- Method: `src/server.py::Router.handle_request`
- Nested class method: `src/server.py::Router.Inner.process`

Convention: `{file_path}::{ParentChain.symbol_name}`

## New Tools (6 total)

### Phase 2: Onboarding

**`get_repository_map(include?, max_items=5) → dict`**

Returns a compact repo overview in one call:
```
languages: {py: 45, js: 12, go: 3}
major_paths: ["src/codetree/", "tests/", "docs/"]
entry_points: ["src/codetree/__main__.py::main"]
hotspots: [top 5 most-connected symbols with in/out degree]
start_here: [ranked "read these first" symbols]
test_roots: ["tests/"]
stats: {files: 60, symbols: 450, edges: 1200}
```

start_here ranking: entry-point bias + centrality + non-test preference.

**`resolve_symbol(query, kind?, path_hint?, limit=10) → dict`**

Disambiguates short names using qualified identity:
```
resolve_symbol("add") →
  1. src/calc.py::Calculator.add (method, 8 callers) — best match
  2. src/utils.py::add (function, 2 callers)
  3. tests/test_calc.py::TestCalc.test_add (test)
```

Ranking: exact QN match > path-hinted match > non-test match > higher centrality > alphabetical.

### Phase 3: Search + Impact

**`search_graph(query?, kind?, file_pattern?, relationship?, direction?, min_degree?, max_degree?, limit=10, offset=0) → dict`**

Structured graph search with pagination:
```
search_graph(relationship="CALLS", direction="inbound", max_degree=0)
→ Dead code: symbols with zero inbound CALLS edges

search_graph(kind="function", min_degree=10)
→ Hotspot functions with 10+ connections
```

**`get_change_impact(symbol_query?, diff_scope?, depth=3) → dict`**

Git-diff-aware impact analysis:
```
get_change_impact(diff_scope="working") →
  changed_symbols: [calc.py::Calculator.add]
  impact:
    CRITICAL (hop 1): [checkout.py::process_order]
    HIGH (hop 2): [api.py::handle_request]
    MEDIUM (hop 3): [cli.py::main]
  affected_tests: [test_calc.py::test_add]
```

Modes: `diff_scope="working"` (uncommitted changes), `diff_scope="staged"`, `diff_scope="HEAD~1"`, or explicit `symbol_query`.

### Phase 4: Dataflow + Taint (Unique Differentiator)

**`get_dataflow(file_path, function_name) → dict`**

Intra-function variable flow tracking via AST:
```
get_dataflow("app.py", "process") →
  flow_chains:
    - request.get("name") → user_input [line 2]
      → sanitize(user_input) → cleaned [line 3]
      → f"SELECT...{cleaned}" → query [line 4]
      → db.execute(query) [line 5, SINK]
  variables: {user_input: {source: "request.get", line: 2}, ...}
  sources: [{expr: "request.get('name')", line: 2, kind: "external_input"}]
  sinks: [{expr: "db.execute(query)", line: 5, kind: "database"}]
```

Implementation: Walk assignment nodes in function body AST, collect identifier references in RHS, build dependency edges between variables.

**`get_taint_paths(file_path, function_name?) → dict`**

Security taint analysis:
```
get_taint_paths("app.py", "process") →
  paths:
    - verdict: SAFE
      chain: request.get("name") → sanitize() → db.execute()
      sanitizer: sanitize()
    - verdict: UNSAFE
      chain: request.get("id") → db.execute()
      risk: SQL injection
      recommendation: Add parameterized query or sanitizer
```

Taint sources: `request.*`, `input()`, `sys.stdin`, `os.environ`, `open()`, function parameters
Taint sinks: `db.execute()`, `os.system()`, `subprocess.*`, `eval()`, `exec()`, `open().write()`
Sanitizers: configurable list, defaults include `escape()`, `sanitize()`, `html.escape()`, `parameterize()`

### Utility

**`index_status() → dict`**

Report on graph freshness:
```
index_status() →
  graph_exists: true
  files_indexed: 60
  symbols: 450
  edges: 1200
  stale_files: 3 (changed since last index)
  last_indexed: "2026-03-10T14:30:00"
```

## Incremental Indexing

1. Hash every source file with sha256
2. On startup, compare current files vs `files` table
3. Only reparse changed/new files
4. Delete rows for removed files
5. Rebuild edges for changed files
6. No filesystem watcher — freshness from startup refresh

For 1000-file repo with 5 changed: reparse 5 files (~0.5s) vs 1000 (~30s).

## Legacy Tool Strategy

**Keep all current tools working.** In Phase 3, migrate these legacy tools to use graph-backed qualified symbol resolution internally:
- `get_symbol` — resolve via qualified name
- `find_references` — use graph edges
- `get_call_graph` — use graph edges
- `get_blast_radius` — use graph BFS
- `find_tests` — use TESTS edges
- `rank_symbols` — PageRank on graph

Keep these AST-backed (no change):
- `get_file_skeleton`, `get_skeletons`
- `get_ast`
- `detect_clones`
- `get_variables`
- `get_complexity`

## Impact Projections

| Metric | Today | After Phase 6 | Improvement |
|---|---|---|---|
| Tokens to orient in unfamiliar repo | ~12,700 | ~1,150 | 91% reduction |
| Tool calls for change impact | 4+ (manual) | 1 (automated) | 75% fewer |
| Symbol disambiguation | Collisions on short names | Qualified names | Zero false matches |
| Startup on unchanged repo | ~3s (reparse call graph) | ~0.1s (read SQLite) | 30x faster |
| Security analysis | Not possible | Taint tracking | New category |
| "Where do I start?" | Not possible | get_repository_map | New category |

## Non-Goals

- No Cypher or general graph query language
- No background filesystem watching
- No ADR persistence (can add later)
- No HTTP route discovery or service-to-service inference
- No community detection (Louvain) in first version
- No language expansion before graph is stable
- No LSP integration (different product category)

## Phase Dependencies

```
Phase 1 (graph core)
  ↓
Phase 2 (onboarding) ← depends on qualified names + graph
  ↓
Phase 3 (search + impact) ← depends on onboarding + graph edges
  ↓
Phase 4 (dataflow) ← depends on graph (stores DATA_FLOWS edges)
  ↓
Phase 5 (polish + languages) ← depends on stable graph
```

## Test Scenarios Required

- Same symbol name in multiple files (qualified name disambiguation)
- Same method name in multiple classes
- Source symbol and test symbol with same short name
- Repo with no obvious entry point
- Repo with multiple entry points
- Repo with only a few files
- Deleted files between index runs
- Renamed files between index runs
- Unchanged files across warm starts
- Dataflow with sanitizer in chain (SAFE path)
- Dataflow without sanitizer (UNSAFE path)
- Taint from multiple source types (request, env, file)

## Competitive Position After Phase 6

| Feature | codetree | Serena | codebase-memory-mcp |
|---|---|---|---|
| Persistent symbol graph | Yes (SQLite) | No (LSP runtime) | Yes (SQLite) |
| Qualified symbol identity | Yes | Yes (via LSP) | Yes |
| Repo onboarding | Yes | Yes (memory system) | Yes (get_architecture) |
| Git-aware impact | Yes | No | Yes |
| Dataflow analysis | **Yes (unique)** | No | No |
| Security taint tracking | **Yes (unique)** | No | No |
| AST access | Yes | No | No |
| Clone detection | Yes | No | No |
| Cyclomatic complexity | Yes | No | No |
| Variable extraction | Yes | No | No |
| Type-aware references | No (syntax only) | Yes (LSP) | No |
| Semantic rename | No | Yes (LSP) | No |
| Languages | 10 → 12 | 30+ | 64 |
| Setup | pip install | pip install + LSP | Single binary |
