import argparse
import importlib.metadata
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time

from datavloot_platform import autostart, location
from datavloot_platform.crowsnest.processes import console_child_flags, port_in_use, terminate_tree

TEMPLATES_DIR = pathlib.Path(__file__).parent / "templates"

# The optimist dbt package release that new projects get, the one this toolkit
# release was tested with: a tag of github.com/datavloot/dbt-datavloot-optimist.
# It has its own version series, apart from the toolkit's: bump it with every
# release of that repository.
DBT_PACKAGE_VERSION = "0.1.1"

# How long the Crows Nest waits for open connections when it shuts down, before
# it goes on regardless (cmd_crowsnest).
SHUTDOWN_GRACE_SECONDS = 5

_IGNORE = shutil.ignore_patterns(
    "__pycache__", "*.pyc", ".venv", "target", "dbt_packages", "logs"
)


def _copy_template(source: pathlib.Path, dest: pathlib.Path) -> None:
    if dest.exists():
        sys.exit(f"Error: '{dest}' already exists. Choose a different path.")
    shutil.copytree(source, dest, ignore=_IGNORE)


def _preinstall_extensions(dest: pathlib.Path) -> None:
    """
    Install the DuckDB extensions now, while the user is here to read a failure.

    Best effort: a failed download prints the manual route and the project is
    still created. Without the optimist extra there is no duckdb to install
    into, and nothing that would load an extension either.

    The lake is not created here. This DuckDB is the CLI's, which need not be
    the project's -- under uvx it is a separate environment -- and a catalog
    written by a newer DuckLake cannot be read by an older one (storage.py).
    `datavloot start` creates it with the project's own DuckDB (_check_lake).
    """
    try:
        import duckdb
    except ImportError:
        return

    from datavloot_platform import extensions

    print(f"Installing DuckDB extensions ({', '.join(extensions.REQUIRED)})…", flush=True)
    conn = duckdb.connect()
    try:
        failures = extensions.install(conn)
    finally:
        conn.close()
    for message in failures:
        print(f"Warning: {message}\n", file=sys.stderr)


def _check_lake(project_dir: pathlib.Path) -> None:
    """
    Create the project's lake if it has none, or check that this DuckDB can read it.

    Run by `start`, in the project's environment, so the catalog is created by
    the DuckDB that will use it, and readers find a lake before the first run.
    A catalog from a newer DuckLake stops the start with what to do about it,
    rather than failing the first run with DuckLake's own message. Anything
    else -- no network for the extensions, a locked catalog -- is a warning:
    the Crows Nest and the runs report it again where it matters.
    """
    from datavloot_platform import storage

    if storage.find_project_dir(project_dir) != project_dir.resolve():
        return
    exists = storage.catalog_path(project_dir).is_file()
    try:
        storage.connect(project_dir, read_only=exists).close()
    except storage.CatalogTooNew as e:
        sys.exit(f"Error: {e}")
    except Exception as e:
        print(f"Warning: could not open the lake in {storage.lake_dir(project_dir)}: {e}\n", file=sys.stderr)


def _warn_about_location(path: pathlib.Path, project_name: str) -> None:
    """Print warnings about where the project and this environment live; never stop."""
    warnings = location.project_warnings(path, project_name) + location.environment_warnings()
    for warning in warnings:
        print(f"Warning: {warning}\n", file=sys.stderr)


def _to_identifier(name: str) -> str:
    """Convert a directory name to a valid Python identifier."""
    return name.replace("-", "_").replace(" ", "_").lower()


def _substitute(dest: pathlib.Path, project_name: str) -> None:
    """Replace placeholder tokens in the copied scaffold with the project name."""
    module_name = f"{project_name}_platform"

    # Rename the placeholder directory before touching file contents
    placeholder_dir = dest / "project_platform"
    if placeholder_dir.exists():
        placeholder_dir.rename(dest / module_name)

    # Ordered substitutions: more specific tokens first to avoid partial matches
    substitutions = [
        ("project_dbt_assets", f"{project_name}_dbt_assets"),
        ("project_dbt_project", f"{project_name}_dbt_project"),
        ("project_platform", module_name),
        ("<project_name>", project_name),
    ]

    for fpath in dest.rglob("*"):
        if not fpath.is_file():
            continue
        try:
            content = fpath.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        new_content = content
        for old, new in substitutions:
            new_content = new_content.replace(old, new)
        if new_content != content:
            fpath.write_text(new_content, encoding="utf-8")


