"""Tests for git history analysis tools: blame, churn, change coupling."""

import pytest
import subprocess
import tempfile
from pathlib import Path
from codetree.graph.git_analysis import get_blame, get_churn, get_change_coupling
from codetree.server import create_server


def _tool(mcp, name):
    return mcp.local_provider._components[f"tool:{name}@"].fn


def _git(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=10, check=True)


@pytest.fixture
def git_repo():
    """Create a git repo with multiple commits for history analysis."""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)

        _git(["git", "init", "-q"], str(p))
        _git(["git", "config", "user.email", "test@test.com"], str(p))
        _git(["git", "config", "user.name", "Test Author"], str(p))

        # Commit 1: initial files
        (p / "calc.py").write_text("def add(a, b):\n    return a + b\n")
        (p / "main.py").write_text("from calc import add\ndef main():\n    add(1, 2)\n")
        _git(["git", "add", "-A"], str(p))
        _git(["git", "commit", "-q", "-m", "initial"], str(p))

        # Commit 2: modify calc.py and main.py together
        (p / "calc.py").write_text("def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n")
        (p / "main.py").write_text("from calc import add, sub\ndef main():\n    add(1, 2)\n    sub(3, 1)\n")
        _git(["git", "add", "-A"], str(p))
        _git(["git", "commit", "-q", "-m", "add sub"], str(p))

        # Commit 3: modify calc.py only
        (p / "calc.py").write_text("def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n\ndef mul(a, b):\n    return a * b\n")
        _git(["git", "add", "-A"], str(p))
        _git(["git", "commit", "-q", "-m", "add mul"], str(p))

        # Commit 4: modify both again
        (p / "main.py").write_text("from calc import add, sub, mul\ndef main():\n    add(1, 2)\n    sub(3, 1)\n    mul(4, 5)\n")
        (p / "calc.py").write_text("def add(a, b):\n    \"\"\"Add.\"\"\"\n    return a + b\n\ndef sub(a, b):\n    return a - b\n\ndef mul(a, b):\n    return a * b\n")
        _git(["git", "add", "-A"], str(p))
        _git(["git", "commit", "-q", "-m", "add docs and use mul"], str(p))

        yield p


# ─── Blame ──────────────────────────────────────────────────────────────────

class TestBlame:

    def test_returns_lines(self, git_repo):
        result = get_blame(str(git_repo), "calc.py")
        assert len(result["lines"]) > 0

    def test_has_author(self, git_repo):
        result = get_blame(str(git_repo), "calc.py")
        assert "Test Author" in result["summary"]["authors"]

    def test_total_lines_match(self, git_repo):
        result = get_blame(str(git_repo), "calc.py")
        total = result["summary"]["total_lines"]
        assert total == len(result["lines"])

    def test_nonexistent_file(self, git_repo):
        result = get_blame(str(git_repo), "nope.py")
        assert result["lines"] == []

    def test_line_has_commit_info(self, git_repo):
        result = get_blame(str(git_repo), "calc.py")
        line = result["lines"][0]
        assert "author" in line
        assert "commit" in line
        assert "line" in line


# ─── Churn ──────────────────────────────────────────────────────────────────

class TestChurn:

    def test_returns_results(self, git_repo):
        results = get_churn(str(git_repo))
        assert len(results) > 0

    def test_calc_has_most_commits(self, git_repo):
        results = get_churn(str(git_repo), top_n=10)
        # calc.py was changed in all 4 commits
        names = [r["file"] for r in results]
        assert "calc.py" in names

    def test_has_additions_deletions(self, git_repo):
        results = get_churn(str(git_repo))
        for r in results:
            assert "commits" in r
            assert "additions" in r
            assert "deletions" in r

    def test_top_n_limits(self, git_repo):
        results = get_churn(str(git_repo), top_n=1)
        assert len(results) <= 1

    def test_no_git_repo(self, tmp_path):
        # tmp_path is not a git repo
        results = get_churn(str(tmp_path))
        assert results == []


# ─── Change Coupling ───────────────────────────────────────────────────────

class TestChangeCoupling:

    def test_finds_coupled_files(self, git_repo):
        results = get_change_coupling(str(git_repo), min_commits=2)
        # calc.py and main.py changed together 3 times
        if results:
            files = [(r["file_a"], r["file_b"]) for r in results]
            # Check either ordering
            found = any(
                ("calc.py" in a and "main.py" in b) or ("main.py" in a and "calc.py" in b)
                for a, b in files
            )
            assert found

    def test_has_coupling_ratio(self, git_repo):
        results = get_change_coupling(str(git_repo), min_commits=2)
        for r in results:
            assert "coupling_ratio" in r
            assert 0 <= r["coupling_ratio"] <= 1.0

    def test_file_filter(self, git_repo):
        results = get_change_coupling(str(git_repo), file_path="calc.py", min_commits=2)
        for r in results:
            assert "calc.py" in (r["file_a"], r["file_b"])

    def test_min_commits_filter(self, git_repo):
        results = get_change_coupling(str(git_repo), min_commits=100)
        assert results == []


# ─── MCP tool: git_history ──────────────────────────────────────────────────

class TestGitHistoryTool:

    def test_blame_mode(self, git_repo):
        mcp = create_server(str(git_repo))
        fn = _tool(mcp, "git_history")
        result = fn(mode="blame", file_path="calc.py")
        assert "Test Author" in result
        assert isinstance(result, str)

    def test_blame_requires_file_path(self, git_repo):
        mcp = create_server(str(git_repo))
        fn = _tool(mcp, "git_history")
        result = fn(mode="blame")
        assert "required" in result.lower()

    def test_churn_mode(self, git_repo):
        mcp = create_server(str(git_repo))
        fn = _tool(mcp, "git_history")
        result = fn(mode="churn", top_n=5)
        assert isinstance(result, str)
        assert "calc.py" in result

    def test_coupling_mode(self, git_repo):
        mcp = create_server(str(git_repo))
        fn = _tool(mcp, "git_history")
        result = fn(mode="coupling", min_commits=2)
        assert isinstance(result, str)

    def test_default_mode_is_blame(self, git_repo):
        mcp = create_server(str(git_repo))
        fn = _tool(mcp, "git_history")
        result = fn(file_path="calc.py")
        assert "Blame" in result
