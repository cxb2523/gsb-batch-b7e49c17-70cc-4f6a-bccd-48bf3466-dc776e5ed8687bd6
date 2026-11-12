"""
Crows Nest FastAPI application.

Serves the REST API at /api/* and the pre-built frontend static files at /*.
Both run on the same port so no CORS configuration is needed.
"""

import asyncio
import pathlib
from importlib.metadata import PackageNotFoundError, version

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from datavloot_platform.crowsnest.auth import TokenAuthMiddleware, get_auth_token
from datavloot_platform.crowsnest.config import get_config, is_loopback, sql_write_enabled
from datavloot_platform.crowsnest import startup
from datavloot_platform.crowsnest.db import get_conn
from datavloot_platform.crowsnest.httpclient import async_client
from datavloot_platform.crowsnest.processes import terminate_tree
from datavloot_platform.crowsnest.routes import pipelines, quality, query, catalog, notebooks, apps, branding

STATIC_DIR = pathlib.Path(__file__).parent / "static"

try:
    # The Crows Nest ships in the datavloot package, so that is its version.
    VERSION = version("datavloot")
except PackageNotFoundError:  # a checkout that was never installed
    VERSION = "dev"
FRONTEND_DIR = pathlib.Path(__file__).parent / "frontend"

# Build inputs that affect static/.  Only these directories are walked — never
# node_modules, .next, or out.
_SOURCE_DIRS = ("app", "components", "lib")
_SOURCE_FILES = (
    "next.config.js",
    "package.json",
    "postcss.config.js",
    "tailwind.config.js",
)

_STALE_WARNING = """
  !!  Crows Nest is serving a STALE frontend build.

      Newest source:  {source} ({age})
      Newest static/: {static}

      static/ is what this server actually serves, so the browser will show the
      PREVIOUS UI -- edits to the frontend source will look like they did nothing.

      Rebuild and deploy:
        cd datavloot_platform/crowsnest/frontend
        npm run build
        rm -rf ../static/* && cp -r out/* ../static/
"""


def _newest_mtime(paths):
    """Return (mtime, path) for the most recently modified file in paths."""
    newest, newest_path = 0.0, None
    for path in paths:
        try:
            if not path.is_file():
                continue
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime > newest:
            newest, newest_path = mtime, path
    return newest, newest_path


def _source_files():
    for dirname in _SOURCE_DIRS:
        directory = FRONTEND_DIR / dirname
        if directory.is_dir():
            yield from directory.rglob("*")
    for filename in _SOURCE_FILES:
        yield FRONTEND_DIR / filename


def check_static_freshness():
    """
    Return a warning message if static/ is older than the frontend source, else None.

    static/ is a committed build artifact -- the thing this app serves -- while
    frontend/ next to it is only the build input.  `npm run build` writes to
    frontend/out/, so editing the source and rebuilding without copying out/ into
    static/ leaves the server quietly serving an older UI.  That failure is silent
    and indistinguishable from a change not working, so it is worth catching here.

    Returns None when frontend/ is absent, and never raises -- a broken check must
    not stop the server.  frontend/ is excluded from the wheel (see the `exclude`
    list in pyproject.toml), so absent is guaranteed for an installed package and
    this check only ever runs from a source checkout, which is the only place the
    warning it prints is actionable.
    """
    try:
        if not FRONTEND_DIR.is_dir() or not STATIC_DIR.is_dir():
            return None

        source_mtime, source_path = _newest_mtime(_source_files())
        static_mtime, static_path = _newest_mtime(STATIC_DIR.rglob("*"))

        if not source_path or not static_path or source_mtime <= static_mtime:
            return None

        hours = (source_mtime - static_mtime) / 3600
        age = f"{hours:.0f}h newer" if hours < 48 else f"{hours / 24:.0f} days newer"
        return _STALE_WARNING.format(
            source=source_path.relative_to(FRONTEND_DIR).as_posix(),
            static=static_path.relative_to(STATIC_DIR).as_posix(),
            age=age,
        )
    except Exception:
        return None


