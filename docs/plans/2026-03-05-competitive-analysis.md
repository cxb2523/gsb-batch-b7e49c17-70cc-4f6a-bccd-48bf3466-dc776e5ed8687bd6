# Competitive Analysis & Roadmap

Research date: 2026-03-05

## Landscape

14+ MCP servers do code analysis. codetree's strength is its focused 4-tool API and clean plugin architecture. Key gaps below.

## Direct Competitors

| Project | Lang | Tools | Key differentiator |
|---|---|---|---|
| [wrale/mcp-server-tree-sitter](https://github.com/wrale/mcp-server-tree-sitter) | Python | 27 | Raw AST access, custom queries, complexity analysis, query templates |
| [nendotools/tree-sitter-mcp](https://github.com/nendotools/tree-sitter-mcp) | TypeScript | 4 | Dead code detection, syntax error reporting, code quality analysis |
| [tree-sitter-analyzer](https://github.com/aimasteracc/tree-sitter-analyzer) | Python | ~10 | Token optimization (TOON format, 95% reduction), 17 languages, complexity |
| [CodeMCP/CKB](https://github.com/SimplyLiz/CodeMCP) | — | 76 | SCIP-based, impact analysis, CODEOWNERS, secret detection, batch ops |
| [Fossil MCP](https://github.com/yfedoseev/fossil-mcp) | Rust | 8 | Dead code, clone detection, blast radius, call path tracing, dataflow |
| [CodePathfinder](https://codepathfinder.dev/mcp) | Python | 6 | 5-pass call graph, import resolution, dataflow/taint analysis |
| [ast-grep MCP](https://github.com/ast-grep/ast-grep-mcp) | — | 4 | Structural code search with code-like patterns (not S-expressions) |
| [CodeRLM](https://github.com/JaredStewart/coderlm) | Rust | ~8 | Variable extraction, test discovery, grep integration, HTTP API |
| [RepoMapper](https://github.com/pdavis68/RepoMapper) | — | ~3 | PageRank symbol importance ranking, token-budget-aware output |
| [LSP Bridge](https://github.com/sehejjain/Language-Server-MCP-Bridge) | — | 10 | Bridges any LSP server → true semantic type info, hover, rename |
| [rag-code-mcp](https://github.com/doITmagic/rag-code-mcp) | — | ~6 | Vector/semantic search via embeddings (Ollama + Qdrant) |
| [Sourcegraph MCP](https://sourcegraph.com/docs/api/mcp) | — | 13 | Cross-repo search, NL search, commit/diff search, Deep Search |

## What codetree does well

- Focused API (4 tools vs 27-76) — less confusion for agents
- Call graph with inbound + outbound — only ~half of competitors have this
- Clean plugin architecture — easiest to extend
- Fast startup (~1s vs slow index builds in competitors)

## Feature Gaps — Prioritized

### Tier 1: Easy wins (use existing tree-sitter infra)

**1. Import/dependency extraction** — New tool `get_imports(file_path)`
- Extract `import`/`use`/`require`/`#include` statements per file
- Who has it: wrale, CodePathfinder, CKB, Fossil
- Unlocks: dependency graphs, dead code detection, impact analysis later
- Effort: Medium (one query per language plugin)

**2. Docstring/comment extraction** — Add `doc` field to skeleton items
- Extract doc comments (Python `"""`, JS `/** */`, Go `//`, Rust `///`, Java `/** */`)
- Who has it: CodeNav, rag-code-mcp
- Effort: Easy (doc comment nodes are siblings of definition nodes)

**3. Syntax error reporting** — New tool or flag on existing tools
- tree-sitter already sets `has_error` on parse trees — just expose it
- Who has it: nendotools
- Effort: Easy (check `tree.root_node.has_error` after parse)

**4. More languages** — C, C++, Ruby, PHP, Kotlin, C#
- `_template.py` makes this mechanical
- Most competitors support 13-17+
- Effort: ~1hr per language following existing pattern

**5. Batch operations** — `get_symbols([(file, name), ...])`, `get_skeletons([file, ...])`
- Reduce round-trips for agents exploring multiple files
- Who has it: CKB (claims 60-70% overhead reduction)
- Effort: Easy (wrap existing tools)

### Tier 2: Medium effort, high value

**6. Complexity metrics** — New tool `get_complexity(file_path, function_name)`
- Cyclomatic complexity: count `if/else/for/while/match/try` branches in function body
- Who has it: wrale, nendotools, CKB, tree-sitter-analyzer
- Effort: Medium (count specific node types within function body)

**7. Token-efficient output** — Compressed skeleton format
- tree-sitter-analyzer claims 95% token reduction with TOON format
- One-line summaries, abbreviated type info
- Who has it: tree-sitter-analyzer, jcodemunch, RepoMapper
- Effort: Medium (alternative output formatter)

**8. Symbol importance ranking** — PageRank on reference graph
- "What are the most important symbols in this repo?"
- Based on Aider's repo map approach
- Who has it: RepoMapper
- Effort: Medium (build adjacency matrix from find_references, run PageRank)

**9. Test discovery** — `find_tests(function_name)`
- Find test functions associated with a function (naming convention + reference matching)
- Who has it: CodeRLM, CKB
- Effort: Medium (search for `test_<name>`, `<Name>Test`, etc. + reference check)

**10. Variable listing in functions** — Extend `get_symbol` output
- Extract local variable declarations within a function body
- Who has it: CodeRLM
- Effort: Easy-Medium (query variable declarations inside function node)

### Tier 3: Hard but differentiating

**11. Dead code detection**
- Functions never called, imports never used
- Who has it: nendotools, CKB, Fossil
- Requires: complete call graph + import resolution (depends on #1)
- Effort: Hard

**12. Blast radius / impact analysis**
- "If I change this function, what breaks?"
- Transitive closure of callers + dependents
- Who has it: CKB, Fossil
- Effort: Hard (transitive call graph traversal)

**13. Clone/duplicate detection**
- Find structurally similar code blocks (Type 1/2/3 clones)
- MinHash + LSH for structural hashing
- Who has it: wrale, Fossil
- Effort: Hard

**14. Raw AST access / custom query execution**
- Let users run arbitrary tree-sitter S-expression queries
- Who has it: wrale, ast-grep
- Effort: Easy to implement, but increases API surface

**15. Semantic/vector search**
- Natural language code search via embeddings
- Requires embedding model (Ollama) + vector store (Qdrant/FAISS)
- Who has it: Sourcegraph, rag-code-mcp
- Effort: Hard (new dependency, infrastructure)

## Suggested implementation order

```
Phase 1 (next): Import extraction → Docstring extraction → Syntax error reporting
Phase 2: More languages (C, C++, Ruby) → Batch operations → Complexity metrics
Phase 3: Token optimization → Symbol importance → Test discovery
Phase 4: Dead code detection → Impact analysis → Clone detection
```

Phase 1 features are foundational — imports unlock dead code and impact analysis later. Docstrings make skeleton output much more useful for agents trying to understand APIs.

## MCP Server Registries (for publishing)

| Registry | URL |
|---|---|
| mcp.so | https://mcp.so (18,000+ servers) |
| mcpservers.org | https://mcpservers.org |
| awesome-mcp-servers | https://github.com/punkpeye/awesome-mcp-servers |
| Smithery | https://smithery.ai |
| PulseMCP | https://pulsemcp.com |
| Glama | https://glama.ai/mcp |
