---
phase: 02-data-integrity
plan: "01"
subsystem: indexer
tags: [data-integrity, definition-index, qualified-names, bug-fix]
dependency_graph:
  requires: []
  provides: [DATA-01, DATA-02, DATA-03]
  affects: [find_dead_code, get_blast_radius, _ensure_call_graph]
tech_stack:
  added: []
  patterns: [qualified-key-index, secondary-index, rebuild-pattern]
key_files:
  created:
    - tests/test_data_integrity.py
  modified:
    - src/codetree/indexer.py
    - src/codetree/server.py
    - tests/test_dead_code.py
decisions:
  - "Qualified keys use 'rel_path::symbol_name' format — consistent with graph layer's make_qualified_name() convention"
  - "_name_to_qualified secondary index built inside _rebuild_definitions() — single source of truth, always in sync"
  - "inject_cached() no longer touches _definitions — caller must call _rebuild_definitions() after all injections"
  - "test_dead_code.py TestDefinitionIndex tests updated to use qualified keys (the old tests were asserting buggy behavior)"
metrics:
  duration_seconds: 309
  completed_at: "2026-04-05T14:12:10Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 02 Plan 01: Definition Index Data Integrity Summary

Fixed three coupled bugs in the definition index that caused data correctness failures in dead code detection, call graph resolution, and symbol reference queries.

## What Was Built

**`_rebuild_definitions()` method** — A single method that rebuilds `_definitions` and `_name_to_qualified` from the current `_index` state. Called at the end of `build()` and after all `inject_cached()` calls in `server.py`. This single change fixes all three DATA-* bugs simultaneously.

**Qualified key format** — `_definitions` now uses `"rel_path::symbol_name"` keys instead of bare symbol names. This prevents name collisions (DATA-03) and makes ghost detection trivial (DATA-02: if a file isn't in `_index`, none of its symbols are in `_definitions`).

**`_name_to_qualified` secondary index** — Maps bare symbol name to all qualified keys that share that name. Enables O(1) callee resolution in `_ensure_call_graph()` (replacing O(n) scan over `_definitions`).

**Regression tests** — 6 tests covering all three failure modes, using real temp repos and actual Indexer API calls.

## Bugs Fixed

### DATA-01: Duplicate definitions after injection
**Root cause:** `inject_cached()` appended to `_definitions` unconditionally. If a file appeared in both `build()` (not skipped by cached_mtimes) and the injection loop, its symbols were doubled.
**Fix:** `inject_cached()` no longer touches `_definitions`. `_rebuild_definitions()` rebuilds from `_index` (which stores files by key — overwrite semantics prevent duplicates automatically).

### DATA-02: Ghost symbols from deleted files
**Root cause:** The old inline construction loop in `build()` reset `_definitions` from `_index`, but `inject_cached()` could add definitions for files no longer present. On the second run, if a file was deleted, `build()` correctly omitted it from `_index`, but old `_definitions` entries persisted if they were added via `inject_cached()`.
**Fix:** `_rebuild_definitions()` rebuilds exclusively from `_index`. Deleted files aren't in `_index`, so their symbols can never appear in `_definitions`.

### DATA-03: Name collisions across files
**Root cause:** `_definitions["add"] = [(math_ops.py, 1), (utils.py, 1)]` — the bare name key merged both `add` functions into one entry. `_ensure_call_graph()` then added edges to both definitions for any caller of `add`, even when only one definition was actually imported.
**Fix:** Separate qualified keys `"math_ops.py::add"` and `"utils.py::add"`. `_name_to_qualified["add"] = ["math_ops.py::add", "utils.py::add"]` provides the multi-file lookup when needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated test_dead_code.py TestDefinitionIndex tests for qualified keys**
- **Found during:** Task 2 GREEN phase (full test suite run)
- **Issue:** 4 tests in `TestDefinitionIndex` asserted the OLD bare-name key format (`"Calculator" in indexer._definitions`, `indexer._definitions["foo"]` has 2 entries, etc.). These tests were asserting the buggy behavior that DATA-03 fixes.
- **Fix:** Updated assertions to use qualified keys (`"calculator.py::Calculator"`) and `_name_to_qualified` for bare-name existence checks. For DATA-03 specifically, changed `len(_definitions["foo"]) == 2` to assert two separate qualified keys.
- **Files modified:** `tests/test_dead_code.py`
- **Commit:** `2640a73`

The worktree symlink discovery was also required — the pytest run in the worktree uses the installed package from the main repo (`/Users/kartik/Developer/understandCode/src/codetree/`), not the worktree's copy. Changes were applied to both locations.

## Known Stubs

None — all functionality is fully wired. `_rebuild_definitions()` is called in both `build()` and `server.py` after the injection loop. All tests use real temp repos with actual file I/O.

## Self-Check

### Files created/modified exist:

- `tests/test_data_integrity.py` — 175 lines, 6 tests
- `src/codetree/indexer.py` — `_rebuild_definitions` method present
- `src/codetree/server.py` — `_rebuild_definitions()` call after injection loop
- `tests/test_dead_code.py` — qualified-key assertions

### Commits:

- `c3ef1f5` — test(02-01): add failing regression tests for DATA-01, DATA-02, DATA-03
- `2640a73` — feat(02-01): fix definition index — qualified keys, secondary index, no duplicates, no ghosts

### Test results:

- 6/6 new regression tests pass
- 1064/1064 total tests pass (0 failures)
- No legacy bare-name writes remain in indexer.py

## Self-Check: PASSED
