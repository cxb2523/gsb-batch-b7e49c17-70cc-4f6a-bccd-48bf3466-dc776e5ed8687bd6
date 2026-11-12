---
phase: 01-critical-safety
plan: 01
subsystem: database
tags: [sqlite, threading, concurrency, graphstore, mcp]

# Dependency graph
requires: []
provides:
  - Thread-safe GraphStore with threading.Lock protecting all _conn and _in_transaction accesses
  - Regression test suite (7 tests) proving concurrent SQLite access is safe
affects: [02-high-quality, graph-layer, mcp-tools]

# Tech tracking
tech-stack:
  added: [threading (stdlib)]
  patterns: [Lock-per-instance for SQLite thread safety, inline auto-commit to avoid deadlock]

key-files:
  created:
    - tests/test_concurrency.py
  modified:
    - src/codetree/graph/store.py

key-decisions:
  - "Use threading.Lock (not RLock) — no method calls another self.method while holding the lock, so re-entrancy is not needed"
  - "Inline auto-commit logic inside each mutating method's with self._lock block to avoid deadlock (instead of calling _auto_commit() inside a locked block)"
  - "execute() uses double-check pattern: check conn outside lock, call open() (which acquires lock), then re-enter lock for execute — avoids deadlock with non-reentrant lock"

patterns-established:
  - "All GraphStore methods that touch self._conn or self._in_transaction wrap their entire body in with self._lock"
  - "Mutating methods inline: if not self._in_transaction: self._conn.commit() rather than calling self._auto_commit()"

requirements-completed: [CONC-01, CONC-02]

# Metrics
duration: 3min
completed: 2026-04-05
---

# Phase 01 Plan 01: GraphStore Thread Safety Summary

**threading.Lock added to GraphStore with 23 protected critical sections, eliminating SQLite database-is-locked errors under concurrent MCP tool calls**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-05T13:40:13Z
- **Completed:** 2026-04-05T13:43:36Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added `self._lock = threading.Lock()` to GraphStore.__init__ and wrapped 23 critical sections with `with self._lock:`
- Eliminated potential "database is locked" errors and _in_transaction flag races under concurrent FastMCP tool calls
- Created 7-test regression suite using real `threading.Thread` objects (not mocks) at both unit and MCP integration levels
- All 1065 tests pass (1058 pre-existing + 7 new concurrency tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add threading.Lock to GraphStore and protect all _conn accesses** - `7d51010` (feat)
2. **Task 2: Write concurrent-access regression tests** - `2af8f3f` (test)

**Plan metadata:** (docs commit — see final_commit step)

## Files Created/Modified
- `src/codetree/graph/store.py` - Added `import threading`, `self._lock = threading.Lock()` in `__init__`, wrapped all 15 methods with `with self._lock:`, inlined auto-commit logic in all mutating methods
- `tests/test_concurrency.py` - 7 tests in TestGraphStoreConcurrency: concurrent upserts, concurrent reads, read/write mix, _in_transaction flag safety, concurrent execute(), lock attribute check, MCP integration test

## Decisions Made
- Used `threading.Lock` (not `threading.RLock`) because no method calls another self.method while holding the lock; re-entrancy is not needed and a plain Lock provides simpler semantics
- Inlined auto-commit logic (`if not self._in_transaction: self._conn.commit()`) directly inside each mutating method's `with self._lock:` block rather than calling `_auto_commit()` — this avoids deadlock since `_auto_commit()` also acquires the lock
- The `execute()` method uses a careful pattern: check `self._conn is None` outside the lock, then call `open()` (which acquires the lock) if needed, then re-enter the lock for the actual execute — this avoids deadlock with the non-reentrant lock

## Deviations from Plan

None — plan executed exactly as written. The `execute()` method required slightly more careful thought around the open() call path, but the final implementation matches the plan's intent.

## Issues Encountered
- The worktree's editable install points to the main repo (`/Users/kartik/Developer/understandCode`), not the worktree. Used `PYTHONPATH=/path/to/worktree/src` when running tests to ensure the worktree's modified files were tested.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- GraphStore is now thread-safe; phase 01-02 can address any remaining critical safety issues
- The lock pattern established here (per-instance Lock, inline auto-commit) should be used as the template for any future database access additions

---
*Phase: 01-critical-safety*
*Completed: 2026-04-05*

## Self-Check: PASSED

- FOUND: src/codetree/graph/store.py
- FOUND: tests/test_concurrency.py
- FOUND: .planning/phases/01-critical-safety/01-01-SUMMARY.md
- FOUND commit: 7d51010 (feat: add threading.Lock)
- FOUND commit: 2af8f3f (test: concurrency tests)
