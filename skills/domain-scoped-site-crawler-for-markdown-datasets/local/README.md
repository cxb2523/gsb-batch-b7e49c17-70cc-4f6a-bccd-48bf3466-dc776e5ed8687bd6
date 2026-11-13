# Local crawler with a reconcilable run summary

A dependency-free (Node.js built-in modules only) implementation of this
skill's crawl flow, built for the case where an "complete-looking" crawl has
actually missed or duplicated pages. Every URL the crawler sees ends up in
exactly one place in the summary: stored, skipped under one reason, deep-link
left for the depth cap, or still queued when the page cap stopped the run.

Nothing leaves the machine: it talks HTTP only to the URLs you give it, so the
included fixture site and tests run fully offline.

## Files

| Path | What it is |
|---|---|
| `src/crawler.mjs` | `crawlSite(input, options)` — the crawler and summary builder |
| `src/url-utils.mjs` | URL resolution/normalization, fragment handling, domain scope |
| `src/url-filters.mjs` | Include/exclude globs and regular expressions |
| `src/robots.mjs` | robots.txt parser: groups, `*`/`$` wildcards, and Allow-beats-Disallow precedence |
| `src/html-utils.mjs` | Title, links, canonical, word count — a tolerant non-DOM reader |
| `test/` | `node:test` suite and the fixture HTTP server |
| `fixtures/site/` | The hand-made static site used by the tests and by hand |
| `example-input.json` | Example input for `scripts/crawl-local.mjs` |

## Input

The field names and meanings follow the Actor's input schema. Only the fields
below are used by this local module.

| Field | Type | Default | Behaviour here |
|---|---|---|---|
| `startUrls` | array | required | `{"url": "..."}` objects or bare strings. Only the hostname of the **first** start URL defines the crawl scope. Duplicate start URLs are collapsed. |
| `maxCrawlDepth` | integer | 10 | `0` crawls only the start URLs. Links found on a depth-`maxCrawlDepth` page are recorded in `depthLimitedUrls`, not stored. |
| `maxCrawlPages` | integer | 20 | Hard cap on stored pages. The crawl stops **immediately** when the cap is reached; links on the page that filled the last slot are not even read. |
| `useSitemaps` | boolean | false | Reads `Sitemap:` entries from robots.txt plus `/sitemap.xml` (and nested sitemap indexes), enqueuing the listed same-domain URLs at depth 1. |
| `useLlmsTxt` | boolean | false | Reads `/llms.txt` and enqueues the URLs in its Markdown links at depth 1. |
| `respectRobotsTxtFile` | boolean | true | **Start URLs are always fetched**, even when disallowed. Discovered URLs that robots.txt disallows are skipped and listed under `robots`. |
| `includeUrlGlobs` | string[] | `[]` | When set, a discovered URL must match at least one. `*` and `?` wildcards, `{a,b}`, `[abc]`. |
| `excludeUrlGlobs` | string[] | `[]` | Any match rejects the URL. |
| `includeUrlRegexps` | string[] | `[]` | When set, a discovered URL must match at least one. |
| `excludeUrlRegexps` | string[] | `[]` | Any match rejects the URL. |
| `keepUrlFragments` | boolean | false | When off, `#fragment` is removed before deduplication, so `page#a` and `page#b` are one page. When on, they are separate pages, and self-links to the same page with different fragments are crawled separately. |
| `ignoreCanonicalUrl` | boolean | false | When off, a page whose `<link rel="canonical">` points at an already-stored page is skipped as `canonicalDuplicate`. When on, the canonical tag is ignored. |

Filters apply only to discovered URLs — start URLs are never filtered. Include
globs and include regexps must both pass when both are set; an exclude match
always wins.

## Output

`crawlSite` returns `{ records, summary }`.

Each record is one line-ready row:

```json
{"url":"http://127.0.0.1:3000/a.html","title":"Page A","depth":1,"wordCount":30,"httpStatusCode":200}
```

`summary` explains the run:

