"""Offline tests for the news aggregator CSV logic.

These tests never open a real browser or import AgentQL/Playwright: the
scraping step is replaced with a fake fetcher that returns canned records, so
they run fully offline and need no credentials.

Run from this directory:

    python -m unittest test_news_aggregator -v
"""

import asyncio
import os
import sys
import tempfile
import types
import unittest

import main as aggregator


def make_item(published_date, entry, url, outlet, author):
    """Build a raw (un-sanitized) query-result item."""
    return {
        "published_date": published_date,
        "entry": entry,
        "url": url,
        "outlet": outlet,
        "author": author,
    }


def read_lines(csv_path):
    """Return the CSV as logical lines without their trailing newlines."""
    with open(csv_path, "r", encoding="utf-8", newline="") as file:
        return [line.rstrip("\r\n") for line in file]


def parse_record(line):
    """Split one data line into its five ordered fields."""
    return line.split(aggregator.DELIMITER)


class NewsAggregatorTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.csv_path = os.path.join(self.temp_dir.name, "news_headlines.csv")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_two_sites_concurrent_with_duplicate_urls(self):
        """Two sites are fetched concurrently; the shared URL is kept once."""

        site_a = [
            make_item("01/02/2026", "Alpha story", "https://a.test/1", "a.test", "Ada"),
            make_item("01/03/2026", "Shared story", "https://shared.test/x", "a.test", "Ada"),
        ]
        site_b = [
            make_item("01/04/2026", "Beta story", "https://b.test/2", "b.test", "Bob"),
            # Same URL as a site-a record plus an intra-site duplicate.
            make_item("01/05/2026", "Shared story duplicate", "https://shared.test/x",
                      "b.test", "Bob"),
            make_item("01/06/2026", "Twin one", "https://b.test/twin", "b.test", "Bob"),
            make_item("01/07/2026", "Twin two", "https://b.test/twin", "b.test", "Bob"),
        ]

        async def fake_fetcher(url):
            # Yield to the event loop so the two fetches genuinely interleave,
            # mirroring concurrent tabs without touching any network.
            await asyncio.sleep(0)
            return {
                "https://site-a.test": [aggregator.normalize_item(i) for i in site_a],
                "https://site-b.test": [aggregator.normalize_item(i) for i in site_b],
            }[url]

        urls = ["https://site-a.test", "https://site-b.test"]
        collected = asyncio.run(
            aggregator.collect_results(fake_fetcher, urls)
        )
        records = [item for url in urls for item in collected[url]]
        written = aggregator.save_results(records, self.csv_path)

        # site-a (2) + site-b (4) - 1 cross-site dup - 1 intra-site dup = 4.
        self.assertEqual(written, 4)

        lines = read_lines(self.csv_path)
        # One header line plus four unique records.
        self.assertEqual(len(lines), 5)
        self.assertEqual(lines[0], aggregator.HEADER)
        self.assertNotIn(aggregator.HEADER, lines[1:])

        data_lines = lines[1:]
        for line in data_lines:
            self.assertEqual(len(parse_record(line)), 5)

        urls_on_disk = [parse_record(line)[2] for line in data_lines]
        self.assertEqual(
            urls_on_disk,
            [
                "https://a.test/1",
                "https://shared.test/x",
                "https://b.test/2",
                "https://b.test/twin",
            ],
        )
        # First occurrence wins: the shared URL keeps site-a's record.
        self.assertEqual(
            parse_record(data_lines[1]),
            ["01/03/2026", "Shared story", "https://shared.test/x", "a.test", "Ada"],
        )

    def test_empty_result_still_writes_valid_header_only_csv(self):
        """A site returning no items must not break the batch or the header."""

        async def fake_fetcher(url):
            await asyncio.sleep(0)
            return []

        collected = asyncio.run(
            aggregator.collect_results(
                fake_fetcher, ["https://empty-1.test", "https://empty-2.test"]
            )
        )
        self.assertEqual(collected, {
            "https://empty-1.test": [],
            "https://empty-2.test": [],
        })

        records = [item for url in collected for item in collected[url]]
        written = aggregator.save_results(records, self.csv_path)
        self.assertEqual(written, 0)

        lines = read_lines(self.csv_path)
        self.assertEqual(lines, [aggregator.HEADER])

    def test_failing_site_is_logged_and_other_sites_continue(self):
        """A failing fetch yields an empty list instead of aborting the batch."""

        async def fake_fetcher(url):
            await asyncio.sleep(0)
            if url == "https://broken.test":
                raise RuntimeError("boom")
            return [
                aggregator.normalize_item(
                    make_item("02/01/2026", "Still here", "https://ok.test/1",
                              "ok.test", "Kim")
                )
            ]

        urls = ["https://broken.test", "https://ok.test"]
        with self.assertLogs(aggregator.log, level="ERROR") as logs:
            collected = asyncio.run(
                aggregator.collect_results(fake_fetcher, urls)
            )

        self.assertTrue(any("Failed to fetch" in message for message in logs.output))
        self.assertEqual(collected["https://broken.test"], [])
        self.assertEqual(len(collected["https://ok.test"]), 1)

        records = [item for url in urls for item in collected[url]]
        aggregator.save_results(records, self.csv_path)

        lines = read_lines(self.csv_path)
        self.assertEqual(lines[0], aggregator.HEADER)
        self.assertEqual(len(lines), 2)
        self.assertEqual(
            parse_record(lines[1]),
            ["02/01/2026", "Still here", "https://ok.test/1", "ok.test", "Kim"],
        )

    def test_existing_csv_urls_are_skipped(self):
        """URLs already present in the target CSV are not appended again."""
        existing = (
            aggregator.HEADER + "\n"
            + aggregator.item_to_line(
                aggregator.normalize_item(
                    make_item("03/01/2026", "Old entry", "https://old.test/1",
                              "old.test", "Lee")
                )
            )
        )
        with open(self.csv_path, "w", encoding="utf-8", newline="") as file:
            file.write(existing)

        new_records = [
            aggregator.normalize_item(
                make_item("03/02/2026", "Old entry again", "https://old.test/1",
                          "new.test", "Pat")
            ),
            aggregator.normalize_item(
                make_item("03/03/2026", "Brand new", "https://new.test/2",
                          "new.test", "Pat")
            ),
        ]
        written = aggregator.save_results(new_records, self.csv_path)
        self.assertEqual(written, 1)

        lines = read_lines(self.csv_path)
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0], aggregator.HEADER)
        # The existing row is preserved untouched; only the genuinely new URL
        # is appended.
        self.assertEqual(
            parse_record(lines[1]),
            ["03/01/2026", "Old entry", "https://old.test/1", "old.test", "Lee"],
        )
        self.assertEqual(
            parse_record(lines[2]),
            ["03/03/2026", "Brand new", "https://new.test/2", "new.test", "Pat"],
        )

    def test_pipes_are_stripped_from_every_field(self):
        """Vertical bars in the data must never corrupt the delimiter."""
        record = aggregator.normalize_item(
            make_item(
                "04|01/2026",
                "A | tricky | entry",
                "https://pipes.test/|x|",
                "pipes|test",
                "Sam|my",
            )
        )
        aggregator.save_results([record], self.csv_path)

        lines = read_lines(self.csv_path)
        self.assertEqual(lines[0], aggregator.HEADER)
        fields = parse_record(lines[1])
        self.assertEqual(len(fields), 5)
        self.assertEqual(
            fields,
            ["0401/2026", "A  tricky  entry", "https://pipes.test/x", "pipestest", "Sammy"],
        )
        for field in fields:
            self.assertNotIn("|", field)

    def test_rerun_is_idempotent_and_header_stays_first(self):
        """Writing the same batch twice changes nothing and never repeats the header."""
        records = [
            aggregator.normalize_item(
                make_item("05/01/2026", "Once", "https://once.test/1", "once.test", "Ty")
            ),
            aggregator.normalize_item(
                make_item("05/02/2026", "Twice", "https://twice.test/2", "twice.test", "Ty")
            ),
        ]

        first = aggregator.save_results(records, self.csv_path)
        second = aggregator.save_results(records, self.csv_path)
        self.assertEqual(first, 2)
        self.assertEqual(second, 0)

        lines = read_lines(self.csv_path)
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0], aggregator.HEADER)
        self.assertEqual(sum(line == aggregator.HEADER for line in lines), 1)

    def test_field_order_matches_contract(self):
        """Columns are emitted as Posted | Entry | URL | Platform | Author."""
        record = aggregator.normalize_item(
            make_item("06/01/2026", "Ordered", "https://order.test/1",
                      "order.test", "Uma")
        )
        aggregator.save_results([record], self.csv_path)

        lines = read_lines(self.csv_path)
        self.assertEqual(
            lines[0], "Posted | Entry | URL | Platform | Author"
        )
        self.assertEqual(
            parse_record(lines[1]),
            ["06/01/2026", "Ordered", "https://order.test/1", "order.test", "Uma"],
        )