def _versions() -> dict[str, str]:
    """
    The versions a new project pins, by placeholder.

    Read before a template is copied, so a failure here leaves no half-made
    project behind.
    """
    return {
        "<toolkit_version>": importlib.metadata.version("datavloot"),
        "<dbt_package_version>": DBT_PACKAGE_VERSION,
    }


def _pin_versions(dest: pathlib.Path, versions: dict[str, str]) -> None:
    """
    Pin the toolkit and the dbt package in a new project to known versions.

    The toolkit to this release and its later patches (`~=`), the dbt package to
    the exact release this toolkit was tested with. A patch of the toolkit can
    therefore run with the dbt package of the release that created the project;
    moving that pin is left to the user, or to `datavloot upgrade` (#55).
    """
    for name in ("pyproject.toml", "packages.yml"):
        path = dest / name
        text = path.read_text(encoding="utf-8")
        for placeholder, version in versions.items():
            text = text.replace(placeholder, version)
        path.write_text(text, encoding="utf-8")


def cmd_new(args: argparse.Namespace) -> None:
    if getattr(args, "source", None):
        return cmd_new_from(args)
    if getattr(args, "ref", None) or getattr(args, "subdir", None):
        sys.exit("Error: --ref and --path go with --from <repository>.")
    dest = pathlib.Path(args.path).resolve()
    project_name = _to_identifier(dest.name)
    versions = _versions()

    _copy_template(TEMPLATES_DIR / "scaffold", dest)
    _substitute(dest, project_name)
    _pin_versions(dest, versions)
    _preinstall_extensions(dest)

    _warn_about_location(dest, project_name)
    print(f"Project '{project_name}' created at '{dest}'.\n")
    print("Next steps:")
    print(f"  1. cd {dest}")
    print(f"  2. pip install -e .   # install the project's Python package")
    print(f"  3. dbt deps           # install the dbt packages; again after changing packages.yml")
    print(f"  4. dbt parse          # compile the manifest for Dagster")
    print(f"  5. datavloot start    # Dagster at http://localhost:3000, the Crows Nest at http://localhost:8080")
    print(f"\nSee data-instructions.md or hand it to your AI assistant at the start of a session so it")
    print(f"knows the toolkit's conventions, then start adding your data sources.")


def cmd_new_from(args: argparse.Namespace) -> None:
    """`datavloot new <path> --from <repository>`: see datavloot_platform/remote.py."""
    from datavloot_platform import remote

    dest = pathlib.Path(args.path).resolve()
    # Before the download, so a warning is read while there is still time to
    # choose another folder.
    _warn_about_location(dest, _to_identifier(dest.name))
    try:
        remote.install(dest, args.source, args.ref, args.subdir)
    except remote.RemoteError as e:
        sys.exit(f"Error: {e}")
    if os.environ.get("DATAVLOOT_INSTALLER"):
        # install.ps1 / install.sh start it themselves.
        return
    print(f"\nReady. Put the project's input files in place first, usually in {dest / 'data'}.")
    print(f"Then start Dagster and the Crows Nest with:")
    print(f"  cd \"{dest}\"")
    print(f"  uv run datavloot start")
    print(f"and click Materialize all in the Crows Nest's Pipelines panel to build every table.")
    print(f"Later, `datavloot update` in that folder installs a newer version of the project.")


def cmd_update(args: argparse.Namespace) -> None:
    """`datavloot update`: see datavloot_platform/remote.py."""
    from datavloot_platform import remote
    from datavloot_platform.crowsnest.config import get_config

    project = pathlib.Path.cwd()
    _warn_about_location(project, _to_identifier(project.name))
    try:
        result = remote.update(project, args.ref)
    except remote.RemoteError as e:
        sys.exit(f"Error: {e}")
    if result is None:
        return
    print(f"\n{remote.run_after_update(project, get_config().dagster_graphql_url, args.run)}")
    print(f"\nUpdated from {result[0]} to {result[1]}.")


def cmd_demo(args: argparse.Namespace) -> None:
    dest = (
        pathlib.Path(args.path).resolve()
        if args.path
        else pathlib.Path.cwd() / "optimist-demo"
    )
    versions = _versions()
    _copy_template(TEMPLATES_DIR / "demo", dest)
    _pin_versions(dest, versions)
    _preinstall_extensions(dest)
    # The demo keeps its own name (noaa), unlike a scaffolded project.
    _warn_about_location(dest, "noaa")
    print(f"NOAA demo project created at '{dest}'.\n")
    if os.environ.get("DATAVLOOT_INSTALLER"):
        # install.ps1 / install.sh take the next steps themselves.
        return
    print("Next steps:")
    print(f"  1. cd {dest}")
    print(f"  2. pip install -e .   # install the demo's Python package")
    print(f"  3. dbt deps           # install the dbt packages; again after changing packages.yml")
    print(f"  4. dbt parse          # compile the manifest for Dagster")
    print(f"  5. datavloot start    # Dagster at http://localhost:3000, the Crows Nest at http://localhost:8080")
    print(f"\nThe first run downloads NOAA's Guam 2025 AIS data into data/ (41 MB, 366 MB unpacked).")
    print(f"\nHand data-instructions.md to your AI assistant at the start of a session so it")
    print(f"knows the toolkit's conventions.")


