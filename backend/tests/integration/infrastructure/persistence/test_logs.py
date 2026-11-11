"""Log transactions recover without interrupting inference."""
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.infrastructure.persistence.inference_logs import InferenceLogStore


def test_concurrent_logs_are_persisted_and_queryable(tmp_path):
    store = InferenceLogStore(tmp_path / "logs.db")
    with ThreadPoolExecutor(max_workers=6) as executor:
        records = list(executor.map(lambda i: store.write(
            "inference_completed", f"window {i}", camera=f"cam{i % 2}",
            processing_ms=i, window_id=str(i)), range(24)))
    assert store.list()["total"] == 24
    assert store.list(camera="cam0")["total"] == 12
    assert store.get(records[0]["id"]) == records[0]
    assert len({record["id"] for record in records}) == 24


def test_schema_commits_separately_and_only_once(monkeypatch):
    import app.infrastructure.persistence.inference_logs as module
    operations = []

    class Connection:
        def execute(self, statement, parameters=None):
            operations.append(statement)

        def __enter__(self):
            return self

        def __exit__(self, kind, value, traceback):
            operations.append("ROLLBACK" if kind else "COMMIT")

        def close(self):
            operations.append("CLOSE")

    monkeypatch.setattr(module, "connect", lambda _: Connection())
    store = InferenceLogStore("postgresql://unused")
    store.write("inference_completed", "first")
    ddl = [i for i, value in enumerate(operations) if value.startswith("CREATE")]
    insert = next(i for i, value in enumerate(operations) if value.startswith("INSERT"))
    assert len(ddl) == 3
    assert operations.index("SELECT pg_advisory_xact_lock(734821906)") < min(ddl)
    assert max(ddl) < operations.index("COMMIT") < insert
    operations.clear()
    store.write("inference_completed", "second")
    assert not any(value.startswith("CREATE") for value in operations)


@pytest.mark.parametrize("sqlstate,failures,expected_attempts", [
    ("40P01", 2, 3), ("40001", 1, 2), ("40P01", 3, 3), ("23503", 1, 1)])
def test_log_retry_rolls_back_and_preserves_identity(monkeypatch, sqlstate, failures, expected_attempts):
    import app.infrastructure.persistence.inference_logs as module
    attempts, outcomes, closed, pauses = [], [], [], []

    class Failure(Exception):
        pass

    error = Failure("database error")
    error.sqlstate = sqlstate

    class Connection:
        def execute(self, statement, parameters=None):
            attempts.append(parameters)
            if len(attempts) <= failures:
                raise error

        def __enter__(self):
            return self

        def __exit__(self, kind, value, traceback):
            outcomes.append("rollback" if kind else "commit")

        def close(self):
            closed.append(1)

    store = InferenceLogStore("unused.db")
    monkeypatch.setattr(store, "connect", Connection)
    monkeypatch.setattr(module.time, "sleep", pauses.append)
    # emit must still swallow an exhausted or non-retryable storage failure.
    record = store.emit("inference_completed", "window", camera="cam")
    succeeds = failures < expected_attempts
    assert (record is not None) == succeeds
    assert len(attempts) == len(closed) == expected_attempts
    assert len(set(attempts)) == 1
    assert outcomes == ["rollback"] * min(failures, expected_attempts) + (["commit"] if succeeds else [])
    assert len(pauses) == expected_attempts - 1
