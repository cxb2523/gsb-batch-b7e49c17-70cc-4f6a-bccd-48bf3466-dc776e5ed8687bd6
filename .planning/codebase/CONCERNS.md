# Codebase Concerns

**Analysis Date:** 2026-04-03

## Critical Issues

### 1. Cache Corruption Crashes Entire Server

**Issue:** `Cache.load()` in `src/codetree/cache.py` silently suppresses all errors on `json.loads()`, but the server can still crash if the cache file is corrupted and not caught at write time.

**Files:** `src/codetree/cache.py:11-17`

**Impact:** A corrupted `.codetree/index.json` will silently fail to load (returning empty dict), causing stale skeletons to be returned to agents. If a partial write occurs (file written but incomplete), subsequent agents see incomplete data.

**Current mitigation:** Lines 14-17 catch `JSONDecodeError` and `OSError`, but these are *after* the exception. If another exception type occurs (e.g., `MemoryError` on huge files), it propagates uncaught.

**Fix approach:**
- Validate JSON file integrity on load: check file size, attempt parse in try block
- Add a schema version field to cache to detect incompatible formats
- Write to temporary file then atomic rename on save (line 22)
- Log cache load failures instead of silent suppression

---

### 2. Definition Index Duplication on Cached Injection

**Issue:** When `inject_cached()` is called in `server.py:32-38`, symbols are added to `_definitions` dict WITHOUT checking if they already exist from `build()`.

**Files:** `src/codetree/indexer.py:122-126`, `src/codetree/server.py:23-38`

**Code flow:**
1. Line 20: `indexer.build(cached_mtimes=cached_mtimes)` — populates `_definitions` from indexed files (lines 98-104)
2. Line 24-38: Loop over cache, calling `inject_cached()` for each unchanged file
3. `inject_cached()` line 122-126: **Unconditionally appends** to `_definitions[name]`

**Impact:** If a file was in cache AND is re-indexed in build(), its definition appears twice:
```python
_definitions["my_func"] = [("file.py", 5), ("file.py", 5)]  # DUPLICATE!
```

This breaks `find_references()` (line 138-143) and `find_dead_code()` (line 208-213) — they see duplicate refs and may incorrectly mark dead code as "alive" or report false positive references.

**Risk:** HIGH — affects correctness of dead code detection and reference finding

**Fix approach:**
- Track injected paths separately: `_injected_paths = set()`
- Check `if rel_path not in _injected_paths` before appending to `_definitions`
- Or: Only inject cached entries that were NOT in `build()` output

---

### 3. Stale Definition Index on Cache Misses

**Issue:** In `server.py:23-38`, files in cache that are **not** in the current indexed set are injected. But the definition index is built ONCE in `build()` (line 20), and injected items update `_definitions` (line 126). This creates an inconsistent state.

**Files:** `src/codetree/indexer.py:98-104`, `src/codetree/server.py:23-38`

**Scenario:**
1. First run: indexes 100 files, cache contains 100 entries
2. Next run: User deletes a file (`old_file.py`), changes another
3. Line 20: `build()` finds 99 files, updates `_definitions` with 99 files
4. Line 24-38: `inject_cached()` restores `old_file.py`'s symbols into `_definitions`
5. Result: `_definitions` now has stale symbols from deleted files

**Impact:** MEDIUM — `find_references()` and `find_dead_code()` will incorrectly report references/dead code for symbols from deleted files.

**Fix approach:**
- After `inject_cached()` completes, don't rely on cached state for definition lookups
- Rebuild `_definitions` once after all injections: loop `_index.items()` and rebuild dict
- Or: Make `inject_cached()` only update `_index`, then rebuild `_definitions` once after the loop

---

### 4. SQLite Check Same Thread Disabled Without Locking

**Issue:** `GraphStore.open()` uses `check_same_thread=False` (line 62) to allow concurrent MCP tool calls, but there is NO mutex/lock protecting the SQLite connection.

