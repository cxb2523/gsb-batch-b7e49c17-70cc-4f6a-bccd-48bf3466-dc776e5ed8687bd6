"""
Regression tests for three coupled definition-index bugs:

DATA-01: Duplicate entries in _definitions after inject_cached() + _rebuild_definitions()
DATA-02: Ghost symbols from deleted files appearing in find_references() / find_dead_code()
DATA-03: Name collisions across files — bare-name keys merge unrelated symbols

These tests are written against the FIXED indexer API:
  - _definitions uses qualified keys "rel_path::symbol_name"
  - _name_to_qualified maps bare name → list of qualified keys
  - _rebuild_definitions() rebuilds both structures from _index

All tests use tmp_path (pytest built-in) for isolation.
"""
import pytest
from pathlib import Path
from codetree.indexer import Indexer


# ── DATA-01: No duplicates after cached injection + build ──────────────────────

def test_no_duplicate_definitions_after_inject(tmp_path):
    """DATA-01: inject_cached() for a file already in build() must not double-add to _definitions."""
    f = tmp_path / "calc.py"
    f.write_text("def foo():\n    pass\n")
    indexer = Indexer(tmp_path)
    indexer.build()  # foo gets indexed into _definitions via _rebuild_definitions()

    # Simulate inject_cached for same file (as if cache had it too)
    from codetree.registry import get_plugin
    plugin = get_plugin(f)
    skeleton = plugin.extract_skeleton(f.read_bytes())
    indexer.inject_cached(
        rel_path="calc.py",
        py_file=f,
        source=f.read_bytes(),
        skeleton=skeleton,
        mtime=f.stat().st_mtime,
    )
    # Must call _rebuild_definitions() — inject_cached() only updates _index
    indexer._rebuild_definitions()

    # Count how many times calc.py symbols appear across all _definitions values
    all_entries = []
    for entries in indexer._definitions.values():
        all_entries.extend(entries)
    foo_entries = [(fp, ln) for fp, ln in all_entries if "calc.py" in fp]
    assert len(foo_entries) == len(skeleton), (
        f"Expected {len(skeleton)} entries for calc.py, got {len(foo_entries)} — duplicates present"
    )


def test_no_duplicate_references_after_inject(tmp_path):
    """DATA-01: find_references() returns each usage once even if file was injected after build()."""
    f = tmp_path / "mod.py"
    f.write_text("def bar():\n    pass\n\nbar()\n")
    indexer = Indexer(tmp_path)
    indexer.build()

    from codetree.registry import get_plugin
    plugin = get_plugin(f)
    skeleton = plugin.extract_skeleton(f.read_bytes())
    # Inject same file again, then rebuild definitions
    indexer.inject_cached("mod.py", f, f.read_bytes(), skeleton, f.stat().st_mtime)
    indexer._rebuild_definitions()

    refs = indexer.find_references("bar")
    files_seen = [(r["file"], r["line"]) for r in refs]
    assert len(files_seen) == len(set(files_seen)), (
        f"Duplicate references found: {files_seen}"
    )


# ── DATA-02: Ghost symbols from deleted files ──────────────────────────────────

def test_ghost_symbols_not_in_find_references(tmp_path):
    """DATA-02: symbols from a deleted file must not appear in find_references()."""
    alive = tmp_path / "alive.py"
    dead_file = tmp_path / "dead.py"
    alive.write_text("def baz():\n    pass\n")
    dead_file.write_text("def ghost():\n    pass\n")

    # First build: both files indexed
    indexer = Indexer(tmp_path)
    indexer.build()
    assert any(r["file"] == "dead.py" for r in indexer.find_references("ghost")), (
        "ghost should appear before deletion"
    )

    # Simulate second run: dead.py deleted
    dead_file.unlink()
    indexer2 = Indexer(tmp_path)
    # Build skips dead.py (doesn't exist); inject alive.py from cache
    from codetree.registry import get_plugin
    plugin = get_plugin(alive)
    skeleton = plugin.extract_skeleton(alive.read_bytes())
    indexer2.build()
    # Do NOT inject dead_file — it no longer exists
    indexer2.inject_cached("alive.py", alive, alive.read_bytes(), skeleton, alive.stat().st_mtime)
    indexer2._rebuild_definitions()

    refs = indexer2.find_references("ghost")
    assert refs == [], f"Ghost references found for deleted file: {refs}"