def cmd_crowsnest(args: argparse.Namespace) -> None:
    try:
        import uvicorn
    except ImportError:
        sys.exit(
            "Error: uvicorn is required for the Crows Nest. "
            "Install it with: pip install datavloot[optimist]"
        )

    from datavloot_platform.crowsnest.config import get_config, sql_write_enabled
    from datavloot_platform.crowsnest.server import create_app

    try:
        sql_write = sql_write_enabled(args.host)
    except ValueError as e:
        sys.exit(f"Error: {e}")

    config = get_config()
    print(f"Starting Crows Nest on http://{args.host}:{args.port}")
    if config.ducklake_catalog_path:
        print(f"  Lake:    {config.ducklake_catalog_path} (as {config.ducklake_alias})")
    else:
        print(f"  DuckDB:  {config.duckdb_path}")
    print(f"  Dagster: {config.dagster_graphql_url}")
    print(f"  Marimo:  {config.marimo_url}")
    from datavloot_platform.crowsnest.auth import get_auth_token
    print(f"  Auth:    {'token required' if get_auth_token() else 'none (set CROWSNEST_AUTH_TOKEN to require one)'}")
    if sql_write:
        print("  SQL:     read-write (set CROWSNEST_SQL_WRITE=0 to make the editor read-only)")
    else:
        print("  SQL:     read-only (set CROWSNEST_SQL_WRITE=1 to let the editor change the lake)")
    print()

    if args.open:
        import threading
        import webbrowser
        url = f"http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}"
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    app = create_app(host=args.host)
    # The Marimo servers run in a session of their own, and the atexit hooks
    # that stop them run only when Python exits normally. uvicorn shuts down on
    # SIGTERM (and on Windows SIGBREAK) and then raises it again into the handler
    # it found, so make those exit normally. Closing the terminal sends SIGHUP,
    # which uvicorn does not handle: turn it into that SIGTERM, unless SIGHUP is
    # ignored (nohup).
    if signal.getsignal(signal.SIGTERM) is signal.SIG_DFL:
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    if hasattr(signal, "SIGBREAK") and signal.getsignal(signal.SIGBREAK) is signal.SIG_DFL:
        signal.signal(signal.SIGBREAK, lambda *_: sys.exit(0))
    if hasattr(signal, "SIGHUP") and signal.getsignal(signal.SIGHUP) is signal.SIG_DFL:
        signal.signal(signal.SIGHUP, lambda *_: os.kill(os.getpid(), signal.SIGTERM))
    # A server of our own rather than uvicorn.run, so the Crows Nest's Shut down
    # button can ask it to exit (server.py, /api/shutdown); it then returns here
    # like after Ctrl+C, and cmd_start stops Dagster.
    # timeout_graceful_shutdown: without it uvicorn waits for every open
    # connection to close, and a browser tab holding one kept a Shut down from
    # ever finishing -- so Dagster and Marimo were never stopped.
    server = uvicorn.Server(
        uvicorn.Config(app, host=args.host, port=args.port, timeout_graceful_shutdown=SHUTDOWN_GRACE_SECONDS)
    )
    app.state.server = server
    app.state.after_shutdown = _exit_watchdog
    server.run()


def _exit_watchdog() -> None:
    """
    After Shut down, end this process even if a clean exit stalls.

    Shut down has already cancelled the runs and stopped Marimo and Dagster
    itself (server.py), so nothing is left to clean up by the time this fires.
    Without it, a stalled exit -- seen once, with a browser tab open on the
    Crows Nest, and not reproduced since -- left a process behind that held on
    to nothing useful but kept `datavloot open` from starting a new one.
    """
    import threading

    timer = threading.Timer(SHUTDOWN_GRACE_SECONDS + 10, os._exit, args=(0,))
    timer.daemon = True  # never what keeps the process alive itself
    timer.start()


