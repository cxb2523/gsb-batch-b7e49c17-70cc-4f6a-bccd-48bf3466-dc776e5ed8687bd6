"""Cross-function taint propagation driven by real call sites.

The previous implementation guessed whether a tainted variable was passed
to a callee by scanning the function source for literal ``callee(var``
fragments. These tests pin down position-based propagation instead:

* two-file, two-hop call reaches ``db.execute`` → UNSAFE
* a sanitizer on the way → SAFE
* multi-argument calls only taint the bound parameter
* ``depth=0`` never enters a callee
* missing files/functions keep the empty-result contract
"""

import tempfile
from pathlib import Path

import pytest

from codetree.graph.dataflow import (
    extract_cross_function_taint,
    extract_taint_paths,
)
from codetree.indexer import Indexer


def _build(files: dict[str, str]) -> Indexer:
    """Index a throwaway multi-file repo; returns the Indexer."""
    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)
    for name, source in files.items():
        (root / name).write_text(source)
    idx = Indexer(str(root))
    idx.build()
    # Keep the temp dir alive as long as the indexer (Windows file locks).
    idx._tmpdir = tmp
    return idx


def _path_list(result: dict) -> list[dict]:
    return result["paths"]


# ─── SAFE / UNSAFE across files ────────────────────────────────────────────


