# codetree

## What This Is

codetree is a Python MCP server that gives coding agents structured code understanding via tree-sitter. It exposes 23 tools over MCP for structural analysis, graph queries, and onboarding — letting agents ask precise questions about code instead of reading entire files.

## Core Value

Every MCP tool call returns correct, trustworthy data — agents can rely on codetree without worrying about stale state, silent failures, or wrong results.

## Requirements

### Validated

- ✓ `.codetree` added to SKIP_DIRS — v1.0
- ✓ `cache.load()` handles corrupt JSON gracefully — v1.0
- ✓ `--root` defaults to cwd instead of hardcoded path — v1.0
- ✓ MCP registration removed hardcoded `--root` — v1.0
- ✓ SQLite GraphStore is thread-safe for concurrent MCP tool calls — v1.0
- ✓ All tool `file_path` inputs are validated against path traversal — v1.0
- ✓ Definition index has no duplicates after cache injection — v1.0
- ✓ Stale definitions from deleted files are cleaned up — v1.0
- ✓ Symbol resolution uses qualified names, not bare names — v1.0
- ✓ Plugin errors during indexing don't crash the server — v1.0

### Active

(None — next milestone will define new requirements)

### Out of Scope

- Performance optimization (#20 find_references) — functional, just slow on large repos
- Silent failure improvements (#6, #7) — return empty data (not wrong data); lower risk
- Taint analysis completeness (#19) — feature enhancement, not a bug
- Complexity for all languages (#22) — feature gap, not a bug
- Schema version enforcement (#11) — no schema changes planned
- Cache mtime-only validation (#10) — extremely rare edge case
- Low-priority tech debt (#15-18, #25-27) — not user-facing

## Context

- Python project: 23 MCP tools, **1116 tests**, 10 language plugins
- Uses FastMCP 3.1.0 with stdio transport
- SQLite graph database at `.codetree/graph.db` — thread-safe via `threading.Lock`
- All `file_path` tool inputs validated against path traversal
- Definition index uses qualified `file::name` keys with `_name_to_qualified` secondary index
- Plugin crashes in `extract_skeleton()` are caught — server continues with `has_errors=True`

## Constraints

- **Testing**: All changes must have tests; 1116 tests must continue passing
- **Backward compat**: No changes to MCP tool signatures (agents already use them)
- **Performance**: Server startup must stay under ~2s for typical repos

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Scope to Critical + High only | Focus on issues that cause wrong data or crashes, skip tech debt | ✓ Good — shipped all 7 requirements |
| Skip already-fixed issues | cache.load(), .codetree SKIP_DIRS, --root default already done | ✓ Good |
| Thread safety via locking, not connection pooling | Simpler, lower risk for MCP use case | ✓ Good — 23 lock blocks, no deadlocks |
| Qualified name resolution in indexer | Graph layer already uses qualified names; align indexer | ✓ Good — `file::name` keys + secondary index |
| `_rebuild_definitions()` single-pass rebuild | Eliminates incremental mutation bugs (duplicates, ghosts) | ✓ Good — clean separation of concerns |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-04-05 after v1.0 milestone*