# GraphQL probe: is the webserver up, and did every code location load?
# A webserver that answers while its code location is broken is the failure mode that
# matters -- the UI responds, but no assets exist, so a plain "did it respond" check
# passes on a platform that cannot actually run anything.
_READINESS_QUERY = """
{
  workspaceOrError {
    __typename
    ... on Workspace {
      locationEntries {
        name
        loadStatus
        locationOrLoadError {
          __typename
          ... on PythonError { message }
        }
      }
    }
    ... on PythonError { message }
  }
}
"""


def _wait_for_dagster(proc: subprocess.Popen, graphql_url: str, timeout: int = 60):
    """
    Block until Dagster is genuinely usable.  Return None on success, else an error string.

    Four outcomes are distinguished, because they warrant different responses:
      - process died          -> fail at once; waiting out the timeout tells us nothing
      - webserver not up yet  -> keep polling
      - locations still load  -> keep polling
      - a location failed     -> fail, surfacing the Python error Dagster reported
    """
    import httpx

    from datavloot_platform.crowsnest import startup

    last_detail = "no response from the webserver"

    for _ in range(timeout):
        if proc.poll() is not None:
            return f"Dagster exited with code {proc.returncode} before becoming ready."

        time.sleep(1)
        try:
            resp = httpx.post(graphql_url, json={"query": _READINESS_QUERY}, timeout=2)
        except Exception:
            continue  # not listening yet

        if resp.status_code != 200:
            last_detail = f"webserver returned HTTP {resp.status_code}"
            continue

        # The webserver answers: what is left is loading the project.
        startup.set_stage("project")

        try:
            workspace = resp.json()["data"]["workspaceOrError"]
        except Exception:
            last_detail = "webserver returned an unreadable GraphQL response"
            continue

        if workspace.get("__typename") == "PythonError":
            message = (workspace.get("message") or "").rstrip()
            return f"Dagster failed to load the workspace:\n\n{message}"

        entries = workspace.get("locationEntries", [])
        if not entries:
            last_detail = "no code locations found in the workspace"
            continue

        loading = [e.get("name", "?") for e in entries if e.get("loadStatus") == "LOADING"]
        if loading:
            last_detail = f"code location(s) still loading: {', '.join(loading)}"
            continue

        failed = [
            e for e in entries
            if (e.get("locationOrLoadError") or {}).get("__typename") == "PythonError"
        ]
        if failed:
            details = "\n\n".join(
                "  Code location '{}' failed to load:\n{}".format(
                    e.get("name", "?"),
                    ((e.get("locationOrLoadError") or {}).get("message") or "").rstrip(),
                )
                for e in failed
            )
            return f"Dagster started but its code location(s) did not load.\n\n{details}"

        return None

    return f"Dagster did not become ready within {timeout} seconds ({last_detail})."


_ASSETS_QUERY = """
{
  repositoriesOrError {
    __typename
    ... on RepositoryConnection {
      nodes {
        name
        location { name }
        assetNodes { assetKey { path } isMaterializable isPartitioned jobNames }
      }
    }
    ... on PythonError { message }
  }
}
"""

_LAUNCH_MUTATION = """
mutation Launch($params: ExecutionParams!) {
  launchRun(executionParams: $params) {
    __typename
    ... on LaunchRunSuccess { run { runId } }
    ... on PythonError { message }
    ... on InvalidSubsetError { message }
    ... on RunConfigValidationInvalid { errors { message } }
  }
}
"""