**Files:** `src/codetree/graph/store.py:62`

**Impact:** CRITICAL — When two MCP tool calls run concurrently:
- Thread A: `search_graph()` → `conn.execute()`
- Thread B: `git_history()` → `conn.execute()`
- SQLite can return mixed/corrupted results or raise "database is locked" errors

**Current state:** `_in_transaction` flag (line 58) is NOT thread-safe. Multiple threads can flip it simultaneously.

**Risk:** Data corruption, race conditions on concurrent queries, uncommitted transactions blocking other threads.

**Fix approach:**
- Add `threading.Lock()` to `GraphStore.__init__()`: `self._lock = threading.Lock()`
- Wrap all `self._conn.execute()` calls with `with self._lock:`
- Or: Use connection pooling (e.g., `sqlite3.threadsafety` mode 3) with thread-local connections
- Or: Force single-threaded MCP (set `max_concurrent=1` in FastMCP)

---

### 5. Path Traversal Vulnerability in Tool Inputs

**Issue:** Tool functions like `get_file_skeleton(file_path: str)` accept arbitrary strings from agents without validating they stay within the repo root.

**Files:** `src/codetree/server.py:115, 131, 161, 192`, and many more

**Attack scenario:**
- Agent calls: `get_file_skeleton("../../../etc/passwd")`
- Indexer will construct: `root_path / "../../../etc/passwd"` = `/etc/passwd`
- Tree-sitter parses system files instead of repo files

**Current protection:** Indexer calls `_should_skip()` during build (line 78), but this only affects initial indexing. Tools accept any path string without validation.

**Impact:** HIGH — agents can read arbitrary files on the filesystem via MCP tools.

**Fix approach:**
- Validate all `file_path` inputs: check no `..` components, no absolute paths
- Use `Path(file_path).resolve().relative_to(root_path)` and catch `ValueError` if it escapes
- Or: Pre-build a whitelist of valid paths during `build()` and check against it

---

### 6. Silent Failures Return Empty Data Instead of Errors

**Issue:** Functions return `None` or `[]` on errors, making it invisible to agents when tools fail.

**Files:** Multiple:
- `indexer.py:269-278`: `get_ast()` returns `None` if file not found (silent)
- `indexer.py:281-289`: `get_variables()` returns `None` if file not found (silent)
- `graph/git_analysis.py:8-18`: `_run_git()` returns `None` on subprocess failure (silent)

