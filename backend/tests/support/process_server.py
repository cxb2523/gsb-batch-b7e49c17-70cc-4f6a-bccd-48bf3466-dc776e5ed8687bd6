"""Start and stop only the ephemeral subprocess owned by an E2E test."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


BACKEND = Path(__file__).resolve().parents[2]
TEST_KEY = "e2e-local-only"


class RunningBackend:
    def __init__(self, directory, *, scenario="complete"):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.process = self.client = self.log = None
        # bootstrap does not load .env. Remove inherited runtime settings too.
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("SENTRIX_", "TA2_")) and key != "FRONTEND_ORIGINS"}
        self.env.update({
            "SENTRIX_DATABASE_URL": "", "SENTRIX_CONTROL_API_KEY": TEST_KEY,
            "SENTRIX_DETECTION_DB": str(directory / "events.sqlite3"),
            "SENTRIX_LOG_DB": str(directory / "logs.sqlite3"),
            "SENTRIX_PREDICTOR": "mock", "SENTRIX_VIDEO_TRANSPORT": "rtsp",
            "SENTRIX_TEST_SCENARIO": scenario, "SENTRIX_RTSP_HOST": "127.0.0.1",
            "TA2_FPS": "4", "TA2_WIDTH": "2", "TA2_HEIGHT": "2",
            "TA2_WINDOW_SIZE": "1", "TA2_QUEUE_SIZE": "2",
            "PYTHONPATH": str(BACKEND), "PYTHONDONTWRITEBYTECODE": "1",
        })

    def start(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.log = (self.directory / "server.log").open("ab")
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{port}",
                                   headers={"X-API-Key": TEST_KEY}, timeout=3)
        try:
            self.process = subprocess.Popen([
                sys.executable, "-m", "uvicorn", "tests.support.server_app:create_test_app", "--factory",
                "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning",
            ], cwd=BACKEND, env=self.env, stdout=self.log, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("El backend de pruebas termino antes de iniciar")
                try:
                    if self.client.get("/health", timeout=.25).status_code == 200:
                        return self
                except httpx.TransportError:
                    pass
                time.sleep(.05)
            raise TimeoutError("El backend de pruebas no inicio en 20 segundos")
        except BaseException:
            self.close()
            diagnostic = (self.directory / "server.log").read_text(encoding="utf-8", errors="replace")
            raise RuntimeError(f"No se pudo iniciar el backend aislado.\n{diagnostic}") from None

    def close(self, *, graceful=True):
        try:
            if self.process is not None and self.process.poll() is None:
                if graceful:
                    self.process.terminate()
                else:
                    self.process.kill()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
        finally:
            if self.client is not None:
                self.client.close()
            if self.log is not None:
                self.log.close()

    def restart(self, *, graceful=True):
        self.close(graceful=graceful)
        return self.start()

    def wait_for(self, path, predicate, *, timeout=8):
        deadline = time.monotonic() + timeout
        payload = None
        while time.monotonic() < deadline:
            response = self.client.get(path)
            response.raise_for_status()
            payload = response.json()
            if predicate(payload):
                return payload
            time.sleep(.02)
        raise AssertionError(f"No se alcanzo el estado esperado en {path}: {payload}")
