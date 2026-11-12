# Milestones

## v1.0 Production Hardening (Shipped: 2026-04-05)

**Phases completed:** 2 phases, 4 plans, 6 tasks

**Key accomplishments:**

- threading.Lock added to GraphStore with 23 protected critical sections, eliminating SQLite database-is-locked errors under concurrent MCP tool calls
- Path traversal and absolute path rejection added to all 15 file_path MCP tools via _validate_path() helper using Path.resolve().relative_to() — 42 regression tests, 1100 tests passing
- `_rebuild_definitions()` method
- try/except around extract_skeleton() in build() — plugin crash skips one file with has_errors=True, server continues indexing remaining files

---
