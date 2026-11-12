"""Collect news headlines concurrently from several URLs and save a stable CSV.

The scraping tasks run concurrently in separate tabs, but every file operation
happens exactly once, after all sites have been fetched. The complete CSV is
built in a temporary file and atomically renamed into place, so:

* the header ``Posted | Entry | URL | Platform | Author`` appears exactly once
  on the first line;
* every record occupies its own complete line (records can never interleave or
  be only half-written when several tasks finish at the same time);
* records already present in the target CSV, and duplicate URLs found during
  this run, are skipped -- only the first occurrence of every URL is kept.

The AgentQL/Playwright imports are performed lazily inside :func:`fetch_data`
so that the pure CSV helpers in this module can be imported and tested without
those packages or any network access.
"""

import asyncio
import logging
import os
import tempfile

# Set up logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Define the queries to interact with the page
QUERY = """
{
    items(might be aritcles, posts, tweets)[]{
        published_date(convert to XX/XX/XXXX format)
        entry(title or post if no title is available)
        author(person's name; return "n/a" if not available)
        outlet(the original platform it is posted on; if no platform is listed, use the root domain of the url)
        url
    }
}
"""

# Set URLs to the desired websites
WEBSITE_URLS = [
    "https://bsky.app/search?q=agents+for+the+web",
    "https://dev.to/search?q=agents%20for%20the%20web&sort_by=published_at&sort_direction=desc",
    "https://hn.algolia.com/?dateRange=last24h&page=0&prefix=false&query=agents%20for%20the%20web&sort=byDate&type=story",
    "https://duckduckgo.com/?q=agents+for+the+web&t=h_&iar=news&ia=news",
]

# Get the directory of the current script and create path to the csv file
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE_PATH = os.path.join(SCRIPT_DIR, "news_headlines.csv")

# Single source of truth for the on-disk CSV layout.
HEADER = "Posted | Entry | URL | Platform | Author"
DELIMITER = " | "
# Query-result keys in the same order as the CSV columns above.
FIELD_ORDER = ("published_date", "entry", "url", "outlet", "author")


def sanitize_field(value):
    """Remove pipes and line breaks so a field cannot break the CSV layout."""
    if value is None:
        return ""
    return str(value).replace("|", "").replace("\r", " ").replace("\n", " ")


def normalize_item(item):
    """Coerce a raw query result into a record holding every expected field."""
    return {field: sanitize_field(item.get(field, "")) for field in FIELD_ORDER}


def item_to_line(item):
    """Serialize one record to a single CSV line, including its newline."""
    return DELIMITER.join(item[field] for field in FIELD_ORDER) + "\n"


def read_existing_records(csv_path):
    """Read an existing CSV and return ``(records, seen_urls)``.

    A missing or empty file yields ``([], set())``. Header lines are ignored
    and lines that cannot be parsed into the expected number of fields are
    preserved verbatim (under an ``_raw`` key) so existing content is never
    silently dropped.
    """
    if not os.path.exists(csv_path):
        return [], set()

    records = []
    seen_urls = set()
    with open(csv_path, "r", encoding="utf-8", newline="") as file:
        for raw_line in file:
            line = raw_line.rstrip("\r\n")
            if not line.strip() or line == HEADER:
                continue
            parts = line.split(DELIMITER)
            if len(parts) != len(FIELD_ORDER):
                # Legacy / malformed line: keep it untouched on rewrite.
                records.append({"_raw": line})
                continue
            record = dict(zip(FIELD_ORDER, parts))
            records.append(record)
            if record["url"]:
                seen_urls.add(record["url"])
    return records, seen_urls


def dedupe_records(records, seen_urls):
    """Drop records whose URL is already known, keeping the first occurrence.

    ``seen_urls`` is updated in place, so the set loaded from the existing CSV
    and the URLs collected during this run share one dedupe boundary.
    """
    unique_records = []
    for record in records:
        url = record["url"]
        if url and url in seen_urls:
            log.info("Skipping duplicate entry for URL: %s", url)
            continue
        unique_records.append(record)
        if url:
            seen_urls.add(url)
    return unique_records


def save_results(new_records, csv_path=CSV_FILE_PATH):
    """Write the whole batch (existing rows + unique new rows) atomically.

    The file is fully rendered in a temporary file in the same directory and
    then ``os.replace``d onto the target, so readers always observe either the
    previous complete file or the new complete file -- never a half-written
    one. The header is always emitted exactly once on the first line.

    Returns the number of newly appended records.
    """
    existing_records, seen_urls = read_existing_records(csv_path)
    unique_records = dedupe_records(list(new_records), seen_urls)

    directory = os.path.dirname(os.path.abspath(csv_path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=os.path.basename(csv_path) + ".",
        suffix=".tmp",
        dir=directory,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as file:
            file.write(HEADER + "\n")
            for record in existing_records:
                if "_raw" in record:
                    file.write(record["_raw"] + "\n")
                else:
                    file.write(item_to_line(record))
            for record in unique_records:
                file.write(item_to_line(record))
        os.replace(tmp_path, csv_path)
    except BaseException:
        # Never leave a stray temporary file behind if the batch fails.
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    log.info("Wrote %d new record(s) to %s", len(unique_records), csv_path)
    return len(unique_records)


async def fetch_data(context, session_url):
    """Open the given URL in a new tab and return its normalized items.

    AgentQL and Playwright are imported here (lazily) on purpose: this module
    must remain importable in offline tests that replace this function with a
    fake fetcher.
    """
    import agentql

    page = await agentql.wrap_async(context.new_page())
    try:
        await page.goto(session_url)
        data = await page.query_data(QUERY)
    finally:
        await page.close()

    items = (data or {}).get("items") or []
    if not items:
        log.warning("No items returned from %s", session_url)
    return [normalize_item(item) for item in items]


async def collect_results(fetcher, urls):
    """Fetch every URL concurrently and return ``{url: records}``.

    A failing fetch or a site that returns an empty list is logged and mapped
    to an empty list; one broken site never interrupts the other sites or the
    batch write that follows.
    """

    async def _collect(session_url):
        try:
            return session_url, await fetcher(session_url)
        except Exception as exc:  # noqa: BLE001 - isolate per-site failures
            log.exception("Failed to fetch data from %s: %s", session_url, exc)
            return session_url, []

    results = await asyncio.gather(*(_collect(url) for url in urls))
    return dict(results)


async def main(csv_path=CSV_FILE_PATH, urls=None):
    """Fetch all sites concurrently, then persist one deduplicated CSV batch."""
    from playwright.async_api import async_playwright

    urls = WEBSITE_URLS if urls is None else urls

    async with async_playwright() as playwright, await playwright.chromium.launch(
        headless=True
    ) as browser, await browser.new_context() as context:
        # Open multiple tabs in the same browser context to fetch concurrently.
        collected = await collect_results(
            lambda url: fetch_data(context, url), urls
        )

    # Flatten in configured site order; fetching itself stays fully concurrent.
    new_records = [item for url in urls for item in collected.get(url, [])]
    written = save_results(new_records, csv_path)
    log.info("All done! %d new record(s) saved to %s", written, csv_path)


if __name__ == "__main__":
    # Run the main function in an event loop
    asyncio.run(main())
