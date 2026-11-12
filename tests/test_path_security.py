import pytest
from pathlib import Path
from codetree.server import create_server


@pytest.fixture
def server_and_tools(sample_repo):
    """Create a server rooted at sample_repo and extract all tool functions."""
    mcp = create_server(str(sample_repo))
    tools = {
        c.split("@")[0].replace("tool:", ""): v.fn
        for c, v in mcp.local_provider._components.items()
        if c.startswith("tool:")
    }
    return tools


TRAVERSAL_PATHS = [
    "../../../etc/passwd",
    "../../secret.txt",
    "../outside.py",
    "src/../../etc/shadow",
]

ABSOLUTE_PATHS = [
    "/etc/passwd",
    "/tmp/evil.py",
    "/root/.ssh/id_rsa",
]

VALID_PATHS = [
    "calculator.py",
    "main.py",
]


def _is_error(result) -> bool:
    """Return True if result is a path-security error (string or dict)."""
    if isinstance(result, dict):
        return "error" in result and (
            "denied" in result["error"]
            or "outside" in result["error"]
            or "Error" in result["error"]
        )
    if isinstance(result, str):
        return "denied" in result or "outside" in result or (
            "Error" in result and "path" in result.lower()
        )
    return False


class TestPathSecurity:

    # --- Traversal attack paths ---

    @pytest.mark.parametrize("bad_path", TRAVERSAL_PATHS)
    def test_get_file_skeleton_rejects_traversal(self, server_and_tools, bad_path):
        result = server_and_tools["get_file_skeleton"](bad_path)
        assert _is_error(result), (
            f"get_file_skeleton({bad_path!r}) should be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("bad_path", TRAVERSAL_PATHS)
    def test_get_symbol_rejects_traversal(self, server_and_tools, bad_path):
        result = server_and_tools["get_symbol"](bad_path, "something")
        assert _is_error(result), (
            f"get_symbol({bad_path!r}) should be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("bad_path", TRAVERSAL_PATHS)
    def test_get_imports_rejects_traversal(self, server_and_tools, bad_path):
        result = server_and_tools["get_imports"](bad_path)
        assert _is_error(result), (
            f"get_imports({bad_path!r}) should be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("bad_path", TRAVERSAL_PATHS)
    def test_get_call_graph_rejects_traversal(self, server_and_tools, bad_path):
        result = server_and_tools["get_call_graph"](bad_path, "run")
        assert _is_error(result), (
            f"get_call_graph({bad_path!r}) should be rejected, got: {result!r}"
        )

    # --- Absolute paths ---

    @pytest.mark.parametrize("bad_path", ABSOLUTE_PATHS)
    def test_get_file_skeleton_rejects_absolute(self, server_and_tools, bad_path):
        result = server_and_tools["get_file_skeleton"](bad_path)
        assert _is_error(result), (
            f"get_file_skeleton({bad_path!r}) should be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("bad_path", ABSOLUTE_PATHS)
    def test_get_symbol_rejects_absolute(self, server_and_tools, bad_path):
        result = server_and_tools["get_symbol"](bad_path, "something")
        assert _is_error(result), (
            f"get_symbol({bad_path!r}) should be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("bad_path", ABSOLUTE_PATHS)
    def test_get_call_graph_rejects_absolute(self, server_and_tools, bad_path):
        result = server_and_tools["get_call_graph"](bad_path, "run")
        assert _is_error(result), (
            f"get_call_graph({bad_path!r}) should be rejected, got: {result!r}"
        )

    # --- Valid paths are NOT rejected ---

    @pytest.mark.parametrize("good_path", VALID_PATHS)
    def test_get_file_skeleton_allows_valid(self, server_and_tools, good_path):
        result = server_and_tools["get_file_skeleton"](good_path)
        assert not _is_error(result), (
            f"get_file_skeleton({good_path!r}) should not be rejected, got: {result!r}"
        )

    @pytest.mark.parametrize("good_path", VALID_PATHS)
    def test_get_imports_allows_valid(self, server_and_tools, good_path):
        result = server_and_tools["get_imports"](good_path)
        assert not _is_error(result), (
            f"get_imports({good_path!r}) should not be rejected, got: {result!r}"
        )

    # --- Optional file_path args ---

    def test_find_dead_code_rejects_traversal(self, server_and_tools):
        result = server_and_tools["find_dead_code"]("../../../etc/passwd")
        assert _is_error(result), (
            f"find_dead_code should reject traversal, got: {result!r}"
        )

    def test_find_dead_code_allows_none(self, server_and_tools):
        result = server_and_tools["find_dead_code"](None)
        assert not _is_error(result), (
            f"find_dead_code(None) should not be rejected, got: {result!r}"
        )

    def test_detect_clones_rejects_absolute(self, server_and_tools):
        result = server_and_tools["detect_clones"]("/etc/passwd")
        assert _is_error(result), (
            f"detect_clones should reject absolute path, got: {result!r}"
        )

    # --- analyze_dataflow returns dict, not str ---

    def test_analyze_dataflow_rejects_traversal_as_dict(self, server_and_tools):
        result = server_and_tools["analyze_dataflow"]("../../../etc/passwd", "main")
        assert isinstance(result, dict), "analyze_dataflow should return dict"
        assert "error" in result, f"Expected error key, got: {result}"
        assert _is_error(result), (
            f"analyze_dataflow should reject traversal, got: {result}"
        )

    # --- get_skeletons (list of paths) ---

    def test_get_skeletons_rejects_bad_in_list(self, server_and_tools):
        result = server_and_tools["get_skeletons"](["calculator.py", "../../../etc/passwd"])
        # Should contain error for the bad path
        assert "denied" in result or "outside" in result or "Error" in result, (
            f"get_skeletons should include error for bad path, got: {result!r}"
        )

    def test_get_skeletons_allows_all_valid(self, server_and_tools):
        result = server_and_tools["get_skeletons"](["calculator.py", "main.py"])
        assert not _is_error(result), (
            f"get_skeletons with valid paths should not be rejected, got: {result!r}"
        )

    # --- get_symbols (list[dict] calling convention) ---

    def test_get_symbols_rejects_bad_file_path(self, server_and_tools):
        """get_symbols takes list[dict] — validate the file_path inside each dict."""
        result = server_and_tools["get_symbols"](
            [{"file_path": "../../../etc/passwd", "symbol_name": "foo"}]
        )
        assert "denied" in result or "outside" in result or "Error" in result, (
            f"get_symbols should reject traversal path in dict, got: {result!r}"
        )

    # --- git_history with optional file_path ---

    def test_git_history_blame_rejects_traversal(self, server_and_tools):
        result = server_and_tools["git_history"]("blame", "../../../etc/passwd")
        assert _is_error(result), (
            f"git_history blame should reject traversal, got: {result!r}"
        )

    # --- suggest_docs with optional file_path ---

    def test_suggest_docs_rejects_absolute(self, server_and_tools):
        result = server_and_tools["suggest_docs"]("/etc/passwd")
        assert _is_error(result), (
            f"suggest_docs should reject absolute path, got: {result!r}"
        )

    # --- Tools patched in Task 1 that need traversal-rejection coverage ---

    def test_get_complexity_rejects_traversal(self, server_and_tools):
        result = server_and_tools["get_complexity"]("../../../etc/passwd", "main")
        assert _is_error(result), (
            f"get_complexity should reject traversal, got: {result!r}"
        )

    def test_find_tests_rejects_traversal(self, server_and_tools):
        result = server_and_tools["find_tests"]("../../../etc/passwd", "main")
        assert _is_error(result), (
            f"find_tests should reject traversal, got: {result!r}"
        )

    def test_get_blast_radius_rejects_traversal(self, server_and_tools):
        result = server_and_tools["get_blast_radius"]("../../../etc/passwd", "main")
        assert _is_error(result), (
            f"get_blast_radius should reject traversal, got: {result!r}"
        )

    def test_get_dependency_graph_rejects_traversal(self, server_and_tools):
        result = server_and_tools["get_dependency_graph"]("../../../etc/passwd")
        assert _is_error(result), (
            f"get_dependency_graph should reject traversal, got: {result!r}"
        )
