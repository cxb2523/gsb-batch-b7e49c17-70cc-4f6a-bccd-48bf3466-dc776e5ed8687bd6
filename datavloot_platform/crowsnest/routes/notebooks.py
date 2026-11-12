"""
Notebooks route — discovers and launches Marimo notebooks from the project's notebooks/ directory.
"""

import atexit
import pathlib
import subprocess
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datavloot_platform.crowsnest.config import get_config
from datavloot_platform.crowsnest.processes import port_in_use, port_taken_message, start_marimo, stop_process

router = APIRouter()

MARIMO_PORT = 2718

# The one process the Crows Nest owns: the Marimo it launched itself. Anything
# else on MARIMO_PORT -- typically the user's own Marimo in another project --
# is left alone.
_marimo_process: "subprocess.Popen | None" = None
_marimo_notebook: "str | None" = None
# Launch and Close run in worker threads, so the server keeps answering while
# Marimo starts or stops. One at a time, or two Launches would each start one.
_marimo_lock = threading.Lock()


def _stop_ours() -> bool:
    """Stop the Marimo this Crows Nest started, if it still runs. Returns whether it did."""
    global _marimo_process, _marimo_notebook
    process = _marimo_process
    _marimo_process = None
    _marimo_notebook = None
    return stop_process(process)


@router.get("/list")
async def list_notebooks():
    """
    List all .py notebooks in the project's notebooks/ directory.

    running is the notebook of the Marimo this Crows Nest started, if it still
    runs: on a laptop the panel embeds only that one, never a Marimo that merely
    answers on the port.
    """
    process = _marimo_process  # read once: a worker thread can clear it
    running = _marimo_notebook if process is not None and process.poll() is None else None
    notebooks_dir = pathlib.Path.cwd() / "notebooks"
    if not notebooks_dir.exists():
        return {"notebooks": [], "available": False, "running": running}
    notebooks = [
        {"name": f.name, "stem": f.stem}
        for f in sorted(notebooks_dir.glob("*.py"))
        if f.is_file()
    ]
    return {"notebooks": notebooks, "available": True, "running": running}


class LaunchRequest(BaseModel):
    name: str


@router.post("/launch")
def launch_notebook(req: LaunchRequest):
    """Start a Marimo notebook server for the given notebook file."""
    global _marimo_process, _marimo_notebook

    name = pathlib.Path(req.name).name
    if not name.endswith(".py"):
        raise HTTPException(400, "Only .py files can be launched")

    notebook_path = pathlib.Path.cwd() / "notebooks" / name
    if not notebook_path.exists():
        raise HTTPException(404, f"Notebook '{name}' not found in notebooks/")

    # Marimo runs as its own service (the Falcon): nothing to start, only where to go.
    public_url = get_config().marimo_public_url
    if public_url:
        return {"launched": name, "url": f"{public_url}/?file={name}"}

    # Replace our own Marimo; refuse rather than stop one we did not start.
    with _marimo_lock:
        if _stop_ours():
            # On Windows the port can still answer for a moment after the tree is
            # gone. Wait for it, or the relaunch would take our own Marimo for a
            # stranger's.
            deadline = time.monotonic() + 5
            while port_in_use(MARIMO_PORT) and time.monotonic() < deadline:
                time.sleep(0.1)
        if port_in_use(MARIMO_PORT):
            raise HTTPException(409, port_taken_message(MARIMO_PORT))

        _marimo_process = start_marimo(
            ["edit", "--headless", "--no-token", "--port", str(MARIMO_PORT), str(notebook_path)]
        )
        _marimo_notebook = name
    return {"launched": name, "url": f"http://127.0.0.1:{MARIMO_PORT}"}


@router.post("/stop")
def stop_notebook():
    """Stop the Marimo server the Crows Nest started."""
    if get_config().marimo_public_url:
        # Not ours to stop: the Marimo service serves everyone.
        return {"stopped": False}
    with _marimo_lock:
        return {"stopped": _stop_ours()}


@atexit.register
def _stop_server() -> None:
    # Started in its own process group, so it would outlive the Crows Nest and
    # go on serving a notebook from a session that is over: the next Crows Nest
    # then shows it as running, even when the file has moved since.
    stop_process(_marimo_process)
