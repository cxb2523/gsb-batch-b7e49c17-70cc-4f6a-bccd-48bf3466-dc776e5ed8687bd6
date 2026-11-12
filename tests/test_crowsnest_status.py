"""
How the Crows Nest says how things stand: per job and per test, the latest.

The header and the overview used to add up every recent run and every test
result of seven days, so one old failure kept a job red after it succeeded,
and a test counted once per run. Now a job counts by its latest settled run,
a test by its latest result, and a failed run says what went wrong.
"""

import pytest

pytest.importorskip("duckdb", reason="duckdb is not installed")
pytest.importorskip("fastapi", reason="fastapi is not installed")

from fastapi.testclient import TestClient  # noqa: E402

from datavloot_platform.crowsnest import config as cn_config  # noqa: E402
from datavloot_platform.crowsnest import server  # noqa: E402
from datavloot_platform.crowsnest.routes import pipelines  # noqa: E402


def _run(run_id, job, status, start):
    return {
        "runId": run_id, "status": status, "jobName": job, "assetSelection": None,
        "startTime": start, "endTime": start + 10, "tags": [],
    }


@pytest.fixture
def warehouse(tmp_path, monkeypatch):
    import duckdb

    db = tmp_path / "p.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE SCHEMA probe_elementary")
    con.execute(
        "CREATE TABLE probe_elementary.elementary_test_results ("
        "test_unique_id VARCHAR, status VARCHAR, detected_at TIMESTAMP)"
    )
    con.close()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CROWSNEST_DUCKDB_PATH", str(db))
    monkeypatch.setenv("CROWSNEST_ELEMENTARY_SCHEMA", "probe_elementary")
    monkeypatch.delenv("CROWSNEST_AUTH_TOKEN", raising=False)
    cn_config.reset_config()
    yield db
    cn_config.reset_config()


@pytest.fixture
def client(warehouse):
    return TestClient(server.create_app())


# --------------------------------------------------------------------------
# pipelines: per job, the latest settled run
# --------------------------------------------------------------------------

def test_a_job_that_succeeded_after_failing_is_fine_again():
    runs = [  # newest first, as Dagster returns them
        {"job": "load", "status": "running"},
        {"job": "load", "status": "success", "id": "3"},
        {"job": "load", "status": "failure", "id": "2"},
        {"job": "build", "status": "cancelled"},
        {"job": "build", "status": "failure", "id": "1"},
    ]
    states = pipelines.job_states(runs)
    assert states["load"]["id"] == "3"
    assert states["build"]["id"] == "1", "a cancelled run does not settle how a job stands"


def _materialize(run_id, status, *assets):
    return {"id": run_id, "job": f"Materialize: {', '.join(assets)}", "job_name": "__ASSET_JOB",
            "assets": list(assets), "status": status}


def test_a_later_materialize_all_settles_a_failed_asset():
    """
    One asset failed, then "Materialize all" succeeded: nothing is failing.

    The two runs have different labels, so by label alone the failed run of
    the one asset stayed the latest of its "job", and the banner kept saying
    "1 failing".
    """
    runs = [
        _materialize("2", "success", "a", "b", "c"),
        _materialize("1", "failure", "b"),
    ]
    states = pipelines.job_states(runs)
    assert [run["id"] for run in states.values()] == ["2"]


def test_a_failed_asset_stays_failing_until_each_of_its_assets_succeeded():
    runs = [
        _materialize("4", "success", "a"),
        _materialize("3", "failure", "c"),   # newer than the failure below: it says nothing on a, b
        _materialize("2", "failure", "a", "b"),
        _materialize("1", "success", "a", "b"),  # older: it cannot settle a later failure
    ]
    failing = {run["id"] for run in pipelines.job_states(runs).values() if run["status"] == "failure"}
    assert failing == {"2", "3"}

    runs.insert(0, _materialize("5", "success", "b"))
    failing = {run["id"] for run in pipelines.job_states(runs).values() if run["status"] == "failure"}
    assert failing == {"3"}, "a and b each succeeded since, in separate runs"


def test_a_materialize_run_does_not_settle_a_failed_job():
    """A job of the project may do more than materialize its assets; only its own next run settles it."""
    runs = [
        _materialize("2", "success", "a"),
        {"id": "1", "job": "load", "job_name": "load", "assets": ["a"], "status": "failure"},
    ]
    assert pipelines.job_states(runs)["load"]["id"] == "1"


