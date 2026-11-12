# Codetree vNext Onboarding Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve codetree from a file/symbol inspector into a workflow-first onboarding tool for unfamiliar repositories by adding a persistent graph core, repo-orientation workflows, structured graph search, and reliable impact analysis.

**Architecture:** Keep the current tree-sitter plugin system and high-value AST tools, but add a repo-local SQLite graph layer under `.codetree/graph.db`. Existing tools continue to exist during the transition, while new workflow-first tools become the preferred path for onboarding, symbol resolution, and change impact. The graph should stay internal-first: use it to improve correctness and token efficiency, but expose only one low-level escape hatch (`search_graph`) instead of turning codetree into a general graph query product.

**Tech Stack:** Python 3.10+, FastMCP, tree-sitter 0.25.x, stdlib `sqlite3`, pytest. No external database, no background service, no network dependency.

**Product direction locked by this plan:**
- Hybrid graph core, not a rewrite in another language
- Workflow-first API, plus one structured search escape hatch
- Optimize for generic unfamiliar-repo onboarding, not backend-only or microservice-first analysis
- Redesign allowed where it materially improves correctness or usability
- Breadth and depth balanced, but graph/onboarding depth comes before major language expansion

## Current state and bottlenecks

- `src/codetree/indexer.py` is still the real core. It holds symbols in memory and resolves relationships mostly by short name.
- `src/codetree/server.py` exposes useful tools, but most outputs are plain text and file-path-first, which makes composition harder for agents.
- `src/codetree/cache.py` only persists `mtime` plus skeleton data, so there is no persistent symbol graph, no project-level search index, and no warm graph queries across sessions.
- This causes the main product bottlenecks:
  - symbol collisions across files and classes
  - no reliable "where do I start?" onboarding answer
  - no relationship-aware structured search
  - no change-aware workflow tied to git diffs
  - too much agent work still happens through repeated file reads instead of a stable graph abstraction

## Non-goals for this roadmap

- Do not add Cypher or a general graph query language
- Do not add background filesystem watching
- Do not add ADR persistence, runtime trace ingestion, or service-to-service HTTP inference
- Do not add external infrastructure or per-user global caches
- Do not expand language support aggressively before the graph-backed workflows are stable

## Public API target

### New workflow-first MCP tools

Add the following tools to `src/codetree/server.py`:

1. `get_repository_map(include: list[str] | None = None, max_items: int = 5) -> dict`
2. `resolve_symbol(query: str, kind: str | None = None, path_hint: str | None = None, limit: int = 10) -> dict`
3. `search_graph(query: str | None = None, kind: str | None = None, file_pattern: str | None = None, relationship: str | None = None, direction: str | None = None, min_degree: int | None = None, max_degree: int | None = None, limit: int = 10, offset: int = 0) -> dict`
4. `get_change_impact(symbol_query: str | None = None, diff_scope: str | None = None, depth: int = 3) -> dict`
5. `index_status() -> dict`

### Legacy tool strategy

- Keep all current tools available during migration.
- Rework the internals of these tools to use qualified symbol resolution once the graph exists:
  - `get_symbol`
  - `find_references`
  - `get_call_graph`
  - `get_blast_radius`
  - `find_tests`
  - `rank_symbols`
- Keep these primarily AST-backed:
  - `get_file_skeleton`
  - `get_skeletons`
  - `get_ast`
  - `detect_clones`
  - `get_variables`

### Output format policy

- New workflow tools should return structured JSON-first payloads.
- Default outputs must be token-capped and summary-oriented.
- Legacy text output can remain where convenient during transition, but new graph-backed behavior should be designed around typed internal data structures instead of string formatting.

## Data model and persistence plan

### New package

Create a new package:

- `src/codetree/graph/__init__.py`
- `src/codetree/graph/models.py`
- `src/codetree/graph/store.py`
- `src/codetree/graph/builder.py`
- `src/codetree/graph/queries.py`

### Storage location

