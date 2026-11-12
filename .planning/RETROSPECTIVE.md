# Retrospective

## Milestone: v1.0 — Production Hardening

**Shipped:** 2026-04-05
**Phases:** 2 | **Plans:** 4

### What Was Built
- `threading.Lock` on all 23 GraphStore methods — eliminates SQLite corruption under concurrent MCP calls
- `_validate_path()` on all 15 file_path tools — rejects path traversal and absolute paths
- `_rebuild_definitions()` with qualified `file::name` keys — no duplicates, no ghosts, no name collisions
- `_name_to_qualified` secondary index — O(1) callee resolution in call graph
- try/except in `build()` — plugin crashes skip file gracefully, server continues

### What Worked
- Codebase audit upfront (CONCERNS.md) gave clear, prioritized issue list — no guessing
- Plan checker caught real issues: missing tests, incorrect grep criteria, DATA-03 unfixable via keys alone
- Worktree isolation for parallel execution — clean merges, no conflicts
- TDD approach (RED then GREEN) confirmed bugs exist before fixing

### What Was Inefficient
- Phase 2 Wave 2 worktree committed directly to main instead of its branch — caused merge confusion
- One flaky concurrency test (timing-dependent) — passed in isolation, failed once in full suite

### Patterns Established
- Qualified keys (`file::name`) as the standard for definition lookups
- `_rebuild_definitions()` as single source of truth for definition index
- `_validate_path()` pattern for all path-accepting tools

### Key Lessons
- The original `--root` bug was purely a config issue — code was fine, registration was wrong
- Thread safety via simple Lock is sufficient for MCP's concurrency model (no need for connection pooling)
- Testing actual failure modes (real threads, real malicious paths) catches bugs that happy-path tests miss

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 2 |
| Plans | 4 |
| Tests added | 58 |
| Total tests | 1116 |
| Regressions | 0 |
