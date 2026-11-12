"""Tests for dependency manifest collection in Scan/DependencyCheck.py.

A local HTTP server serves every edge case (valid manifest, HTML error page,
>1MB body, 404, duplicate URLs). No external network and no real credentials
are used; confused/osv-scanner availability is simulated with shutil.which.
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import Global
from Scan import DependencyCheck as DC


SMALL_PACKAGE = json.dumps({
    "name": "test-app",
    "version": "1.0.0",
    "dependencies": {"lodash": "4.17.21", "left-pad": "1.3.0"},
})
REQUIREMENTS = "requests==2.31.0\nflask==3.0.0\n"
HTML_PAGE = "<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>error</body></html>"
OVERSIZED = "x" * (DC.MAX_BODY_BYTES + 1024)


class DependencyHandler(BaseHTTPRequestHandler):
    routes = {
        "/package.json": (200, SMALL_PACKAGE, "application/json"),
        "/requirements.txt": (200, REQUIREMENTS, "text/plain"),
        "/nested/package.json": (200, SMALL_PACKAGE, "application/json"),
        "/html-package/package.json": (200, HTML_PAGE, "text/html"),
        "/huge/package.json": (200, OVERSIZED, "application/json"),
        "/missing/composer.lock": (404, HTML_PAGE, "text/html"),
        "/empty/package.json": (200, "", "application/json"),
        "/ct-html/requirements.txt": (200, REQUIREMENTS, "text/html; charset=utf-8"),
    }

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        route = self.routes.get(path)
        if not route:
            self.send_response(404)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())
            return
        status, body, content_type = route
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # keep the test output clean
        pass


class DependencyCollectionTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), DependencyHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        Global.Flags.clear()
        Global.GeneralInfoNotes.clear()
        Global.DepConfusionFindings.clear()
        Global.DepCveFindings.clear()
        Global.DepToolsAvailable = {"confused": None, "osv-scanner": None}
        DC._reset_collection_state()
        self.run_dir = tempfile.mkdtemp(prefix="easm_dep_test_")
        Global.RunDir = self.run_dir
        Global.HTTPAssets = [f"http://127.0.0.1:{self.port}"]
        Global.AssetsWithWAF = {}
        Global.CrawledURLs = []
        Global.URLsWithWAF = []

    def tearDown(self):
        shutil.rmtree(self.run_dir, ignore_errors=True)

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def _run_collection_with_crawled(self, crawled_urls):
        Global.CrawledURLs = crawled_urls
        with mock.patch.object(DC, "_run_nuclei", return_value=[]):
            DC.collect_dependency_files()

    def test_valid_manifests_are_saved_under_indexed_dep_files_directories(self):
        self._run_collection_with_crawled([self.url("/package.json"), self.url("/requirements.txt")])
        self.assertEqual(len(DC._downloaded), 2)
        saved_paths = [os.path.join(item["dir"], item["filename"]) for item in DC._downloaded]
        for path in saved_paths:
            self.assertTrue(os.path.exists(path))
        self.assertTrue(any(path.replace("\\", "/").endswith("dep_files/0/package.json") for path in saved_paths))
        self.assertTrue(any(path.replace("\\", "/").endswith("dep_files/1/requirements.txt") for path in saved_paths))
        self.assertEqual(Global.DepSkippedFiles, [])
        self.assertIn("SAVED", open(os.path.join(self.run_dir, "DependencyFiles.log"), encoding="utf-8").read())

    def test_html_error_page_is_rejected_and_reported(self):
        self._run_collection_with_crawled([self.url("/html-package/package.json")])
        self.assertEqual(DC._downloaded, [])
        reasons = [entry["reason"] for entry in Global.DepSkippedFiles]
        self.assertIn(DC.REASON_HTML, reasons)
        self.assertEqual(DC._skip_counts[DC.REASON_HTML], 1)

    def test_content_type_html_is_also_rejected_even_without_html_markers(self):
        self._run_collection_with_crawled([self.url("/ct-html/requirements.txt")])
        self.assertEqual(DC._downloaded, [])
        self.assertIn(DC.REASON_HTML, [entry["reason"] for entry in Global.DepSkippedFiles])

    def test_oversized_body_is_rejected_without_being_buffered_or_saved(self):
        self._run_collection_with_crawled([self.url("/huge/package.json")])
        self.assertEqual(DC._downloaded, [])
        self.assertIn(DC.REASON_TOO_LARGE, [entry["reason"] for entry in Global.DepSkippedFiles])
        # Nothing may have been written under dep_files for the rejected URL
        dep_root = os.path.join(self.run_dir, "dep_files")
        self.assertEqual([name for name in os.listdir(dep_root)], [])

    def test_duplicate_url_is_downloaded_once_and_listed_only_once(self):
        url = self.url("/package.json")
        self._run_collection_with_crawled([url, url + "?v=1", url + "#frag", url])
        self.assertEqual(len(DC._downloaded), 1)
        duplicate_entries = [e for e in Global.DepSkippedFiles if e["reason"] == DC.REASON_DUPLICATE]
        self.assertEqual(len(duplicate_entries), 1)
        # Occurrences are still audited per hit in the log
        log = open(os.path.join(self.run_dir, "DependencyFiles.log"), encoding="utf-8").read()
        self.assertEqual(log.count("DUPLICATE"), 3)

    def test_failed_download_is_recorded_with_reason(self):
        self._run_collection_with_crawled([self.url("/missing/composer.lock")])
        self.assertEqual(DC._downloaded, [])
        self.assertIn(DC.REASON_DOWNLOAD_FAILED, [entry["reason"] for entry in Global.DepSkippedFiles])

    def test_empty_body_is_recorded(self):
        self._run_collection_with_crawled([self.url("/empty/package.json")])
        self.assertIn(DC.REASON_EMPTY, [entry["reason"] for entry in Global.DepSkippedFiles])

    def test_nuclei_inline_body_is_saved_and_not_downloaded_again(self):
        nuclei_line = json.dumps({
            "matched-at": self.url("/nested/package.json"),
            "response": {"body": SMALL_PACKAGE},
        })
        # The same URL also appears in the crawl results: it must be recognized as a duplicate
        Global.CrawledURLs = [self.url("/nested/package.json")]
        with mock.patch.object(DC, "_run_nuclei", return_value=[nuclei_line]):
            DC.collect_dependency_files()
        self.assertEqual(len(DC._downloaded), 1)
        self.assertIn(DC.REASON_DUPLICATE, [entry["reason"] for entry in Global.DepSkippedFiles])

    def test_nuclei_html_body_is_rejected_and_not_retried_by_downloader(self):
        nuclei_line = json.dumps({
            "matched-at": self.url("/html-package/package.json"),
            "response": {"body": HTML_PAGE},
        })
        Global.CrawledURLs = [self.url("/html-package/package.json")]
        with mock.patch.object(DC, "_run_nuclei", return_value=[nuclei_line]), \
                mock.patch.object(DC, "_download_url") as download_mock:
            DC.collect_dependency_files()
        download_mock.assert_not_called()
        self.assertIn(DC.REASON_HTML, [entry["reason"] for entry in Global.DepSkippedFiles])

    def test_summary_note_is_added_for_html_and_oversized_skips(self):
        self._run_collection_with_crawled([
            self.url("/html-package/package.json"),
            self.url("/huge/package.json"),
            self.url("/package.json"),
        ])
        notes = " ".join(Global.GeneralInfoNotes)
        self.assertIn("HTML error pages", notes)
        self.assertIn("larger than 1MB", notes)

    def test_non_manifest_crawl_urls_are_audited_but_not_listed_in_report(self):
        self._run_collection_with_crawled([
            self.url("/about/team.html"),       # not a known manifest name
            self.url("/login?next=/dashboard"),  # no manifest suffix
        ])
        self.assertEqual(DC._downloaded, [])
        # Ordinary crawl URLs must not appear as skipped candidates in the report...
        self.assertEqual(Global.DepSkippedFiles, [])
        # ...but they are still counted and audited in the per-run log
        self.assertEqual(DC._skip_counts[DC.REASON_NOT_MANIFEST], 2)
        log = open(os.path.join(self.run_dir, "DependencyFiles.log"), encoding="utf-8").read()
        self.assertEqual(log.count(DC.REASON_NOT_MANIFEST), 2)


class SaveManifestUnitTests(unittest.TestCase):

    def setUp(self):
        Global.Flags.clear()
        self.run_dir = tempfile.mkdtemp(prefix="easm_dep_unit_")
        Global.RunDir = self.run_dir
        DC._reset_collection_state()

    def tearDown(self):
        shutil.rmtree(self.run_dir, ignore_errors=True)

    def test_save_manifest_rejects_duplicate_then_html_then_too_large(self):
        url = "http://example.test/package.json"
        self.assertTrue(DC._save_manifest(url, SMALL_PACKAGE))
        self.assertFalse(DC._save_manifest(url, SMALL_PACKAGE))  # duplicate
        self.assertFalse(DC._save_manifest("http://example.test/a/package.json", HTML_PAGE))
        self.assertFalse(DC._save_manifest("http://example.test/b/package.json", OVERSIZED))
        reasons = [entry["reason"] for entry in Global.DepSkippedFiles]
        self.assertEqual(reasons, [DC.REASON_DUPLICATE, DC.REASON_HTML, DC.REASON_TOO_LARGE])


class ToolAvailabilityTests(unittest.TestCase):

    def setUp(self):
        Global.GeneralInfoNotes.clear()
        Global.DepConfusionFindings.clear()
        Global.DepCveFindings.clear()
        Global.DepExposedFiles.clear()
        DC._reset_collection_state()
        self.run_dir = tempfile.mkdtemp(prefix="easm_dep_tool_")
        Global.RunDir = self.run_dir

    def tearDown(self):
        shutil.rmtree(self.run_dir, ignore_errors=True)

    def test_missing_tools_are_announced_and_checks_skip_subprocess(self):
        Global.DepToolsAvailable = {"confused": None, "osv-scanner": None}
        with mock.patch.object(DC.shutil, "which", return_value=None):
            tools = DC.check_dependency_tools()
        self.assertEqual(tools, {"confused": False, "osv-scanner": False})
        notes = " ".join(Global.GeneralInfoNotes)
        self.assertIn("confused", notes)
        self.assertIn("osv-scanner", notes)

        # analyze_dependency_files must not attempt any subprocess when the tools are missing
        with mock.patch.object(DC, "_run_confused") as confused_mock, \
                mock.patch.object(DC, "_run_osv") as osv_mock, \
                mock.patch.object(DC, "_scan_js_cdn_cves", return_value=False):
            DC._downloaded.append({"url": "http://example.test/package.json",
                                   "dir": self.run_dir, "filename": "package.json"})
            DC.analyze_dependency_files()
        confused_mock.assert_not_called()
        osv_mock.assert_not_called()

    def test_installed_tools_are_invoked(self):
        Global.DepToolsAvailable = {"confused": None, "osv-scanner": None}
        with mock.patch.object(DC.shutil, "which", return_value="C:\\tools\\fake.exe"):
            tools = DC.check_dependency_tools()
        self.assertEqual(tools, {"confused": True, "osv-scanner": True})
        with mock.patch.object(DC, "_run_confused") as confused_mock, \
                mock.patch.object(DC, "_run_osv") as osv_mock, \
                mock.patch.object(DC, "_scan_js_cdn_cves", return_value=False):
            item = {"url": "http://example.test/package.json", "dir": self.run_dir, "filename": "package.json"}
            DC._downloaded.append(item)
            DC.analyze_dependency_files()
        confused_mock.assert_called_once_with(item)
        osv_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
