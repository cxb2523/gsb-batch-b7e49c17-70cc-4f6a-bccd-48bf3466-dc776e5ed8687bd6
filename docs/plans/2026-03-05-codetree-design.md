# codetree — Design Document

**Date:** 2026-03-05
**Status:** Approved

## What it is

An MCP server that gives coding agents (Claude Code, Cursor, etc.) structured code understanding powered by Tree-sitter. Instead of fragile grep-based context, agents get precise, structured facts about a codebase.

## Problem

Coding agents today use grep/regex to understand code. This gives them raw text with no structure — they don't know what class a function belongs to, what calls it, or where it's used. This leads to agents reading whole files when they only need one function, missing cross-file relationships, and making mistakes from incomplete context.

## Solution

A Python MCP server that:
1. On startup, walks the repo and parses every `.py` file with Tree-sitter
2. Builds an in-memory index of all symbols, classes, functions, and references
3. Caches the index to `.codetree/index.json` (keyed by file path + mtime) so restarts are instant
4. Exposes 4 tools the agent can call to navigate code structurally

## Architecture

```
User's repo (.py files on disk)
    │
    ▼
codetree server starts (python -m codetree --root /path/to/repo)
    ├── loads .codetree/index.json if it exists
    ├── checks each file's mtime against cache
    ├── re-parses only changed/new files with tree-sitter
    └── builds in-memory index

Agent connects via MCP protocol
    └── calls tools → server queries index → returns clean structured text
```

## Cache Design

```
.codetree/
└── index.json
```

Structure:
```json
{
  "src/calculator.py": {
    "mtime": 1709123456.0,
    "classes": ["Calculator"],
    "functions": ["add", "divide"],
    "symbols": { ... },
    "references": { ... }
  }
}
```

On power failure or crash: cache may be stale but never wrong. Worst case, re-parses affected files on next startup. Tree-sitter parses hundreds of files in under 2 seconds.

## The 4 MCP Tools

### `get_file_skeleton(file_path)`
Returns all classes and function signatures in a file without bodies.

```
class Calculator (line 1)
  def add(self, a, b) → line 2
  def divide(self, a, b) → line 5
def helper_fn() → line 12
```

### `get_symbol(file_path, symbol_name)`
Returns the exact source of a specific function or class by name, with line numbers.

### `find_references(symbol_name)`
Finds all usages of a symbol across the entire repo.

```
src/calculator.py:5  → definition
src/main.py:14       → call: calc.divide(10, 2)
tests/test_calc.py:8 → call: self.calc.divide(...)
```

### `get_call_graph(file_path, function_name)`
Returns what a function calls and what calls it.

```
divide calls:
  → ValueError (built-in)
divide is called by:
  ← main.py:14  run()
  ← test_calc.py:8  test_divide()
```

## Project Structure

```
codetree/
├── src/
│   └── codetree/
│       ├── __init__.py
│       ├── __main__.py     ← entry: python -m codetree --root .
│       ├── server.py       ← FastMCP server + tool definitions
│       ├── indexer.py      ← walks repo, parses files, builds index
│       ├── cache.py        ← reads/writes .codetree/index.json
│       └── queries.py      ← tree-sitter queries for Python grammar
├── pyproject.toml
└── README.md
```

## Distribution

```bash
pip install codetree
```

Claude Code config (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "codetree": {
      "command": "python",
      "args": ["-m", "codetree", "--root", "/path/to/repo"]
    }
  }
}
```

## v1 Scope

- Python files only
- In-memory index with file-based JSON cache
- 4 tools: skeleton, symbol fetch, references, call graph

## Future (not v1)

- Multi-language support (JS/TS, Go, Rust, etc.)
- SQLite persistent index for very large repos
- Semantic search via embeddings
- Watch mode (auto re-index on file change)