def materialize_all(graphql_url: str, started_by: str = "datavloot start --run") -> tuple[bool, str]:
    """
    Start one run of every asset, as "Materialize all" in Dagster does.

    Return whether a run started, and what happened in a sentence for the user.

    Through Dagster's own API, so the run goes through the instance like one
    started in the UI: it shows in the Crows Nest's Pipelines panel and keeps to
    the "lake" pool (dagster.yaml). Partitioned assets are left out: a run of
    unpartitioned assets cannot take them. Never raises: the platform is up
    either way, and the run can be started by hand.
    """
    manual = "Start it in Dagster instead: Asset Catalog > Materialize all."
    try:
        import httpx

        resp = httpx.post(graphql_url, json={"query": _ASSETS_QUERY}, timeout=30)
        repos = resp.json()["data"]["repositoriesOrError"]
        if repos.get("__typename") != "RepositoryConnection":
            return False, f"Could not list the assets: {repos.get('message', repos)}. {manual}"

        launched, skipped = [], 0
        for repo in repos["nodes"]:
            assets = [a for a in repo["assetNodes"] if a["isMaterializable"]]
            selection = [{"path": a["assetKey"]["path"]} for a in assets if not a["isPartitioned"]]
            skipped += len(assets) - len(selection)
            jobs = {
                job for a in assets if not a["isPartitioned"]
                for job in a["jobNames"] if job.startswith("__ASSET_JOB")
            }
            if not selection or len(jobs) != 1:
                continue
            params = {
                "selector": {
                    "repositoryLocationName": repo["location"]["name"],
                    "repositoryName": repo["name"],
                    "pipelineName": jobs.pop(),
                    "assetSelection": selection,
                },
                "executionMetadata": {
                    "tags": [{"key": "datavloot/started_by", "value": started_by}],
                },
            }
            resp = httpx.post(
                graphql_url,
                json={"query": _LAUNCH_MUTATION, "variables": {"params": params}},
                timeout=60,
            )
            result = resp.json()["data"]["launchRun"]
            if result["__typename"] != "LaunchRunSuccess":
                detail = result.get("message") or "; ".join(
                    e["message"] for e in result.get("errors", [])
                ) or result["__typename"]
                return False, f"Could not start the run: {detail}. {manual}"
            launched.append(f"{len(selection)} assets in {repo['location']['name']}")
    except Exception as e:  # noqa: BLE001 -- see the docstring
        return False, f"Could not start the run: {e}. {manual}"

    if not launched:
        return False, f"Found no assets to run. {manual}"
    note = f" ({skipped} partitioned assets left out)" if skipped else ""
    return True, f"Started a run of {', '.join(launched)}{note}."


_ACTIVE_RUNS_QUERY = """
query ActiveRuns($statuses: [RunStatus!]) {
  runsOrError(filter: {statuses: $statuses}, limit: 100) {
    __typename
    ... on Runs { results { runId updateTime } }
  }
}
"""

_CANCEL_MUTATION = """
mutation Cancel($runId: String!) {
  terminateRun(runId: $runId, terminatePolicy: MARK_AS_CANCELED_IMMEDIATELY) {
    __typename
    ... on TerminateRunFailure { message }
    ... on PythonError { message }
  }
}
"""


def cancel_runs(
    graphql_url: str,
    statuses: tuple[str, ...] = ("STARTING", "STARTED", "CANCELING", "QUEUED"),
    not_updated_since: float | None = None,
) -> list[str]:
    """
    Mark runs as cancelled in Dagster, and stop their processes if any are left.
    Return the ids of the runs it cancelled.

    Two callers. The Crows Nest's Shut down, before Datavloot stops: a run
    still going would otherwise stay "Started" forever, since its process dies
    with Dagster before Dagster can record it. And `datavloot start`, once
    Dagster is ready, for the runs an earlier Datavloot left that way -- after
    a forced stop, a logout or a laptop that switched off mid-run. Dagster's
    run launcher on a laptop runs a run inside Dagster's own processes, so after
    a restart no run of the previous one can still be going; `not_updated_since`
    (the moment this Dagster started) keeps a run this Dagster just started out
    of it. Never raises: cleaning up must not stop a start or a shutdown.
    """
    cancelled: list[str] = []
    try:
        import httpx

        resp = httpx.post(
            graphql_url,
            json={"query": _ACTIVE_RUNS_QUERY, "variables": {"statuses": list(statuses)}},
            timeout=10,
        )
        runs = resp.json()["data"]["runsOrError"].get("results") or []
        for run in runs:
            updated = run.get("updateTime")
            if not_updated_since is not None and (updated is None or updated >= not_updated_since):
                continue
            result = httpx.post(
                graphql_url,
                json={"query": _CANCEL_MUTATION, "variables": {"runId": run["runId"]}},
                timeout=30,
            ).json()["data"]["terminateRun"]
            if result.get("__typename") == "TerminateRunSuccess":
                cancelled.append(run["runId"])
            else:
                print(f"Could not cancel run {run['runId']}: {result.get('message', result)}", flush=True)
    except Exception as e:  # noqa: BLE001 -- see the docstring
        print(f"Could not check for runs to cancel: {e}", flush=True)
    return cancelled


_CLAIMS_QUERY = """
query Claims {
  instance {
    concurrencyLimits {
      claimedSlots { runId }
      pendingSteps { runId }
    }
  }
}
"""

_RUN_STATUSES_QUERY = """
query RunStatuses($runIds: [String!], $limit: Int) {
  runsOrError(filter: {runIds: $runIds}, limit: $limit) {
    __typename
    ... on Runs { results { runId status } }
    ... on PythonError { message }
  }
}
"""

_FREE_SLOTS_MUTATION = """
mutation FreeSlots($runId: String!) {
  freeConcurrencySlotsForRun(runId: $runId)
}
"""