class MainEndToEndTest(unittest.TestCase):
    """Drive ``main()`` itself with a fake browser; no network or credentials."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.csv_path = os.path.join(self.temp_dir.name, "news_headlines.csv")
        self.urls = [
            "https://site-a.test",
            "https://site-b.test",
            "https://empty.test",
            "https://broken.test",
        ]
        self.canned = {
            "https://site-a.test": [
                make_item("11/01/2026", "A one", "https://a.test/1", "a.test", "Ada"),
                make_item("11/02/2026", "Shared", "https://shared.test/x", "a.test", "Ada"),
            ],
            "https://site-b.test": [
                make_item("11/03/2026", "B one", "https://b.test/2", "b.test", "Bob"),
                # Cross-site duplicate that must be dropped.
                make_item("11/04/2026", "Shared again", "https://shared.test/x",
                          "b.test", "Bob"),
            ],
            "https://empty.test": [],
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def _install_fake_playwright(self):
        """Inject a minimal async_playwright stub into ``sys.modules``."""

        class _AsyncContext:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

        class FakeContext(_AsyncContext):
            pass

        class FakeBrowser(_AsyncContext):
            async def new_context(self):
                return FakeContext()

        class FakeChromium:
            async def launch(self, **kwargs):
                return FakeBrowser()

        class FakePlaywright(_AsyncContext):
            chromium = FakeChromium()

        fake_module = types.ModuleType("playwright.async_api")
        fake_module.async_playwright = FakePlaywright
        original = sys.modules.get("playwright.async_api")
        sys.modules["playwright.async_api"] = fake_module
        self.addCleanup(
            lambda: sys.modules.__setitem__("playwright.async_api", original)
            if original is not None
            else sys.modules.pop("playwright.async_api", None)
        )

    def test_main_writes_one_stable_batch_from_concurrent_fetches(self):
        self._install_fake_playwright()

        async def fake_fetch_data(context, session_url):
            await asyncio.sleep(0)  # force interleaving between sites
            if session_url == "https://broken.test":
                raise RuntimeError("simulated outage")
            return [
                aggregator.normalize_item(item)
                for item in self.canned[session_url]
            ]

        original_fetch = aggregator.fetch_data
        aggregator.fetch_data = fake_fetch_data
        self.addCleanup(setattr, aggregator, "fetch_data", original_fetch)

        # Pre-seed the CSV with one URL that site-a would fetch again.
        aggregator.save_results(
            [
                aggregator.normalize_item(
                    make_item("10/31/2026", "Already stored", "https://a.test/1",
                              "old.test", "Lee")
                )
            ],
            self.csv_path,
        )

        with self.assertLogs(aggregator.log, level="ERROR") as logs:
            asyncio.run(aggregator.main(self.csv_path, self.urls))
        self.assertTrue(
            any("Failed to fetch" in message for message in logs.output)
        )

        lines = read_lines(self.csv_path)
        # Header + pre-existing row + shared URL + site-b row = 4 lines.
        # The pre-seeded https://a.test/1 is skipped; the duplicate shared URL
        # within the run appears once; empty and broken sites add nothing.
        self.assertEqual(lines[0], aggregator.HEADER)
        self.assertEqual(len(lines), 4)
        self.assertEqual(sum(line == aggregator.HEADER for line in lines), 1)

        urls_on_disk = [parse_record(line)[2] for line in lines[1:]]
        self.assertEqual(
            urls_on_disk,
            [
                "https://a.test/1",
                "https://shared.test/x",
                "https://b.test/2",
            ],
        )
        # Existing content is preserved verbatim.
        self.assertEqual(
            parse_record(lines[1]),
            ["10/31/2026", "Already stored", "https://a.test/1", "old.test", "Lee"],
        )
        # No temporary files are left behind after the atomic write.
        leftovers = [
            name for name in os.listdir(self.temp_dir.name) if name.endswith(".tmp")
        ]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
