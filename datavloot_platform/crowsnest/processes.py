"""
The Marimo servers the Crows Nest starts on a laptop: one for notebooks
(routes/notebooks.py) and one for apps (routes/apps.py). Behind a proxy (the
Falcon) both are services of their own and nothing here runs. The CLI stops
`dagster dev` the same way the Crows Nest stops these.
"""

import os
import signal
import socket
import subprocess
import sys

# Not in subprocess outside Windows; the value is Windows' own.
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


def has_console() -> bool:
    """
    Whether this process has a console window, as python.exe in a terminal does
    and pythonw.exe (autostart, the shortcut) does not. Always True off Windows.
    """
    if sys.platform != "win32":
        return True
    import ctypes

    return bool(ctypes.windll.kernel32.GetConsoleWindow())


def console_child_flags() -> int:
    """
    creationflags for a console program (dagster, taskkill) started from here.

    Started from pythonw, which has no console, Windows gives every console
    child a console window of its own, in front of the user, unless it gets
    CREATE_NO_WINDOW; that hidden console is then shared by its own children
    (Dagster's webserver, daemon, code servers, dbt). From a terminal the child
    shares the terminal instead, which is what makes Ctrl+C and closing the
    window reach it: there the flag is left off.
    """
    return CREATE_NO_WINDOW if sys.platform == "win32" and not has_console() else 0


def terminate_tree(proc: subprocess.Popen) -> None:
    """
    Kill the whole process tree, not just the launcher.

    `dagster dev` supervises a webserver, a daemon, and gRPC code-server children.
    proc.terminate() signals only the launcher, orphaning the grandchildren -- they
    keep holding port 3000 and spawning dbt runs after datavloot has exited, so every
    failed start leaves debris that interferes with the next one.
    """
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            # taskkill walks the tree itself: /T includes children, /F forces.
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
                check=False,
                # taskkill is a console program: no window under pythonw.
                creationflags=CREATE_NO_WINDOW,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        proc.terminate()

    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def stop_process(proc: "subprocess.Popen | None") -> bool:
    """
    Stop a server this Crows Nest started, with every process it started in turn.
    Returns whether it was still running.

    On Windows proc is the venv's python.exe launcher; a plain kill() stops that
    and the server, but leaves the kernel Marimo starts per notebook session.
    """
    if proc is None or proc.poll() is not None:
        return False
    terminate_tree(proc)
    return True


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def port_taken_message(port: int) -> str:
    """Why the Crows Nest will not start a server on port, and how to free it."""
    # Only the listener: a browser tab still connected to the port matches a
    # bare ":port" too, and must not be the one that gets stopped. On Windows,
    # Get-NetTCPConnection selects it by state, where a filter on netstat's
    # text depends on how netstat words it.
    if os.name == "nt":
        how = (
            "in PowerShell, taskkill /T /F /PID "
            f"(Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess stops it"
        )
    else:
        how = f"lsof -ti tcp:{port} -sTCP:LISTEN | xargs kill stops it"
    return (
        f"Port {port} is in use by something the Crows Nest did not start "
        "(a Marimo from another project, or one left over from an earlier session). "
        f"Stop it and try again: {how}."
    )


def start_marimo(args: list[str]) -> subprocess.Popen:
    """
    Start `python -m marimo <args>` in the background, without a console window.

    python.exe (not pythonw.exe — that breaks marimo's asyncio kernel).
    STARTUPINFO with SW_HIDE hides the console window at the Win32 show-window
    level, which is more reliable for console apps than CREATE_NO_WINDOW alone.
    Both, because under pythonw (autostart) there is no console to share and
    SW_HIDE alone still lets a console window flash up. Its own (hidden)
    console changes nothing for stopping it: terminate_tree uses taskkill /T,
    which follows parent process ids, not consoles or process groups.
    """
    kwargs: dict = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0  # SW_HIDE
        kwargs["startupinfo"] = si
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True

    return subprocess.Popen([sys.executable, "-m", "marimo", *args], **kwargs)