class _CacheControlledStatic(StaticFiles):
    """
    StaticFiles sends no Cache-Control at all, which lets browsers apply heuristic
    caching to index.html -- quietly reusing a stale shell that points at chunk
    hashes from an older build.  The page then renders entirely from cache and looks
    like a deploy that did not take effect.

    Chunk filenames under _next/static are content-hashed, so they are immutable and
    safe to cache forever; the HTML shell that references them must always revalidate.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        content_type = response.headers.get("content-type", "")
        if content_type.startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        elif "_next/static" in str(path).replace("\\", "/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def create_app(host: str | None = None) -> FastAPI:
    """
    The Crows Nest app. `host` is the address it will listen on: it decides
    whether the SQL editor may write when CROWSNEST_SQL_WRITE is unset (see
    config.sql_write_enabled). Without it, the editor stays read-only.
    """
    app = FastAPI(
        title="Crows Nest",
        description="Unified dashboard for the Optimist data platform",
        version=VERSION,
    )
    app.state.sql_write = sql_write_enabled(host)
    # The Shut down button: only on a laptop, where the Crows Nest listens on
    # this machine alone. On a shared host anyone signed in could stop the
    # service for everyone. `server` is the uvicorn server the CLI runs this app
    # in (cli.cmd_crowsnest); without one there is nothing this app can stop.
    app.state.can_shutdown = is_loopback(host)
    app.state.server = None

    # Off unless CROWSNEST_AUTH_TOKEN is set. Added before the routers so it
    # covers the API and the static dashboard alike -- serving the UI to anyone
    # who asks while the data behind it needs a token is not a useful boundary.
    app.add_middleware(TokenAuthMiddleware)

    app.include_router(pipelines.router, prefix="/api/pipelines", tags=["Pipelines"])
    app.include_router(quality.router, prefix="/api/quality", tags=["Data Quality"])
    app.include_router(query.router, prefix="/api/query", tags=["SQL Query"])
    app.include_router(catalog.router, prefix="/api/catalog", tags=["Catalog"])
    app.include_router(notebooks.router, prefix="/api/notebooks", tags=["Notebooks"])
    app.include_router(apps.router, prefix="/api/apps", tags=["Apps"])
    app.include_router(branding.router, prefix="/api/branding", tags=["Branding"])

    @app.get("/api/health")
    async def health_check():
        """Live connectivity check for all platform services."""
        config = get_config()
        # The three at once. A short connect timeout, because on Windows a refused
        # connection (a service that is not running) takes two seconds to fail.
        timeout = httpx.Timeout(2.0, connect=0.75)

        async def dagster() -> str:
            try:
                async with async_client(timeout) as client:
                    resp = await client.post(
                        config.dagster_graphql_url,
                        json={"query": "{ __typename }"},
                    )
                    return "ok" if resp.status_code == 200 else "offline"
            except Exception:
                return "offline"

        def duckdb() -> str:
            # Open a connection the way the routes do, lake or file.
            try:
                get_conn(read_only=True).close()
                return "ok"
            except Exception:
                return "offline"

        async def marimo() -> str:
            try:
                async with async_client(timeout) as client:
                    resp = await client.get(config.marimo_url)
                    return "ok" if resp.status_code < 500 else "offline"
            except Exception:
                return "offline"

        dagster_status, duckdb_status, marimo_status = await asyncio.gather(
            dagster(), asyncio.to_thread(duckdb), marimo()
        )
        # "starting" while `datavloot start` waits for Dagster to load the
        # project, also once its webserver answers: until the code location
        # has loaded there are no pipelines yet. "failed", with the reason,
        # when that failed, and Dagster no longer answers.
        started, error = startup.dagster()
        result = {"services": {"dagster": dagster_status, "duckdb": duckdb_status, "marimo": marimo_status}}
        if started == "starting" or (dagster_status != "ok" and started == "failed"):
            result["services"]["dagster"] = started
            if error:
                result["dagster_error"] = error
        progress = startup.progress()
        if progress:
            result["dagster_start"] = progress
        return result

    @app.get("/api/services")
    async def get_services():
        """Return live service URLs for the frontend to use."""
        config = get_config()
        return {
            "dagster_url": config.dagster_public_url,
            "marimo_url": config.marimo_public_url or config.marimo_url,
            # One Marimo for every notebook (the Falcon), not one per launch.
            "marimo_shared": bool(config.marimo_public_url),
            "apps_url": config.apps_public_url or config.apps_url,
            "duckdb_path": config.duckdb_path,
            "version": VERSION,
            "can_shutdown": _can_shutdown(),
        }

    def _can_shutdown() -> bool:
        return bool(app.state.can_shutdown and app.state.server is not None)

    @app.post("/api/shutdown")
    async def shutdown(background: BackgroundTasks):
        """
        Stop Datavloot: the Crows Nest, and with it the Dagster `datavloot start`
        runs and the Marimo servers.

        The uvicorn server is asked to exit once this response has gone out, so
        the browser still hears that it worked. uvicorn then returns to the CLI,
        which stops Dagster's process tree on its way out (cli.cmd_start), and
        the normal exit runs the hooks that stop Marimo -- the same as closing
        the terminal `datavloot start` runs in.
        """
        if not app.state.can_shutdown:
            raise HTTPException(
                403,
                "Shutting down from the Crows Nest works only when it listens on this "
                "machine alone; stop the service where it runs.",
            )
        server = app.state.server
        if server is None:
            raise HTTPException(
                409, "This Crows Nest was not started with `datavloot start` or `launch`; stop it where it runs."
            )
        # Runs still going are cancelled first: their processes go down with
        # Dagster, and Dagster would otherwise keep them "Started" for good.
        from datavloot_platform.cli import cancel_runs, free_finished_run_slots

        startup.set_stopping()
        url = get_config().dagster_graphql_url
        cancelled: list[str] = []
        # A Dagster still loading has no runs going and does not answer yet:
        # asking would only fill the log with "could not check".
        if startup.dagster()[0] != "starting":
            cancelled = await asyncio.to_thread(cancel_runs, url)
            # A cancelled run's process dies with Dagster before it frees its pool
            # slots; left claimed, they would keep every later run Queued.
            await asyncio.to_thread(free_finished_run_slots, url)
        # Marimo now, not only at exit: the exit hooks run once uvicorn has
        # finished shutting down, and a shutdown that stalls (a browser tab
        # holding a connection open) left the notebook server running, holding
        # its port for the next session.
        await asyncio.to_thread(_stop_marimo)
        # Dagster too, for the same reason: `datavloot start` stops it once the
        # Crows Nest has returned, and a stalled shutdown never returned.
        dagster = startup.dagster_process()
        if dagster is not None:
            await asyncio.to_thread(terminate_tree, dagster)
        background.add_task(_exit)
        return {"message": "Datavloot is stopping.", "cancelled_runs": cancelled}

    def _stop_marimo() -> None:
        notebooks._stop_server()
        apps._stop_server()

    def _exit() -> None:
        app.state.server.should_exit = True
        # The CLI's backstop (cli._exit_watchdog); absent in tests and other servers.
        after = getattr(app.state, "after_shutdown", None)
        if after is not None:
            after()

    warning = check_static_freshness()
    if warning:
        print(warning)

    # Mount pre-built frontend last so API routes take precedence.
    # If static/ hasn't been built yet, skip the mount and the API still works.
    if STATIC_DIR.exists() and any(STATIC_DIR.iterdir()):
        app.mount("/", _CacheControlledStatic(directory=str(STATIC_DIR), html=True), name="static")

    return app