- Store the graph in `.codetree/graph.db` under the current repo root.
- Keep the current `.codetree/index.json` cache only as a transition aid if needed; it should no longer be the primary source of truth for relationship-aware features.

### Schema

Create SQLite tables:

- `meta`
  - `schema_version`
  - `last_indexed_at`
  - `tool_version`
- `files`
  - `file_path`
  - `sha256`
  - `language`
  - `is_test`
  - `indexed_at`
- `symbols`
  - `qualified_name`
  - `name`
  - `kind`
  - `parent_qualified_name`
  - `file_path`
  - `start_line`
  - `end_line`
  - `language`
  - `doc`
  - `params`
  - `is_test`
  - `is_entry_point`
- `edges`
  - `source_qn`
  - `target_qn`
  - `type`
  - `weight`
  - `properties_json`

### Initial edge types

Only support these in the first graph milestone:

- `CALLS`
- `IMPORTS`
- `CONTAINS`
- `TESTS`

Anything else should be deferred until the graph-backed onboarding flow is stable.

### Qualified symbol identity

The current short-name-based resolution in `src/codetree/indexer.py` must stop being the authoritative identity mechanism.

Each extracted symbol must produce:

- `qualified_name`
- `name`
- `kind`
- `parent_qualified_name`
- `file_path`
- `start_line`
- `end_line`
- `language`
- `doc`
- `params`
- `is_test`
- `is_entry_point`

Qualified names must be deterministic and language-aware, but the first version can use a simple convention:

- top-level symbol: `path.module.Symbol`
- method: `path.module.Parent.method`
- nested symbol: append parent chain segments

The exact separator can be `.` throughout the implementation for consistency.

### Incremental indexing

- Hash every supported source file with `sha256`.
- On startup, compare the current repo snapshot with the `files` table.
- Reparse only changed or new files.
- Delete rows for removed files.
- Rebuild edges for changed files and any directly affected resolution targets.
- Do not implement filesystem watching. Freshness comes from explicit startup refresh and `index_status`.

## Implementation phases

### Phase 1: Persistent graph core

**Outcome:** graph persistence exists, qualified symbol identity exists, unchanged repos do not fully reparse.

**Files:**
- Create: `src/codetree/graph/models.py`
- Create: `src/codetree/graph/store.py`
- Create: `src/codetree/graph/builder.py`
- Create: `src/codetree/graph/queries.py`
- Modify: `src/codetree/indexer.py`
- Modify: `src/codetree/server.py`
- Modify: `src/codetree/languages/base.py`
- Modify: language plugins as needed to expose enough symbol metadata
- Test: `tests/test_graph_store.py`
- Test: `tests/test_graph_builder.py`

**Step 1: Write the failing graph store tests**

Add tests covering:
- database creation at `.codetree/graph.db`
- schema bootstrap
- symbol insert/query by qualified name
- edge insert/query

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_store.py -v
```

Expected:
- FAIL because the graph package and schema do not exist yet

**Step 2: Implement the minimal SQLite store**

Implement:
- schema creation
- open/close helpers
- upsert file rows
- replace symbols for one file
- replace edges for one file
- lookup by qualified name

**Step 3: Run graph store tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_store.py -v
```

Expected:
- PASS

**Step 4: Write the failing builder tests**

Add tests covering:
- initial full graph build
- warm build with unchanged files
- single-file change only reindexes that file
- deleted file removes symbol and edge rows

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_builder.py -v
```

Expected:
- FAIL because no builder exists

**Step 5: Implement qualified symbol extraction and graph build**

Implement:
- qualified-name generation
- file hashing
- changed-file detection
- graph row replacement for changed files
- graph-backed import/call edge emission

Use `src/codetree/indexer.py` as the adapter layer during transition, not as the final source of truth for graph features.

**Step 6: Run builder tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_builder.py -v
```

Expected:
- PASS

**Step 7: Commit**

```bash
git add src/codetree/graph src/codetree/indexer.py src/codetree/server.py src/codetree/languages/base.py tests/test_graph_store.py tests/test_graph_builder.py
git commit -m "feat: add persistent graph core for codetree"
```

