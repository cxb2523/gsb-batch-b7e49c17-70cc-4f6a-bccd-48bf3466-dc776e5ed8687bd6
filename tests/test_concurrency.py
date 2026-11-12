"""Regression tests for GraphStore thread safety.

These tests use real threading.Thread objects to verify that concurrent
SQLite access via GraphStore does not produce "database is locked" errors,
data corruption, or _in_transaction flag races.
"""

import threading
import tempfile

import pytest

from codetree.graph.store import GraphStore
from codetree.graph.models import SymbolNode, Edge


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as tmp:
        s = GraphStore(tmp)
        s.open()
        yield s
        s.close()


def _make_sym(name: str, file: str = "a.py") -> SymbolNode:
    return SymbolNode(
        qualified_name=f"{file}::{name}",
        name=name,
        kind="function",
        file_path=file,
        start_line=1,
        end_line=5,
    )


class TestGraphStoreConcurrency:

    def test_concurrent_upserts_no_exception(self, store):
        """50 symbols from thread A and 50 from thread B — no exception, 100 total."""
        errors = []

        def insert_batch(prefix: str, count: int):
            try:
                for i in range(count):
                    store.upsert_symbol(_make_sym(f"{prefix}_{i}", file=f"{prefix}.py"))
            except Exception as e:
                errors.append(e)

        t1 = threading.Thread(target=insert_batch, args=("alpha", 50))
        t2 = threading.Thread(target=insert_batch, args=("beta", 50))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert errors == [], f"Concurrent upserts raised: {errors}"
        result = store.stats()
        assert result["symbols"] == 100

    def test_concurrent_reads_no_exception(self, store):
        """Two threads both call stats() simultaneously — no error."""
        store.upsert_symbol(_make_sym("foo"))
        errors = []

        def read_stats():
            try:
                for _ in range(20):
                    store.stats()
            except Exception as e:
                errors.append(e)

        t1 = threading.Thread(target=read_stats)
        t2 = threading.Thread(target=read_stats)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert errors == [], f"Concurrent reads raised: {errors}"

    def test_concurrent_read_write_no_exception(self, store):
        """Thread A reads stats while thread B upserts — no 'database is locked'."""
        errors = []

        def writer():
            try:
                for i in range(30):
                    store.upsert_symbol(_make_sym(f"w_{i}", file="write.py"))
            except Exception as e:
                errors.append(("writer", e))

        def reader():
            try:
                for _ in range(30):
                    store.stats()
            except Exception as e:
                errors.append(("reader", e))

        t1 = threading.Thread(target=writer)
        t2 = threading.Thread(target=reader)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert errors == [], f"Concurrent read/write raised: {errors}"

    def test_in_transaction_flag_thread_safe(self, store):
        """begin()/commit() from a thread — _in_transaction ends False."""
        errors = []

        def transaction_cycle():
            try:
                for _ in range(10):
                    store.begin()
                    store.upsert_symbol(_make_sym("txn_sym", file="tx.py"))
                    store.commit()
            except Exception as e:
                errors.append(e)

        # NOTE: This test does NOT run two transactions in parallel (that would
        # cause logical conflicts). Instead it verifies no exception and that
        # the flag ends in a consistent state.
        t1 = threading.Thread(target=transaction_cycle)
        t1.start()
        t1.join()
        assert errors == [], f"Transaction cycle raised: {errors}"
        with store._lock:
            assert store._in_transaction is False

    def test_execute_concurrent_selects(self, store):
        """Two threads call execute('SELECT 1') simultaneously — both get 1."""
        results = {}

        def do_select(key: str):
            cur = store.execute("SELECT 1")
            results[key] = cur.fetchone()[0]

        t1 = threading.Thread(target=do_select, args=("a",))
        t2 = threading.Thread(target=do_select, args=("b",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert results == {"a": 1, "b": 1}

    def test_lock_attribute_exists(self, store):
        """GraphStore has _lock and it is a threading.Lock (acquirable)."""
        assert hasattr(store, "_lock")
        # Lock() returns a _thread.lock — verify it's acquirable and releasable
        assert store._lock.acquire(blocking=False)
        store._lock.release()

    def test_mcp_tools_concurrent_graph_calls(self):
        """Integration: two threads invoke different graph MCP tools concurrently — no exception.

        This proves the lock works end-to-end through the MCP layer, not just
        at the GraphStore unit level.
        """
        from pathlib import Path
        from codetree.server import create_server

        errors = []

        with tempfile.TemporaryDirectory() as tmp:
            # Create a minimal Python file so the indexer has something to work with
            (Path(tmp) / "hello.py").write_text("def greet(): pass\n")
            mcp = create_server(tmp)
            tools = {
                c.split("@")[0].replace("tool:", ""): v.fn
                for c, v in mcp.local_provider._components.items()
                if c.startswith("tool:")
            }

            def call_index_status():
                try:
                    for _ in range(10):
                        tools["index_status"]()
                except Exception as e:
                    errors.append(("index_status", e))

            def call_search_graph():
                try:
                    for _ in range(10):
                        tools["search_graph"]()
                except Exception as e:
                    errors.append(("search_graph", e))

            t1 = threading.Thread(target=call_index_status)
            t2 = threading.Thread(target=call_search_graph)
            t1.start()
            t2.start()
            t1.join()
            t2.join()

        assert errors == [], f"Concurrent MCP graph tool calls raised: {errors}"