_FINAL_RUN_STATUSES = ("SUCCESS", "FAILURE", "CANCELED")


def free_finished_run_slots(graphql_url: str) -> list[str]:
    """
    Free the concurrency-pool slots that runs which have ended still claim.
    Return the ids of the runs whose slots it freed.

    A run frees its slots in its own process when its steps end. When that
    process dies first -- a forced stop, a logout, a laptop that switched off --
    nothing does, and marking the run cancelled does not either. The slot then
    stays claimed, and every later run waits for the pool (`lake`, one slot)
    as Queued for good. Called after cancel_runs, at start and at Shut down.
    A run that is queued, starting or started keeps its slots; one deleted in
    Dagster since does not, and only a slot Dagster says it freed counts. Never raises:
    cleaning up must not stop a start or a shutdown.
    """
    freed: list[str] = []
    try:
        import httpx

        def ask(query: str, variables: dict | None = None) -> dict:
            body = httpx.post(graphql_url, json={"query": query, "variables": variables or {}}, timeout=10).json()
            if body.get("errors") or body.get("data") is None:
                raise RuntimeError(body.get("errors") or "no data in Dagster's answer")
            return body["data"]

        limits = ask(_CLAIMS_QUERY)["instance"]["concurrencyLimits"] or []
        run_ids = sorted(
            {
                claim["runId"]
                for limit in limits
                for claim in (limit.get("claimedSlots") or []) + (limit.get("pendingSteps") or [])
                if claim.get("runId")
            }
        )
        if not run_ids:
            return freed
        runs = ask(_RUN_STATUSES_QUERY, {"runIds": run_ids, "limit": len(run_ids)})["runsOrError"]
        if runs.get("__typename") != "Runs":
            raise RuntimeError(runs.get("message") or runs)
        status = {run["runId"]: run["status"] for run in runs.get("results") or []}
        for run_id in run_ids:
            # A run deleted in Dagster keeps its claims too: nothing will ever free them.
            if status.get(run_id, "DELETED") not in (*_FINAL_RUN_STATUSES, "DELETED"):
                continue
            try:
                done = ask(_FREE_SLOTS_MUTATION, {"runId": run_id}).get("freeConcurrencySlotsForRun")
            except Exception as e:  # noqa: BLE001 -- the other runs still get their turn
                print(f"Could not free the pool slots of run {run_id}: {e}", flush=True)
                continue
            if done:
                freed.append(run_id)
            else:
                print(f"Dagster did not free the pool slots of run {run_id}.", flush=True)
    except Exception as e:  # noqa: BLE001 -- see the docstring
        print(f"Could not check for pool slots to free: {e}", flush=True)
    return freed


def _materialize_all(graphql_url: str) -> str:
    """materialize_all, as the sentence `start --run` and `update` print."""
    started, message = materialize_all(graphql_url)
    return f"{message} Follow it in the Crows Nest's Pipelines panel." if started else message


def _dagster_home(project_dir: pathlib.Path) -> dict[str, str]:
    """
    DAGSTER_HOME for `dagster dev`: the one set, else <project>/.dagster.

    Without DAGSTER_HOME, `dagster dev` makes a temporary home per start, and
    a restart forgets the run history, which schedules and sensors are on, and
    what a sensor already picked up. A home inside the project keeps all that.
    Dagster reads its instance settings (dagster.yaml) from DAGSTER_HOME only,
    so the project's copy goes there on every start: an edit to it then counts
    from the next start, and without it the lake's one-writer pool is gone.
    """
    if os.environ.get("DAGSTER_HOME"):
        return {}
    home = project_dir / ".dagster"
    home.mkdir(exist_ok=True)
    settings, copy = project_dir / "dagster.yaml", home / "dagster.yaml"
    if settings.is_file():
        shutil.copyfile(settings, copy)
    else:
        copy.unlink(missing_ok=True)
    return {"DAGSTER_HOME": str(home)}