### Phase 2: Repository onboarding workflows

**Outcome:** users can orient to a new repo without manually traversing files first.

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `src/codetree/graph/queries.py`
- Test: `tests/test_repository_map.py`
- Test: `tests/test_symbol_resolution.py`

**Step 1: Write failing tests for `get_repository_map`**

Cover:
- language summary
- top-level paths
- entry points
- hotspot symbols
- recommended `start_here` list
- token-lean defaults

Run:
```bash
source .venv/bin/activate
pytest tests/test_repository_map.py -v
```

Expected:
- FAIL because the tool does not exist

**Step 2: Implement repository map queries**

The tool should return:
- `languages`
- `major_paths`
- `entry_points`
- `hotspots`
- `top_symbols`
- `test_roots`
- `start_here`

Default behavior:
- max 5 items per section
- exclude tests from `start_here` unless the repo is test-only
- never include raw source

`start_here` ranking should combine:
- entry-point bias
- centrality / call-degree importance
- non-test preference
- stable tie-breaking by qualified name

**Step 3: Run repository map tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_repository_map.py -v
```

Expected:
- PASS

**Step 4: Write failing tests for `resolve_symbol`**

Cover:
- exact qualified-name match
- exact short-name match
- path-hinted disambiguation
- method disambiguation across classes
- source/test collision handling

Run:
```bash
source .venv/bin/activate
pytest tests/test_symbol_resolution.py -v
```

Expected:
- FAIL because no tool or resolver exists

**Step 5: Implement `resolve_symbol`**

Ranking order:
- exact qualified-name match
- exact short-name match inside `path_hint`
- exact short-name non-test match
- higher graph centrality
- alphabetical qualified-name tie-break

Return:
- single resolved match when confidence is clear
- ordered candidate list when ambiguous

**Step 6: Run symbol resolution tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_symbol_resolution.py -v
```

Expected:
- PASS

**Step 7: Commit**

```bash
git add src/codetree/server.py src/codetree/graph/queries.py tests/test_repository_map.py tests/test_symbol_resolution.py
git commit -m "feat: add workflow-first repository onboarding tools"
```

### Phase 3: Structured search and change impact

**Outcome:** codetree can answer relationship-aware questions and change impact questions without exposing a general graph query language.

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `src/codetree/graph/queries.py`
- Modify: `src/codetree/indexer.py`
- Test: `tests/test_search_graph.py`
- Test: `tests/test_change_impact.py`
- Test: `tests/test_legacy_graph_migration.py`

**Step 1: Write failing tests for `search_graph`**

Cover:
- text search over symbol names
- kind filtering
- file-pattern filtering
- relationship-aware degree filtering
- pagination
- stable ordering

Run:
```bash
source .venv/bin/activate
pytest tests/test_search_graph.py -v
```

Expected:
- FAIL because the tool does not exist

**Step 2: Implement `search_graph`**

Supported filters:
- `query`
- `kind`
- `file_pattern`
- `relationship`
- `direction`
- `min_degree`
- `max_degree`
- `limit`
- `offset`

Do not add free-form graph query syntax.

Default result payload:
- `total`
- `limit`
- `offset`
- `has_more`
- `results`

Each result should include:
- `qualified_name`
- `name`
- `kind`
- `file_path`
- `start_line`
- `end_line`
- `in_degree`
- `out_degree`

**Step 3: Run search tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_search_graph.py -v
```

Expected:
- PASS

**Step 4: Write failing tests for `get_change_impact`**

Cover both modes:
- explicit symbol query
- git diff / working tree mode

Cover output sections:
- changed symbols
- direct callers
- transitive callers
- affected tests
- risk buckets by hop

Run:
```bash
source .venv/bin/activate
pytest tests/test_change_impact.py -v
```

Expected:
- FAIL because the tool does not exist

**Step 5: Implement `get_change_impact`**

Rules:
- explicit symbol mode should resolve through `resolve_symbol`
- diff mode should inspect local git changes
- risk buckets are hop-based:
  - hop 1: critical
  - hop 2: high
  - hop 3: medium
  - hop 4+: low
- if impacted tests are known through `TESTS` edges, surface them separately

Keep the implementation generic. Do not add route or HTTP heuristics.

**Step 6: Run impact tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_change_impact.py -v
```

