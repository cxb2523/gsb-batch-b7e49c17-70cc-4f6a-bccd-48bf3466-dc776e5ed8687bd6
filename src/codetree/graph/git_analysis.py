"""Git history analysis: blame, churn, and change coupling."""

import subprocess
from pathlib import Path
from collections import Counter


def _run_git(cmd: list[str], cwd: str, timeout: int = 15) -> str | None:
    """Run a git command safely, returning stdout or None on error."""
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            return None
        return result.stdout
    except Exception:
        return None


def get_blame(root: str, file_path: str) -> dict:
    """Get per-line blame info for a file.

    Returns:
        {
            "file": str,
            "lines": [{"line": int, "author": str, "commit": str, "date": str}],
            "summary": {"authors": {name: line_count}, "total_lines": int},
        }
    """
    output = _run_git(
        ["git", "blame", "--porcelain", file_path], cwd=root, timeout=15,
    )
    if output is None:
        return {"file": file_path, "lines": [], "summary": {"authors": {}, "total_lines": 0}}

    lines_info = []
    current_commit = ""
    current_author = ""
    current_date = ""
    line_num = 0
    author_counts: Counter = Counter()

    for raw_line in output.split("\n"):
        if not raw_line:
            continue
        # Lines starting with a hex commit hash (40 chars)
        parts = raw_line.split()
        if len(parts) >= 3 and len(parts[0]) == 40:
            current_commit = parts[0][:8]
            line_num = int(parts[2]) if len(parts) >= 3 else 0
        elif raw_line.startswith("author "):
            current_author = raw_line[7:]
        elif raw_line.startswith("author-time "):
            current_date = raw_line[12:]
        elif raw_line.startswith("\t"):
            # Actual source line
            author_counts[current_author] += 1
            lines_info.append({
                "line": line_num,
                "author": current_author,
                "commit": current_commit,
                "date": current_date,
            })

    return {
        "file": file_path,
        "lines": lines_info,
        "summary": {
            "authors": dict(author_counts.most_common()),
            "total_lines": len(lines_info),
        },
    }


def get_churn(root: str, top_n: int = 20, since: str | None = None) -> list[dict]:
    """Get most-changed files by commit count.

    Args:
        root: repo root path
        top_n: max results
        since: optional git date filter (e.g., "6 months ago")

    Returns list of {"file": str, "commits": int, "additions": int, "deletions": int}.
    """
    # Get commit counts per file
    cmd = ["git", "log", "--pretty=format:", "--name-only"]
    if since:
        cmd.extend(["--since", since])
    output = _run_git(cmd, cwd=root, timeout=30)
    if output is None:
        return []

    file_commits: Counter = Counter()
    for line in output.strip().split("\n"):
        line = line.strip()
        if line:
            file_commits[line] += 1

    # Get additions/deletions via numstat
    cmd = ["git", "log", "--pretty=format:", "--numstat"]
    if since:
        cmd.extend(["--since", since])
    output = _run_git(cmd, cwd=root, timeout=30)

    file_adds: Counter = Counter()
    file_dels: Counter = Counter()
    if output:
        for line in output.strip().split("\n"):
            parts = line.strip().split("\t")
            if len(parts) == 3:
                adds, dels, fname = parts
                if adds != "-" and dels != "-":
                    file_adds[fname] += int(adds)
                    file_dels[fname] += int(dels)

    # Filter to files that still exist
    results = []
    for fname, commits in file_commits.most_common(top_n * 2):
        if (Path(root) / fname).exists():
            results.append({
                "file": fname,
                "commits": commits,
                "additions": file_adds.get(fname, 0),
                "deletions": file_dels.get(fname, 0),
            })
        if len(results) >= top_n:
            break

    return results


def get_change_coupling(root: str, file_path: str | None = None,
                         top_n: int = 10, min_commits: int = 3) -> list[dict]:
    """Find files that change together frequently (temporal coupling).

    Args:
        root: repo root path
        file_path: optional — show coupling for this file only
        top_n: max results
        min_commits: minimum co-commits to report

    Returns list of {"file_a": str, "file_b": str, "co_commits": int, "coupling_ratio": float}.
    """
    # Get commit history as sets of files
    output = _run_git(
        ["git", "log", "--pretty=format:---COMMIT---", "--name-only"],
        cwd=root, timeout=30,
    )
    if output is None:
        return []

    # Parse commits into file sets
    commits = []
    current_files = set()
    for line in output.split("\n"):
        line = line.strip()
        if line == "---COMMIT---":
            if current_files:
                commits.append(current_files)
            current_files = set()
        elif line:
            current_files.add(line)
    if current_files:
        commits.append(current_files)

    # Count co-occurrences
    pair_counts: Counter = Counter()
    file_counts: Counter = Counter()
    for file_set in commits:
        files = sorted(file_set)
        for f in files:
            file_counts[f] += 1
        for i, a in enumerate(files):
            if file_path and a != file_path:
                continue
            for b in files[i + 1:]:
                if file_path and b != file_path:
                    pair_counts[(a, b)] += 1
                elif not file_path:
                    pair_counts[(a, b)] += 1

    # Build results with coupling ratio
    results = []
    for (a, b), co_count in pair_counts.most_common(top_n * 2):
        if co_count < min_commits:
            continue
        max_individual = max(file_counts.get(a, 0), file_counts.get(b, 0))
        ratio = co_count / max_individual if max_individual > 0 else 0
        results.append({
            "file_a": a,
            "file_b": b,
            "co_commits": co_count,
            "coupling_ratio": round(ratio, 2),
        })
        if len(results) >= top_n:
            break

    return results
