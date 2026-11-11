"""Offline tests for tools/capture.py static extraction and --solve gating.

All samples are inline HTML; nothing here performs network I/O.
"""
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import capture  # noqa: E402

ATTR_HTML = """<!doctype html>
<html><head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"></script>
</head><body>
  <div class="cf-turnstile" data-action="login" data-cdata="user-123"
       data-chlpagedata="page-ctx" data-sitekey="0x4AAAAAAA_attr"></div>
</body></html>"""

SCRIPT_HTML = """<!doctype html>
<html><head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"></script>
</head><body>
  <div id="box"></div>
  <script>
    function onToken(token) { console.log(token); }
    window.turnstile.render('#box', {
        sitekey: '0x4AAAAAAA_script',
        action: "signup",
        cData: 'order-42',
        chlPageData: 'server-data',
        callback: onToken,
    });
  </script>
</body></html>"""

MIXED_HTML = """<!doctype html>
<html><body>
  <div class="cf-turnstile" data-sitekey="0x4AAAAAAA_attr"
       data-action="attr-action" data-cdata="attr-cdata"></div>
  <script>
    turnstile.render('#box', { sitekey: '0x4AAAAAAA_script' });
  </script>
</body></html>"""

NO_WIDGET_HTML = """<!doctype html>
<html><body><p>There is no Turnstile widget on this page.</p></body></html>"""

LOADER_ONLY_HTML = """<!doctype html>
<html><head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
</head><body></body></html>"""


class ExtractionTests(unittest.TestCase):
    def test_data_attributes_in_any_order(self):
        info = capture.extract(ATTR_HTML)
        self.assertEqual(info["sitekey"], "0x4AAAAAAA_attr")
        self.assertEqual(info["cdata"], "user-123")
        self.assertEqual(info["action"], "login")
        self.assertEqual(info["chlpagedata"], "page-ctx")
        self.assertTrue(info["loads_turnstile"])
        self.assertFalse(info["managed_challenge"])
        self.assertEqual(
            info["source"],
            {
                "sitekey": "attribute",
                "cdata": "attribute",
                "action": "attribute",
                "chlpagedata": "attribute",
            },
        )
        self.assertEqual(info["invalid"], {})

    def test_turnstile_render_options(self):
        info = capture.extract(SCRIPT_HTML)
        self.assertEqual(info["sitekey"], "0x4AAAAAAA_script")
        self.assertEqual(info["cdata"], "order-42")
        self.assertEqual(info["action"], "signup")
        self.assertEqual(info["chlpagedata"], "server-data")
        self.assertTrue(info["loads_turnstile"])
        self.assertEqual(
            info["source"],
            {
                "sitekey": "script",
                "cdata": "script",
                "action": "script",
                "chlpagedata": "script",
            },
        )

    def test_render_options_with_comments_and_expression_container(self):
        html = """
        <script>
          /* render params */
          turnstile.render(
            document.getElementById('x'),
            {
              // public key
              "sitekey": "0x4AAAAAAA_commented", /* trailing */
              action: 'a_b-1',
              cData: "esc\\u0031",
            },
            function () {}
          );
        </script>
        """
        info = capture.extract(html)
        self.assertEqual(info["sitekey"], "0x4AAAAAAA_commented")
        self.assertEqual(info["action"], "a_b-1")
        self.assertEqual(info["cdata"], "esc1")

    def test_render_object_is_isolated_from_unrelated_objects(self):
        html = """
        <script>
          turnstile.render('#box', { action: 'only-action' });
          const unrelated = { sitekey: '0xNOT-TURNSTILE', cData: 'nope' };
        </script>
        """
        info = capture.extract(html)
        self.assertEqual(info["action"], "only-action")
        self.assertIsNone(info["sitekey"])
        self.assertIsNone(info["cdata"])

    def test_render_options_win_over_attributes_per_field(self):
        info = capture.extract(MIXED_HTML)
        # Explicit render config is authoritative for fields it provides.
        self.assertEqual(info["sitekey"], "0x4AAAAAAA_script")
        # Fields absent from the render options fall back to attributes.
        self.assertEqual(info["action"], "attr-action")
        self.assertEqual(info["cdata"], "attr-cdata")
        self.assertIsNone(info["chlpagedata"])
        self.assertEqual(info["source"]["sitekey"], "script")
        self.assertEqual(info["source"]["action"], "attribute")
        self.assertEqual(info["source"]["cdata"], "attribute")
        self.assertIsNone(info["source"]["chlpagedata"])

    def test_missing_fields_stay_null(self):
        info = capture.extract(NO_WIDGET_HTML)
        for field in capture.FIELDS:
            self.assertIsNone(info[field], field)
            self.assertIsNone(info["source"][field], field)
        self.assertFalse(info["loads_turnstile"])
        self.assertFalse(info["managed_challenge"])
        self.assertEqual(info["invalid"], {})

    def test_loader_detected_without_widget_parameters(self):
        info = capture.extract(LOADER_ONLY_HTML)
        self.assertTrue(info["loads_turnstile"])
        self.assertIsNone(info["sitekey"])
        self.assertIsNone(info["action"])

    def test_over_limit_action_and_cdata_are_invalid(self):
        long_action = "a" * 33
        long_cdata = "c" * 256
        html = (
            '<div data-sitekey="0x4AAAAAAA_key" '
            f'data-action="{long_action}" data-cdata="{long_cdata}"></div>'
        )
        info = capture.extract(html)
        self.assertEqual(info["sitekey"], "0x4AAAAAAA_key")
        self.assertIsNone(info["action"])
        self.assertIsNone(info["cdata"])
        self.assertIsNone(info["source"]["action"])
        self.assertIsNone(info["source"]["cdata"])
        self.assertIn("32", info["invalid"]["action"])
        self.assertIn("255", info["invalid"]["cdata"])

    def test_action_character_set_is_enforced(self):
        info = capture.extract('<div data-action="bad action!"></div>')
        self.assertIsNone(info["action"])
        self.assertIn("letters", info["invalid"]["action"])

    def test_boundary_lengths_are_accepted(self):
        max_action = "a" * 32
        max_cdata = "c" * 255
        info = capture.extract(
            f'<div data-action="{max_action}" data-cdata="{max_cdata}"></div>'
        )
        self.assertEqual(info["action"], max_action)
        self.assertEqual(info["cdata"], max_cdata)
        self.assertEqual(info["invalid"], {})

    def test_empty_attribute_is_treated_as_missing(self):
        info = capture.extract('<div data-sitekey="" data-action="  "></div>')
        self.assertIsNone(info["sitekey"])
        self.assertIsNone(info["action"])
        self.assertIsNone(info["source"]["sitekey"])

    def test_managed_challenge_marker(self):
        info = capture.extract('<html><body>Just a moment...</body></html>')
        self.assertTrue(info["managed_challenge"])


