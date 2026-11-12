# Technology Stack

**Analysis Date:** 2026-04-03

## Languages

**Primary:**
- Python 3.10+ - Core application language; MCP server and all indexing/analysis logic
  - Supported versions: 3.10, 3.11, 3.12, 3.13
  - Run via `python` or installed CLI via pip

**Supported for Analysis (via tree-sitter):**
- Python (`.py`)
- JavaScript/JSX (`.js`, `.jsx`)
- TypeScript (`.ts`)
- TypeScript JSX (`.tsx`)
- Go (`.go`)
- Rust (`.rs`)
- Java (`.java`)
- C (`.c`, `.h`)
- C++ (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`)
- Ruby (`.rb`)

## Runtime

**Environment:**
- Python 3.10+ as base interpreter
- Standard library modules: `pathlib`, `json`, `subprocess`, `sqlite3`, `argparse`, `atexit`, `hashlib`, `re`, `dataclasses`

**Package Manager:**
- pip (standard Python package manager)
- Optional: `uv` for faster installation (recommended in README for Quick Start)
- Lockfile: `.venv/` contains installed packages; no `requirements.txt` or `pyproject.lock` committed

## Frameworks

**Core:**
- FastMCP 3.1.0 (or later `>=2.0.0`) - MCP (Model Context Protocol) server framework
  - Purpose: Exposes 23 tools as MCP server for AI agents (Claude, Cursor, etc.)
  - Location: `src/codetree/server.py` defines tools and registers with FastMCP
  - Transport: Stdio (default via FastMCP)

**Code Analysis:**
- tree-sitter 0.23.0+ - AST parsing library (language-agnostic)
  - Language plugins: `tree-sitter-python`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-ruby` (all 0.23.0+)
  - Purpose: Parse source code into syntax trees for structural analysis
  - Used in: `src/codetree/languages/` (plugin classes for each language)

**Testing:**
- pytest (via GitHub Actions workflow, not explicitly in pyproject.toml dependencies but installed in CI)
  - Config: `tool.pytest.ini_options` in `pyproject.toml` → `testpaths = ["tests"]`
  - Run: `pytest` command (1058+ tests across 35+ test files)

**Build/Dev:**
- hatchling (build backend)
  - Config: `[build-system]` in `pyproject.toml`
  - Packages wheel from `src/codetree`

## Key Dependencies

**Critical:**
- tree-sitter (0.23.0+) - Core AST parsing; blocks everything else
  - Why: All structural analysis and symbol extraction depends on accurate parsing
- fastmcp (2.0.0+) - MCP server registration and tool transport
  - Why: Provides the server interface for agents; defines all 23 tools

**Language Support (all 0.23.0+):**
- tree-sitter-python, tree-sitter-javascript, tree-sitter-typescript, tree-sitter-go, tree-sitter-rust, tree-sitter-java, tree-sitter-c, tree-sitter-cpp, tree-sitter-ruby
  - Why: Each provides grammar files for parsing that language

## Configuration

**Environment:**
- No explicit environment variables required for normal operation
- `.codetree/` directory created in repository root for persistent data:
  - `.codetree/index.json` - Cache of skeleton data (mtime-based invalidation)
  - `.codetree/graph.db` - SQLite database for symbol graph, edges, imports
- Startup: Command-line argument `--root /path/to/repo` specifies target codebase (default: current directory)
  - Entry point: `codetree/__main__.py` → `main()` function

**Build:**
- `pyproject.toml` - Single source of truth for dependencies, project metadata, build config
- Python wheel built via hatchling (not in committed dist/)
- CLI entrypoint: `codetree = "codetree.__main__:main"`

## Platform Requirements

**Development:**
- Python 3.10+ interpreter
- pip or uv for package installation
- `.venv/` virtual environment (created and activated via `source .venv/bin/activate`)
- Git for accessing codebase metadata (used by `git_analysis.py` module)
- ~150MB disk for installed dependencies (tree-sitter + language grammars)

**Production / Deployment:**
- Python 3.10+ on target system
- No external services or databases required — SQLite is embedded
- Runs as stdio-based MCP server in agent/IDE contexts (Claude Code, Cursor, VS Code, Windsurf)
- Network: Optional — git history analysis uses local `git` command; no outbound network calls
- Memory: ~50-100MB for typical codebases; scales with repository size
- CPU: Single-threaded analysis; no async I/O (subprocess calls are blocking)

## Storage Model

**Local-only:**
- `.codetree/index.json` - JSON text file in target repo (human-readable, git-ignored)
- `.codetree/graph.db` - SQLite 3 database (binary, git-ignored)
- No cloud storage, no S3, no vector DB

**Persistence:**
- Cache invalidated on file modification time (mtime) changes
- Graph rebuilt incrementally on changes (sha256 content hashing)
- Both are .gitignore'd to avoid committing analysis artifacts

---

*Stack analysis: 2026-04-03*
