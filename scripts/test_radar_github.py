#!/usr/bin/env python3
"""
test_radar_github.py - local end-to-end tests for `radar.py --github`.

Spins up a throwaway HTTP server on 127.0.0.1 that mimics the GitHub API
(repo listing + per-repo language endpoints) and points radar.py at it via
the RADAR_GITHUB_API_BASE env var. No network access needed.

Run from anywhere:

    python scripts/test_radar_github.py

Scenarios covered:
  1. partial failure  - some repos 404/500, some succeed, some fork/archived
  2. total failure    - every language endpoint fails -> non-zero exit, no SVG
  3. --limit clamping - limit < 1 and limit > #languages fall back to all
  4. < 3 languages    - still errors out, per the existing rule
  5. --curve          - rescales axes only; ranking and byte totals unchanged
  6. zero/negative    - 0 and negative byte entries never enter the sums
  7. --data mode      - unchanged behaviour
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

RADAR = Path(__file__).resolve().with_name("radar.py")
SKILLS = Path(__file__).resolve().parents[1] / "assets" / "skills.json"

failures: list[str] = []


def check(cond: bool, msg: str):
    print(f"  {'PASS' if cond else 'FAIL'}  {msg}")
    if not cond:
        failures.append(msg)


# --------------------------------------------------------------------------- #
# mock GitHub API
# --------------------------------------------------------------------------- #


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        hit = self.server.routes.get(path)
        if hit is None:
            status, payload = 404, {"message": "Not Found"}
        else:
            status, payload = hit
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # keep the test output clean
        pass


def make_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    base = f"http://127.0.0.1:{port}"

    def repo(name, **kw):
        r = {"name": name, "fork": False, "archived": False,
             "languages_url": f"{base}/repos/testuser/{name}/languages"}
        r.update(kw)
        return r

    srv.routes = {
        # scenario 1+3+5+6: mixed results
        "/users/testuser/repos": (200, [
            repo("alpha"),
            repo("beta"),
            repo("gone"),          # languages -> 404
            repo("broken"),        # languages -> 500
            repo("forked", fork=True),
            repo("mothballed", archived=True),
        ]),
        "/repos/testuser/alpha/languages": (200, {
            "Python": 1000, "Go": 500, "HTML": 999,  # HTML is --excluded
        }),
        "/repos/testuser/beta/languages": (200, {
            "Python": 200, "JavaScript": 800,
            "ZeroLang": 0, "NegLang": -42,  # must not enter the sums
        }),
        "/repos/testuser/gone/languages": (404, {"message": "Not Found"}),
        "/repos/testuser/broken/languages": (500, {"message": "boom"}),

        # scenario 2: every repo fails
        "/users/failuser/repos": (200, [repo("x"), repo("y")]),
        "/repos/testuser/x/languages": (404, {"message": "Not Found"}),
        "/repos/testuser/y/languages": (404, {"message": "Not Found"}),

        # scenario 4: only two languages in total
        "/users/twolang/repos": (200, [repo("solo")]),
        "/repos/testuser/solo/languages": (200, {"Python": 100, "Go": 50}),
    }
    # failuser's repos point at testuser paths via repo(); fix them up:
    srv.routes["/users/failuser/repos"] = (200, [
        {"name": "x", "fork": False, "archived": False,
         "languages_url": f"{base}/repos/testuser/x/languages"},
        {"name": "y", "fork": False, "archived": False,
         "languages_url": f"{base}/repos/testuser/y/languages"},
    ])
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, base


def run_radar(base: str, outdir: Path, *extra: str):
    env = dict(os.environ, RADAR_GITHUB_API_BASE=base)
    env.pop("GITHUB_TOKEN", None)
    env.pop("GH_TOKEN", None)
    return subprocess.run(
        [sys.executable, str(RADAR), *extra],
        capture_output=True, text=True, env=env, cwd=outdir,
    )


# --------------------------------------------------------------------------- #
# scenarios
# --------------------------------------------------------------------------- #


def test_partial_failure(base: str, tmp: Path):
    print("scenario 1: partial failure (404 + 500 among successes)")
    out = tmp / "partial" / "radar"
    r = run_radar(base, tmp, "--github", "testuser", "-o", str(out), "--values")
    combined = r.stdout + r.stderr

    check(r.returncode == 0, f"exit code 0 (got {r.returncode}: {r.stderr.strip()})")
    check("repos scanned: 4" in r.stdout, "summary reports 4 scanned repos")
    check("succeeded:     2" in r.stdout, "summary reports 2 succeeded")
    check("failed:        2" in r.stdout, "summary reports 2 failed")
    check("excluded:      2" in r.stdout, "summary reports 2 excluded")
    check("gone: HTTP 404" in r.stdout, "failure lists repo 'gone' with HTTP 404")
    check("broken: HTTP 500" in r.stdout, "failure lists repo 'broken' with HTTP 500")
    check("forked (fork)" in r.stdout, "excluded lists forked repo")
    check("mothballed (archived)" in r.stdout, "excluded lists archived repo")
    check("结果不完整" in r.stdout and "INCOMPLETE" in r.stdout,
          "summary is marked as incomplete (结果不完整)")
    check("Python" in r.stdout and "1,200 bytes" in r.stdout
          and "from 2 repo(s)" in r.stdout,
          "Python total 1,200 bytes from 2 repos")
    check("JavaScript" in r.stdout and "800 bytes" in r.stdout
          and "from 1 repo(s)" in r.stdout, "JavaScript total 800 bytes from 1 repo")
    check("Go" in r.stdout and "500 bytes" in r.stdout, "Go total 500 bytes")
    check("ZeroLang" not in r.stdout and "NegLang" not in r.stdout,
          "zero/negative byte entries are dropped")
    check("HTML" not in r.stdout, "--exclude'd language absent from summary")

    dark = out.with_name("radar-dark.svg")
    light = out.with_name("radar-light.svg")
    check(dark.exists() and light.exists(), "both SVG files written")
    if dark.exists():
        svg = dark.read_text(encoding="utf-8")
        for label in ("Python", "JavaScript", "Go"):
            check(f">{label}</text>" in svg, f"SVG has axis label {label}")
        # curve=0.5 on totals Python=1200, JavaScript=800, Go=500
        for val in ("100", "81.6", "64.5"):
            check(f">{val}</text>" in svg, f"SVG shows axis value {val}")
        check("ZeroLang" not in svg and "NegLang" not in svg,
              "dropped languages absent from SVG")
    return combined


def test_total_failure(base: str, tmp: Path):
    print("scenario 2: total failure (every repo errors)")
    outdir = tmp / "allfail"
    out = outdir / "radar"
    r = run_radar(base, tmp, "--github", "failuser", "-o", str(out))
    check(r.returncode != 0, f"non-zero exit code (got {r.returncode})")
    check("all 2 scanned repos failed" in (r.stdout + r.stderr),
          "error message explains every repo failed")
    check(not outdir.exists() or not list(outdir.glob("*.svg")),
          "no SVG files generated")


def test_limit_clamping(base: str, tmp: Path):
    print("scenario 3: --limit clamping")
    for bad in ("0", "99"):
        out = tmp / f"limit{bad}" / "radar"
        r = run_radar(base, tmp, "--github", "testuser", "-o", str(out),
                      "--limit", bad)
        check(r.returncode == 0, f"--limit {bad}: exit 0")
        check(f"--limit {bad} adjusted to 3" in r.stdout,
              f"--limit {bad}: falls back to all 3 languages")
        svg = out.with_name("radar-dark.svg")
        check(svg.exists(), f"--limit {bad}: SVG written")


def test_too_few_languages(base: str, tmp: Path):
    print("scenario 4: fewer than 3 languages still errors")
    out = tmp / "twolang" / "radar"
    r = run_radar(base, tmp, "--github", "twolang", "-o", str(out))
    check(r.returncode != 0, "non-zero exit code")
    check("at least 3 axes" in (r.stdout + r.stderr), "existing <3-axes rule fires")
    check(not out.with_name("radar-dark.svg").exists(), "no SVG generated")


def test_curve_only_rescales(base: str, tmp: Path):
    print("scenario 5: --curve changes scaling only, not ranking or totals")
    summaries, orders = [], []
    for curve in ("1.0", "0.3"):
        out = tmp / f"curve{curve}" / "radar"
        r = run_radar(base, tmp, "--github", "testuser", "-o", str(out),
                      "--curve", curve)
        check(r.returncode == 0, f"--curve {curve}: exit 0")
        lang_lines = [ln.strip() for ln in r.stdout.splitlines()
                      if "bytes  from" in ln]
        summaries.append(lang_lines)
        svg = out.with_name("radar-dark.svg").read_text(encoding="utf-8")
        orders.append(re.findall(r'font-size="13"[^>]*>([^<]+)</text>', svg))
    check(summaries[0] == summaries[1],
          "byte totals identical across curve values")
    check(orders[0] == orders[1] and orders[0] == ["Python", "JavaScript", "Go"],
          f"axis ranking identical across curve values (got {orders})")


def test_data_mode(tmp: Path):
    print("scenario 6: --data mode unchanged")
    out = tmp / "datamode" / "radar"
    r = run_radar("", tmp, "--data", str(SKILLS), "-o", str(out))
    check(r.returncode == 0, f"exit 0 (got {r.returncode}: {r.stderr.strip()})")
    check(out.with_name("radar-dark.svg").exists()
          and out.with_name("radar-light.svg").exists(), "both SVG files written")


def main():
    srv, base = make_server()
    print(f"mock GitHub API on {base}\n")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        test_partial_failure(base, tmp)
        test_total_failure(base, tmp)
        test_limit_clamping(base, tmp)
        test_too_few_languages(base, tmp)
        test_curve_only_rescales(base, tmp)
        test_data_mode(tmp)
    srv.shutdown()

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