def cmd_start(args: argparse.Namespace) -> None:
    # `start` runs from the project directory, which may have been created or
    # moved without going through `new`.
    project_dir = pathlib.Path.cwd()
    # First, so that with --log (autostart) even a missing uvicorn is in the log.
    log = autostart.redirect_output(project_dir, getattr(args, "log", None))

    try:
        import uvicorn  # noqa: F401
    except ImportError:
        sys.exit(
            "Error: uvicorn is required. "
            "Install it with: pip install datavloot[optimist]"
        )

    from datavloot_platform.crowsnest.config import get_config

    graphql_url = get_config().dagster_graphql_url

    _warn_about_location(project_dir, _to_identifier(project_dir.name))

    # Before Dagster, so a second start fails at once and says why, instead of
    # after Dagster has loaded, in a line of uvicorn's.
    port = getattr(args, "port", None)
    if port and port_in_use(port):
        sys.exit(
            f"Error: port {port}, which the Crows Nest needs, is in use. If Datavloot is "
            f"already running, open http://localhost:{port}; otherwise stop the program "
            "that holds the port and start again."
        )
    # Also before Dagster: a lake this DuckDB cannot read stops the start here.
    _check_lake(project_dir)

    # This environment's scripts first on the PATH, for Dagster and the dbt it
    # runs: started without activating the venv (a shortcut, autostart), the
    # PATH can hold another dbt -- a global dbt Fusion fails on the profile.
    scripts = str(pathlib.Path(sys.executable).parent)
    env = {**os.environ, "PATH": scripts + os.pathsep + os.environ.get("PATH", "")}
    env.update(_dagster_home(project_dir))
    print(f"Starting Dagster, with its state in {env['DAGSTER_HOME']}…")
    if (project_dir / "dagster.yaml").is_file():
        # dagster dev warns about the dagster.yaml it finds in the working
        # directory; the copy in DAGSTER_HOME is the one it uses.
        print("  (Dagster's warning that dagster.yaml will not be used is about the original; it uses the copy.)")

    with autostart.start_marker(project_dir):
        _start(args, graphql_url, scripts, env, log)


def _start(args, graphql_url, scripts, env, log) -> None:
    # POSIX: own session, so the whole tree can be signalled as one group.
    # Windows without a console (pythonw): no console window for Dagster
    # either (console_child_flags). A child in a console of its own writes to
    # that console unless it is handed output handles, and Popen hands them
    # down only when one of the three is set: hence stdin, which Dagster does
    # not read. With a log, Dagster's output goes there too.
    flags = console_child_flags()
    stdio: dict = {"stdin": subprocess.DEVNULL} if flags or log else {}
    if log:
        stdio.update(stdout=log, stderr=subprocess.STDOUT)
    # Runs not updated since this moment were left by an earlier Dagster (cancel_runs).
    dagster_started = time.time()
    dagster_proc = subprocess.Popen(
        [shutil.which("dagster", path=scripts) or "dagster", "dev"],
        env=env,
        start_new_session=(os.name != "nt"),
        creationflags=flags,
        **stdio,
    )

    # The Crows Nest starts now, not once Dagster is ready: loading a project
    # takes Dagster half a minute or more, and from a shortcut nothing showed
    # in that time. Dagster's readiness is watched beside it; the Crows Nest
    # says "starting" meanwhile, and the error if loading fails (startup.py).
    from datavloot_platform.crowsnest import startup

    project_dir = pathlib.Path.cwd()
    startup.set_dagster("starting", expected=startup.last_start_seconds(project_dir))
    startup.set_dagster_process(dagster_proc)

    def watch() -> None:
        print(f"Waiting for Dagster to be ready at {graphql_url}…", flush=True)
        error = _wait_for_dagster(dagster_proc, graphql_url)
        if startup.stopping():
            # Shut down stopped Dagster while it was loading: not a failed start.
            print("Dagster stopped before it was ready: Datavloot is shutting down.", flush=True)
            return
        if error:
            # The Crows Nest stays up to show it; Dagster's leftovers go.
            terminate_tree(dagster_proc)
            startup.set_dagster("failed", error)
            print(f"Error: {error}", flush=True)
            return
        startup.set_dagster("ready")
        # For the next start's progress bar (startup.last_start_seconds).
        startup.record_start_seconds(project_dir, time.time() - dagster_started)
        print("Dagster is ready.", flush=True)
        left = cancel_runs(
            graphql_url,
            statuses=("STARTING", "STARTED", "CANCELING"),
            not_updated_since=dagster_started,
        )
        if left:
            print(
                f"Marked {len(left)} run(s) as cancelled that an earlier Datavloot left "
                f"running when it stopped: {', '.join(r[:8] for r in left)}.",
                flush=True,
            )
        stuck = free_finished_run_slots(graphql_url)
        if stuck:
            print(
                f"Freed the pool slots of {len(stuck)} finished run(s) that an earlier Datavloot "
                f"cut off: {', '.join(r[:8] for r in stuck)}.",
                flush=True,
            )
        if getattr(args, "run", False):
            # Not fatal: the platform is up, and the run can be started by hand.
            print(_materialize_all(graphql_url), flush=True)

    import threading

    threading.Thread(target=watch, name="dagster-ready", daemon=True).start()

    try:
        cmd_crowsnest(args)
    finally:
        # A closed terminal takes stdout with it, and Dagster has to stop anyway.
        try:
            print("\nShutting down Dagster…")
        except OSError:
            pass
        terminate_tree(dagster_proc)
        startup.set_dagster_process(None)


