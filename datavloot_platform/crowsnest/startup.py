"""
Where Dagster is in starting up, for the Crows Nest to say so.

`datavloot start` starts the Crows Nest straight away and Dagster next to it,
because Dagster takes half a minute or more to load a project, and a person
who double-clicked a shortcut should see the Crows Nest within seconds rather
than nothing at all. Meanwhile a probe that finds Dagster not answering cannot
tell "still loading" from "not running"; this tells it, so the health check
can say "starting" and, if loading fails, why.

One process, one Dagster: module-level state, set by cli._start's watcher
thread and read by the health check. `datavloot launch` on its own never sets
it, so there the probe decides alone, as before.
"""

import json
import pathlib
import threading
import time

_lock = threading.Lock()
_state: dict = {"dagster": None, "error": None, "stage": None, "started_at": None, "expected": None}

# Where a start is while "starting", in the order they come: the `dagster dev`
# process runs but its webserver does not answer yet, then the webserver
# answers and the code location is loading.
STAGES = ("server", "project")


def set_dagster(status: str | None, error: str | None = None, expected: float | None = None) -> None:
    """
    status: "starting", "ready" or "failed", or None when nothing is known.

    "starting" also starts the clock the Crows Nest shows, at stage "server";
    `expected`: how many seconds the last start took, if known (last_start_seconds).
    """
    with _lock:
        _state["dagster"] = status
        _state["error"] = error
        if status == "starting":
            _state.update(stage=STAGES[0], started_at=time.time(), expected=expected)


def dagster() -> tuple[str | None, str | None]:
    """(status, error) as last set."""
    with _lock:
        return _state["dagster"], _state["error"]


def set_stage(stage: str) -> None:
    """The stage the readiness watcher sees; only while starting, and never back."""
    with _lock:
        if _state["dagster"] == "starting" and STAGES.index(stage) > STAGES.index(_state["stage"]):
            _state["stage"] = stage


def progress() -> dict | None:
    """While starting: the stage, seconds since the start, and the last start's seconds."""
    with _lock:
        if _state["dagster"] != "starting":
            return None
        return {
            "stage": _state["stage"],
            "elapsed": round(time.time() - _state["started_at"], 1),
            "expected": _state["expected"],
        }


# How long the last start took, so the next one can show its progress against
# it. Per project, as the time depends on the project and the machine.
def _times_file(project_dir: pathlib.Path) -> pathlib.Path:
    return project_dir / ".datavloot" / "dagster-start.json"


def last_start_seconds(project_dir: pathlib.Path) -> float | None:
    try:
        seconds = json.loads(_times_file(project_dir).read_text(encoding="utf-8"))["seconds"]
        return float(seconds) if seconds > 0 else None
    except Exception:
        return None


def record_start_seconds(project_dir: pathlib.Path, seconds: float) -> None:
    """Best effort: a project folder that cannot be written to only loses the estimate."""
    try:
        path = _times_file(project_dir)
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"seconds": round(seconds, 1)}), encoding="utf-8")
    except OSError:
        pass


# The `dagster dev` process `datavloot start` runs, so Shut down can stop it
# itself instead of relying on the CLI getting control back (server.py).
_process: dict = {"dagster": None}


def set_dagster_process(proc) -> None:
    with _lock:
        _process["dagster"] = proc


def dagster_process():
    with _lock:
        return _process["dagster"]


# Set by Shut down, so a Dagster it stops while still loading is not reported
# as a Dagster that failed to start (cli._start's watcher).
_stopping = threading.Event()


def set_stopping(value: bool = True) -> None:
    if value:
        _stopping.set()
    else:
        _stopping.clear()


def stopping() -> bool:
    return _stopping.is_set()