def test_two_file_call_reaching_db_execute_is_unsafe():
    idx = _build({
        "handler.py": (
            "def handle_request(request):\n"
            '    user_input = request.get("query")\n'
            "    build_query(user_input)\n"
        ),
        "db_layer.py": (
            "def build_query(data):\n"
            '    query = f"SELECT * FROM users WHERE id = {data}"\n'
            "    db.execute(query)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "handler.py", "handle_request", depth=3)

    assert result["entry"] == "handler.py::handle_request"
    unsafe = [p for p in _path_list(result) if p["verdict"] == "UNSAFE"]
    assert len(unsafe) == 1
    path = unsafe[0]
    assert path["risk"] == "SQL injection"
    assert path["sanitizer"] is None
    # The chain shows the cross-function jump and the callee's parameter.
    assert path["chain"][0] == "handle_request() → build_query(user_input)"
    assert "data" in path["chain"]
    assert path["functions"] == ["handler.py::handle_request", "db_layer.py::build_query"]
    assert result["depth_reached"] == 1


def test_renamed_parameter_is_propagated_by_position():
    """A callee may rename its parameter; binding must not rely on names."""
    idx = _build({
        "caller.py": (
            "def entry(request):\n"
            '    raw = request.get("q")\n'
            "    passthrough(raw)\n"
        ),
        "callee.py": (
            "def passthrough(renamed):\n"
            "    forwarded = renamed\n"
            "    db.execute(forwarded)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "caller.py", "entry")
    assert any(p["verdict"] == "UNSAFE" for p in result["paths"])


def test_sanitizer_between_caller_and_callee_is_safe():
    idx = _build({
        "handler.py": (
            "def safe_handle(request):\n"
            '    data = request.get("id")\n'
            "    cleaned = int(data)\n"
            "    safe_query(cleaned)\n"
        ),
        "db_layer.py": (
            "def safe_query(data):\n"
            '    query = f"SELECT * FROM users WHERE id = {data}"\n'
            "    db.execute(query)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "handler.py", "safe_handle", depth=3)
    paths = _path_list(result)
    assert paths, "the sanitized path should still be reported (as SAFE)"
    assert all(p["verdict"] == "SAFE" for p in paths)
    assert paths[0]["sanitizer"] == "int"
    assert paths[0]["risk"] is None


def test_sanitizer_inside_callee_is_safe():
    idx = _build({
        "handler.py": (
            "def handle(request):\n"
            '    data = request.get("id")\n'
            "    store(data)\n"
        ),
        "db_layer.py": (
            "def store(value):\n"
            "    safe = escape(value)\n"
            "    db.execute(safe)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "handler.py", "handle")
    paths = _path_list(result)
    assert paths
    assert all(p["verdict"] == "SAFE" for p in paths)


def test_three_file_chain_reaches_sink():
    idx = _build({
        "a.py": (
            "def entry(request):\n"
            '    raw = request.get("x")\n'
            "    level_one(raw)\n"
        ),
        "b.py": (
            "def level_one(value):\n"
            '    level_two(f"prefix {value}")\n'
        ),
        "c.py": (
            "def level_two(payload):\n"
            "    db.execute(payload)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "a.py", "entry", depth=3)
    unsafe = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
    assert len(unsafe) == 1
    assert unsafe[0]["functions"] == [
        "a.py::entry", "b.py::level_one", "c.py::level_two",
    ]
    assert result["depth_reached"] == 2


def test_multiple_arguments_only_tainted_parameter_is_marked():
    """Only the parameter bound to the tainted argument may be tainted."""
    files = {
        "caller.py": (
            "def entry(request, decoy):\n"
            '    bad = request.get("x")\n'
            '    good = "static"\n'
            "    take_two(bad, good)\n"
        ),
        "callee.py": (
            "def take_two(first, second):\n"
            "    db.execute(first)\n"
        ),
    }
    result = extract_cross_function_taint(_build(files), "caller.py", "entry")
    paths = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
    assert len(paths) == 1
    assert "first" in paths[0]["chain"]
    assert "second" not in paths[0]["chain"]


def test_multi_argument_clean_parameter_reaching_sink_is_not_flagged():
    """A sink fed only by the clean parameter must not be reported."""
    files = {
        "caller.py": (
            "def entry(request):\n"
            '    bad = request.get("x")\n'
            '    good = "static"\n'
            "    take_two(good, bad)\n"
        ),
        "callee.py": (
            "def take_two(first, second):\n"
            "    db.execute(first)\n"
        ),
    }
    result = extract_cross_function_taint(_build(files), "caller.py", "entry")
    assert result["paths"] == []


def test_keyword_argument_binding_uses_parameter_name():
    idx = _build({
        "caller.py": (
            "def entry(request):\n"
            '    bad = request.get("x")\n'
            '    run(safe="a", query=bad)\n'
        ),
        "callee.py": (
            "def run(query, safe):\n"
            "    db.execute(query)\n"
        ),
    })
    result = extract_cross_function_taint(idx, "caller.py", "entry")
    unsafe = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
    assert len(unsafe) == 1
    assert "query" in unsafe[0]["chain"]
    assert "safe" not in unsafe[0]["chain"]


def test_nested_transformation_argument_is_followed():
    idx = _build({
        "caller.py": (
            "def entry(request):\n"
            '    bad = request.get("x")\n'
            '    consume({"payload": bad})\n'
        ),
        "callee.py": (
            "def consume(packet):\n"
            "    db.execute(packet)\n"
        ),
    })
    result = extract_cross_function_taint(idx, "caller.py", "entry")
    assert any(p["verdict"] == "UNSAFE" for p in result["paths"])


# ─── depth / recursion bounds ──────────────────────────────────────────────


def test_depth_zero_does_not_enter_callee():
    idx = _build({
        "handler.py": (
            "def handle_request(request):\n"
            '    user_input = request.get("query")\n'
            "    build_query(user_input)\n"
        ),
        "db_layer.py": (
            "def build_query(data):\n"
            "    db.execute(data)\n"
        ),
    })

    result = extract_cross_function_taint(idx, "handler.py", "handle_request", depth=0)
    assert result["paths"] == []
    assert result["depth_reached"] == 0


def test_depth_limit_stops_before_deep_callee():
    files = {
        "a.py": (
            "def entry(request):\n"
            '    raw = request.get("x")\n'
            "    first(raw)\n"
        ),
        "b.py": "def first(v):\n    second(v)\n",
        "c.py": "def second(v):\n    db.execute(v)\n",
    }

    idx = _build(files)
    shallow = extract_cross_function_taint(idx, "a.py", "entry", depth=1)
    assert shallow["paths"] == []
    assert shallow["depth_reached"] == 1

    deep = extract_cross_function_taint(idx, "a.py", "entry", depth=2)
    assert any(p["verdict"] == "UNSAFE" for p in deep["paths"])
    assert deep["depth_reached"] == 2


def test_recursion_terminates_and_reports_sink_once():
    idx = _build({
        "a.py": (
            "def entry(request):\n"
            '    raw = request.get("x")\n'
            "    loop(raw)\n"
        ),
        "b.py": (
            "def loop(v):\n"
            "    if v:\n"
            "        loop(v)\n"
            "    db.execute(v)\n"
        ),
    })
    result = extract_cross_function_taint(idx, "a.py", "entry", depth=5)
    assert len(result["paths"]) == 1
    assert result["paths"][0]["verdict"] == "UNSAFE"


# ─── empty-result contract ────────────────────────────────────────────────


def test_missing_file_returns_empty_result_without_raising():
    idx = _build({"present.py": "def f():\n    pass\n"})
    result = extract_cross_function_taint(idx, "missing.py", "foo")
    assert result["entry"] == "missing.py::foo"
    assert result["paths"] == []
    assert result["depth_reached"] == 0


def test_missing_function_returns_empty_result_without_raising():
    idx = _build({"present.py": "def f():\n    pass\n"})
    result = extract_cross_function_taint(idx, "present.py", "absent")
    assert result["entry"] == "present.py::absent"
    assert result["paths"] == []
    assert result["depth_reached"] == 0


def test_no_cross_function_taint_reports_no_paths():
    idx = _build({
        "pure.py": "def compute(a, b):\n    return a + b\n",
    })
    result = extract_cross_function_taint(idx, "pure.py", "compute")
    assert result["paths"] == []


# ─── single-function taint did not regress ─────────────────────────────────


@pytest.fixture
def intra_repo():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "app.py").write_text(
            "def process(request):\n"
            '    user_input = request.get("name")\n'
            "    cleaned = sanitize(user_input)\n"
            '    query = f"SELECT * FROM users WHERE name = {cleaned}"\n'
            "    db.execute(query)\n"
        )
        (root / "unsafe.py").write_text(
            "def handle(request):\n"
            '    data = request.get("id")\n'
            '    db.execute(f"DELETE FROM users WHERE id = {data}")\n'
        )
        (root / "escape_only.py").write_text(
            "def handle(request):\n"
            '    data = request.get("id")\n'
            "    cleaned = escape(data)\n"
            "    db.execute(cleaned)\n"
        )
        idx = Indexer(str(root))
        idx.build()
        yield idx, root


def test_intra_function_sanitized_path_stays_safe(intra_repo):
    idx, _ = intra_repo
    entry = idx._index["app.py"]
    paths = extract_taint_paths(entry.plugin, entry.source, "process")["paths"]
    assert paths
    assert all(p["verdict"] == "SAFE" for p in paths)


def test_intra_function_escape_sanitized_path_stays_safe(intra_repo):
    idx, _ = intra_repo
    entry = idx._index["escape_only.py"]
    paths = extract_taint_paths(entry.plugin, entry.source, "handle")["paths"]
    assert paths
    assert all(p["verdict"] == "SAFE" for p in paths)
    assert paths[0]["sanitizer"] == "escape"


def test_intra_function_unsanitized_path_stays_unsafe(intra_repo):
    idx, _ = intra_repo
    entry = idx._index["unsafe.py"]
    paths = extract_taint_paths(entry.plugin, entry.source, "handle")["paths"]
    unsafe = [p for p in paths if p["verdict"] == "UNSAFE"]
    assert len(unsafe) == 1
    assert unsafe[0]["risk"] == "SQL injection"


def test_cross_function_without_callee_still_reports_local_sink(intra_repo):
    """The entry function's own unsanitized sink is reported by cross mode."""
    idx, _ = intra_repo
    result = extract_cross_function_taint(idx, "unsafe.py", "handle")
    unsafe = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
    assert len(unsafe) == 1
    assert unsafe[0]["risk"] == "SQL injection"
    assert unsafe[0]["functions"] == ["unsafe.py::handle"]