class SolveGatingTests(unittest.TestCase):
    def _run_main(self, argv, html):
        with mock.patch.object(capture, "fetch", return_value=html), \
                mock.patch.object(sys, "argv", ["capture.py"] + argv), \
                redirect_stdout(io.StringIO()):
            capture.main()

    def test_no_sitekey_exits_before_solve(self):
        # Even with an API key configured, --solve must not hit the solver.
        with mock.patch.dict(os.environ, {"PEAK_API_KEY": "pk_test"}, clear=False), \
                mock.patch.object(capture, "solve_with_peak") as solve, \
                mock.patch.object(capture.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(SystemExit) as raised:
                self._run_main(["https://example.test/", "--solve"], NO_WIDGET_HTML)
            solve.assert_not_called()
            urlopen.assert_not_called()
        self.assertIn("No sitekey found", str(raised.exception))

    def test_no_api_key_makes_no_request(self):
        with mock.patch.dict(os.environ, {"PEAK_API_KEY": ""}, clear=False), \
                mock.patch.object(capture, "solve_with_peak") as solve, \
                mock.patch.object(capture.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(SystemExit) as raised:
                self._run_main(["https://example.test/", "--solve"], SCRIPT_HTML)
            solve.assert_not_called()
            urlopen.assert_not_called()
        self.assertIn("PEAK_API_KEY", str(raised.exception))

    def test_with_sitekey_and_key_calls_solver(self):
        with mock.patch.dict(os.environ, {"PEAK_API_KEY": "pk_test"}, clear=False), \
                mock.patch.object(capture, "solve_with_peak",
                                  return_value={"status": "ok"}) as solve:
            self._run_main(
                ["https://example.test/", "--solve", "--proxy", "http://127.0.0.1:8080"],
                SCRIPT_HTML,
            )
        solve.assert_called_once_with(
            "0x4AAAAAAA_script", "https://example.test/", "http://127.0.0.1:8080"
        )


if __name__ == "__main__":
    unittest.main()