def cmd_autostart(args: argparse.Namespace) -> None:
    autostart.main(args.action, pathlib.Path.cwd())


def cmd_shortcut(args: argparse.Namespace) -> None:
    autostart.main(args.action, pathlib.Path.cwd(), login=False)


def cmd_open(args: argparse.Namespace) -> None:
    sys.exit(autostart.open_crowsnest(pathlib.Path.cwd()))


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="datavloot",
        description="Datavloot CLI",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    new_parser = subparsers.add_parser(
        "new", help="Scaffold a new project at the given path"
    )
    new_parser.add_argument("path", help="Path where the project will be created")
    new_parser.add_argument(
        "--from", dest="source", metavar="URL",
        help="Install an existing project from a tag of this GitHub or GitLab repository",
    )
    new_parser.add_argument(
        "--ref", metavar="TAG", help="With --from: the tag to install (default: the latest version)"
    )
    new_parser.add_argument(
        "--path", dest="subdir", metavar="FOLDER",
        help="With --from: the project's folder in the repository, when it cannot be found by itself",
    )
    new_parser.set_defaults(func=cmd_new)

    update_parser = subparsers.add_parser(
        "update", help="Install another tag of a project installed with `new --from`"
    )
    update_parser.add_argument(
        "--ref", metavar="TAG", help="The tag to go to, also an older one (default: the latest version)"
    )
    update_parser.add_argument(
        "--no-run", dest="run", action="store_false",
        help="Do not start a run of every asset afterwards",
    )
    update_parser.set_defaults(func=cmd_update, run=True)

    demo_parser = subparsers.add_parser(
        "demo", help="Copy the NOAA worked example to a local directory"
    )
    demo_parser.add_argument(
        "path",
        nargs="?",
        help="Path for the demo (default: ./optimist-demo)",
    )
    demo_parser.set_defaults(func=cmd_demo)

    crowsnest_parser = subparsers.add_parser(
        "launch", help="Start the Crows Nest unified dashboard"
    )
    crowsnest_parser.add_argument(
        "--port", type=int, default=8080, help="Port to listen on (default: 8080)"
    )
    crowsnest_parser.add_argument(
        "--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)"
    )
    crowsnest_parser.add_argument(
        "--no-open", dest="open", action="store_false",
        help="Do not open the browser automatically"
    )
    crowsnest_parser.set_defaults(func=cmd_crowsnest, open=True)

    start_parser = subparsers.add_parser(
        "start", help="Start Dagster and the Crows Nest together"
    )
    start_parser.add_argument(
        "--port", type=int, default=8080, help="Crows Nest port (default: 8080)"
    )
    start_parser.add_argument(
        "--host", default="127.0.0.1", help="Crows Nest host (default: 127.0.0.1)"
    )
    start_parser.add_argument(
        "--no-open", dest="open", action="store_false",
        help="Do not open the browser automatically"
    )
    start_parser.add_argument(
        "--run", action="store_true",
        help="Once Dagster is ready, start one run of every asset (Materialize all)"
    )
    start_parser.add_argument(
        "--log", metavar="FILE",
        help="Write all output to FILE, relative to the project (autostart uses "
        f"{autostart.LOG_FILE.as_posix()})"
    )
    start_parser.set_defaults(func=cmd_start, open=True)

    autostart_parser = subparsers.add_parser(
        "autostart",
        help="Start this project's Datavloot at login, with a shortcut to the Crows Nest",
    )
    autostart_parser.add_argument(
        "action", choices=["on", "off", "status"],
        help="on: start at login and make the shortcut; off: remove both; status: show what is there",
    )
    autostart_parser.set_defaults(func=cmd_autostart)

    shortcut_parser = subparsers.add_parser(
        "shortcut",
        help="A shortcut to this project's Crows Nest, without starting Datavloot at login",
    )
    shortcut_parser.add_argument(
        "action", choices=["on", "off", "status"],
        help="on: make the shortcut (and switch autostart off); off: remove it; status: show what is there",
    )
    shortcut_parser.set_defaults(func=cmd_shortcut)

    open_parser = subparsers.add_parser(
        "open",
        help="Open the Crows Nest, starting Datavloot in the background if it is not running",
    )
    open_parser.set_defaults(func=cmd_open)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
