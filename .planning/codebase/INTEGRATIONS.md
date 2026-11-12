# External Integrations

**Analysis Date:** 2026-04-03

## APIs & External Services

**MCP (Model Context Protocol):**
- FastMCP server - No external API calls; defines local tool interface
  - Server registration via `FastMCP("codetree")` in `src/codetree/server.py`
  - No authentication required (local stdio transport)
  - Used by: Claude Code, Cursor, VS Code, Windsurf, Claude Desktop (agent clients)

**No External APIs:**
- This is a local-only analysis tool
- No HTTP/REST API calls to external services
- No SDK integrations (Stripe, AWS, Supabase, etc.)
- No OpenAI/Anthropic API calls (runs standalone)

## Data Storage

**Databases:**
- SQLite 3 (embedded, local-only)
  - Location: `.codetree/graph.db` in repository root
  - Client/ORM: Direct `sqlite3` module (Python stdlib)
  - Purpose: Persistent symbol graph, edges, imports, file metadata
  - Tables:
    - `meta` - Schema version and metadata
    - `files` - Source files indexed (path, sha256, language, mtime, is_test)
    - `symbols` - Extracted symbols (qualified name, kind, file, line range, doc, params)
    - `edges` - Symbol relationships (CALLS, CONTAINS, IMPORTS with weights)
  - Initialization: Auto-created on first run via `GraphStore.open()` in `src/codetree/graph/store.py`
  - No backup/replication; single-file database (safe for concurrent reads, serialized writes)

**File Storage:**
- Local filesystem only
  - Codebase being analyzed: Read from disk at `--root` path
  - Cache: `.codetree/index.json` - JSON text file with skeleton mtime cache
  - No S3, no cloud storage

**Caching:**
- In-memory caching during execution (indexer, graph queries)
- Persistent mtime-based cache in `.codetree/index.json` (skips re-parsing unchanged files)
- No Redis, no Memcached

## Authentication & Identity

**Auth Provider:**
- None - This is a local development tool
- No user accounts, no API keys required
- Git history analysis uses local `git` CLI (requires `.git/` folder to exist)

## Monitoring & Observability

**Error Tracking:**
- None - No external error tracking
- Errors logged to stderr (standard Python exception handling)
- Syntax errors in indexed files detected locally and included in skeleton warnings

**Logs:**
- Console output (stdout/stderr)
  - Success: Brief status messages during indexing
  - Errors: Full Python traceback on exceptions
- No centralized logging, no log aggregation

**Debugging:**
- Index freshness visible via `index_status()` MCP tool
- Graph statistics available via `get_repository_map()` tool

## CI/CD & Deployment

**Hosting:**
- Not a server; runs locally in agent/IDE processes
- Distributed via PyPI as `mcp-server-codetree` package
- Installed with: `pip install mcp-server-codetree` or `uvx --from mcp-server-codetree codetree --root .`

**CI Pipeline:**
- GitHub Actions (`.github/workflows/test.yml`)
- Trigger: On push/PR to main or master branches
- Environment: Ubuntu latest
- Matrix: Python 3.10, 3.11, 3.12, 3.13
- Steps: Checkout → Setup Python → Install deps + pytest → `pytest`
- No deployment step (releases via GitHub Releases + PyPI)

## Git Integration

**Local Git Analysis:**
- `src/codetree/graph/git_analysis.py` - Git history without API
  - Runs local `git` commands via subprocess (15s timeout per command)
  - `get_blame(root, file_path)` - `git blame --porcelain` per-line blame info
  - `get_churn(root)` - `git log --pretty --name-status` file change frequency
  - `get_change_coupling(root)` - `git log --pretty --name-status` files that change together
  - No external Git API (GitHub API, GitLab API, etc.)
  - Graceful fallback if `.git/` missing or git command fails (returns empty results)

## Environment Configuration

**Required env vars:**
- None - No environment variables required

**Optional env vars (standard Python/Git):**
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` - If git blame is used and git config is incomplete
- `PYTHONPATH` - If running as library import instead of CLI

**Secrets location:**
- Not applicable - No secrets, API keys, or credentials used

## Webhooks & Callbacks

**Incoming:**
- None - This is a client library/tool, not a server accepting requests

**Outgoing:**
- None - No webhooks or callbacks to external systems

## Agent Integration

**MCP Server Clients:**
- Claude Code (claude.ai/code) - Main target
- Cursor IDE - Via MCP integration
- VS Code - Via MCP extension
- Windsurf - Via MCP integration
- Claude Desktop - Via `claude mcp add` command

**Tool Registration:**
```bash
# User-wide installation
claude mcp add codetree -- uvx --from mcp-server-codetree codetree --root .

# Or with pip
pip install mcp-server-codetree
codetree --root /path/to/repo
```

**Tool Transport:**
- Stdio-based (FastMCP default)
- No TCP, no HTTP

## Dataflow & Security Analysis

**Taint Analysis (local only):**
- `src/codetree/graph/dataflow.py` - Intra-function taint tracking
  - Known sources: `request.get`, `sys.stdin`, `os.environ`, `open()`, etc.
  - Known sinks: `db.execute`, `os.system`, `subprocess`, `eval`, `exec`, etc.
  - Known sanitizers: `html.escape`, `bleach.clean`, `urllib.parse.quote`, type casting, etc.
  - No external taint definitions or security databases
  - No network calls

## Concurrency & Thread Safety

**Execution Model:**
- Single-threaded during indexing and analysis
- MCP tool calls are sequential (no concurrent agent requests)
- SQLite graph store uses blocking locks (serialized writes, concurrent reads)
- `atexit` handler closes database connection on shutdown

---

*Integration audit: 2026-04-03*
