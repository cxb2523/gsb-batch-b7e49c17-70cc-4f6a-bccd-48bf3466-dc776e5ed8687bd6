# Roadmap: codetree Production Hardening

## Overview

Two phases deliver the full hardening effort. Phase 1 eliminates the critical risks: concurrent MCP tool calls can corrupt the SQLite database without a lock, and agents can read arbitrary files outside the repo via path traversal. Phase 2 fixes the high-priority data correctness issues: the definition index accumulates duplicates and ghost symbols, name-collision causes wrong dead-code results, and any plugin crash tears down the whole server. Both phases add regression tests so the existing 1070-test suite remains the quality gate.

## Phases

- [x] **Phase 1: Critical Safety** - Thread-safe SQLite and path traversal validation for all tool inputs
- [ ] **Phase 2: Data Integrity** - Correct definition index (no duplicates, no ghosts, qualified names) and plugin crash protection

## Phase Details

### Phase 1: Critical Safety
**Goal**: Concurrent MCP tool calls cannot corrupt SQLite state, and no tool can read files outside the repo root
**Depends on**: Nothing (first phase)
**Requirements**: CONC-01, CONC-02, SEC-01
**Success Criteria** (what must be TRUE):
  1. Two simultaneous calls to any graph tool (e.g., search_graph + git_history) complete without "database is locked" errors or mixed results
  2. The `_in_transaction` flag can be read and written from multiple threads without a race condition
  3. Calling any file_path tool with `"../../../etc/passwd"` or an absolute path returns an error, not file content
  4. All existing 1070+ tests continue to pass after the fix
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Add threading.Lock to GraphStore; concurrent-access regression tests
- [x] 01-02-PLAN.md — Add _validate_path to all file_path tools; path traversal regression tests

### Phase 2: Data Integrity
**Goal**: The definition index reflects only current files with unique, qualified symbols, and plugin errors do not crash the server
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, ROBUST-01
**Success Criteria** (what must be TRUE):
  1. After a file is cached and then re-indexed in the same build, its symbols appear exactly once in `_definitions`
  2. Symbols from a file deleted between runs do not appear in find_references() or find_dead_code() results
  3. When two files both define a function named `add()`, find_references("add") and find_dead_code() distinguish between them by file-qualified lookup
  4. A plugin that raises an unexpected exception during extract_skeleton() causes that file to be skipped with has_errors=True, and the server continues indexing remaining files
  5. All existing 1070+ tests continue to pass after the fixes
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Fix _definitions: qualified keys, no duplicates, no ghost symbols (DATA-01, DATA-02, DATA-03)
- [x] 02-02-PLAN.md — Wrap extract_skeleton() in try/except; plugin crash protection (ROBUST-01)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Critical Safety | 2/2 | Complete | 2026-04-05 |
| 2. Data Integrity | 0/2 | Not started | - |