def test_the_summary_counts_jobs_and_lists_only_those_still_failing(client, monkeypatch):
    async def dagster(query, variables=None):
        if "logsForRun" in query:
            return {"data": {"logsForRun": {"__typename": "EventConnection", "events": [{
                "__typename": "ExecutionStepFailureEvent", "stepKey": "build",
                "error": {"message": "dagster: wrapper", "causes": [{"message": "ValueError: boom"}]},
            }]}}}
        return {"data": {"runsOrError": {"__typename": "Runs", "results": [
            _run("r4", "load", "SUCCESS", 400.0),
            _run("r3", "build", "FAILURE", 300.0),
            _run("r2", "load", "FAILURE", 200.0),
            _run("r1", "build", "SUCCESS", 100.0),
        ]}}}

    monkeypatch.setattr(pipelines, "_dagster_query", dagster)
    summary = client.get("/api/pipelines/summary").json()
    assert summary["jobs_by_status"] == {"success": 1, "failure": 1}
    assert [r["id"] for r in summary["failing_jobs"]] == ["r3"]
    assert summary["failing_jobs"][0]["error"] == "build: ValueError: boom"
    assert summary["latest_run"]["id"] == "r4"


def test_a_failed_run_in_the_list_carries_its_error(client, monkeypatch):
    async def dagster(query, variables=None):
        if "logsForRun" in query:
            return {"data": {"logsForRun": {"events": [
                {"__typename": "RunFailureEvent", "message": "Execution of run failed."},
            ]}}}
        return {"data": {"runsOrError": {"__typename": "Runs", "results": [
            _run("r2", "load", "FAILURE", 200.0), _run("r1", "load", "SUCCESS", 100.0),
        ]}}}

    monkeypatch.setattr(pipelines, "_dagster_query", dagster)
    runs = client.get("/api/pipelines/runs").json()["runs"]
    assert runs[0]["error"] == "Execution of run failed."
    assert "error" not in runs[1]


@pytest.mark.parametrize("event, expected", [
    # A Python error raised in an asset: the cause, not Dagster's wrapper.
    ({"stepKey": "ketenconnect__antwoorden", "error": {
        "message": "dagster._core.errors.DagsterExecutionStepExecutionError: Error occurred while executing op",
        "causes": [{"message": "FileNotFoundError: No .xlsx export in data; place the export there.\n"}],
    }}, "ketenconnect__antwoorden: FileNotFoundError: No .xlsx export in data; place the export there."),
    # A dbt failure: only what dbt reported.
    ({"stepKey": "dbt_assets", "error": {
        "message": "dagster_dbt.errors.DagsterDbtCliRuntimeError: The dbt CLI process with command\n\n"
                   "`dbt build`\n\nfailed.\n\nErrors parsed from dbt logs:\n\n"
                   "[error] Database Error in model fct_x: column y not found\n",
        "causes": [],
    }}, "dbt_assets: [error] Database Error in model fct_x: column y not found"),
])
def test_the_error_says_what_went_wrong(event, expected):
    event = {"__typename": "ExecutionStepFailureEvent", **event}
    assert pipelines.error_summary([event]) == expected


def test_a_long_error_is_cut_short():
    event = {"__typename": "ExecutionStepFailureEvent", "stepKey": "s",
             "error": {"message": "x" * 2000, "causes": []}}
    assert len(pipelines.error_summary([event])) <= 403


# --------------------------------------------------------------------------
# quality: per test, the latest result
# --------------------------------------------------------------------------

def test_quality_counts_each_test_once_by_its_latest_result(client, warehouse):
    import duckdb

    con = duckdb.connect(str(warehouse))
    con.execute("""
        INSERT INTO probe_elementary.elementary_test_results VALUES
        ('t1', 'fail', now() - INTERVAL 2 DAY),
        ('t1', 'pass', now() - INTERVAL 1 DAY),   -- fixed since: passes now
        ('t2', 'pass', now() - INTERVAL 2 DAY),
        ('t2', 'fail', now() - INTERVAL 1 DAY),   -- broke since: fails now
        ('t3', 'pass', now() - INTERVAL 1 DAY),
        ('t4', 'fail', now() - INTERVAL 30 DAY)   -- no result in a week: dropped
    """)
    con.close()

    summary = client.get("/api/quality/summary").json()
    assert summary["total_tests"] == 3
    assert summary["by_status"] == {"pass": 2, "fail": 1}
    assert summary["health_score"] == pytest.approx(66.7)