**Impact:** Agents receive `None` or empty lists and continue, unaware the query failed. This leads to incomplete analysis (e.g., `git_history()` returns `[]` if repo is not a git repo, but agent doesn't know why).

**Risk:** MEDIUM — agents may trust incomplete results and make wrong decisions based on "no data" responses.

**Fix approach:**
- Raise descriptive exceptions instead of returning `None`
- Return `{"error": "reason"}` dicts in API responses
- Server catches exceptions and formats them into error messages back to agents

---

### 7. Git Commands Fail Silently on Non-Git Repos

**Issue:** `git_history()` tool (server.py:618-675) calls git commands, but `_run_git()` (git_analysis.py:8-18) silently returns `None` if git fails.

**Files:** `src/codetree/graph/git_analysis.py:8-18`, `src/codetree/server.py:630-675`

**Scenario:**
1. Agent runs MCP server on non-git directory
2. Calls `git_history(mode="blame", file_path="src/main.py")`
3. `_run_git()` fails (returncode != 0), returns `None`
4. `get_blame()` line 34 returns `{"lines": [], "summary": {}}` (silent empty response)
5. Agent gets empty results, doesn't know the directory isn't a git repo

**Impact:** MEDIUM — agents can't distinguish between "no git data" and "not a git repo".

**Fix approach:**
- Check `git status` or `git rev-parse --git-dir` at server startup
- Raise error if git tools are requested on non-git repo
- Or: Return error dict: `{"error": "Not a git repository"}`

---

### 8. Cache Injection Doesn't Validate File Existence

**Issue:** `server.py:28-38` reads `py_file` again from disk (`line 35: py_file.read_bytes()`) even after checking existence (line 29).

**Files:** `src/codetree/server.py:28-35`

**Code:**
```python
if py_file.exists():  # line 29 — file exists
    mtime = py_file.stat().st_mtime  # line 30 — stat works
    if cache.is_valid(rel_path, mtime):  # line 31
        indexer.inject_cached(
            source=py_file.read_bytes(),  # line 35 — FILE COULD BE DELETED HERE!
```

**Race condition:** Between line 30 (`stat()`) and line 35 (`read_bytes()`), the file could be deleted by another process.

**Impact:** LOW — `read_bytes()` raises `FileNotFoundError`, crashing server startup.

**Fix approach:**
- Read file ONCE and reuse: `source = py_file.read_bytes()` before checking mtime
- Or: Wrap in try/except, skip file if it disappears

---

### 9. Duplicate Symbol Names Across Files Break Resolution

**Issue:** `find_references()` and `find_dead_code()` use simple name-based lookup (`_definitions[name]`), but don't distinguish between symbols in different files or namespaces.

**Files:** `src/codetree/indexer.py:138-143, 199-223`

**Scenario:** Multiple files define `add()`:
- `math.py` defines `add(a, b)`
- `utils.py` defines `add(list1, list2)`

When agent calls `find_references("add")`, the indexer returns all usages of ANY `add()`, conflating the two symbols.

**Impact:** HIGH — correct identification of dead code and references becomes impossible with name collisions.

**Risk:** False positives in dead code detection; incorrect call graphs.

**Fix approach:**
- Use qualified names in `_definitions`: `_definitions["math.add"] = [...], _definitions["utils.add"] = [...]`
- Or: Return tuples of (file, name) in reference results and let agent disambiguate
- Better: Move to graph-based queries (already in `GraphQueries`) for qualified name resolution

---

### 10. Cached Skeletons Not Validated Against Actual Source

**Issue:** `inject_cached()` trusts the cached skeleton without re-parsing. If the cache is stale or corrupted, agents get wrong info about the file.

**Files:** `src/codetree/indexer.py:106-126`

**Scenario:**
1. Cache stores skeleton for `main.py` at mtime 123456
2. File is edited (mtime 123457) but externally reverted to old content (mtime 123456 again)
3. File now differs from skeleton, but cache is "valid" (mtime matches)
4. Skeleton is stale; agents get old function signatures

**Impact:** MEDIUM — skeleton data can become inconsistent with actual file content.

**Fix approach:**
- Add SHA256 hash to cache, not just mtime
- Validate: `cache.is_valid()` should check both mtime AND hash
- Or: Remove caching for skeletons; reparse always (performance trade-off)

---

### 11. Graph Store Schema Version Not Enforced

**Issue:** `GraphStore.open()` checks schema version (lines 67-73) but only **inserts** it if missing; doesn't **enforce** compatibility on open.

**Files:** `src/codetree/graph/store.py:60-73`

**Scenario:**
1. Run with codetree v1, creates graph.db with schema_version="1"
2. Upgrade to v2 (different schema)
3. Open graph.db with v2 code
4. Code doesn't check if stored version != current SCHEMA_VERSION
5. Queries run against incompatible schema → silent data corruption or crashes

**Impact:** MEDIUM — schema migrations break silently; database becomes unusable after version upgrade.

**Fix approach:**
- Read schema_version on open: `cur.execute("SELECT value FROM meta WHERE key='schema_version'")`
- Raise error if version != SCHEMA_VERSION
- Or: Implement schema migration logic (e.g., `v1_to_v2()`)

---

### 12. Subprocess Commands Not Validated for Shell Injection

**Issue:** `_symbols_from_diff()` in `queries.py:287-308` builds git command with user input (`diff_scope`).

**Files:** `src/codetree/graph/queries.py:291-296`

**Code:**
```python
if diff_scope == "working":
    cmd = ["git", "diff", "--name-only"]
elif diff_scope == "staged":
    cmd = ["git", "diff", "--staged", "--name-only"]
else:
    cmd = ["git", "diff", diff_scope, "--name-only"]  # ARBITRARY STRING!
```

**Risk:** If agent passes `diff_scope = "; rm -rf /"`, subprocess array prevents shell injection (good), but invalid git ref causes silent failure.

**Impact:** LOW (subprocess array safety), but MEDIUM (silent failure on invalid input).

**Fix approach:**
- Validate `diff_scope` is a valid git ref: `git show-ref --quiet $ref`
- Raise error if invalid
- Or: Only accept "working", "staged", "HEAD", "HEAD~1" (whitelist)

---

### 13. Missing Input Validation in Search Functions

**Issue:** `search_symbols()` in `server.py:370-422` accepts user queries without sanitization.

**Files:** `src/codetree/server.py:370-400`, `src/codetree/indexer.py:291-334`

**SQL query built at `queries.py:136`:**
```python
if query:
    conditions.append("s.name LIKE ?")
    params.append(f"%{query}%")
```

This is parameterized (safe), but large `query` strings can cause performance degradation.

**Impact:** LOW (parameterized queries prevent injection), but MEDIUM (DoS via large strings).

**Fix approach:**
- Limit query length: `if len(query) > 1000: raise ValueError("query too long")`
- Add query timeout to SQLite: `PRAGMA query_only = ON`

---

### 14. Language Plugin Error Handling Incomplete

**Issue:** If `extract_skeleton()` raises unexpected exception (e.g., MemoryError on huge file), server crashes without logging.

**Files:** `src/codetree/indexer.py:85-95`

**Code:**
```python
skeleton = plugin.extract_skeleton(source)  # line 85 — NO TRY/EXCEPT
```

**Impact:** HIGH — any plugin error crashes server initialization.

**Fix approach:**
- Wrap in try/except: catch and log errors, set `has_errors=True`
- Continue with empty skeleton instead of crashing

---

### 15. Missing Connection Null Check in GraphStore Methods

**Issue:** Multiple `GraphStore` methods assume `self._conn` is not None, but it could be if `open()` was never called.

**Files:** `src/codetree/graph/store.py:103-113, 118-123, 126-139`

**Example (line 104):**
```python
def get_meta(self, key: str) -> str | None:
    cur = self._conn.execute(...)  # CRASHES if _conn is None
```

**Impact:** LOW (execute() calls `self.open()` on line 98), but defensive check missing.

**Fix approach:**
- Add `if self._conn is None: raise RuntimeError("Database not opened")`
- Or: Ensure `open()` is always called before any method

---

### 16. Graph Builder File Hash Collision Potential

**Issue:** `GraphBuilder.build()` uses SHA256 hash to detect file changes (line 49), but hash is stored without versioning the hash algorithm.

**Files:** `src/codetree/graph/builder.py:15-16, 48-50`

**Scenario:**
- v1 uses SHA256 (current)
- v2 switches to SHA512
- Upgrade: old hashes don't match new algorithm
- All files appear "changed" → full reindex (slow, but correct)

**Impact:** LOW (correct but inefficient), but no way to detect hash algorithm mismatch.

**Fix approach:**
- Store algorithm name in files table: `hash_algorithm TEXT DEFAULT 'sha256'`
- Check algorithm on load; rebuild if mismatch

---

### 17. Dead Code Detection Excludes __init__.py Globally

**Issue:** `find_dead_code()` skips ALL `__init__.py` files (line 205), but some `__init__.py` exports are actually unused.

**Files:** `src/codetree/indexer.py:205-206`

**Code:**
```python
if rel_path.endswith("__init__.py"):
    continue  # SKIP ENTIRE FILE
```

**Impact:** MEDIUM — dead exports in `__init__.py` are never detected.

**Fix approach:**
- Still process `__init__.py`, but exclude only symbols that are explicitly re-exported (`__all__`)

---

### 18. Dataflow Analysis Doesn't Handle Function Overloads

**Issue:** `extract_dataflow()` in `dataflow.py:34-83` assumes one function definition per name, but languages support overloads.

**Files:** `src/codetree/graph/dataflow.py:46-50`

**Code:**
```python
result = plugin.extract_symbol_source(source, fn_name)  # Returns FIRST match only
```

**Impact:** LOW (rare in dynamic languages), but MEDIUM in languages with overloading (Java, C++, Go).

**Fix approach:**
- Accept line number parameter to disambiguate overloads
- Or: Return all overloads and let caller specify

---

### 19. Taint Analysis TAINT_SOURCES Incomplete

**Issue:** `extract_taint_paths()` uses hardcoded TAINT_SOURCES list (line 7-13), which is incomplete for modern frameworks.

**Files:** `src/codetree/graph/dataflow.py:7-13`

**Missing sources:**
- Flask: `request.args`, `request.form` (exists), but not `session`, `cookies`, `headers`
- Django: `request.GET`, `request.POST`, `request.FILES` (not listed)
- FastAPI: `Request.query_params`, `Request.body()` (not listed)
- Database queries that return user data: `db.query()`, `cursor.fetchall()` (not listed)

**Impact:** MEDIUM — taint analysis misses real security issues.

**Fix approach:**
- Expand TAINT_SOURCES with common framework patterns
- Make it configurable per project (via `.codetreerc`)

---

### 20. Performance Bottleneck: find_references Scans All Files

**Issue:** `find_references()` does a full repo scan on every call (line 140-142), even for symbols that appear only in one file.

**Files:** `src/codetree/indexer.py:138-143`

**Code:**
```python
def find_references(self, symbol_name: str) -> list[dict]:
    results = []
    for rel_path, entry in self._index.items():  # ITERATES ALL FILES
        for u in entry.plugin.extract_symbol_usages(entry.source, symbol_name):
            results.append(...)
    return results
```

**Impact:** MEDIUM — slow on large repos (1000+ files).

**Fix approach:**
- Use graph-based queries (GraphQueries already has this)
- Or: Cache usage index keyed by (symbol_name, file_path)

---

### 21. Missing Handle Cleanup on Errors

**Issue:** `GraphStore.open()` calls `executescript()` which can fail, leaving the connection in a broken state.

**Files:** `src/codetree/graph/store.py:60-73`

**Scenario:**
1. Disk full during schema creation
2. `executescript()` fails partway
3. Connection is open but schema is incomplete
4. Subsequent queries crash

**Impact:** LOW (rare), but database could be corrupted on crash during open.

**Fix approach:**
- Wrap schema creation in try/except
- On error, close connection and raise

---

### 22. Cyclomatic Complexity Calculation Unavailable for Most Languages

**Issue:** `compute_complexity()` is implemented for only Python and JavaScript; returns None for others.

**Files:** `src/codetree/languages/base.py:209-211` (default), `python.py`, `javascript.py`

**Impact:** MEDIUM — `search_symbols(min_complexity=...)` returns no results for Java/Go/Rust code.

**Fix approach:**
- Implement complexity calculation for all languages
- Or: Document which languages support it

---

### 23. Stale Graph on Incremental Rebuild

**Issue:** When files are deleted, `delete_edges_for_file()` uses LIKE pattern matching (line 261-266), which could delete wrong edges.

**Files:** `src/codetree/graph/store.py:260-266`

**Code:**
```python
prefix = file_path + "::"
self._conn.execute(
    "DELETE FROM edges WHERE source_qn LIKE ? OR target_qn LIKE ?",
    (prefix + "%", prefix + "%"),
)
```

**Bug:** If file is `src/calc.py` and another is `src/calc_utils.py`, deleting `src/calc.py` with LIKE `src/calc.py::%` might delete `src/calc_utils.py::` edges too (depends on LIKE semantics).

**Impact:** LOW (exact LIKE matching should be safe), but fragile.

**Fix approach:**
- Use exact match: `source_qn = ? OR target_qn = ?` with specific qualified names
- Or: Ensure qualified names use `::` as separator and validate no ambiguity

---

### 24. Missing Null Checks in Skeleton Items

**Issue:** Tools access skeleton fields without checking they exist.

**Files:** `src/codetree/server.py:78-89` (full format), `src/codetree/graph/builder.py:88-103`

**Code:**
```python
for item in skeleton:
    kind = item["type"]  # Could KeyError if skeleton is malformed
    name = item["name"]
    line = item["line"]
    parent = item.get("parent")  # Safe
```

**Risk:** Malformed skeleton from a plugin crashes formatting code.

**Impact:** LOW (plugins should return valid skeletons), but MEDIUM if plugin has bug.

**Fix approach:**
- Validate skeleton on return from plugin: check all required fields
- Use `.get()` with defaults for optional fields

---

## Tech Debt

### 25. Inconsistent Error Message Format

**Issue:** Tool error messages use different formats:
- `"File not found or empty: {file_path}"` (get_file_skeleton)
- `"Symbol '{symbol_name}' not found in {file_path}"` (get_symbol)
- `"No references found for '{symbol_name}'"` (find_references)

**Impact:** Agents can't parse errors consistently.

**Fix approach:**
- Standardize on format: `{file}: {message}` or return `{"error": "...", "code": "..."}`

---

### 26. Unused `_call_graph_built` Flag

**Issue:** `_call_graph_built` in `indexer.py:41` is set to False on inject (line 109), but is used in `_ensure_call_graph()` which rebuilds on-demand. The flag is unnecessarily complex.

**Files:** `src/codetree/indexer.py:41, 109, 156`

**Impact:** LOW (works correctly), but confusing.

**Fix approach:**
- Always rebuild call graph on first access, remove flag
- Or: Document why flag is needed

---

### 27. Incomplete Type Hints

**Issue:** Some functions missing return type annotations.

**Files:** `src/codetree/indexer.py:269, 281`, etc.

**Impact:** LOW (mypy can infer), but reduces clarity.

**Fix approach:**
- Run mypy and add missing annotations

---

## Known Limitations (Not Bugs, But Constraints)

- **Name-based symbol resolution:** Symbols with the same name in different files/namespaces are conflated (see #9)
- **No import graph analysis:** Call graph resolution relies on file stem matching, not actual import paths
- **Language-specific complexity:** Cyclomatic complexity only in Python/JS (see #22)
- **Taint analysis incompleteness:** TAINT_SOURCES/SINKS hardcoded; not extensible (see #19)

---

## Summary by Priority

**CRITICAL (Fix Before Production):**
- #4: SQLite concurrency without locking
- #5: Path traversal vulnerability in tool inputs

**HIGH (Fix Soon):**
- #1: Cache corruption crashes server
- #2: Definition index duplication
- #9: Duplicate symbol names break resolution

**MEDIUM (Fix This Quarter):**
- #3: Stale definition index on cache misses
- #6: Silent failures hide errors
- #7: Git commands fail silently on non-git repos
- #10: Cached skeletons not validated
- #11: Graph schema version not enforced
- #14: Plugin errors crash server
- #20: find_references scans all files (performance)

**LOW (Monitor/Refactor):**
- #8: Cache injection race condition
- #12: Subprocess validation
- #13: Search input validation
- #15-18: Edge cases and limitations

---

*Concerns audit: 2026-04-03*
