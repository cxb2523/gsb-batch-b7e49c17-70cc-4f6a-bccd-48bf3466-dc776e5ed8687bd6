"""Tests for the wildcard DNS handling in Scan/Discovery.py.

No real DNS is used: getaddrinfo is replaced with a fake resolver that can
resolve every name (wildcard), refuse names (socket.gaierror) or hang past
the probe timeout. The probe timeout is shortened so the suite stays fast.
"""
import os
import socket
import sys
import threading
import time
import unittest
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import Global
from Scan.Discovery import detect_dns_wildcard, check_dns_wildcards, _probe_wildcard_once
from Scan.Helpers import get_domains_for_enumeration


class HangingResolver:
    """Resolver whose first call hangs; a release event lets it finish later."""

    def __init__(self):
        self.release = threading.Event()
        self.calls = 0
        self.lock = threading.Lock()

    def __call__(self, host, port):
        with self.lock:
            self.calls += 1
        self.release.wait(timeout=30)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.7", 0))]


def wildcard_resolver(host, port):
    # Any random non-existent subdomain resolves: this is a wildcard
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.5", 0))]


def normal_resolver(host, port):
    # Only the root domain itself resolves; random subdomains do not
    if host.count(".") == 1:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.9", 0))]
    raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")


def flaky_resolver(host, port):
    # First probe times out, the retry gets an answer
    flaky_resolver.calls += 1
    if flaky_resolver.calls == 1:
        time.sleep(0.5)
    raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")


flaky_resolver.calls = 0


class DetectWildcardTests(unittest.TestCase):

    def test_wildcard_domain_is_detected(self):
        self.assertEqual(detect_dns_wildcard("wildcard.example", resolver=wildcard_resolver,
                                             timeout=2, attempts=1), "wildcard")

    def test_normal_domain_is_not_wildcard(self):
        self.assertEqual(detect_dns_wildcard("normal.example", resolver=normal_resolver,
                                             timeout=2, attempts=1), "none")

    def test_hanging_resolver_times_out_instead_of_hanging_the_scan(self):
        resolver = HangingResolver()
        started = time.monotonic()
        state = detect_dns_wildcard("slow.example", resolver=resolver, timeout=0.3, attempts=2)
        elapsed = time.monotonic() - started
        self.assertEqual(state, "timeout")
        self.assertLess(elapsed, 3, "the probe timeout did not bound the resolver call")
        self.assertEqual(resolver.calls, 2)
        resolver.release.set()  # let the daemon workers finish instead of leaking them into other tests

    def test_retry_after_one_timeout_still_confirms_normal_domain(self):
        flaky_resolver.calls = 0
        self.assertEqual(detect_dns_wildcard("flaky.example", resolver=flaky_resolver,
                                             timeout=0.2, attempts=2), "none")

    def test_unexpected_resolver_error_is_treated_as_timeout_not_wildcard(self):
        def broken_resolver(host, port):
            raise RuntimeError("resolver exploded")

        self.assertEqual(detect_dns_wildcard("broken.example", resolver=broken_resolver,
                                             timeout=1, attempts=1), "timeout")

    def test_probe_returns_timeout_state_while_worker_is_still_running(self):
        resolver = HangingResolver()
        self.assertEqual(_probe_wildcard_once("slow.example", resolver, 0.2), "timeout")
        resolver.release.set()


class CheckWildcardsFlowTests(unittest.TestCase):

    def setUp(self):
        Global.Domains = ["wildcard.example", "normal.example", "slow.example"]
        Global.WildcardDomains.clear()
        Global.GeneralInfoNotes.clear()
        self._resolvers = {
            "wildcard.example": wildcard_resolver,
            "normal.example": normal_resolver,
        }
        self.hanging = HangingResolver()

        def fake_getaddrinfo(host, port):
            root = host.split(".", 1)[1]
            resolver = self._resolvers.get(root)
            if resolver:
                return resolver(host, port)
            return self.hanging(host, port)

        self.patcher = mock.patch("socket.getaddrinfo", side_effect=fake_getaddrinfo)
        self.patcher.start()
        self.timeout_patcher = mock.patch("Scan.Discovery.WILDCARD_PROBE_TIMEOUT", 0.3)
        self.attempts_patcher = mock.patch("Scan.Discovery.WILDCARD_PROBE_ATTEMPTS", 1)
        self.timeout_patcher.start()
        self.attempts_patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.timeout_patcher.stop()
        self.attempts_patcher.stop()
        self.hanging.release.set()
        time.sleep(0.1)  # give the released daemon worker a moment to wind down

    def test_wildcard_domain_never_enters_enumeration_input(self):
        check_dns_wildcards()
        self.assertEqual(Global.WildcardDomains, ["wildcard.example"])
        enumeration_input = get_domains_for_enumeration()
        self.assertNotIn("wildcard.example", enumeration_input)
        self.assertIn("normal.example", enumeration_input)
        # Timed-out domains stay in the enumeration input (treated as normal)
        self.assertIn("slow.example", enumeration_input)

    def test_wildcard_and_timeout_are_explained_in_general_info_notes(self):
        check_dns_wildcards()
        notes = " ".join(Global.GeneralInfoNotes)
        self.assertIn("wildcard.example", notes)
        self.assertIn("Subdomain enumeration was skipped", notes)
        self.assertIn("slow.example", notes)
        self.assertIn("timed out", notes)

    def test_late_wildcard_answer_after_timeout_cannot_add_domain_later(self):
        # Regression test for the old shared-deadline implementation: a resolver
        # answer arriving after check_dns_wildcards() returned used to mutate a
        # local list nobody read anymore (and could never reach WildcardDomains).
        check_dns_wildcards()
        wildcard_snapshot = list(Global.WildcardDomains)
        time.sleep(0.6)  # longer than the probe timeout; any late worker answer happens in here
        self.assertEqual(Global.WildcardDomains, wildcard_snapshot)
        self.assertNotIn("slow.example", Global.WildcardDomains)


if __name__ == "__main__":
    unittest.main()