Expected:
- PASS

**Step 7: Write failing migration/regression tests for legacy graph-backed tools**

Cover:
- `get_symbol`
- `find_references`
- `get_call_graph`
- `get_blast_radius`
- `find_tests`
- `rank_symbols`

Specifically verify that duplicate short names no longer collide.

Run:
```bash
source .venv/bin/activate
pytest tests/test_legacy_graph_migration.py -v
```

Expected:
- FAIL because legacy tools still use short-name-only logic

**Step 8: Rework legacy internals to use graph-backed resolution**

Migrate the internal resolution path for the listed tools to:
- resolve symbol -> qualified symbol
- operate on graph-backed relationships
- preserve user-facing behavior where reasonable

**Step 9: Run migration tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_legacy_graph_migration.py -v
```

Expected:
- PASS

**Step 10: Commit**

```bash
git add src/codetree/server.py src/codetree/graph/queries.py src/codetree/indexer.py tests/test_search_graph.py tests/test_change_impact.py tests/test_legacy_graph_migration.py
git commit -m "feat: add graph search and change impact workflows"
```

### Phase 4: Post-stability breadth expansion

**Outcome:** once the new core is stable, add a small language tranche without destabilizing onboarding features.

**Files:**
- Modify: `src/codetree/registry.py`
- Create: new language plugins as chosen
- Test: per-language tests

**Step 1: Add one language after graph stabilization**

Default language order:
1. C#
2. PHP

Do not start this phase until:
- graph builder tests pass
- repository map tests pass
- search and impact tests pass

**Step 2: Add per-language symbol identity and edge extraction tests**

Graph-specific tests must verify:
- qualified-name stability
- symbol extraction
- import edges
- call edges
- test-file detection

**Step 3: Commit**

```bash
git add src/codetree/registry.py src/codetree/languages tests/languages
git commit -m "feat: extend graph workflows to an additional language"
```

## Acceptance criteria

The roadmap is complete when all of the following are true:

- A new repo gets a persistent `.codetree/graph.db`
- Reopening the same repo without changes does not reparse everything
- `get_repository_map` gives a useful, compact "where should I start?" answer
- `resolve_symbol` reliably disambiguates duplicate short names
- `search_graph` can answer relationship-aware search questions with pagination
- `get_change_impact` works for both explicit symbols and local git changes
- legacy relationship-heavy tools no longer rely on short-name-only identity
- AST-heavy tools still work without regression

## Test scenarios that must exist

- same symbol name in multiple files
- same method name in multiple classes
- source symbol and test symbol with same short name
- repo with no obvious entry point
- repo with multiple entry points
- repo with only a few files
- repo with deleted files between index runs
- repo with renamed files between index runs
- repo with unchanged files across warm starts

## Assumptions

- The graph remains repo-local, not shared across repositories.
- SQLite from the stdlib is sufficient for the first major version.
- Workflow value matters more than query-language power.
- Generic repo onboarding is the primary product differentiator.
- Background watchers, service topology heuristics, and ADR memory are intentionally excluded from this roadmap.
- Current tools may be internally redesigned, but migration should avoid unnecessary removals until the new workflow tools are proven in use.

## Review guidance

When reviewing this plan, focus on these questions first:

1. Is the product direction right: workflow-first onboarding instead of raw graph power?
2. Is the scope right: graph core + onboarding + search + impact, without HTTP/ADR/Cypher?
3. Is the persistence model right: repo-local SQLite under `.codetree/graph.db`?
4. Is the phase ordering right: identity first, onboarding second, search/impact third, breadth later?
5. Are there any existing codetree strengths that should be promoted more aggressively into the onboarding flow?

