"""
Pipeline status route — pulls from Dagster's GraphQL API.
"""

from fastapi import APIRouter, HTTPException
import httpx

from datavloot_platform.crowsnest.config import get_config
from datavloot_platform.crowsnest.httpclient import async_client

router = APIRouter()

RUNS_QUERY = """
query RecentRuns($limit: Int!) {
  runsOrError(filter: {}, limit: $limit) {
    __typename
    ... on Runs {
      results {
        runId
        status
        jobName
        assetSelection {
          path
        }
        startTime
        endTime
        tags {
          key
          value
        }
      }
    }
    ... on InvalidPipelineRunsFilterError {
      message
    }
    ... on PythonError {
      message
    }
  }
}
"""

JOBS_QUERY = """
query Jobs {
  repositoriesOrError {
    __typename
    ... on RepositoryConnection {
      nodes {
        name
        jobs {
          name
          description
          isJob
        }
      }
    }
  }
}
"""


async def _dagster_query(query: str, variables: dict | None = None) -> dict:
    config = get_config()
    async with async_client(10.0) as client:
        resp = await client.post(
            config.dagster_graphql_url,
            json={"query": query, "variables": variables or {}},
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Dagster returned {resp.status_code}")
        return resp.json()


RUN_ERRORS_QUERY = """
query RunErrors($runId: ID!) {
  logsForRun(runId: $runId, limit: 5000) {
    __typename
    ... on EventConnection {
      events {
        __typename
        ... on ExecutionStepFailureEvent {
          stepKey
          error { message causes { message } }
        }
        ... on RunFailureEvent { message }
      }
    }
  }
}
"""

# Failed runs whose error is fetched for the runs list: one Dagster query each.
_MAX_ERRORS = 10
_ERROR_CHARS = 400
_DBT_ERRORS = "Errors parsed from dbt logs:"


def error_summary(events: list[dict]) -> str | None:
    """
    The part of a failed run's error a person needs, in a line or three.

    The first failed step, with its deepest cause: a Python error raised in an
    asset comes wrapped in Dagster's own "Error occurred while executing op",
    and the cause is what went wrong. From a dbt failure, only the errors dbt
    reported, not the command line and log path dagster-dbt puts around them.
    A run that failed without a failed step (its worker died) has only Dagster's
    run failure message.
    """
    for event in events:
        if event.get("__typename") != "ExecutionStepFailureEvent":
            continue
        error = event.get("error") or {}
        messages = [error.get("message") or ""] + [
            cause.get("message") or "" for cause in error.get("causes") or []
        ]
        text = next((m for m in reversed(messages) if m.strip()), "")
        if _DBT_ERRORS in text:
            text = text.split(_DBT_ERRORS, 1)[1]
        lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
        text = " ".join(lines[:3])
        if len(text) > _ERROR_CHARS:
            text = text[:_ERROR_CHARS - 1].rstrip() + "…"
        step = event.get("stepKey")
        return f"{step}: {text}" if step else text
    for event in events:
        if event.get("__typename") == "RunFailureEvent" and event.get("message"):
            return event["message"].strip()
    return None


async def _run_error(run_id: str) -> str | None:
    try:
        data = await _dagster_query(RUN_ERRORS_QUERY, {"runId": run_id})
        logs = data.get("data", {}).get("logsForRun") or {}
        return error_summary(logs.get("events") or [])
    except Exception:  # noqa: BLE001 -- a missing tooltip must not break the list
        return None


async def _add_errors(runs: list[dict], limit: int = _MAX_ERRORS) -> None:
    """Give the first `limit` failed runs an `error`, fetched side by side."""
    import asyncio

    failed = [r for r in runs if r["status"] == "failure"][:limit]
    errors = await asyncio.gather(*(_run_error(r["id"]) for r in failed))
    for run, error in zip(failed, errors):
        run["error"] = error


@router.get("/runs")
async def get_recent_runs(limit: int = 20, errors: bool = True):
    """
    Return recent pipeline runs with normalized status.

    With `errors`, the first failed runs carry `error`: the part of the error
    message that says what went wrong (error_summary), for a tooltip.
    """
    try:
        data = await _dagster_query(RUNS_QUERY, {"limit": limit})
        runs_data = data.get("data", {}).get("runsOrError", {})

        if runs_data.get("__typename") != "Runs":
            raise HTTPException(502, runs_data.get("message", "Unknown Dagster error"))

        runs = []
        for r in runs_data.get("results", []):
            runs.append(
                {
                    "id": r["runId"],
                    "job": _job_label(r["jobName"], r.get("assetSelection")),
                    "job_name": r["jobName"],
                    "assets": _asset_keys(r.get("assetSelection")),
                    "status": _normalize_status(r["status"]),
                    "started_at": r.get("startTime"),
                    "ended_at": r.get("endTime"),
                    "duration_seconds": _calc_duration(
                        r.get("startTime"), r.get("endTime")
                    ),
                    "tags": {t["key"]: t["value"] for t in r.get("tags", [])},
                }
            )

        if errors:
            await _add_errors(runs)
        return {"runs": runs, "total": len(runs)}

    except httpx.ConnectError:
        raise HTTPException(503, "Cannot connect to Dagster — is it running?")


@router.post("/materialize-all")
async def materialize_all_assets():
    """
    Start one run of every asset, as "Materialize all" in Dagster does.

    The same call `datavloot start --run` makes (cli.materialize_all), so the
    run goes through Dagster like one started in its UI. Refused while a run is
    active: a second run of every asset would only queue behind the first, and
    two writers on the lake make one of them fail.
    """
    import asyncio

    from datavloot_platform.cli import materialize_all
    from datavloot_platform.crowsnest.routes.query import _active_run

    active = await _active_run()
    if active:
        raise HTTPException(
            409, f"A run is already in progress ({active}). Wait until it has finished."
        )
    started, message = await asyncio.to_thread(
        materialize_all, get_config().dagster_graphql_url, "Crows Nest"
    )
    if not started:
        raise HTTPException(502, message)
    return {"message": message}


@router.get("/jobs")
async def get_jobs():
    """Return all registered jobs/pipelines."""
    try:
        data = await _dagster_query(JOBS_QUERY)
        repos = data.get("data", {}).get("repositoriesOrError", {})

        if repos.get("__typename") != "RepositoryConnection":
            return {"jobs": []}

        jobs = []
        for repo in repos.get("nodes", []):
            for job in repo.get("jobs", []):
                # Dagster's own hidden jobs (__ASSET_JOB) are not the project's.
                if job.get("isJob") and not job["name"].startswith("__"):
                    jobs.append(
                        {
                            "name": job["name"],
                            "repository": repo["name"],
                            "description": job.get("description"),
                        }
                    )

        return {"jobs": jobs}

    except httpx.ConnectError:
        raise HTTPException(503, "Cannot connect to Dagster — is it running?")


# Statuses that settle how a job stands. A run in progress has not settled it
# yet, and a cancelled one never does: it says nothing about whether the job works.
_SETTLED = ("success", "failure")


def job_states(runs: list[dict]) -> dict[str, dict]:
    """
    Each job's latest settled run, by the job as `job` labels it; runs newest first.

    A job that failed and then succeeded is fine again: only its latest settled
    run counts, so an old failure does not keep a job red.

    Runs started with "Materialize" have no job: each selection of assets gets
    a label of its own, so a later "Materialize all" never settles the failed
    run of one asset. Such a failed run is left out once every asset it
    selected was in a later successful Materialize run.
    """
    latest: dict[str, dict] = {}
    for run in runs:
        if run["status"] in _SETTLED and run["job"] not in latest:
            latest[run["job"]] = run
    return {
        job: run for job, run in latest.items()
        if not (run["status"] == "failure" and _materialized_since(run, runs))
    }


def _materialized_since(failed: dict, runs: list[dict]) -> bool:
    """Whether later successful Materialize runs, together, selected every asset of `failed`."""
    if not _is_asset_job(failed.get("job_name", "")) or not failed.get("assets"):
        return False
    since: set[str] = set()
    for run in runs:  # newest first: the runs before `failed` came after it
        if run is failed:
            break
        if run["status"] == "success" and _is_asset_job(run.get("job_name", "")):
            since.update(run.get("assets") or [])
    return set(failed["assets"]) <= since


@router.get("/summary")
async def pipeline_summary(limit: int = 50):
    """
    How the pipelines stand, for the banner and the overview.

    `latest_run` is the most recent run; `jobs_by_status` counts jobs by their
    latest settled run (job_states), and `failing_jobs` lists those whose latest
    settled run failed, newest first, with its error. `by_status` still counts
    the recent runs one by one.
    """
    try:
        runs_resp = await get_recent_runs(limit=limit, errors=False)
        runs = runs_resp["runs"]

        status_counts: dict = {}
        for r in runs:
            s = r["status"]
            status_counts[s] = status_counts.get(s, 0) + 1

        states = job_states(runs)
        jobs_by_status: dict = {}
        for run in states.values():
            jobs_by_status[run["status"]] = jobs_by_status.get(run["status"], 0) + 1
        failing = [run for run in states.values() if run["status"] == "failure"]
        await _add_errors(failing)

        return {
            "total_runs": len(runs),
            "by_status": status_counts,
            "latest_run": runs[0] if runs else None,
            "jobs_by_status": jobs_by_status,
            "failing_jobs": failing,
            "running": sum(1 for r in runs if r["status"] in ("running", "queued")),
        }

    except HTTPException:
        return {
            "total_runs": 0,
            "by_status": {},
            "latest_run": None,
            "jobs_by_status": {},
            "failing_jobs": [],
            "running": 0,
            "error": "Cannot connect to Dagster",
        }


def _job_label(job_name: str, asset_selection: list | None) -> str:
    """
    The job as a person reads it.

    A run started with "Materialize" in Dagster belongs to no job of the
    project: Dagster files it under a hidden job, __ASSET_JOB. What tells such
    runs apart is the assets they materialized, so that is what is shown.
    """
    if not _is_asset_job(job_name):
        return job_name
    keys = _asset_keys(asset_selection)
    if not keys:
        return "Materialize"
    if len(keys) <= 2:
        return "Materialize: " + ", ".join(keys)
    return f"Materialize · {len(keys)} assets"


def _is_asset_job(job_name: str) -> bool:
    """Dagster's hidden job for "Materialize" runs; older Dagster numbers it (__ASSET_JOB_0)."""
    return job_name.startswith("__ASSET_JOB")


def _asset_keys(asset_selection: list | None) -> list[str]:
    return ["/".join(key["path"]) for key in asset_selection or []]


def _normalize_status(dagster_status: str) -> str:
    mapping = {
        "SUCCESS": "success",
        "FAILURE": "failure",
        "CANCELED": "cancelled",
        "CANCELING": "cancelling",
        "STARTED": "running",
        "STARTING": "running",
        "QUEUED": "queued",
        "NOT_STARTED": "pending",
    }
    return mapping.get(dagster_status, dagster_status.lower())


def _calc_duration(start: float | None, end: float | None) -> float | None:
    if start and end:
        return round(end - start, 1)
    return None
