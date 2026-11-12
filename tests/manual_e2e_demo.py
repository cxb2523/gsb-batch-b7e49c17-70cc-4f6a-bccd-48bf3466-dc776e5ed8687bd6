"""End-to-end, offline demonstration of the two fixed behaviors.

Run from the repo root:  python -I tests/manual_e2e_demo.py
It starts a local HTTP server, fakes DNS and nuclei, and prints the real
console output plus the generated DependencyFiles.log. No external network.
"""
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import socket
import Global
from Scan import DependencyCheck as DC
from Scan.Discovery import detect_dns_wildcard

PACKAGE = json.dumps({"name": "demo", "dependencies": {"left-pad": "1.3.0"}})
HTML = "<!DOCTYPE html><html><body>404 Not Found</body></html>"
HUGE = "a" * (DC.MAX_BODY_BYTES + 10)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/package.json":
            payload = PACKAGE.encode()
            self.send_response(200)
        elif path == "/err/package.json":
            payload = HTML.encode()
            self.send_response(200)
        elif path == "/big/package.json":
            payload = HUGE.encode()
            self.send_response(200)
        else:
            payload = HTML.encode()
            self.send_response(404)
        self.send_header("Content-Type", "text/html" if b"<html" in payload else "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


def main():
    print("=" * 70)
    print("PART 1: wildcard DNS handling (faked resolver, no real DNS)")
    print("=" * 70)

    def wildcard_resolver(host, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.5", 0))]

    def normal_resolver(host, port):
        raise socket.gaierror(socket.EAI_NONAME, "not known")

    hanging_event = threading.Event()

    def hanging_resolver(host, port):
        hanging_event.wait(10)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.6", 0))]

    print("wildcard.example ->", detect_dns_wildcard("wildcard.example", wildcard_resolver, 1, 1))
    print("normal.example   ->", detect_dns_wildcard("normal.example", normal_resolver, 1, 1))
    print("slow.example     ->", detect_dns_wildcard("slow.example", hanging_resolver, 0.3, 1),
          "(hanging resolver bounded by the 0.3s timeout)")
    hanging_event.set()

    print()
    print("=" * 70)
    print("PART 2: dependency manifest collection (local HTTP server only)")
    print("=" * 70)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    run_dir = tempfile.mkdtemp(prefix="easm_e2e_")
    Global.RunDir = run_dir
    Global.HTTPAssets = [base]
    Global.AssetsWithWAF = {}
    Global.URLsWithWAF = []
    # Duplicate query/fragment variants and a plain non-manifest page included on purpose
    Global.CrawledURLs = [
        f"{base}/package.json",
        f"{base}/package.json?v=2",
        f"{base}/err/package.json",
        f"{base}/big/package.json",
        f"{base}/missing/composer.lock",
        f"{base}/about.html",
    ]
    Global.GeneralInfoNotes.clear()

    with mock.patch.object(DC, "_run_nuclei", return_value=[]):
        DC.collect_dependency_files()

    print()
    print("Report-facing skipped candidates:", json.dumps(Global.DepSkippedFiles, indent=2))
    print()
    print("--- dep_files directory tree ---")
    for root, dirs, files in os.walk(os.path.join(run_dir, "dep_files")):
        for name in files:
            print(os.path.join(root, name))
    print()
    print("--- DependencyFiles.log ---")
    with open(os.path.join(run_dir, "DependencyFiles.log"), encoding="utf-8") as f:
        print(f.read())

    print("--- tool-missing behavior (shutil.which forced to None) ---")
    Global.DepToolsAvailable = {"confused": None, "osv-scanner": None}
    with mock.patch.object(DC.shutil, "which", return_value=None):
        DC.analyze_dependency_files()
    print("GeneralInfoNotes after analysis:")
    for note in Global.GeneralInfoNotes:
        print(" *", note)

    server.shutdown()
    server.server_close()


if __name__ == "__main__":
    main()
