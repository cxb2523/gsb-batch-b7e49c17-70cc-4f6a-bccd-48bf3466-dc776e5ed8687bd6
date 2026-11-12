from pathlib import Path
from .store import GraphStore
from .models import SymbolNode


class GraphQueries:
    def __init__(self, store: GraphStore):
        self._store = store

    def repository_map(self, include: list[str] | None = None, max_items: int = 5) -> dict:
        """Return a compact repo overview for agent onboarding."""
        conn = self._store

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
        conn = self._store

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
        conn = self._store

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

    def change_impact(self, symbol_query: str | None = None,
                      diff_scope: str | None = None,
                      root: str | None = None, depth: int = 3,
                      min_weight: float = 0.0) -> dict:
        """Analyze impact of a change — by explicit symbol or git diff."""
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
            # Check both resolved (file::name) and unresolved (?::name) edges
            callers = self._store.edges_to(current_qn, edge_type="CALLS")
            # Also check unresolved form: callers may point to ?::name
            parts = current_qn.rsplit("::", 1)
            if len(parts) == 2 and not parts[0].startswith("?"):
                unresolved_qn = f"?::{parts[1]}"
                callers = callers + self._store.edges_to(unresolved_qn, edge_type="CALLS")
            for edge in callers:
                caller_qn = edge.source_qn
                if caller_qn in visited or caller_qn.startswith("?::"):
                    continue
                if edge.weight < min_weight:
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

    def find_hot_paths(self, indexer, top_n: int = 10) -> list[dict]:
        """Find high-leverage optimization targets: complexity x inbound call count.

        Args:
            indexer: Indexer instance for computing complexity
            top_n: max results to return

        Returns list of dicts with qualified_name, name, file, line, complexity,
        inbound_calls, and hot_score (complexity * inbound_calls).
        """
        conn = self._store

        # Get all non-test functions/methods with inbound CALLS edges
        cur = conn.execute(
            "SELECT s.qualified_name, s.name, s.kind, s.file_path, s.start_line "
            "FROM symbols s WHERE s.is_test = 0 AND s.kind IN ('function', 'method')"
        )
        candidates = cur.fetchall()

        results = []
        for qn, name, kind, file_path, start_line in candidates:
            # Count inbound CALLS edges
            inbound = self._store.edges_to(qn, edge_type="CALLS")
            call_count = len(inbound)
            if call_count == 0:
                continue

            # Compute complexity
            entry = indexer._index.get(file_path)
            if entry is None:
                continue
            complexity_result = entry.plugin.compute_complexity(entry.source, name)
            complexity = complexity_result["total"] if complexity_result else 1

            hot_score = complexity * call_count
            results.append({
                "qualified_name": qn,
                "name": name,
                "file": file_path,
                "line": start_line,
                "complexity": complexity,
                "inbound_calls": call_count,
                "hot_score": hot_score,
            })

        results.sort(key=lambda x: x["hot_score"], reverse=True)
        return results[:top_n]

    def suggest_docs(self, indexer, file_path: str | None = None,
                     symbol_name: str | None = None) -> list[dict]:
        """Find undocumented functions and assemble context for doc generation.

        Args:
            indexer: Indexer instance
            file_path: optional — scope to this file
            symbol_name: optional — scope to this symbol

        Returns list of dicts with symbol info plus context (callers, callees, variables, params).
        """
        results = []

        # Gather candidates from indexer
        if file_path:
            files = {file_path: indexer._index.get(file_path)} if file_path in indexer._index else {}
        else:
            files = dict(indexer._index)

        for fp, entry in files.items():
            if entry is None:
                continue
            for item in entry.skeleton:
                if item["type"] not in ("function", "method"):
                    continue
                if symbol_name and item["name"] != symbol_name:
                    continue
                # Skip already-documented symbols
                if item.get("doc", "").strip():
                    continue

                name = item["name"]
                # Skip test functions and private helpers
                if name.startswith("test_") or name.startswith("_"):
                    continue

                # Assemble context
                params = item.get("params", "")
                callees = entry.plugin.extract_calls_in_function(entry.source, name)
                variables = entry.plugin.extract_variables(entry.source, name)

                # Get callers from graph
                qn = f"{fp}::{name}"
                if item.get("parent"):
                    qn = f"{fp}::{item['parent']}.{name}"
                callers = []
                edges = self._store.edges_to(qn, edge_type="CALLS")
                for e in edges:
                    sym = self._store.get_symbol(e.source_qn)
                    if sym:
                        callers.append(f"{sym.file_path}::{sym.name}")

                results.append({
                    "qualified_name": qn,
                    "name": name,
                    "file": fp,
                    "line": item["line"],
                    "parent": item.get("parent"),
                    "params": params,
                    "callees": callees,
                    "callers": callers,
                    "variables": [{"name": v["name"], "type": v.get("type", "")} for v in variables],
                })

        return results

    def get_dependency_graph(self, file_path: str | None = None,
                              format: str = "mermaid") -> dict:
        """Generate a dependency graph from IMPORTS edges.

        Args:
            file_path: optional — if given, show only dependencies of/to this file
            format: "mermaid" (default) or "list"

        Returns:
            {"format": str, "content": str, "nodes": int, "edges": int}
        """
        conn = self._store

        # Get all IMPORTS edges
        if file_path:
            # Edges from or to this file
            cur = conn.execute(
                "SELECT source_qn, target_qn FROM edges "
                "WHERE type='IMPORTS' AND (source_qn LIKE ? OR target_qn LIKE ?)",
                (f"{file_path}::%", f"{file_path}::%"),
            )
        else:
            cur = conn.execute(
                "SELECT source_qn, target_qn FROM edges WHERE type='IMPORTS'"
            )

        raw_edges = cur.fetchall()
        if not raw_edges:
            return {"format": format, "content": "No import dependencies found.", "nodes": 0, "edges": 0}

        # Extract file names from qualified names (file::__file__)
        edges = []
        nodes = set()
        for src_qn, tgt_qn in raw_edges:
            src_file = src_qn.split("::")[0]
            tgt_file = tgt_qn.split("::")[0]
            nodes.add(src_file)
            nodes.add(tgt_file)
            edges.append((src_file, tgt_file))

        if format == "mermaid":
            lines = ["graph LR"]
            # Create safe node IDs (replace dots/slashes)
            node_ids = {}
            for i, n in enumerate(sorted(nodes)):
                safe_id = f"n{i}"
                node_ids[n] = safe_id
                lines.append(f'    {safe_id}["{n}"]')
            for src, tgt in edges:
                lines.append(f"    {node_ids[src]} --> {node_ids[tgt]}")
            content = "\n".join(lines)
        else:
            lines = ["Dependencies:"]
            for src, tgt in sorted(edges):
                lines.append(f"  {src} → {tgt}")
            content = "\n".join(lines)

        return {
            "format": format,
            "content": content,
            "nodes": len(nodes),
            "edges": len(edges),
        }
