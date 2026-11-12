# Phase 6: Persistent Graph + Onboarding + Dataflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent SQLite graph layer, repo onboarding tools, git-aware change impact, and intra-function dataflow/taint analysis to codetree — making it the only MCP server that combines structural code understanding with dataflow tracking.

**Architecture:** Keep the existing tree-sitter plugin system and 16 MCP tools unchanged. Add a new `graph/` package that persists symbol relationships in `.codetree/graph.db` (stdlib sqlite3). New tools query the graph for onboarding, search, impact analysis, and dataflow. The graph layer sits on top of the existing indexer — the indexer still does tree-sitter parsing, the graph persists results and adds relationship queries.

**Tech Stack:** Python 3.10+, FastMCP 3.1.0, tree-sitter 0.25.x, stdlib `sqlite3`, pytest. No external database, no background service, no network dependency.

---

## Task 1: Graph Data Models

**Files:**
- Create: `src/codetree/graph/__init__.py`
- Create: `src/codetree/graph/models.py`

**Step 1: Create the graph package**

Create `src/codetree/graph/__init__.py` (empty file).

Create `src/codetree/graph/models.py`:

```python
from dataclasses import dataclass, field


@dataclass
class SymbolNode:
    qualified_name: str
    name: str
    kind: str
    file_path: str
    start_line: int
    end_line: int | None = None
    parent_qn: str | None = None
    doc: str = ""
    params: str = ""
    is_test: bool = False
    is_entry_point: bool = False


@dataclass
class Edge:
    source_qn: str
    target_qn: str
    type: str  # CALLS, IMPORTS, CONTAINS, TESTS, DATA_FLOWS
    weight: float = 1.0


def make_qualified_name(file_path: str, name: str, parent: str | None = None) -> str:
    """Build a qualified name: file_path::Parent.name or file_path::name."""
    if parent:
        return f"{file_path}::{parent}.{name}"
    return f"{file_path}::{name}"
```

**Step 2: Verify import works**

Run:
```bash
source .venv/bin/activate
python -c "from codetree.graph.models import SymbolNode, Edge, make_qualified_name; print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add src/codetree/graph/
git commit -m "feat: add graph data models (SymbolNode, Edge, qualified names)"
```

---

## Task 2: SQLite Graph Store

**Files:**
- Create: `src/codetree/graph/store.py`
- Create: `tests/test_graph_store.py`

**Step 1: Write the failing store tests**

Create `tests/test_graph_store.py`:

```python
import pytest
import tempfile
from pathlib import Path
from codetree.graph.store import GraphStore
from codetree.graph.models import SymbolNode, Edge


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as tmp:
        s = GraphStore(tmp)
        s.open()
        yield s
        s.close()


class TestGraphStoreSchema:
    def test_creates_database_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = GraphStore(tmp)
            s.open()
            assert (Path(tmp) / ".codetree" / "graph.db").exists()
            s.close()

    def test_schema_version_stored(self, store):
        val = store.get_meta("schema_version")
        assert val == "1"

    def test_idempotent_open(self, store):
        # Opening twice should not fail
        store.close()
        store.open()
        assert store.get_meta("schema_version") == "1"


class TestSymbolCRUD:
    def test_upsert_and_get_symbol(self, store):
        sym = SymbolNode(
            qualified_name="calc.py::Calculator",
            name="Calculator",
            kind="class",
            file_path="calc.py",
            start_line=1,
            end_line=20,
        )
        store.upsert_symbol(sym)
        result = store.get_symbol("calc.py::Calculator")
        assert result is not None
        assert result.name == "Calculator"
        assert result.kind == "class"
        assert result.start_line == 1

    def test_upsert_overwrites(self, store):
        sym = SymbolNode(
            qualified_name="calc.py::add",
            name="add",
            kind="function",
            file_path="calc.py",
            start_line=1,
        )
        store.upsert_symbol(sym)
        sym.start_line = 10
        store.upsert_symbol(sym)
        result = store.get_symbol("calc.py::add")
        assert result.start_line == 10

    def test_get_missing_symbol(self, store):
        assert store.get_symbol("nonexistent") is None

    def test_symbols_by_name(self, store):
        store.upsert_symbol(SymbolNode("a.py::add", "add", "function", "a.py", 1))
        store.upsert_symbol(SymbolNode("b.py::add", "add", "function", "b.py", 5))
        store.upsert_symbol(SymbolNode("c.py::sub", "sub", "function", "c.py", 1))
        results = store.symbols_by_name("add")
        assert len(results) == 2
        assert {r.file_path for r in results} == {"a.py", "b.py"}

    def test_symbols_by_file(self, store):
        store.upsert_symbol(SymbolNode("a.py::Foo", "Foo", "class", "a.py", 1))
        store.upsert_symbol(SymbolNode("a.py::bar", "bar", "function", "a.py", 10))
        store.upsert_symbol(SymbolNode("b.py::baz", "baz", "function", "b.py", 1))
        results = store.symbols_by_file("a.py")
        assert len(results) == 2

    def test_delete_symbols_for_file(self, store):
        store.upsert_symbol(SymbolNode("a.py::Foo", "Foo", "class", "a.py", 1))
        store.upsert_symbol(SymbolNode("b.py::Bar", "Bar", "class", "b.py", 1))
        store.delete_symbols_for_file("a.py")
        assert store.get_symbol("a.py::Foo") is None
        assert store.get_symbol("b.py::Bar") is not None


class TestEdgeCRUD:
    def test_upsert_and_get_edges(self, store):
        store.upsert_edge(Edge("a.py::foo", "b.py::bar", "CALLS"))
        edges = store.edges_from("a.py::foo")
        assert len(edges) == 1
        assert edges[0].target_qn == "b.py::bar"
        assert edges[0].type == "CALLS"

    def test_edges_to(self, store):
        store.upsert_edge(Edge("a.py::foo", "b.py::bar", "CALLS"))
        store.upsert_edge(Edge("c.py::baz", "b.py::bar", "CALLS"))
        edges = store.edges_to("b.py::bar")
        assert len(edges) == 2

    def test_edges_filtered_by_type(self, store):
        store.upsert_edge(Edge("a.py::foo", "b.py::bar", "CALLS"))
        store.upsert_edge(Edge("a.py::foo", "b.py::bar", "IMPORTS"))
        assert len(store.edges_from("a.py::foo", edge_type="CALLS")) == 1
        assert len(store.edges_from("a.py::foo")) == 2

    def test_delete_edges_for_file(self, store):
        store.upsert_edge(Edge("a.py::foo", "b.py::bar", "CALLS"))
        store.upsert_edge(Edge("c.py::baz", "d.py::qux", "CALLS"))
        store.delete_edges_for_file("a.py")
        assert len(store.edges_from("a.py::foo")) == 0
        assert len(store.edges_from("c.py::baz")) == 1


class TestFileCRUD:
    def test_upsert_and_get_file(self, store):
        store.upsert_file("calc.py", sha256="abc123", language="py", is_test=False)
        result = store.get_file("calc.py")
        assert result is not None
        assert result["sha256"] == "abc123"

    def test_get_missing_file(self, store):
        assert store.get_file("nope.py") is None

    def test_delete_file(self, store):
        store.upsert_file("calc.py", sha256="abc", language="py", is_test=False)
        store.delete_file("calc.py")
        assert store.get_file("calc.py") is None

    def test_all_files(self, store):
        store.upsert_file("a.py", sha256="a", language="py", is_test=False)
        store.upsert_file("b.py", sha256="b", language="py", is_test=True)
        files = store.all_files()
        assert len(files) == 2


class TestMeta:
    def test_set_and_get_meta(self, store):
        store.set_meta("tool_version", "0.2.0")
        assert store.get_meta("tool_version") == "0.2.0"

    def test_get_missing_meta(self, store):
        assert store.get_meta("nonexistent") is None


class TestStats:
    def test_stats(self, store):
        store.upsert_symbol(SymbolNode("a.py::foo", "foo", "function", "a.py", 1))
        store.upsert_symbol(SymbolNode("a.py::bar", "bar", "function", "a.py", 5))
        store.upsert_edge(Edge("a.py::foo", "a.py::bar", "CALLS"))
        store.upsert_file("a.py", sha256="x", language="py", is_test=False)
        stats = store.stats()
        assert stats["files"] == 1
        assert stats["symbols"] == 2
        assert stats["edges"] == 1
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_store.py -v
```

Expected: FAIL (ModuleNotFoundError: No module named 'codetree.graph.store')

**Step 3: Implement the GraphStore**

Create `src/codetree/graph/store.py`:

```python
import sqlite3
import time
from pathlib import Path
from .models import SymbolNode, Edge

SCHEMA_VERSION = "1"

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS files (
    file_path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    language TEXT,
    is_test INTEGER DEFAULT 0,
    indexed_at REAL
);

CREATE TABLE IF NOT EXISTS symbols (
    qualified_name TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    parent_qn TEXT,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER,
    doc TEXT DEFAULT '',
    params TEXT DEFAULT '',
    is_test INTEGER DEFAULT 0,
    is_entry_point INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edges (
    source_qn TEXT NOT NULL,
    target_qn TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    PRIMARY KEY (source_qn, target_qn, type)
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_qn);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_qn);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
"""


class GraphStore:
    def __init__(self, root: str):
        self._root = Path(root)
        self._db_path = self._root / ".codetree" / "graph.db"
        self._conn: sqlite3.Connection | None = None

    def open(self):
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA_SQL)
        # Set schema version if not exists
        cur = self._conn.execute("SELECT value FROM meta WHERE key='schema_version'")
        if cur.fetchone() is None:
            self._conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )
            self._conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── Meta ──────────────────────────────────────────────────────────────

    def get_meta(self, key: str) -> str | None:
        cur = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,))
        row = cur.fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str):
        self._conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            (key, value),
        )
        self._conn.commit()

    # ── Files ─────────────────────────────────────────────────────────────

    def upsert_file(self, file_path: str, sha256: str, language: str, is_test: bool):
        self._conn.execute(
            "INSERT OR REPLACE INTO files (file_path, sha256, language, is_test, indexed_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (file_path, sha256, language, int(is_test), time.time()),
        )
        self._conn.commit()

    def get_file(self, file_path: str) -> dict | None:
        cur = self._conn.execute(
            "SELECT file_path, sha256, language, is_test, indexed_at FROM files WHERE file_path=?",
            (file_path,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "file_path": row[0],
            "sha256": row[1],
            "language": row[2],
            "is_test": bool(row[3]),
            "indexed_at": row[4],
        }

    def delete_file(self, file_path: str):
        self._conn.execute("DELETE FROM files WHERE file_path=?", (file_path,))
        self._conn.commit()

    def all_files(self) -> list[dict]:
        cur = self._conn.execute(
            "SELECT file_path, sha256, language, is_test, indexed_at FROM files"
        )
        return [
            {"file_path": r[0], "sha256": r[1], "language": r[2], "is_test": bool(r[3]), "indexed_at": r[4]}
            for r in cur.fetchall()
        ]

    # ── Symbols ───────────────────────────────────────────────────────────

    def upsert_symbol(self, sym: SymbolNode):
        self._conn.execute(
            "INSERT OR REPLACE INTO symbols "
            "(qualified_name, name, kind, parent_qn, file_path, start_line, end_line, "
            "doc, params, is_test, is_entry_point) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sym.qualified_name, sym.name, sym.kind, sym.parent_qn,
                sym.file_path, sym.start_line, sym.end_line,
                sym.doc, sym.params, int(sym.is_test), int(sym.is_entry_point),
            ),
        )
        self._conn.commit()

    def get_symbol(self, qualified_name: str) -> SymbolNode | None:
        cur = self._conn.execute(
            "SELECT qualified_name, name, kind, parent_qn, file_path, start_line, end_line, "
            "doc, params, is_test, is_entry_point FROM symbols WHERE qualified_name=?",
            (qualified_name,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return SymbolNode(
            qualified_name=row[0], name=row[1], kind=row[2], parent_qn=row[3],
            file_path=row[4], start_line=row[5], end_line=row[6],
            doc=row[7] or "", params=row[8] or "",
            is_test=bool(row[9]), is_entry_point=bool(row[10]),
        )

    def symbols_by_name(self, name: str) -> list[SymbolNode]:
        cur = self._conn.execute(
            "SELECT qualified_name, name, kind, parent_qn, file_path, start_line, end_line, "
            "doc, params, is_test, is_entry_point FROM symbols WHERE name=?",
            (name,),
        )
        return [
            SymbolNode(
                qualified_name=r[0], name=r[1], kind=r[2], parent_qn=r[3],
                file_path=r[4], start_line=r[5], end_line=r[6],
                doc=r[7] or "", params=r[8] or "",
                is_test=bool(r[9]), is_entry_point=bool(r[10]),
            )
            for r in cur.fetchall()
        ]

    def symbols_by_file(self, file_path: str) -> list[SymbolNode]:
        cur = self._conn.execute(
            "SELECT qualified_name, name, kind, parent_qn, file_path, start_line, end_line, "
            "doc, params, is_test, is_entry_point FROM symbols WHERE file_path=?",
            (file_path,),
        )
        return [
            SymbolNode(
                qualified_name=r[0], name=r[1], kind=r[2], parent_qn=r[3],
                file_path=r[4], start_line=r[5], end_line=r[6],
                doc=r[7] or "", params=r[8] or "",
                is_test=bool(r[9]), is_entry_point=bool(r[10]),
            )
            for r in cur.fetchall()
        ]

    def delete_symbols_for_file(self, file_path: str):
        self._conn.execute("DELETE FROM symbols WHERE file_path=?", (file_path,))
        self._conn.commit()

    # ── Edges ─────────────────────────────────────────────────────────────

    def upsert_edge(self, edge: Edge):
        self._conn.execute(
            "INSERT OR REPLACE INTO edges (source_qn, target_qn, type, weight) "
            "VALUES (?, ?, ?, ?)",
            (edge.source_qn, edge.target_qn, edge.type, edge.weight),
        )
        self._conn.commit()

    def edges_from(self, source_qn: str, edge_type: str | None = None) -> list[Edge]:
        if edge_type:
            cur = self._conn.execute(
                "SELECT source_qn, target_qn, type, weight FROM edges "
                "WHERE source_qn=? AND type=?",
                (source_qn, edge_type),
            )
        else:
            cur = self._conn.execute(
                "SELECT source_qn, target_qn, type, weight FROM edges WHERE source_qn=?",
                (source_qn,),
            )
        return [Edge(r[0], r[1], r[2], r[3]) for r in cur.fetchall()]

    def edges_to(self, target_qn: str, edge_type: str | None = None) -> list[Edge]:
        if edge_type:
            cur = self._conn.execute(
                "SELECT source_qn, target_qn, type, weight FROM edges "
                "WHERE target_qn=? AND type=?",
                (target_qn, edge_type),
            )
        else:
            cur = self._conn.execute(
                "SELECT source_qn, target_qn, type, weight FROM edges WHERE target_qn=?",
                (target_qn,),
            )
        return [Edge(r[0], r[1], r[2], r[3]) for r in cur.fetchall()]

    def delete_edges_for_file(self, file_path: str):
        prefix = file_path + "::"
        self._conn.execute(
            "DELETE FROM edges WHERE source_qn LIKE ? OR target_qn LIKE ?",
            (prefix + "%", prefix + "%"),
        )
        self._conn.commit()

    # ── Stats ─────────────────────────────────────────────────────────────

    def stats(self) -> dict:
        files = self._conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        symbols = self._conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
        edges = self._conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        return {"files": files, "symbols": symbols, "edges": edges}
```

**Step 4: Run store tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_store.py -v
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/codetree/graph/store.py tests/test_graph_store.py
git commit -m "feat: add SQLite graph store with symbol/edge/file CRUD"
```

---

## Task 3: Graph Builder (Incremental Indexing)

**Files:**
- Create: `src/codetree/graph/builder.py`
- Create: `tests/test_graph_builder.py`

**Step 1: Write the failing builder tests**

Create `tests/test_graph_builder.py`:

```python
import pytest
import hashlib
import tempfile
from pathlib import Path
from codetree.graph.builder import GraphBuilder
from codetree.graph.store import GraphStore
from codetree.indexer import Indexer


@pytest.fixture
def repo_dir():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'class Calculator:\n'
            '    """A calculator."""\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def sub(self, a, b):\n'
            '        return a - b\n'
        )
        (p / "main.py").write_text(
            'from calc import Calculator\n'
            'def main():\n'
            '    c = Calculator()\n'
            '    print(c.add(1, 2))\n'
        )
        (p / "test_calc.py").write_text(
            'from calc import Calculator\n'
            'def test_add():\n'
            '    c = Calculator()\n'
            '    assert c.add(1, 2) == 3\n'
        )
        yield p


