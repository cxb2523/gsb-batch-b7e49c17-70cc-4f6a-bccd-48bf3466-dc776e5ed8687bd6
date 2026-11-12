"""Tests for website_crawler.client against the local FakeScavioServer.

No real SCAVIO_API_KEY is used anywhere. Run from the repo root:

    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from website_crawler import (  # noqa: E402
    BatchNotCreated,
    ScavioError,
    WebsiteCrawlerClient,
)
from website_crawler.fake_server import FakeScavioServer  # noqa: E402

API_KEY = "sk_test_fake"
DOCS = "https://docs.example.com"


class ClientTestCase(unittest.TestCase):
    def setUp(self):
        self.server = FakeScavioServer(api_key=API_KEY, credits=1_000)
        self.server.start()
        self.addCleanup(self.server.stop)
        self.client = WebsiteCrawlerClient(
            api_key=API_KEY, base_url=self.server.base_url, poll_interval=0.01
        )

    def status_gets(self):
        return [
            r
            for r in self.server.request_log
            if r["method"] == "GET" and "/extract/" in r["path"]
        ]


class TestMap(ClientTestCase):
    def test_map_returns_links_and_costs_one_credit(self):
        self.server.add_map_plan(DOCS, [f"{DOCS}/a", f"{DOCS}/b"])
        result = self.client.map(DOCS)
        self.assertEqual(result.total_found, 2)
        self.assertEqual([l["url"] for l in result.links], [f"{DOCS}/a", f"{DOCS}/b"])
        self.assertEqual(result.credits_used, 1)
        self.assertEqual(self.server.credits, 999)

    def test_map_402_carries_billing_url(self):
        self.server.credits = 0
        with self.assertRaises(ScavioError) as ctx:
            self.client.map(DOCS)
        self.assertEqual(ctx.exception.status, 402)
        self.assertEqual(ctx.exception.billing_url, self.server.billing_url)


class TestCrawl(ClientTestCase):
    def plan_mixed(self):
        self.server.add_crawl_plan(
            DOCS,
            [
                {"url": f"{DOCS}/ok-1"},
                {"url": f"{DOCS}/ok-2"},
                {"url": f"{DOCS}/boom", "outcome": "failed", "error": "HTTP 500", "status_code": 500},
                {"url": f"{DOCS}/robots", "outcome": "skipped", "skip_reason": "robots"},
            ],
        )

    def test_start_returns_202_with_zero_credits(self):
        self.plan_mixed()
        handle = self.client.start_crawl(DOCS, max_pages=10)
        self.assertEqual(handle.raw["credits_used"], 0)
        self.assertTrue(handle.job_id.startswith("crawl_"))
        self.assertEqual(handle.credits_per_page, 1)
        self.assertEqual(self.server.credits, 1_000)  # nothing billed yet

    def test_mixed_results_bill_only_succeeded(self):
        self.plan_mixed()
        report = self.client.crawl(DOCS, max_pages=10)
        self.assertEqual(report.status, "completed")
        self.assertIsNone(report.stopped_reason)
        self.assertTrue(report.ok)
        self.assertEqual(report.pages.succeeded, 2)
        self.assertEqual(report.pages.failed, 1)
        self.assertEqual(report.pages.skipped, 1)
        # only succeeded pages billed: 2 x 1 credit
        self.assertEqual(report.credits_used, 2)
        self.assertEqual(report.credits_from_pages, 2)
        self.assertEqual(report.credits_expected, 2)
        self.assertTrue(report.credits_match)
        self.assertEqual(self.server.credits, 998)
        # failed / skipped pages carry 0 credits and no content
        failed = report.failed_pages[0]
        self.assertEqual(failed.url, f"{DOCS}/boom")
        self.assertEqual(failed.credits, 0)
        self.assertEqual(failed.error, "HTTP 500")
        self.assertIsNone(failed.content)
        skipped = report.skipped_pages[0]
        self.assertEqual(skipped.skip_reason, "robots")
        self.assertEqual(skipped.credits, 0)
        # succeeded pages have content
        self.assertTrue(all(p.content for p in report.succeeded_pages))

    def test_ultra_mode_bills_two_per_page(self):
        self.plan_mixed()
        report = self.client.crawl(DOCS, max_pages=10, mode="ultra")
        self.assertEqual(report.credits_per_page, 2)
        self.assertEqual(report.credits_used, 4)  # 2 succeeded x 2
        self.assertTrue(report.credits_match)
        self.assertEqual(self.server.credits, 996)

    def test_polling_is_lightweight_then_content_fetched(self):
        self.plan_mixed()
        self.client.crawl(DOCS, max_pages=10)
        gets = self.status_gets()
        self.assertGreaterEqual(len(gets), 2)
        # every poll before the terminal one used include_content=false
        for req in gets[:-1]:
            self.assertEqual(req["query"].get("include_content"), ["false"])
        # content fetched once, after the job ended
        self.assertNotEqual(gets[-1]["query"].get("include_content"), ["false"])

    def test_max_pages_stop_reason_exposed_verbatim(self):
        self.plan_mixed()  # 4 pages planned
        report = self.client.crawl(DOCS, max_pages=2)
        self.assertEqual(report.status, "completed")
        self.assertEqual(report.stopped_reason, "max_pages")
        self.assertFalse(report.ok)  # early stop is not success
        self.assertEqual(report.pages.discovered, 4)
        self.assertEqual(report.pages.succeeded, 2)
        self.assertEqual(report.credits_used, 2)
        self.assertIn("max_pages", report.summary())

    def test_insufficient_credits_keeps_pages_and_gives_billing_url(self):
        self.plan_mixed()
        self.server.credits = 1  # only one page affordable
        report = self.client.crawl(DOCS, max_pages=10)
        self.assertEqual(report.stopped_reason, "insufficient_credits")
        self.assertFalse(report.ok)  # must not be rewritten as success
        self.assertEqual(report.pages.succeeded, 1)
        self.assertEqual(report.credits_used, 1)
        self.assertEqual(len(report.succeeded_pages), 1)  # fetched pages kept
        self.assertTrue(report.succeeded_pages[0].content)
        self.assertEqual(report.billing_url, self.server.billing_url)
        self.assertIn(self.server.billing_url, report.summary())

    def test_cancel_stops_job(self):
        self.plan_mixed()
        handle = self.client.start_crawl(DOCS, max_pages=10)
        data = self.client.cancel(handle)
        self.assertEqual(data["status"], "cancelled")
        report = self.client.wait(handle, poll_interval=0.01)
        self.assertEqual(report.status, "cancelled")
        self.assertEqual(report.stopped_reason, "cancelled")
        self.assertFalse(report.ok)

    def test_idempotency_key_sent_automatically(self):
        self.plan_mixed()
        handle = self.client.start_crawl(DOCS)
        posts = [r for r in self.server.request_log if r["method"] == "POST"]
        self.assertEqual(posts[0]["idempotency_key"], handle.idempotency_key)
        self.assertTrue(handle.idempotency_key)

    def test_idempotent_retry_reuses_job_without_double_billing(self):
        self.plan_mixed()
        key = "docs-crawl-2026-11-12"
        first = self.client.start_crawl(DOCS, idempotency_key=key, max_pages=10)
        second = self.client.start_crawl(DOCS, idempotency_key=key, max_pages=10)
        self.assertEqual(first.job_id, second.job_id)
        self.assertEqual(len(self.server.jobs), 1)
        self.assertEqual(self.server.idempotent_replays, 1)
        report = self.client.wait(second, poll_interval=0.01)
        self.assertEqual(report.credits_used, 2)  # billed once, not twice
        self.assertEqual(self.server.credits, 998)


class TestBatch(ClientTestCase):
    URLS = [f"{DOCS}/a", f"{DOCS}/b", f"{DOCS}/c"]

    def test_batch_happy_path_in_input_order(self):
        self.server.set_page_outcome(f"{DOCS}/b", "failed", error="HTTP 404", status_code=404)
        report = self.client.batch(self.URLS)
        self.assertTrue(report.ok)
        self.assertEqual([p.url for p in report.results], self.URLS)  # input order
        self.assertEqual(report.pages.succeeded, 2)
        self.assertEqual(report.pages.failed, 1)
        self.assertEqual(report.credits_used, 2)
        self.assertTrue(report.credits_match)

    def test_invalid_urls_listed_separately_and_never_billed(self):
        handle = self.client.start_batch([f"{DOCS}/a", "notaurl", "ftp://x/y"])
        self.assertEqual(handle.urls_count, 1)
        self.assertEqual(len(handle.invalid_urls), 2)
        self.assertEqual({i["url"] for i in handle.invalid_urls}, {"notaurl", "ftp://x/y"})
        report = self.client.wait(handle, poll_interval=0.01)
        self.assertEqual(report.pages.succeeded, 1)
        self.assertEqual(report.credits_used, 1)  # invalid URLs never billed
        self.assertEqual(len(report.invalid_urls), 2)
        # invalid URLs are not counted among succeeded pages
        self.assertNotIn("notaurl", [p.url for p in report.succeeded_pages])
        self.assertIn("invalid", report.summary())

    def test_all_invalid_urls_means_no_job_created(self):
        with self.assertRaises(BatchNotCreated) as ctx:
            self.client.start_batch(["notaurl", "ftp://x/y"])
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(len(ctx.exception.invalid_urls), 2)
        self.assertIn("not created", str(ctx.exception))
        self.assertEqual(len(self.server.jobs), 0)  # really no job
        self.assertEqual(self.server.credits, 1_000)  # nothing billed

    def test_batch_idempotent_retry_reuses_job(self):
        key = "batch-2026-11-12"
        first = self.client.start_batch(self.URLS, idempotency_key=key)
        second = self.client.start_batch(self.URLS, idempotency_key=key)
        self.assertEqual(first.job_id, second.job_id)
        self.assertEqual(len(self.server.jobs), 1)
        report = self.client.wait(second, poll_interval=0.01)
        self.assertEqual(report.credits_used, 3)
        self.assertEqual(self.server.credits, 997)

    def test_batch_insufficient_credits(self):
        self.server.credits = 2
        report = self.client.batch(self.URLS)  # 3 valid URLs, only 2 affordable
        self.assertEqual(report.stopped_reason, "insufficient_credits")
        self.assertFalse(report.ok)
        self.assertEqual(report.pages.succeeded, 2)
        self.assertEqual(report.credits_used, 2)
        self.assertEqual(report.billing_url, self.server.billing_url)


class TestAuthAndErrors(ClientTestCase):
    def test_missing_key_raises_at_construction(self):
        os.environ.pop("SCAVIO_API_KEY", None)
        with self.assertRaises(ValueError):
            WebsiteCrawlerClient(base_url=self.server.base_url)

    def test_env_key_is_used(self):
        os.environ["SCAVIO_API_KEY"] = API_KEY
        try:
            client = WebsiteCrawlerClient(base_url=self.server.base_url)
            self.assertEqual(client.api_key, API_KEY)
        finally:
            del os.environ["SCAVIO_API_KEY"]

    def test_wrong_key_gets_401(self):
        client = WebsiteCrawlerClient(api_key="wrong", base_url=self.server.base_url)
        with self.assertRaises(ScavioError) as ctx:
            client.map(DOCS)
        self.assertEqual(ctx.exception.status, 401)

    def test_unknown_job_gets_404(self):
        from website_crawler import JobHandle

        handle = JobHandle(kind="crawl", job_id="crawl_nope", idempotency_key="k", status_url="")
        with self.assertRaises(ScavioError) as ctx:
            self.client.status(handle)
        self.assertEqual(ctx.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