def test_ghost_symbols_not_in_find_dead_code(tmp_path):
    """DATA-02: find_dead_code() must not report symbols from deleted files."""
    alive = tmp_path / "alive.py"
    dead_file = tmp_path / "dead.py"
    alive.write_text("def living():\n    pass\n")
    dead_file.write_text("def phantom():\n    pass\n")

    # Simulate second run: dead.py is already gone before the indexer runs
    dead_file.unlink()

    indexer = Indexer(tmp_path)
    indexer.build()
    from codetree.registry import get_plugin
    plugin = get_plugin(alive)
    skeleton = plugin.extract_skeleton(alive.read_bytes())
    indexer.inject_cached("alive.py", alive, alive.read_bytes(), skeleton, alive.stat().st_mtime)
    indexer._rebuild_definitions()

    dead = indexer.find_dead_code()
    dead_files = {d["file"] for d in dead}
    assert "dead.py" not in dead_files, (
        f"Phantom dead code from deleted file: {[d for d in dead if d['file'] == 'dead.py']}"
    )


# ── DATA-03: Name collisions across files ──────────────────────────────────────

def test_qualified_names_distinguish_colliding_symbols(tmp_path):
    """DATA-03: _definitions must have separate qualified keys for add() in math_ops.py and utils.py."""
    math_py = tmp_path / "math_ops.py"
    utils_py = tmp_path / "utils.py"
    math_py.write_text("def add(a, b):\n    return a + b\n")
    utils_py.write_text("def add(x, y):\n    return x + y\n")

    indexer = Indexer(tmp_path)
    indexer.build()

    # With qualified keys: "math_ops.py::add" and "utils.py::add" must be separate entries
    assert "math_ops.py::add" in indexer._definitions, (
        f"Expected 'math_ops.py::add' key, got keys: {list(indexer._definitions.keys())}"
    )
    assert "utils.py::add" in indexer._definitions, (
        f"Expected 'utils.py::add' key, got keys: {list(indexer._definitions.keys())}"
    )
    # Each qualified key should have exactly one entry (not merged)
    assert len(indexer._definitions["math_ops.py::add"]) == 1
    assert len(indexer._definitions["utils.py::add"]) == 1


def test_name_to_qualified_secondary_index(tmp_path):
    """DATA-03: _name_to_qualified maps bare name to all qualified keys (O(1) callee lookup)."""
    math_py = tmp_path / "math_ops.py"
    utils_py = tmp_path / "utils.py"
    math_py.write_text("def add(a, b):\n    return a + b\n")
    utils_py.write_text("def add(x, y):\n    return x + y\n")

    indexer = Indexer(tmp_path)
    indexer.build()

    # _name_to_qualified["add"] should list both qualified keys
    assert hasattr(indexer, "_name_to_qualified"), (
        "_name_to_qualified secondary index not present on Indexer"
    )
    qualified = indexer._name_to_qualified.get("add", [])
    assert "math_ops.py::add" in qualified, (
        f"math_ops.py::add missing from _name_to_qualified['add']: {qualified}"
    )
    assert "utils.py::add" in qualified, (
        f"utils.py::add missing from _name_to_qualified['add']: {qualified}"
    )


# --- ROBUST-01: Plugin exception handling ---

