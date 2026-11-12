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


class TestAnalyzeDataflowFlow:
    def test_returns_variables(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="app.py", function_name="process", mode="flow")
        assert "variables" in result
        var_names = {v["name"] for v in result["variables"]}
        assert "user_input" in var_names

    def test_returns_sinks(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="app.py", function_name="process", mode="flow")
        assert len(result["sinks"]) > 0

    def test_file_not_found(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="nope.py", function_name="foo", mode="flow")
        assert "error" in result

    def test_default_mode_is_flow(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="app.py", function_name="process")
        assert "variables" in result


class TestAnalyzeDataflowTaint:
    def test_safe_path(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="app.py", function_name="process", mode="taint")
        safe = [p for p in result["paths"] if p["verdict"] == "SAFE"]
        assert len(safe) > 0

    def test_unsafe_path(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="unsafe.py", function_name="handle", mode="taint")
        unsafe = [p for p in result["paths"] if p["verdict"] == "UNSAFE"]
        assert len(unsafe) > 0
        assert unsafe[0]["risk"] is not None

    def test_file_not_found(self, mcp_with_dataflow):
        fn = _tool(mcp_with_dataflow, "analyze_dataflow")
        result = fn(file_path="nope.py", function_name="foo", mode="taint")
        assert "error" in result
