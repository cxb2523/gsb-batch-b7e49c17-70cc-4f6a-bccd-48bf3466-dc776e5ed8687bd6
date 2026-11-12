"""Tests for the installed-tools check in Scan/CommandRun.py.

The dependency tools (confused, osv-scanner) must be reported loudly but must
NOT abort the whole scan: the dependency module handles their absence itself.
Subprocess is faked, so nothing external is invoked.
"""
import os
import sys
import unittest
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import Global
from Scan.CommandRun import check_installed_tools


class ToolCheckTests(unittest.TestCase):

    def setUp(self):
        Global.Flags.clear()

    def _fake_run_factory(self, missing):
        def fake_run(command, *args, **kwargs):
            utility = command.split()[0]
            return mock.Mock(returncode=1 if utility in missing else 0)
        return fake_run

    def test_missing_dependency_tools_are_not_fatal(self):
        with mock.patch("Scan.CommandRun.subprocess.run",
                        side_effect=self._fake_run_factory({"confused", "osv-scanner"})):
            errors = check_installed_tools()
        self.assertEqual(errors, 0)

    def test_missing_core_tool_is_still_fatal(self):
        with mock.patch("Scan.CommandRun.subprocess.run",
                        side_effect=self._fake_run_factory({"subfinder"})):
            errors = check_installed_tools()
        self.assertGreaterEqual(errors, 1)

    def test_dcf_flag_skips_dependency_tool_checks(self):
        Global.Flags.append("-dcf")
        seen_commands = []

        def fake_run(command, *args, **kwargs):
            seen_commands.append(command)
            return mock.Mock(returncode=0)

        with mock.patch("Scan.CommandRun.subprocess.run", side_effect=fake_run):
            errors = check_installed_tools()
        self.assertEqual(errors, 0)
        self.assertFalse(any(cmd.startswith("confused") or cmd.startswith("osv-scanner")
                             for cmd in seen_commands))


if __name__ == "__main__":
    unittest.main()