class TestGraphBuilder:
    def test_full_build(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        result = builder.build()
        assert result["files_indexed"] > 0
        assert result["symbols_created"] > 0
        assert result["edges_created"] > 0
        store.close()

    def test_symbols_have_qualified_names(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        # Calculator class should have qualified name
        sym = store.get_symbol("calc.py::Calculator")
        assert sym is not None
        assert sym.kind == "class"
        # Method should include parent
        sym = store.get_symbol("calc.py::Calculator.add")
        assert sym is not None
        assert sym.kind == "method"
        store.close()

    def test_calls_edges_created(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        # main calls add
        edges = store.edges_from("main.py::main", edge_type="CALLS")
        callee_names = {e.target_qn.split("::")[-1] for e in edges}
        assert "add" in callee_names or "Calculator" in callee_names
        store.close()

    def test_contains_edges(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        edges = store.edges_from("calc.py::Calculator", edge_type="CONTAINS")
        child_names = {e.target_qn for e in edges}
        assert "calc.py::Calculator.add" in child_names
        assert "calc.py::Calculator.sub" in child_names
        store.close()

    def test_incremental_unchanged(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        r1 = builder.build()
        r2 = builder.build()
        # Second build should skip unchanged files
        assert r2["files_skipped"] == r1["files_indexed"]
        assert r2["files_indexed"] == 0
        store.close()

    def test_incremental_changed_file(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        # Modify calc.py
        (repo_dir / "calc.py").write_text(
            'class Calculator:\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def multiply(self, a, b):\n'
            '        return a * b\n'
        )
        r2 = builder.build()
        assert r2["files_indexed"] == 1
        # sub should be gone, multiply should exist
        assert store.get_symbol("calc.py::Calculator.sub") is None
        assert store.get_symbol("calc.py::Calculator.multiply") is not None
        store.close()

    def test_deleted_file(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        assert store.get_symbol("main.py::main") is not None
        # Delete main.py
        (repo_dir / "main.py").unlink()
        builder.build()
        assert store.get_symbol("main.py::main") is None
        assert store.get_file("main.py") is None
        store.close()

    def test_test_file_detected(self, repo_dir):
        store = GraphStore(str(repo_dir))
        store.open()
        builder = GraphBuilder(str(repo_dir), store)
        builder.build()
        f = store.get_file("test_calc.py")
        assert f is not None
        assert f["is_test"] is True
        sym = store.get_symbol("test_calc.py::test_add")
        assert sym is not None
        assert sym.is_test is True
        store.close()
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_builder.py -v
```

Expected: FAIL (ModuleNotFoundError)

**Step 3: Implement the GraphBuilder**

Create `src/codetree/graph/builder.py`:

```python
import hashlib
from pathlib import Path
from .store import GraphStore
from .models import SymbolNode, Edge, make_qualified_name
from ..indexer import Indexer


class GraphBuilder:
    def __init__(self, root: str, store: GraphStore):
        self._root = Path(root)
        self._store = store

    def _hash_file(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def _is_test_file(self, rel_path: str) -> bool:
        name = Path(rel_path).name
        parts = Path(rel_path).parts
        if any(d in ("test", "tests", "spec", "__tests__") for d in parts):
            return True
        return (name.startswith("test_") or
                "_test." in name or
                ".test." in name or
                ".spec." in name or
                (name[0].isupper() and "Test" in name))

    def build(self) -> dict:
        """Build or incrementally update the graph.

        Returns stats: {files_indexed, files_skipped, symbols_created, edges_created}
        """
        indexer = Indexer(str(self._root))
        indexer.build()

        # Get current files on disk
        current_files = {}
        for rel_path, entry in indexer._index.items():
            abs_path = self._root / rel_path
            if abs_path.exists():
                current_files[rel_path] = {
                    "hash": self._hash_file(abs_path),
                    "entry": entry,
                }

        # Determine which files changed
        files_indexed = 0
        files_skipped = 0
        symbols_created = 0
        edges_created = 0

        indexed_paths = set()

        for rel_path, info in current_files.items():
            indexed_paths.add(rel_path)
            existing = self._store.get_file(rel_path)
            if existing and existing["sha256"] == info["hash"]:
                files_skipped += 1
                continue

            # File is new or changed — reindex it
            files_indexed += 1
            entry = info["entry"]
            is_test = self._is_test_file(rel_path)

            # Clear old data for this file
            self._store.delete_symbols_for_file(rel_path)
            self._store.delete_edges_for_file(rel_path)

            # Upsert file record
            self._store.upsert_file(
                rel_path,
                sha256=info["hash"],
                language=entry.language,
                is_test=is_test,
            )

            # Build symbols from skeleton
            for item in entry.skeleton:
                qn = make_qualified_name(rel_path, item["name"], item.get("parent"))
                is_entry = item["name"] in ("main", "__main__") and not item.get("parent")
                sym = SymbolNode(
                    qualified_name=qn,
                    name=item["name"],
                    kind=item["type"],
                    file_path=rel_path,
                    start_line=item["line"],
                    end_line=None,
                    parent_qn=make_qualified_name(rel_path, item["parent"]) if item.get("parent") else None,
                    doc=item.get("doc", ""),
                    params=item.get("params", ""),
                    is_test=is_test or item["name"].startswith("test_") or item["name"].startswith("Test"),
                    is_entry_point=is_entry,
                )
                self._store.upsert_symbol(sym)
                symbols_created += 1

                # CONTAINS edges for methods
                if item.get("parent"):
                    parent_qn = make_qualified_name(rel_path, item["parent"])
                    self._store.upsert_edge(Edge(parent_qn, qn, "CONTAINS"))
                    edges_created += 1

            # Build CALLS edges
            for item in entry.skeleton:
                if item["type"] not in ("function", "method"):
                    continue
                caller_qn = make_qualified_name(rel_path, item["name"], item.get("parent"))
                callees = entry.plugin.extract_calls_in_function(entry.source, item["name"])
                for callee_name in callees:
                    # Resolve callee to definition(s)
                    targets = self._store.symbols_by_name(callee_name)
                    if targets:
                        for t in targets:
                            self._store.upsert_edge(Edge(caller_qn, t.qualified_name, "CALLS"))
                            edges_created += 1
                    else:
                        # Unresolved — store with ? prefix
                        self._store.upsert_edge(Edge(caller_qn, f"?::{callee_name}", "CALLS"))
                        edges_created += 1

            # Build IMPORTS edges
            imports = entry.plugin.extract_imports(entry.source)
            for imp in imports:
                text = imp["text"]
                # Simple heuristic: extract module name from import text
                # "from calc import Calculator" → "calc"
                # "import os" → "os"
                parts = text.split()
                if len(parts) >= 2:
                    module = parts[1] if parts[0] in ("import", "from") else parts[0]
                    # Try to find matching file
                    for candidate in current_files:
                        stem = Path(candidate).stem
                        if stem == module or candidate == module:
                            self._store.upsert_edge(
                                Edge(f"{rel_path}::__file__", f"{candidate}::__file__", "IMPORTS")
                            )
                            edges_created += 1
                            break

        # Delete files that no longer exist
        for stored_file in self._store.all_files():
            if stored_file["file_path"] not in indexed_paths:
                fp = stored_file["file_path"]
                self._store.delete_symbols_for_file(fp)
                self._store.delete_edges_for_file(fp)
                self._store.delete_file(fp)

        self._store.set_meta("last_indexed_at", str(__import__("time").time()))

        return {
            "files_indexed": files_indexed,
            "files_skipped": files_skipped,
            "symbols_created": symbols_created,
            "edges_created": edges_created,
        }
```

**Step 4: Run builder tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_builder.py -v
```

Expected: ALL PASS

**Step 5: Run full test suite to verify no regressions**

Run:
```bash
source .venv/bin/activate
pytest
```

Expected: 921+ tests pass

**Step 6: Commit**

```bash
git add src/codetree/graph/builder.py tests/test_graph_builder.py
git commit -m "feat: add incremental graph builder with qualified names and edge extraction"
```

---

## Task 4: Graph Queries Module

**Files:**
- Create: `src/codetree/graph/queries.py`
- Create: `tests/test_graph_queries.py`

**Step 1: Write the failing query tests**

Create `tests/test_graph_queries.py`:

```python
import pytest
import tempfile
from pathlib import Path
from codetree.graph.store import GraphStore
from codetree.graph.builder import GraphBuilder
from codetree.graph.queries import GraphQueries


@pytest.fixture
def built_graph():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'class Calculator:\n'
            '    """A calculator class."""\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def sub(self, a, b):\n'
            '        return a - b\n'
        )
        (p / "main.py").write_text(
            'from calc import Calculator\n'
            'def main():\n'
            '    c = Calculator()\n'
            '    print(c.add(1, 2))\n'
        )
        (p / "utils.py").write_text(
            'def add(a, b):\n'
            '    return a + b\n'
            'def helper():\n'
            '    pass\n'
        )
        (p / "test_calc.py").write_text(
            'from calc import Calculator\n'
            'def test_add():\n'
            '    c = Calculator()\n'
            '    assert c.add(1, 2) == 3\n'
        )
        store = GraphStore(str(p))
        store.open()
        builder = GraphBuilder(str(p), store)
        builder.build()
        queries = GraphQueries(store)
        yield queries, store, p
        store.close()


class TestRepositoryMap:
    def test_returns_languages(self, built_graph):
        queries, _, _ = built_graph
        result = queries.repository_map()
        assert "py" in result["languages"]

    def test_returns_entry_points(self, built_graph):
        queries, _, _ = built_graph
        result = queries.repository_map()
        assert any("main" in ep for ep in result["entry_points"])

    def test_returns_hotspots(self, built_graph):
        queries, _, _ = built_graph
        result = queries.repository_map()
        assert len(result["hotspots"]) > 0

    def test_returns_stats(self, built_graph):
        queries, _, _ = built_graph
        result = queries.repository_map()
        assert result["stats"]["files"] > 0
        assert result["stats"]["symbols"] > 0

    def test_max_items_limits_output(self, built_graph):
        queries, _, _ = built_graph
        result = queries.repository_map(max_items=2)
        assert len(result["hotspots"]) <= 2


class TestResolveSymbol:
    def test_exact_match(self, built_graph):
        queries, _, _ = built_graph
        results = queries.resolve_symbol("Calculator")
        assert len(results) >= 1
        assert results[0].name == "Calculator"

    def test_disambiguates_by_callers(self, built_graph):
        queries, _, _ = built_graph
        # "add" exists in both calc.py and utils.py
        results = queries.resolve_symbol("add")
        assert len(results) >= 2

    def test_kind_filter(self, built_graph):
        queries, _, _ = built_graph
        results = queries.resolve_symbol("add", kind="method")
        assert all(r.kind == "method" for r in results)

    def test_path_hint(self, built_graph):
        queries, _, _ = built_graph
        results = queries.resolve_symbol("add", path_hint="utils.py")
        assert results[0].file_path == "utils.py"

    def test_non_test_preferred(self, built_graph):
        queries, _, _ = built_graph
        results = queries.resolve_symbol("add")
        # Non-test results should come before test results
        non_test = [r for r in results if not r.is_test]
        if non_test:
            assert not results[0].is_test


class TestSearchGraph:
    def test_search_by_name(self, built_graph):
        queries, _, _ = built_graph
        result = queries.search_graph(query="calc")
        assert result["total"] > 0

    def test_search_by_kind(self, built_graph):
        queries, _, _ = built_graph
        result = queries.search_graph(kind="class")
        assert all(r["kind"] == "class" for r in result["results"])

    def test_search_by_file_pattern(self, built_graph):
        queries, _, _ = built_graph
        result = queries.search_graph(file_pattern="calc")
        assert all("calc" in r["file_path"] for r in result["results"])

    def test_search_pagination(self, built_graph):
        queries, _, _ = built_graph
        r1 = queries.search_graph(limit=2, offset=0)
        r2 = queries.search_graph(limit=2, offset=2)
        if r1["total"] > 2:
            assert r1["results"] != r2["results"]

    def test_search_by_min_degree(self, built_graph):
        queries, _, _ = built_graph
        result = queries.search_graph(min_degree=1)
        # All results should have at least 1 connection
        for r in result["results"]:
            assert r["in_degree"] + r["out_degree"] >= 1
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_queries.py -v
```

Expected: FAIL (ModuleNotFoundError)

**Step 3: Implement GraphQueries**

Create `src/codetree/graph/queries.py`:

```python
from pathlib import Path
from .store import GraphStore
from .models import SymbolNode


class GraphQueries:
    def __init__(self, store: GraphStore):
        self._store = store

    def repository_map(self, include: list[str] | None = None, max_items: int = 5) -> dict:
        """Return a compact repo overview for agent onboarding."""
        conn = self._store._conn

        # Languages
        cur = conn.execute("SELECT language, COUNT(*) FROM files GROUP BY language ORDER BY COUNT(*) DESC")
        languages = {r[0]: r[1] for r in cur.fetchall() if r[0]}

        # Major paths (most common directory prefixes)
        cur = conn.execute("SELECT file_path FROM files")
        all_paths = [r[0] for r in cur.fetchall()]
        dir_counts: dict[str, int] = {}
        for fp in all_paths:
            parts = Path(fp).parts
            if len(parts) > 1:
                d = str(Path(*parts[:-1])) + "/"
                dir_counts[d] = dir_counts.get(d, 0) + 1
        major_paths = sorted(dir_counts, key=dir_counts.get, reverse=True)[:max_items]

        # Entry points
        cur = conn.execute(
            "SELECT qualified_name, file_path, start_line FROM symbols "
            "WHERE is_entry_point=1 LIMIT ?",
            (max_items,),
        )
        entry_points = [r[0] for r in cur.fetchall()]

        # Hotspots (most connected symbols)
        cur = conn.execute(
            "SELECT s.qualified_name, s.name, s.kind, s.file_path, s.start_line, "
            "COALESCE(ein.cnt, 0) + COALESCE(eout.cnt, 0) as degree "
            "FROM symbols s "
            "LEFT JOIN (SELECT target_qn, COUNT(*) as cnt FROM edges GROUP BY target_qn) ein "
            "ON s.qualified_name = ein.target_qn "
            "LEFT JOIN (SELECT source_qn, COUNT(*) as cnt FROM edges GROUP BY source_qn) eout "
            "ON s.qualified_name = eout.source_qn "
            "WHERE s.is_test = 0 "
            "ORDER BY degree DESC LIMIT ?",
            (max_items,),
        )
        hotspots = [
            {"qualified_name": r[0], "name": r[1], "kind": r[2], "file": r[3], "line": r[4], "degree": r[5]}
            for r in cur.fetchall()
        ]

        # Start here: entry points first, then hotspots, non-test only
        start_here = entry_points[:max_items]
        if len(start_here) < max_items:
            for h in hotspots:
                if h["qualified_name"] not in start_here and len(start_here) < max_items:
                    start_here.append(h["qualified_name"])

        # Test roots
        cur = conn.execute("SELECT DISTINCT file_path FROM files WHERE is_test=1")
        test_files = [r[0] for r in cur.fetchall()]
        test_dirs = set()
        for tf in test_files:
            parts = Path(tf).parts
            if len(parts) > 1:
                test_dirs.add(str(Path(*parts[:-1])) + "/")
            else:
                test_dirs.add("./")
        test_roots = sorted(test_dirs)[:max_items]

        stats = self._store.stats()

        return {
            "languages": languages,
            "major_paths": major_paths,
            "entry_points": entry_points,
            "hotspots": hotspots,
            "start_here": start_here,
            "test_roots": test_roots,
            "stats": stats,
        }

    def resolve_symbol(self, query: str, kind: str | None = None,
                       path_hint: str | None = None, limit: int = 10) -> list[SymbolNode]:
        """Disambiguate a short symbol name into ranked qualified matches."""
        conn = self._store._conn

        # Find all symbols matching the name (case-insensitive)
        cur = conn.execute(
            "SELECT qualified_name, name, kind, parent_qn, file_path, start_line, end_line, "
            "doc, params, is_test, is_entry_point FROM symbols WHERE name = ? COLLATE NOCASE",
            (query,),
        )
        candidates = [
            SymbolNode(
                qualified_name=r[0], name=r[1], kind=r[2], parent_qn=r[3],
                file_path=r[4], start_line=r[5], end_line=r[6],
                doc=r[7] or "", params=r[8] or "",
                is_test=bool(r[9]), is_entry_point=bool(r[10]),
            )
            for r in cur.fetchall()
        ]

        # Apply kind filter
        if kind:
            candidates = [c for c in candidates if c.kind == kind]

        # Rank candidates
        def score(sym: SymbolNode) -> tuple:
            # Higher is better for each component
            path_match = 1 if path_hint and path_hint in sym.file_path else 0
            not_test = 0 if sym.is_test else 1
            is_entry = 1 if sym.is_entry_point else 0
            # Count inbound edges as centrality proxy
            inbound = len(self._store.edges_to(sym.qualified_name))
            return (path_match, not_test, is_entry, inbound, sym.qualified_name)

        candidates.sort(key=score, reverse=True)
        return candidates[:limit]

    def search_graph(self, query: str | None = None, kind: str | None = None,
                     file_pattern: str | None = None, relationship: str | None = None,
                     direction: str | None = None, min_degree: int | None = None,
                     max_degree: int | None = None, limit: int = 10, offset: int = 0) -> dict:
        """Structured graph search with filters and pagination."""
        conn = self._store._conn

        # Build WHERE clause
        conditions = []
        params = []

        if query:
            conditions.append("s.name LIKE ?")
            params.append(f"%{query}%")
        if kind:
            conditions.append("s.kind = ?")
            params.append(kind)
        if file_pattern:
            conditions.append("s.file_path LIKE ?")
            params.append(f"%{file_pattern}%")

        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        # Get symbols with degree info
        sql = (
            "SELECT s.qualified_name, s.name, s.kind, s.file_path, s.start_line, s.end_line, "
            "COALESCE(ein.cnt, 0) as in_degree, COALESCE(eout.cnt, 0) as out_degree "
            "FROM symbols s "
            "LEFT JOIN (SELECT target_qn, COUNT(*) as cnt FROM edges GROUP BY target_qn) ein "
            "ON s.qualified_name = ein.target_qn "
            "LEFT JOIN (SELECT source_qn, COUNT(*) as cnt FROM edges GROUP BY source_qn) eout "
            "ON s.qualified_name = eout.source_qn "
            f"{where} "
            "ORDER BY (COALESCE(ein.cnt, 0) + COALESCE(eout.cnt, 0)) DESC"
        )

        cur = conn.execute(sql, params)
        all_results = cur.fetchall()

        # Apply degree filters in Python (simpler than SQL)
        filtered = []
        for r in all_results:
            in_deg, out_deg = r[6], r[7]
            total_deg = in_deg + out_deg
            if min_degree is not None and total_deg < min_degree:
                continue
            if max_degree is not None and total_deg > max_degree:
                continue
            if relationship and direction:
                # Check if symbol has specific relationship in given direction
                if direction == "inbound":
                    edges = self._store.edges_to(r[0], edge_type=relationship)
                else:
                    edges = self._store.edges_from(r[0], edge_type=relationship)
                if not edges:
                    continue
            filtered.append({
                "qualified_name": r[0],
                "name": r[1],
                "kind": r[2],
                "file_path": r[3],
                "start_line": r[4],
                "end_line": r[5],
                "in_degree": in_deg,
                "out_degree": out_deg,
            })

        total = len(filtered)
        page = filtered[offset:offset + limit]

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
            "results": page,
        }
```

**Step 4: Run query tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_graph_queries.py -v
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/codetree/graph/queries.py tests/test_graph_queries.py
git commit -m "feat: add graph queries — repository map, resolve symbol, search graph"
```

---

## Task 5: Wire Graph into Server + New MCP Tools (Phase 1-2)

**Files:**
- Modify: `src/codetree/server.py`
- Create: `tests/test_onboarding_tools.py`

**Step 1: Write the failing MCP tool tests**

Create `tests/test_onboarding_tools.py`:

```python
import pytest
import json
import tempfile
from pathlib import Path
from codetree.server import create_server


def _tool(mcp, name):
    key = f"tool:{name}@"
    tool = mcp.local_provider._components.get(key)
    return tool.fn


@pytest.fixture
def mcp_with_graph():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'class Calculator:\n'
            '    """A calculator class."""\n'
            '    def add(self, a, b):\n'
            '        return a + b\n'
            '    def sub(self, a, b):\n'
            '        return a - b\n'
        )
        (p / "main.py").write_text(
            'from calc import Calculator\n'
            'def main():\n'
            '    c = Calculator()\n'
            '    print(c.add(1, 2))\n'
        )
        (p / "test_calc.py").write_text(
            'def test_add():\n'
            '    assert 1 + 2 == 3\n'
        )
        mcp = create_server(str(p))
        yield mcp


class TestIndexStatus:
    def test_returns_graph_info(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "index_status")
        result = fn()
        assert "files" in result
        assert "symbols" in result
        assert "graph_exists" in result


class TestGetRepositoryMap:
    def test_returns_overview(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "get_repository_map")
        result = fn()
        assert "languages" in result
        assert "entry_points" in result
        assert "hotspots" in result
        assert "start_here" in result
        assert "stats" in result

    def test_max_items(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "get_repository_map")
        result = fn(max_items=1)
        assert len(result["hotspots"]) <= 1


class TestResolveSymbol:
    def test_finds_symbol(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "resolve_symbol")
        result = fn(query="Calculator")
        assert "matches" in result
        assert len(result["matches"]) >= 1
        assert result["matches"][0]["name"] == "Calculator"

    def test_no_match(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "resolve_symbol")
        result = fn(query="nonexistent_xyz")
        assert len(result["matches"]) == 0
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_onboarding_tools.py -v
```

Expected: FAIL (tools not registered)

**Step 3: Wire graph into create_server and add new tools**

Modify `src/codetree/server.py`. After the existing cache/indexer setup (around line 46), add graph initialization. Then add the new tool definitions before `return mcp`.

Add after `cache.save()` (line 46):

```python
    # ── Build persistent graph ───────────────────────────────────────────
    from .graph.store import GraphStore
    from .graph.builder import GraphBuilder
    from .graph.queries import GraphQueries

    graph_store = GraphStore(root)
    graph_store.open()
    graph_builder = GraphBuilder(root, graph_store)
    graph_builder.build()
    graph_queries = GraphQueries(graph_store)
```

Add new tools before `return mcp`:

```python
    @mcp.tool()
    def index_status() -> dict:
        """Report on graph index freshness and stats."""
        stats = graph_store.stats()
        last = graph_store.get_meta("last_indexed_at")
        return {
            "graph_exists": True,
            **stats,
            "last_indexed_at": last,
        }

    @mcp.tool()
    def get_repository_map(max_items: int = 5) -> dict:
        """Get a compact overview of the repository for onboarding.

        Returns languages, entry points, hotspots, recommended start_here symbols,
        and stats — everything an agent needs to orient in an unfamiliar repo.

        Args:
            max_items: maximum items per section (default 5)
        """
        return graph_queries.repository_map(max_items=max_items)

    @mcp.tool()
    def resolve_symbol(query: str, kind: str | None = None,
                       path_hint: str | None = None, limit: int = 10) -> dict:
        """Disambiguate a short symbol name into ranked qualified matches.

        Resolves ambiguous names like 'add' to specific qualified symbols
        ranked by relevance (path match, non-test preference, centrality).

        Args:
            query: symbol name to resolve
            kind: filter by type (function, class, method, etc.)
            path_hint: prefer results from files matching this path
            limit: max results (default 10)
        """
        results = graph_queries.resolve_symbol(query, kind=kind, path_hint=path_hint, limit=limit)
        return {
            "query": query,
            "matches": [
                {
                    "qualified_name": r.qualified_name,
                    "name": r.name,
                    "kind": r.kind,
                    "file": r.file_path,
                    "line": r.start_line,
                    "is_test": r.is_test,
                }
                for r in results
            ],
        }
```

**Step 4: Run onboarding tool tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_onboarding_tools.py -v
```

Expected: ALL PASS

**Step 5: Run full test suite**

Run:
```bash
source .venv/bin/activate
pytest
```

Expected: 921+ tests pass (all existing tests still pass)

**Step 6: Commit**

```bash
git add src/codetree/server.py tests/test_onboarding_tools.py
git commit -m "feat: wire graph into server, add index_status, get_repository_map, resolve_symbol tools"
```

---

## Task 6: Change Impact Tool (Phase 3)

**Files:**
- Modify: `src/codetree/graph/queries.py`
- Modify: `src/codetree/server.py`
- Create: `tests/test_change_impact.py`

**Step 1: Write the failing change impact tests**

Create `tests/test_change_impact.py`:

```python
import pytest
import subprocess
import tempfile
from pathlib import Path
from codetree.graph.store import GraphStore
from codetree.graph.builder import GraphBuilder
from codetree.graph.queries import GraphQueries
from codetree.server import create_server


def _tool(mcp, name):
    key = f"tool:{name}@"
    return mcp.local_provider._components.get(key).fn


@pytest.fixture
def impact_repo():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "calc.py").write_text(
            'def add(a, b):\n    return a + b\n'
            'def sub(a, b):\n    return a - b\n'
        )
        (p / "checkout.py").write_text(
            'from calc import add\n'
            'def process_order(items):\n'
            '    total = add(0, len(items))\n'
            '    return total\n'
        )
        (p / "api.py").write_text(
            'from checkout import process_order\n'
            'def handle_request(req):\n'
            '    return process_order(req["items"])\n'
        )
        (p / "test_calc.py").write_text(
            'from calc import add\n'
            'def test_add():\n'
            '    assert add(1, 2) == 3\n'
        )
        # Init git repo for diff tests
        subprocess.run(["git", "init"], cwd=tmp, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=tmp, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=tmp, capture_output=True,
                       env={"GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "t@t",
                            "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "t@t",
                            "HOME": tmp, "PATH": "/usr/bin:/bin:/usr/local/bin"})
        store = GraphStore(str(p))
        store.open()
        builder = GraphBuilder(str(p), store)
        builder.build()
        queries = GraphQueries(store)
        yield queries, store, p
        store.close()


class TestChangeImpactBySymbol:
    def test_direct_callers(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add")
        assert "impact" in result
        # process_order calls add, so it should be CRITICAL (hop 1)
        critical_names = [i["name"] for i in result["impact"].get("CRITICAL", [])]
        assert "process_order" in critical_names

    def test_transitive_callers(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add", depth=3)
        # handle_request calls process_order which calls add (hop 2 = HIGH)
        high_names = [i["name"] for i in result["impact"].get("HIGH", [])]
        assert "handle_request" in high_names

    def test_affected_tests(self, impact_repo):
        queries, _, _ = impact_repo
        result = queries.change_impact(symbol_query="add")
        test_names = [t["name"] for t in result.get("affected_tests", [])]
        assert "test_add" in test_names


class TestChangeImpactByDiff:
    def test_working_tree_changes(self, impact_repo):
        queries, _, repo_dir = impact_repo
        # Modify calc.py (working tree change)
        (repo_dir / "calc.py").write_text(
            'def add(a, b):\n    return a + b + 0  # changed\n'
            'def sub(a, b):\n    return a - b\n'
        )
        result = queries.change_impact(diff_scope="working", root=str(repo_dir))
        assert len(result["changed_symbols"]) > 0


class TestChangeImpactMCPTool:
    def test_tool_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "calc.py").write_text('def add(a, b):\n    return a + b\n')
            mcp = create_server(str(p))
            fn = _tool(mcp, "get_change_impact")
            result = fn(symbol_query="add")
            assert "impact" in result
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_change_impact.py -v
```

Expected: FAIL

**Step 3: Add change_impact to GraphQueries**

Add to `src/codetree/graph/queries.py`:

```python
    def change_impact(self, symbol_query: str | None = None,
                      diff_scope: str | None = None,
                      root: str | None = None, depth: int = 3) -> dict:
        """Analyze impact of a change — by explicit symbol or git diff.

        Args:
            symbol_query: symbol name to analyze impact for
            diff_scope: "working", "staged", or "HEAD~N" to use git diff
            root: repo root path (needed for git diff)
            depth: max hop depth for transitive analysis
        """
        changed_qns = []

        if diff_scope and root:
            changed_qns = self._symbols_from_diff(diff_scope, root)
        elif symbol_query:
            syms = self._store.symbols_by_name(symbol_query)
            changed_qns = [s.qualified_name for s in syms if not s.is_test]

        if not changed_qns:
            return {"changed_symbols": [], "impact": {}, "affected_tests": []}

        # BFS through reverse call edges
        risk_labels = {1: "CRITICAL", 2: "HIGH", 3: "MEDIUM"}
        impact: dict[str, list] = {}
        affected_tests = []
        visited = set(changed_qns)
        queue = [(qn, 0) for qn in changed_qns]

        while queue:
            current_qn, current_depth = queue.pop(0)
            if current_depth >= depth:
                continue
            callers = self._store.edges_to(current_qn, edge_type="CALLS")
            for edge in callers:
                caller_qn = edge.source_qn
                if caller_qn in visited or caller_qn.startswith("?::"):
                    continue
                visited.add(caller_qn)
                hop = current_depth + 1
                sym = self._store.get_symbol(caller_qn)
                if sym is None:
                    continue
                entry = {
                    "qualified_name": caller_qn,
                    "name": sym.name,
                    "file": sym.file_path,
                    "line": sym.start_line,
                    "hop": hop,
                }
                if sym.is_test:
                    affected_tests.append(entry)
                else:
                    label = risk_labels.get(hop, "LOW")
                    impact.setdefault(label, []).append(entry)
                queue.append((caller_qn, hop))

        # Also find tests via TESTS edges
        for qn in changed_qns:
            test_edges = self._store.edges_to(qn, edge_type="TESTS")
            for e in test_edges:
                sym = self._store.get_symbol(e.source_qn)
                if sym and sym.qualified_name not in visited:
                    affected_tests.append({
                        "qualified_name": sym.qualified_name,
                        "name": sym.name,
                        "file": sym.file_path,
                        "line": sym.start_line,
                        "hop": 0,
                    })

        changed_info = []
        for qn in changed_qns:
            sym = self._store.get_symbol(qn)
            if sym:
                changed_info.append({"qualified_name": qn, "name": sym.name, "file": sym.file_path})

        return {
            "changed_symbols": changed_info,
            "impact": impact,
            "affected_tests": affected_tests,
        }

    def _symbols_from_diff(self, diff_scope: str, root: str) -> list[str]:
        """Extract changed symbol qualified names from git diff."""
        import subprocess

        if diff_scope == "working":
            cmd = ["git", "diff", "--name-only"]
        elif diff_scope == "staged":
            cmd = ["git", "diff", "--staged", "--name-only"]
        else:
            cmd = ["git", "diff", diff_scope, "--name-only"]

        try:
            result = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=10)
            changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        except Exception:
            return []

        changed_qns = []
        for fp in changed_files:
            syms = self._store.symbols_by_file(fp)
            changed_qns.extend(s.qualified_name for s in syms if not s.is_test)
        return changed_qns
```

**Step 4: Add get_change_impact tool to server.py**

Add to `src/codetree/server.py` before `return mcp`:

```python
    @mcp.tool()
    def get_change_impact(symbol_query: str | None = None,
                          diff_scope: str | None = None, depth: int = 3) -> dict:
        """Analyze impact of a change — by explicit symbol or git diff.

        Shows direct/transitive callers with risk classification and affected tests.

        Args:
            symbol_query: symbol name to analyze (e.g., "add")
            diff_scope: "working" (uncommitted), "staged", or "HEAD~1" for git-based analysis
            depth: max hop depth (default 3)
        """
        return graph_queries.change_impact(
            symbol_query=symbol_query,
            diff_scope=diff_scope,
            root=root,
            depth=depth,
        )
```

**Step 5: Run change impact tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_change_impact.py -v
```

Expected: ALL PASS

**Step 6: Run full test suite**

Run:
```bash
source .venv/bin/activate
pytest
```

Expected: 921+ tests pass

**Step 7: Commit**

```bash
git add src/codetree/graph/queries.py src/codetree/server.py tests/test_change_impact.py
git commit -m "feat: add get_change_impact tool with git-diff-aware blast radius and risk classification"
```

---

## Task 7: search_graph MCP Tool

**Files:**
- Modify: `src/codetree/server.py`
- Modify: `tests/test_onboarding_tools.py`

**Step 1: Add search_graph tool tests**

Add to `tests/test_onboarding_tools.py`:

```python
class TestSearchGraph:
    def test_search_by_query(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(query="add")
        assert result["total"] > 0

    def test_search_by_kind(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(kind="class")
        assert all(r["kind"] == "class" for r in result["results"])

    def test_pagination(self, mcp_with_graph):
        fn = _tool(mcp_with_graph, "search_graph")
        result = fn(limit=1)
        assert len(result["results"]) <= 1
        assert "has_more" in result
```

**Step 2: Add search_graph tool to server.py**

Add before `return mcp`:

```python
    @mcp.tool()
    def search_graph(query: str | None = None, kind: str | None = None,
                     file_pattern: str | None = None, relationship: str | None = None,
                     direction: str | None = None, min_degree: int | None = None,
                     max_degree: int | None = None, limit: int = 10, offset: int = 0) -> dict:
        """Search the code graph with flexible filters and pagination.

        Args:
            query: case-insensitive substring match on symbol name
            kind: exact type filter (function, class, method, struct, etc.)
            file_pattern: substring match on file path
            relationship: edge type filter (CALLS, IMPORTS, CONTAINS)
            direction: "inbound" or "outbound" (used with relationship)
            min_degree: minimum total connections
            max_degree: maximum total connections (0 = isolated/dead code)
            limit: max results per page (default 10)
            offset: pagination offset (default 0)
        """
        return graph_queries.search_graph(
            query=query, kind=kind, file_pattern=file_pattern,
            relationship=relationship, direction=direction,
            min_degree=min_degree, max_degree=max_degree,
            limit=limit, offset=offset,
        )
```

**Step 3: Run tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_onboarding_tools.py -v
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/codetree/server.py tests/test_onboarding_tools.py
git commit -m "feat: add search_graph MCP tool with pagination and degree filtering"
```

---

## Task 8: Dataflow Analysis (Phase 4 — The Differentiator)

**Files:**
- Create: `src/codetree/graph/dataflow.py`
- Create: `tests/test_dataflow.py`

**Step 1: Write the failing dataflow tests**

Create `tests/test_dataflow.py`:

```python
import pytest
import tempfile
from pathlib import Path
from codetree.indexer import Indexer
from codetree.graph.dataflow import extract_dataflow, extract_taint_paths


@pytest.fixture
def py_indexer():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "app.py").write_text(
            'def process(request):\n'
            '    user_input = request.get("name")\n'
            '    cleaned = sanitize(user_input)\n'
            '    query = f"SELECT * FROM users WHERE name = {cleaned}"\n'
            '    db.execute(query)\n'
        )
        (p / "unsafe.py").write_text(
            'def handle(request):\n'
            '    data = request.get("id")\n'
            '    db.execute(f"DELETE FROM users WHERE id = {data}")\n'
        )
        (p / "simple.py").write_text(
            'def add(a, b):\n'
            '    result = a + b\n'
            '    return result\n'
        )
        idx = Indexer(str(p))
        idx.build()
        yield idx, p


class TestDataflow:
    def test_tracks_assignment_chain(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["app.py"]
        result = extract_dataflow(entry.plugin, entry.source, "process")
        assert result is not None
        # user_input depends on request
        var_names = {v["name"] for v in result["variables"]}
        assert "user_input" in var_names
        assert "cleaned" in var_names
        assert "query" in var_names

    def test_dependency_edges(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["app.py"]
        result = extract_dataflow(entry.plugin, entry.source, "process")
        # cleaned depends on user_input
        cleaned = next(v for v in result["variables"] if v["name"] == "cleaned")
        assert "user_input" in cleaned["depends_on"]

    def test_identifies_sinks(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["app.py"]
        result = extract_dataflow(entry.plugin, entry.source, "process")
        sink_exprs = [s["expr"] for s in result["sinks"]]
        assert any("execute" in s for s in sink_exprs)

    def test_simple_function(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["simple.py"]
        result = extract_dataflow(entry.plugin, entry.source, "add")
        assert result is not None
        var_names = {v["name"] for v in result["variables"]}
        assert "result" in var_names

    def test_function_not_found(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["simple.py"]
        result = extract_dataflow(entry.plugin, entry.source, "nonexistent")
        assert result is None


class TestTaintPaths:
    def test_safe_path_with_sanitizer(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["app.py"]
        result = extract_taint_paths(entry.plugin, entry.source, "process")
        # Has a sanitize() call in the chain, so should be SAFE
        safe_paths = [p for p in result["paths"] if p["verdict"] == "SAFE"]
        assert len(safe_paths) > 0

    def test_unsafe_path_without_sanitizer(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["unsafe.py"]
        result = extract_taint_paths(entry.plugin, entry.source, "handle")
        # No sanitizer between request.get and db.execute
        unsafe_paths = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
        assert len(unsafe_paths) > 0

    def test_no_taint_in_simple_function(self, py_indexer):
        idx, _ = py_indexer
        entry = idx._index["simple.py"]
        result = extract_taint_paths(entry.plugin, entry.source, "add")
        # No external sources or dangerous sinks
        assert len(result["paths"]) == 0
```

**Step 2: Run tests to verify they fail**

Run:
```bash
source .venv/bin/activate
pytest tests/test_dataflow.py -v
```

Expected: FAIL (ModuleNotFoundError)

**Step 3: Implement dataflow analysis**

Create `src/codetree/graph/dataflow.py`:

```python
"""Intra-function dataflow and taint analysis using tree-sitter AST."""

from ..languages.base import LanguagePlugin

# Known taint sources — method calls that return external/untrusted data
TAINT_SOURCES = {
    "request.get", "request.form", "request.args", "request.json",
    "request.data", "request.values", "request.files",
    "input", "raw_input",
    "sys.stdin.read", "sys.stdin.readline",
    "os.environ.get", "os.environ",
    "open", "read", "readline", "readlines",
}

# Known sinks — calls where tainted data is dangerous
TAINT_SINKS = {
    "db.execute", "cursor.execute", "connection.execute",
    "os.system", "os.popen",
    "subprocess.run", "subprocess.call", "subprocess.Popen", "subprocess.check_output",
    "eval", "exec", "compile",
    "open().write", "write",
}

# Known sanitizers — calls that make data safe
SANITIZERS = {
    "sanitize", "escape", "html.escape", "markupsafe.escape",
    "bleach.clean", "urllib.parse.quote",
    "parameterize", "quote", "sanitize_input",
    "int", "float", "bool",  # type casting is a form of sanitization
}


def extract_dataflow(plugin: LanguagePlugin, source: bytes, fn_name: str) -> dict | None:
    """Extract intra-function variable dataflow from AST.

    Returns:
        {
            "variables": [{"name", "line", "depends_on": [str], "source_expr": str}],
            "flow_chains": [[var1, var2, ...] ordered by dependency],
            "sources": [{"expr", "line", "kind"}],
            "sinks": [{"expr", "line", "kind"}],
        }
    """
    # Get function source
    result = plugin.extract_symbol_source(source, fn_name)
    if result is None:
        return None

    fn_source, start_line = result
    fn_bytes = fn_source.encode("utf-8", errors="replace")

    # Get variables from plugin
    variables_raw = plugin.extract_variables(fn_bytes, fn_name)

    # Parse the function to walk assignments
    parser = plugin._get_parser()
    tree = parser.parse(fn_bytes)
    root = tree.root_node

    # Find the function body
    fn_body = _find_function_body(root, fn_name)
    if fn_body is None:
        # If we can't find the function in its own source, use root
        fn_body = root

    variables = []
    all_var_names = set()

    # Walk assignment nodes to build dependency graph
    _walk_assignments(fn_body, variables, all_var_names, start_line)

    # Identify sources and sinks from call expressions
    sources = []
    sinks = []
    _walk_calls(fn_body, sources, sinks, all_var_names, start_line)

    # Build flow chains (topological sort of dependencies)
    flow_chains = _build_flow_chains(variables)

    return {
        "variables": variables,
        "flow_chains": flow_chains,
        "sources": sources,
        "sinks": sinks,
    }


def extract_taint_paths(plugin: LanguagePlugin, source: bytes, fn_name: str) -> dict | None:
    """Analyze taint paths from sources to sinks.

    Returns:
        {
            "paths": [
                {"verdict": "SAFE"|"UNSAFE", "chain": [str], "sanitizer": str|None, "risk": str|None}
            ]
        }
    """
    flow = extract_dataflow(plugin, source, fn_name)
    if flow is None:
        return {"paths": []}

    # Build variable dependency map
    dep_map: dict[str, list[str]] = {}
    for v in flow["variables"]:
        dep_map[v["name"]] = v["depends_on"]

    # Build call map — which variables pass through which function calls
    call_map: dict[str, str] = {}  # var_name → call_expr that produces it
    for v in flow["variables"]:
        expr = v.get("source_expr", "")
        if "(" in expr:
            call_map[v["name"]] = expr

    paths = []

    # For each sink, trace backward to see if any taint source reaches it
    for sink in flow["sinks"]:
        sink_expr = sink["expr"]
        # Find variables used in the sink call
        sink_vars = _extract_identifiers_from_expr(sink_expr)

        for sv in sink_vars:
            # Trace backward through dependencies
            chain = _trace_backward(sv, dep_map, call_map)
            if not chain:
                continue

            # Check if any source in the chain is a taint source
            has_taint = False
            taint_source = None
            for var_name in chain:
                expr = call_map.get(var_name, "")
                for src in TAINT_SOURCES:
                    if src in expr:
                        has_taint = True
                        taint_source = expr
                        break
                if has_taint:
                    break

            if not has_taint:
                continue

            # Check if any sanitizer exists in the chain
            sanitizer = None
            for var_name in chain:
                expr = call_map.get(var_name, "")
                for san in SANITIZERS:
                    if san in expr:
                        sanitizer = san
                        break
                if sanitizer:
                    break

            chain_strs = chain + [sink_expr]
            if sanitizer:
                paths.append({
                    "verdict": "SAFE",
                    "chain": chain_strs,
                    "sanitizer": sanitizer,
                    "risk": None,
                })
            else:
                # Determine risk type
                risk = "unknown"
                if "execute" in sink_expr:
                    risk = "SQL injection"
                elif "system" in sink_expr or "subprocess" in sink_expr:
                    risk = "Command injection"
                elif "eval" in sink_expr or "exec" in sink_expr:
                    risk = "Code injection"

                paths.append({
                    "verdict": "UNSAFE",
                    "chain": chain_strs,
                    "sanitizer": None,
                    "risk": risk,
                })

    return {"paths": paths}


def _find_function_body(root, fn_name: str):
    """Find the body node of a function by name."""
    for node in _walk_tree(root):
        if node.type in ("function_definition", "function_declaration", "method_definition"):
            for child in node.children:
                if child.type in ("identifier", "property_identifier") and child.text:
                    if child.text.decode("utf-8", errors="replace") == fn_name:
                        # Return the body/block child
                        for c in node.children:
                            if c.type in ("block", "statement_block", "compound_statement"):
                                return c
                        return node
    return None


def _walk_tree(node):
    """Depth-first walk of all nodes."""
    yield node
    for child in node.children:
        yield from _walk_tree(child)


def _walk_assignments(node, variables: list, all_var_names: set, line_offset: int):
    """Walk AST to find assignments and their dependencies."""
    for n in _walk_tree(node):
        if n.type == "assignment":
            left = None
            right = None
            for child in n.children:
                if child.type == "identifier" and left is None:
                    left = child
                elif child.type == "=" or child.type == "assignment_operator":
                    continue
                elif left is not None and right is None:
                    right = child

            if left and right:
                var_name = left.text.decode("utf-8", errors="replace")
                if var_name in ("self", "cls"):
                    continue
                all_var_names.add(var_name)
                rhs_text = right.text.decode("utf-8", errors="replace") if right.text else ""
                deps = _extract_identifiers_from_node(right, all_var_names)
                line = (left.start_point[0] + line_offset) if hasattr(left, 'start_point') else 0

                variables.append({
                    "name": var_name,
                    "line": line,
                    "depends_on": list(deps),
                    "source_expr": rhs_text,
                })


def _extract_identifiers_from_node(node, known_vars: set) -> set[str]:
    """Extract identifier names from an AST node that match known variables."""
    ids = set()
    for n in _walk_tree(node):
        if n.type == "identifier" and n.text:
            name = n.text.decode("utf-8", errors="replace")
            if name in known_vars:
                ids.add(name)
    return ids


def _extract_identifiers_from_expr(expr: str) -> list[str]:
    """Simple text-based identifier extraction from an expression string."""
    import re
    return re.findall(r'\b([a-zA-Z_]\w*)\b', expr)


def _walk_calls(node, sources: list, sinks: list, var_names: set, line_offset: int):
    """Find function calls that are taint sources or sinks."""
    for n in _walk_tree(node):
        if n.type == "call" or n.type == "call_expression":
            call_text = n.text.decode("utf-8", errors="replace") if n.text else ""
            line = (n.start_point[0] + line_offset) if hasattr(n, 'start_point') else 0

            # Check if it's a known source
            for src in TAINT_SOURCES:
                if src in call_text:
                    sources.append({"expr": call_text, "line": line, "kind": "external_input"})
                    break

            # Check if it's a known sink
            for sink in TAINT_SINKS:
                if sink in call_text:
                    sinks.append({"expr": call_text, "line": line, "kind": _sink_kind(sink)})
                    break


def _sink_kind(sink_name: str) -> str:
    if "execute" in sink_name:
        return "database"
    if "system" in sink_name or "subprocess" in sink_name:
        return "shell"
    if "eval" in sink_name or "exec" in sink_name:
        return "code_execution"
    return "output"


def _build_flow_chains(variables: list) -> list[list[str]]:
    """Build ordered flow chains from variable dependencies."""
    chains = []
    visited = set()

    for v in variables:
        if v["name"] in visited:
            continue
        chain = _trace_forward(v["name"], variables, visited)
        if len(chain) > 1:
            chains.append(chain)

    return chains


def _trace_forward(start: str, variables: list, visited: set) -> list[str]:
    """Trace forward from a variable through its dependents."""
    chain = [start]
    visited.add(start)
    # Find variables that depend on start
    for v in variables:
        if start in v["depends_on"] and v["name"] not in visited:
            chain.extend(_trace_forward(v["name"], variables, visited))
    return chain


def _trace_backward(var_name: str, dep_map: dict, call_map: dict,
                    visited: set | None = None, max_depth: int = 20) -> list[str]:
    """Trace backward from a variable to its origins."""
    if visited is None:
        visited = set()
    if var_name in visited or max_depth <= 0:
        return []
    visited.add(var_name)

    deps = dep_map.get(var_name, [])
    if not deps:
        return [var_name]

    chain = []
    for dep in deps:
        sub_chain = _trace_backward(dep, dep_map, call_map, visited, max_depth - 1)
        chain.extend(sub_chain)
    chain.append(var_name)
    return chain
```

**Step 4: Run dataflow tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_dataflow.py -v
```

Expected: ALL PASS (may need minor adjustments based on exact AST node types)

**Step 5: Commit**

```bash
git add src/codetree/graph/dataflow.py tests/test_dataflow.py
git commit -m "feat: add intra-function dataflow and taint analysis"
```

---

## Task 9: Dataflow MCP Tools

**Files:**
- Modify: `src/codetree/server.py`
- Create: `tests/test_dataflow_tools.py`

**Step 1: Write the failing MCP tool tests**

Create `tests/test_dataflow_tools.py`:

```python
import pytest
import tempfile
from pathlib import Path
from codetree.server import create_server


def _tool(mcp, name):
    key = f"tool:{name}@"
    return mcp.local_provider._components.get(key).fn


@pytest.fixture
def mcp_with_dataflow():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        (p / "app.py").write_text(
            'def process(request):\n'
            '    user_input = request.get("name")\n'
            '    cleaned = sanitize(user_input)\n'
            '    query = f"SELECT * FROM users WHERE name = {cleaned}"\n'
            '    db.execute(query)\n'
        )
        (p / "unsafe.py").write_text(
            'def handle(request):\n'
            '    data = request.get("id")\n'
            '    db.execute(f"DELETE FROM users WHERE id = {data}")\n'
        )
        mcp = create_server(str(p))
        yield mcp


class TestGetDataflow:
    def test_returns_variables(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_dataflow")
        result = fn(file_path="app.py", function_name="process")
        assert "variables" in result
        var_names = {v["name"] for v in result["variables"]}
        assert "user_input" in var_names

    def test_returns_sinks(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_dataflow")
        result = fn(file_path="app.py", function_name="process")
        assert len(result["sinks"]) > 0

    def test_file_not_found(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_dataflow")
        result = fn(file_path="nope.py", function_name="foo")
        assert "error" in result


class TestGetTaintPaths:
    def test_safe_path(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_taint_paths")
        result = fn(file_path="app.py", function_name="process")
        safe = [p for p in result["paths"] if p["verdict"] == "SAFE"]
        assert len(safe) > 0

    def test_unsafe_path(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_taint_paths")
        result = fn(file_path="unsafe.py", function_name="handle")
        unsafe = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
        assert len(unsafe) > 0
        assert unsafe[0]["risk"] is not None

    def test_file_not_found(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "get_taint_paths")
        result = fn(file_path="nope.py", function_name="foo")
        assert "error" in result
```

**Step 2: Add dataflow tools to server.py**

Add to `src/codetree/server.py` before `return mcp`:

```python
    @mcp.tool()
    def get_dataflow(file_path: str, function_name: str) -> dict:
        """Get intra-function variable dataflow analysis.

        Traces how data flows through variable assignments within a function.
        Shows dependency chains, external sources, and dangerous sinks.

        Args:
            file_path: path relative to the repo root
            function_name: name of the function to analyze
        """
        from .graph.dataflow import extract_dataflow

        entry = indexer._index.get(file_path)
        if entry is None:
            return {"error": f"File not found: {file_path}"}
        result = extract_dataflow(entry.plugin, entry.source, function_name)
        if result is None:
            return {"error": f"Function '{function_name}' not found in {file_path}"}
        return result

    @mcp.tool()
    def get_taint_paths(file_path: str, function_name: str) -> dict:
        """Analyze security taint paths from untrusted sources to dangerous sinks.

        Traces whether user input (request data, env vars, file reads) reaches
        sensitive operations (SQL queries, shell commands, eval) without passing
        through a sanitizer.

        Args:
            file_path: path relative to the repo root
            function_name: name of the function to analyze
        """
        from .graph.dataflow import extract_taint_paths

        entry = indexer._index.get(file_path)
        if entry is None:
            return {"error": f"File not found: {file_path}"}
        result = extract_taint_paths(entry.plugin, entry.source, function_name)
        if result is None:
            return {"error": f"Function '{function_name}' not found in {file_path}"}
        return result
```

**Step 3: Run dataflow tool tests**

Run:
```bash
source .venv/bin/activate
pytest tests/test_dataflow_tools.py -v
```

Expected: ALL PASS

**Step 4: Run full test suite**

Run:
```bash
source .venv/bin/activate
pytest
```

Expected: ALL tests pass

**Step 5: Commit**

```bash
git add src/codetree/server.py tests/test_dataflow_tools.py
git commit -m "feat: add get_dataflow and get_taint_paths MCP tools"
```

---

## Task 10: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Update the tool count from 16 to 22. Add the 6 new tool rows to the table:

| Tool | Purpose | Returns |
|------|---------|---------|
| `index_status()` | Graph index freshness and stats | `{graph_exists, files, symbols, edges}` |
| `get_repository_map(max_items?)` | Compact repo overview for onboarding | `{languages, entry_points, hotspots, start_here, stats}` |
| `resolve_symbol(query, kind?, path_hint?)` | Disambiguate short symbol names | `{matches: [{qualified_name, name, kind, file, line}]}` |
| `search_graph(query?, kind?, ...)` | Structured graph search with pagination | `{total, results: [{qualified_name, kind, in_degree, out_degree}]}` |
| `get_change_impact(symbol_query?, diff_scope?)` | Git-aware change impact with risk classification | `{changed_symbols, impact: {CRITICAL, HIGH, MEDIUM}, affected_tests}` |
| `get_dataflow(file_path, function_name)` | Intra-function variable flow tracking | `{variables, flow_chains, sources, sinks}` |
| `get_taint_paths(file_path, function_name)` | Security taint analysis | `{paths: [{verdict, chain, sanitizer, risk}]}` |

Update the architecture section to mention the graph layer. Update the test count.

**Step 2: Run tests one final time**

Run:
```bash
source .venv/bin/activate
pytest
```

Expected: ALL pass

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md for Phase 6 — graph, onboarding, dataflow, taint"
```

---

## Summary

| Task | What Ships | New Tests |
|------|-----------|-----------|
| 1 | Graph data models (SymbolNode, Edge, qualified names) | — |
| 2 | SQLite graph store (CRUD, schema, indexes) | ~20 tests |
| 3 | Incremental graph builder (sha256 hashing, edge extraction) | ~8 tests |
| 4 | Graph queries (repo map, resolve symbol, search) | ~15 tests |
| 5 | Server wiring + 3 MCP tools (index_status, get_repository_map, resolve_symbol) | ~6 tests |
| 6 | Change impact tool (git diff, BFS, risk classification) | ~5 tests |
| 7 | search_graph MCP tool | ~3 tests |
| 8 | Dataflow analysis engine (AST-based variable tracking) | ~7 tests |
| 9 | Dataflow MCP tools (get_dataflow, get_taint_paths) | ~6 tests |
| 10 | Documentation update | — |

**Total: 10 tasks, ~70 new tests, 7 new MCP tools (22 total)**
