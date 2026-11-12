---
phase: 02-data-integrity
plan: "02"
subsystem: indexer
tags: [indexer, error-handling, robustness, tree-sitter, plugin]

# Dependency graph
requires:
  - phase: 02-01
    provides: qualified definition index (_definitions, _name_to_qualified, _rebuild_definitions)
provides:
  - try/except around extract_skeleton() in build() — plugin crash skips file, server continues
  - ROBUST-01 regression tests (3 tests) — plugin crash scenarios with real exception types
affects:
  - any phase that calls build() or relies on indexer startup not crashing

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defensive plugin invocation: wrap plugin calls in try/except Exception — crash skips file with has_errors=True, indexing continues"

key-files:
  created:
    - tests/test_data_integrity.py (ROBUST-01 section appended)
  modified:
    - src/codetree/indexer.py (try/except added in build())

key-decisions:
  - "Use except Exception (not BaseException or except *): MemoryError is a subclass of Exception in Python 3; catches all standard exceptions while not masking KeyboardInterrupt/SystemExit"
  - "Store crashing file in _index with skeleton=[] and has_errors=True rather than omitting it — callers can check entry.has_errors to warn about the file"

patterns-established:
  - "Plugin defensive wrapping: both extract_skeleton() and check_syntax() are wrapped in a single try/except block — if either fails, the file gets skeleton=[] and has_errors=True"

requirements-completed:
  - ROBUST-01

# Metrics
duration: 2min
completed: "2026-04-05"
---

# Phase 02 Plan 02: Plugin Crash Isolation Summary

**try/except around extract_skeleton() in build() — plugin crash skips one file with has_errors=True, server continues indexing remaining files**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-05T14:15:36Z
- **Completed:** 2026-04-05T14:17:26Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments

- Plugin crash (RuntimeError, ValueError, MemoryError, AttributeError) in `extract_skeleton()` or `check_syntax()` no longer propagates out of `build()` and crashes the MCP server at startup
- Affected file is still added to `_index` with `skeleton=[]` and `has_errors=True` so callers can detect the skipped file
- Indexing continues for all files after the crashing one — no data loss for healthy files
- 3 ROBUST-01 regression tests added with real monkeypatching of the plugin class via subclassing

## Task Commits

1. **Task 1: Write ROBUST-01 regression tests (RED phase)** - `7307b02` (test)
2. **Task 2: Add try/except around extract_skeleton() in build() (GREEN phase)** - `9f8a3d2` (fix)

**Plan metadata:** (pending docs commit)

_Note: TDD workflow — tests committed first in failing state, then implementation committed to make them pass._

## Files Created/Modified

- `src/codetree/indexer.py` - Added try/except Exception block wrapping `plugin.extract_skeleton(source)` and `plugin.check_syntax(source)` in `build()` method
- `tests/test_data_integrity.py` - Appended 3 ROBUST-01 tests: `test_plugin_exception_skips_file`, `test_plugin_memoryerror_skips_file`, `test_plugin_exception_server_continues_indexing`

## Decisions Made

- **except Exception (not BaseException):** `MemoryError` is a subclass of `Exception` in Python 3 (`issubclass(MemoryError, Exception) == True`), so `except Exception` catches all standard crash types. This also preserves `KeyboardInterrupt` and `SystemExit` as unmasked so the server can be stopped normally.
- **File kept in _index with has_errors=True:** Rather than omitting the crashing file entirely, it is added to `_index` with an empty skeleton and `has_errors=True`. This matches the existing convention (syntax errors also set `has_errors=True`) and allows tools to detect and report the problem.
- **Both extract_skeleton and check_syntax in same try block:** If `check_syntax` itself crashes, we still want to mark the file as errored and continue. Putting both calls inside the same try block handles this uniformly.

## Deviations from Plan

None - plan executed exactly as written. The test code and implementation block in the plan matched what was needed.

## Issues Encountered

None. The fix was a minimal targeted change to 2 lines in `build()`, and the tests matched the plan specification exactly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 active requirements (DATA-01, DATA-02, DATA-03, ROBUST-01) are now fixed and tested
- Phase 02 is complete — 9 tests in test_data_integrity.py, all passing
- Full suite: 1116 tests pass (0 failures, 0 regressions)
- PROJECT.md should have ROBUST-01 moved from Active to Validated

---
*Phase: 02-data-integrity*
*Completed: 2026-04-05*

## Self-Check: PASSED

- FOUND: src/codetree/indexer.py
- FOUND: tests/test_data_integrity.py
- FOUND: .planning/phases/02-data-integrity/02-02-SUMMARY.md
- FOUND commit: 7307b02 (test — ROBUST-01 RED phase)
- FOUND commit: 9f8a3d2 (fix — try/except GREEN phase)
- `grep "except Exception" src/codetree/indexer.py` → line 118: present
- `grep -c "^def test_" tests/test_data_integrity.py` → 9 (expected 9)