def test_plugin_exception_skips_file(tmp_path, monkeypatch):
    """ROBUST-01: RuntimeError in extract_skeleton() skips that file with has_errors=True."""
    before = tmp_path / "before.py"
    crashing = tmp_path / "crashing.py"
    after = tmp_path / "after.py"
    before.write_text("def normal(): pass\n")
    crashing.write_text("def boom(): pass\n")
    after.write_text("def also_normal(): pass\n")

    from codetree.registry import get_plugin

    original_get_plugin = get_plugin

    def patched_get_plugin(path):
        plugin = original_get_plugin(path)
        if plugin is None:
            return None
        if path.name == "crashing.py":
            # Return a wrapped plugin that raises on extract_skeleton
            class CrashingPlugin(type(plugin)):
                def extract_skeleton(self, source):
                    raise RuntimeError("Simulated plugin crash")
            return CrashingPlugin()
        return plugin

    monkeypatch.setattr("codetree.indexer.get_plugin", patched_get_plugin)

    indexer = Indexer(tmp_path)
    # Must NOT raise:
    indexer.build()

    assert "before.py" in indexer._index, "before.py must be indexed"
    assert "after.py" in indexer._index, "after.py must be indexed"
    assert "crashing.py" in indexer._index, "crashing.py must be in index (with has_errors)"
    crashing_entry = indexer._index["crashing.py"]
    assert crashing_entry.has_errors is True, "crashing.py must have has_errors=True"
    assert crashing_entry.skeleton == [], "crashing.py must have empty skeleton"


def test_plugin_memoryerror_skips_file(tmp_path, monkeypatch):
    """ROBUST-01: MemoryError in extract_skeleton() also skips that file gracefully."""
    crashing = tmp_path / "huge.py"
    crashing.write_text("def big(): pass\n")

    from codetree.registry import get_plugin

    original_get_plugin = get_plugin

    def patched_get_plugin(path):
        plugin = original_get_plugin(path)
        if plugin is None:
            return None
        if path.name == "huge.py":
            class MemCrashPlugin(type(plugin)):
                def extract_skeleton(self, source):
                    raise MemoryError("Simulated OOM")
            return MemCrashPlugin()
        return plugin

    monkeypatch.setattr("codetree.indexer.get_plugin", patched_get_plugin)

    indexer = Indexer(tmp_path)
    indexer.build()  # Must not raise

    entry = indexer._index.get("huge.py")
    assert entry is not None
    assert entry.has_errors is True
    assert entry.skeleton == []


def test_plugin_exception_server_continues_indexing(tmp_path, monkeypatch):
    """ROBUST-01: files after a crashing file are still indexed."""
    # Create files in alphabetical order so walk order is predictable
    a_file = tmp_path / "aaa.py"
    b_file = tmp_path / "bbb.py"
    c_file = tmp_path / "ccc.py"
    a_file.write_text("def alpha(): pass\n")
    b_file.write_text("def beta(): pass\n")   # This one crashes
    c_file.write_text("def gamma(): pass\n")

    from codetree.registry import get_plugin

    original_get_plugin = get_plugin

    def patched_get_plugin(path):
        plugin = original_get_plugin(path)
        if plugin is None:
            return None
        if path.name == "bbb.py":
            class CrashPlugin(type(plugin)):
                def extract_skeleton(self, source):
                    raise ValueError("boom")
            return CrashPlugin()
        return plugin

    monkeypatch.setattr("codetree.indexer.get_plugin", patched_get_plugin)

    indexer = Indexer(tmp_path)
    indexer.build()

    # aaa and ccc must be fully indexed with their symbols
    assert "aaa.py" in indexer._index
    assert "ccc.py" in indexer._index
    aaa_names = [item["name"] for item in indexer._index["aaa.py"].skeleton]
    ccc_names = [item["name"] for item in indexer._index["ccc.py"].skeleton]
    assert "alpha" in aaa_names, f"alpha not found in aaa.py skeleton: {aaa_names}"
    assert "gamma" in ccc_names, f"gamma not found in ccc.py skeleton: {ccc_names}"