| Field | Meaning |
|---|---|
| `stopReason` | `max_pages_reached`, `max_depth_reached`, `all_filtered`, or `no_more_links` |
| `stopReasonDetail` | Human-readable sentence for the reason |
| `pagesCrawled` | Number of records — equals `records.length` |
| `pagesFetched` | Successful pages plus canonical duplicates and failed fetches |
| `skippedCounts` / `skippedUrls` | Per group: `robots`, `offDomain`, `filtered`, `canonicalDuplicate`, `fetchFailed`. Each entry carries `url`, `depth`, `sourceUrl`, and either `canonicalUrl`, `statusCode` + `error`, or `detail` |
| `totalSkippedUrls` | Sum of all skip groups |
| `depthLimitedUrls` / `depthLimitedCount` | Links found deeper than `maxCrawlDepth`; reported instead of silently dropped |
| `unvisitedUrls` / `unvisitedCount` | Same-domain URLs still queued when the page cap stopped the run |
| `uniqueUrlsTracked` | `records.length + totalSkippedUrls + unvisitedCount` — every URL seen, counted once |
| `discovery` | Sitemap/llms.txt counters and non-fatal warnings |

Exactly one URL appears in exactly one of the four account columns: stored
(`records`), skipped (`skippedUrls`), depth-limited (`depthLimitedUrls`), or
unvisited (`unvisitedUrls`). `records` never contains a duplicate URL.

`all_filtered` is reported when the only stored pages are start URLs and at
least one discovered URL was skipped. If the frontier empties because links
pointed deeper than the depth cap, `max_depth_reached` wins; otherwise an
unfiltered empty frontier is `no_more_links`.

## Run it

```bash
cd local

# Tests (fixture server, fully offline)
node --test test/crawler.test.mjs    # or: npm test

# By hand: serve the sample site in one terminal...
node scripts/serve-fixture.mjs 3000

# ...and crawl it in another
node ../scripts/crawl-local.mjs example-input.json

# Or point at any other local/HTTP site
node ../scripts/crawl-local.mjs '{"startUrls":[{"url":"http://127.0.0.1:3000/"}],"maxCrawlDepth":1,"maxCrawlPages":3}'
```

`scripts/crawl-local.mjs` prints one JSON record per line on stdout and the
summary JSON on stderr. `--records <path>` and `--summary <path>` also write
files; `--no-summary` suppresses stderr.

Node.js 20+ is required (uses `fetch`, `AbortSignal.timeout`, and
`node:test`). No npm install is needed.

## What the fixture site contains

| Path | Used to test |
|---|---|
| `/` | start page linking to every case below |
| `/a.html` → `/a2.html` | two-level chain; depth and parent/child breadth-first order |
| `/dup.html` | canonical pointing at `/a.html` → `canonicalDuplicate` |
| `/private/secret.html` | robots `Disallow: /private/`; never fetched |
| `/hidden/start.html` | robots-disallowed **start** URL; fetched anyway, its discovered links still filtered |
| `/private/public-note.html` | longer `Allow:` rule overriding the `Disallow:` prefix |
| `/filter/docs/guide.html`, `/filter/blog/post.html`, `/filter/docs/draft.html` | include/exclude glob and regexp combinations |
| `/broken.html` (HTTP 500), `/reset.html` (dropped connection) | `fetchFailed` group |
| `/deep1.html` → `/deep2.html` → `/deep3.html` | `max_depth_reached` |
| `/frag.html` | `keepUrlFragments` on/off |
| `sitemap.xml`, `llms.txt` | sitemap and llms.txt discovery |
| `https://other.example.com/external.html` | off-domain link never crawled |

## Scope and limitations

- It is a plain-HTTP crawler: no JavaScript execution, no CSS extraction, no
  PDF parsing. Pages are read for title, links, canonical, and words.
- Only `<a href>` links are followed; images, scripts, and alternate formats
  are not pages.
- The HTML reader is deliberately simple and is not a browser DOM. It is fine
  for ordinary pages and fixtures, not for pathological markup.
- Redirects are followed by `fetch`; the record keeps the requested URL, not
  the final URL.
- Polite by default: one request at a time, plus robots.txt.
