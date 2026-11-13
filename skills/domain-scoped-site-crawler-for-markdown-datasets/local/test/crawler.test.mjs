import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { crawlSite, STOP_REASONS } from '../src/crawler.mjs';
import { globToRegExp } from '../src/url-filters.mjs';
import { isAllowedByRobots, parseRobotsTxt } from '../src/robots.mjs';
import { normalizeUrl } from '../src/url-utils.mjs';
import { startFixtureServer } from './fixture-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

let server;

before(async () => {
  server = await startFixtureServer();
});

after(async () => {
  await server.close();
});

function input(overrides = {}) {
  return { startUrls: [{ url: `${server.origin}/` }], ...overrides };
}

function relative(url) {
  return url.startsWith(server.origin) ? url.slice(server.origin.length) || '/' : url;
}

function recordPaths(result) {
  return result.records.map((record) => relative(record.url));
}

function skipPaths(result, group) {
  return result.summary.skippedUrls[group].map((entry) => relative(entry.url));
}

function dispositionOf(summary, url) {
  for (const [group, entries] of Object.entries(summary.skippedUrls)) {
    if (entries.some((entry) => entry.url === url)) return group;
  }
  return null;
}

/**
 * The core reconciliation assertion: the summary must be a faithful account
 * of the run and nothing may be counted twice or dropped silently.
 */
function assertSummaryMatchesRecords(result) {
  const { records, summary } = result;

  assert.equal(summary.pagesCrawled, records.length, 'pagesCrawled equals the record count');
  assert.ok(records.length <= summary.maxCrawlPages, 'never exceeds maxCrawlPages');

  const stored = new Set(records.map((record) => record.url));
  assert.equal(stored.size, records.length, 'every stored URL appears exactly once');

  // Unique depth-ordered visit: parents never come after children.
  for (const record of records) {
    assert.ok(Number.isInteger(record.depth) && record.depth >= 0, 'depth is a non-negative integer');
    assert.ok(record.depth <= summary.maxCrawlDepth, 'no record is deeper than maxCrawlDepth');
  }

  let listedSkips = 0;
  for (const [group, entries] of Object.entries(summary.skippedUrls)) {
    assert.equal(summary.skippedCounts[group], entries.length, `skippedCounts.${group} equals its list length`);
    const groupUrls = new Set(entries.map((entry) => entry.url));
    assert.equal(groupUrls.size, entries.length, `skippedUrls.${group} has no duplicate URL`);
    for (const entry of entries) {
      assert.ok(!stored.has(entry.url), `skipped ${entry.url} must not also be stored`);
      assert.equal(dispositionOf(summary, entry.url), group, `${entry.url} is accounted under exactly one group`);
      assert.ok(Number.isInteger(entry.depth) && entry.depth >= 0, `skip entry depth for ${entry.url}`);
      assert.equal(typeof entry.detail, 'string', `skip entry detail for ${entry.url}`);
    }
    listedSkips += entries.length;
  }
  assert.equal(summary.totalSkippedUrls, listedSkips, 'totalSkippedUrls equals the sum of all groups');

  // URLs still queued when the crawl stopped are reported separately, never
  // silently dropped: every tracked URL is exactly one of stored/skipped/unvisited.
  assert.equal(summary.unvisitedCount, summary.unvisitedUrls.length, 'unvisitedCount matches its list');
  const unvisited = new Set(summary.unvisitedUrls);
  assert.equal(unvisited.size, summary.unvisitedUrls.length, 'unvisited URLs are unique');
  for (const url of summary.unvisitedUrls) {
    assert.ok(!stored.has(url), 'an unvisited URL was not stored');
    assert.equal(dispositionOf(summary, url), null, 'an unvisited URL is not also in a skip group');
  }
  assert.equal(
    summary.uniqueUrlsTracked,
    records.length + listedSkips + summary.unvisitedCount + summary.depthLimitedCount,
    'every tracked URL is stored xor skipped xor unvisited xor depth-limited',
  );
  assert.ok(summary.unvisitedCount === 0 || summary.stopReason === STOP_REASONS.MAX_PAGES, 'only the page cap leaves URLs unvisited');

  // The depth cap may leave URLs unfollowed; they are reported, not dropped.
  assert.equal(summary.depthLimitedCount, summary.depthLimitedUrls.length, 'depthLimitedCount matches its list');
  const depthLimitedSet = new Set(summary.depthLimitedUrls);
  assert.equal(depthLimitedSet.size, summary.depthLimitedUrls.length, 'depth-limited URLs are unique');
  for (const url of summary.depthLimitedUrls) {
    assert.ok(!stored.has(url), 'a depth-limited URL was not stored');
    assert.equal(dispositionOf(summary, url), null, 'a depth-limited URL is not also in a skip group');
    assert.ok(!unvisited.has(url), 'a depth-limited URL is not also listed as unvisited');
    assert.equal(new URL(url).hostname, summary.domain, 'a depth-limited URL is on the crawl domain');
  }

  if (summary.stopReason === STOP_REASONS.MAX_PAGES) {
    assert.equal(records.length, summary.maxCrawlPages, 'page-cap stop only when the cap is actually full');
  } else {
    assert.ok(records.length <= summary.maxCrawlPages);
  }
  if (summary.stopReason === STOP_REASONS.ALL_FILTERED) {
    const starts = new Set(summary.startUrlsSeen);
    for (const record of records) {
      assert.ok(starts.has(record.url), 'only start URLs were stored when everything discovered was filtered');
    }
  }
  if (summary.stopReason === STOP_REASONS.MAX_DEPTH) {
    assert.ok(summary.depthLimitedCount > 0, 'depth stop requires depth-limited URLs');
  }
  if (summary.stopReason === STOP_REASONS.NO_MORE_LINKS) {
    assert.equal(summary.depthLimitedCount, 0, 'nothing may be left beyond maxCrawlDepth for no_more_links');
  }

  for (const record of records) {
    assert.equal(typeof record.title, 'string', 'title is a string');
    assert.ok(Number.isInteger(record.wordCount) && record.wordCount >= 0, 'wordCount is a non-negative integer');
    assert.ok(Number.isInteger(record.httpStatusCode), 'httpStatusCode is an integer');
  }
}

test('unit: URL normalization drops fragments unless asked to keep them', () => {
  assert.equal(normalizeUrl('/a.html#top', 'https://example.com/'), 'https://example.com/a.html');
  assert.equal(
    normalizeUrl('/a.html#top', 'https://example.com/', { keepFragments: true }),
    'https://example.com/a.html#top',
  );
  assert.equal(normalizeUrl('mailto:hi@example.com', 'https://example.com/'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://example.com/'), null);
});

test('unit: glob filters and robots rules behave as documented', () => {
  assert.ok(globToRegExp('*/filter/*').test('http://x/filter/docs/guide.html'));
  assert.ok(globToRegExp('*login*').test('http://x/login'));
  assert.ok(!globToRegExp('https://example.com/docs/*').test('https://example.com/blog/x'));

  const parsed = parseRobotsTxt(`
    User-agent: *
    Disallow: /private/
    Allow: /private/public-note.html
    Sitemap: https://example.com/sitemap.xml
  `);
  assert.equal(isAllowedByRobots(parsed, 'https://example.com/private/secret.html', 'AnyBot'), false);
  assert.equal(isAllowedByRobots(parsed, 'https://example.com/private/public-note.html', 'AnyBot'), true);
  assert.equal(isAllowedByRobots(parsed, 'https://example.com/a.html', 'AnyBot'), true);
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap.xml']);
});

test('crawls multiple pages, deduplicates links, and reports no_more_links', async () => {
  const result = await crawlSite(input({
    maxCrawlDepth: 2,
    maxCrawlPages: 20,
    excludeUrlGlobs: ['*/filter/*', '*/broken.html', '*/reset.html', '*/deep2.html', '*/deep3.html'],
  }), { userAgent: 'FixtureCrawler/1.0', requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.equal(result.summary.stopReason, STOP_REASONS.NO_MORE_LINKS);
  assert.equal(result.summary.pagesCrawled, 6);
  assert.deepEqual(recordPaths(result), ['/', '/a.html', '/b.html', '/deep1.html', '/frag.html', '/a2.html']);

  assert.equal(result.records[0].depth, 0);
  assert.equal(result.records[0].title, 'Fixture Home');
  assert.equal(result.records[0].wordCount > 0, true);
  assert.equal(result.records.find((record) => record.url.endsWith('/a2.html')).depth, 2);
  for (const record of result.records) {
    if (!record.url.endsWith('/a2.html') && record.url !== `${server.origin}/`) {
      assert.equal(record.depth, 1, `${record.url} should be a direct child of the start URL`);
    }
    assert.equal(record.httpStatusCode, 200);
  }

  // b.html links back to "/", which was already stored at depth 0.
  const allTracked = [
    ...result.records.map((record) => record.url),
    ...Object.values(result.summary.skippedUrls).flat().map((entry) => entry.url),
  ];
  assert.equal(allTracked.filter((url) => url === `${server.origin}/`).length, 1, 'no duplicate start URL');

  // Off-domain and non-http links are never crawled; off-domain is reported.
  assert.equal(result.summary.skippedCounts.offDomain, 1);
  assert.deepEqual(skipPaths(result, 'offDomain'), ['https://other.example.com/external.html']);
  assert.ok(!server.requests.includes('/external.html'));

  // robots.txt is honoured: the disallowed page is listed, never requested.
  assert.deepEqual(skipPaths(result, 'robots'), ['/private/secret.html']);
  assert.ok(!server.requests.includes('/private/secret.html'), 'robots-skipped page was not fetched');
});

test('stops immediately at maxCrawlPages and says so', async () => {
  const result = await crawlSite(input({
    maxCrawlDepth: 3,
    maxCrawlPages: 3,
    excludeUrlGlobs: ['*/filter/*', '*/broken.html', '*/reset.html', '*/deep2.html', '*/deep3.html'],
  }), { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.equal(result.summary.stopReason, STOP_REASONS.MAX_PAGES);
  assert.equal(result.summary.pagesCrawled, 3);
  assert.equal(result.records.length, 3);
  assert.ok(!result.records.some((record) => record.url.endsWith('/a2.html')), 'stopped before deeper pages');

  // The crawler stops at the cap; it does not keep fetching pages it will not store.
  assert.ok(server.requests.length < 20, 'no runaway fetching after the cap');
});

test('fetches the start URL even when robots.txt disallows it, but skips discovered pages', async () => {
  const result = await crawlSite({
    startUrls: [{ url: `${server.origin}/hidden/start.html` }],
    maxCrawlDepth: 2,
    maxCrawlPages: 10,
  }, { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.equal(result.records[0].url, `${server.origin}/hidden/start.html`, 'disallowed start URL is still crawled');
  assert.equal(result.records[0].title, 'Hidden Start');
  assert.deepEqual(skipPaths(result, 'robots'), ['/private/secret.html']);

  // The longer Allow rule wins over the /private/ prefix rule.
  assert.ok(recordPaths(result).includes('/private/public-note.html'), 'explicitly allowed page is crawled');
  assert.ok(!server.requests.includes('/private/secret.html'), 'disallowed discovered page is never fetched');

  assert.equal(result.summary.stopReason, STOP_REASONS.NO_MORE_LINKS);
});

test('applies include globs and include regexps together with exclusions', async () => {
  const result = await crawlSite(input({
    maxCrawlDepth: 3,
    maxCrawlPages: 20,
    includeUrlGlobs: ['*/filter/*'],
    excludeUrlGlobs: ['*/filter/blog/*'],
    excludeUrlRegexps: ['/draft\\.html$'],
  }), { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.deepEqual(recordPaths(result), ['/', '/filter/docs/guide.html']);
  const filtered = skipPaths(result, 'filtered');
  assert.ok(filtered.includes('/filter/blog/post.html'), 'exclude glob removes the blog post');
  assert.ok(filtered.includes('/filter/docs/draft.html'), 'exclude regexp removes the draft');
  assert.ok(!filtered.includes('/filter/docs/guide.html'), 'a URL passing both include and exclude rules is kept');
  assert.ok(filtered.includes('/a.html'), 'include glob rejects URLs outside the include set');
  assert.equal(result.summary.stopReason, STOP_REASONS.NO_MORE_LINKS);
});

test('skips canonical duplicates unless ignoreCanonicalUrl is true', async () => {
  const base = {
    startUrls: [{ url: `${server.origin}/` }],
    maxCrawlDepth: 1,
    maxCrawlPages: 20,
    respectRobotsTxtFile: false,
    excludeUrlGlobs: ['*/filter/*', '*/broken.html', '*/reset.html', '*/deep1.html'],
  };

  const result = await crawlSite(base, { requestTimeoutMs: 5000 });
  assertSummaryMatchesRecords(result);
  assert.deepEqual(skipPaths(result, 'canonicalDuplicate'), ['/dup.html']);
  assert.ok(recordPaths(result).includes('/a.html'));
  assert.ok(!recordPaths(result).includes('/dup.html'));
  assert.equal(result.summary.skippedUrls.canonicalDuplicate[0].canonicalUrl, `${server.origin}/a.html`);

  const ignoring = await crawlSite({ ...base, ignoreCanonicalUrl: true }, { requestTimeoutMs: 5000 });
  assertSummaryMatchesRecords(ignoring);
  assert.equal(ignoring.summary.skippedCounts.canonicalDuplicate, 0);
  assert.ok(recordPaths(ignoring).includes('/dup.html'), 'canonical duplicates are stored when ignored');
  assert.equal(ignoring.summary.pagesCrawled, result.summary.pagesCrawled + 1);
});

test('keeps URL fragments as distinct pages when requested', async () => {
  const base = {
    startUrls: [{ url: `${server.origin}/frag.html` }],
    maxCrawlDepth: 1,
    maxCrawlPages: 20,
    respectRobotsTxtFile: false,
  };

  const collapsed = await crawlSite(base, { requestTimeoutMs: 5000 });
  assertSummaryMatchesRecords(collapsed);
  assert.deepEqual(recordPaths(collapsed), ['/frag.html']);
  assert.equal(collapsed.summary.stopReason, STOP_REASONS.NO_MORE_LINKS);

  const kept = await crawlSite({ ...base, keepUrlFragments: true }, { requestTimeoutMs: 5000 });
  assertSummaryMatchesRecords(kept);
  assert.deepEqual(recordPaths(kept), ['/frag.html', '/frag.html#one', '/frag.html#two']);
  assert.equal(kept.summary.pagesCrawled, 3);
});

test('records fetch failures in the skip list instead of dropping pages', async () => {
  const result = await crawlSite({
    startUrls: [{ url: `${server.origin}/failure.html` }],
    maxCrawlDepth: 1,
    maxCrawlPages: 10,
  }, { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.deepEqual(recordPaths(result), ['/failure.html']);
  assert.deepEqual(skipPaths(result, 'fetchFailed').sort(), ['/broken.html', '/reset.html']);
  const broken = result.summary.skippedUrls.fetchFailed.find((entry) => entry.url.endsWith('/broken.html'));
  assert.equal(broken.statusCode, 500);
  const reset = result.summary.skippedUrls.fetchFailed.find((entry) => entry.url.endsWith('/reset.html'));
  assert.equal(reset.statusCode, null);
  assert.ok(reset.error.length > 0, 'connection failures carry an error message');
  assert.equal(result.summary.stopReason, STOP_REASONS.ALL_FILTERED);
});

test('reports depth exhaustion when the depth cap cuts the crawl short', async () => {
  server.resetRequests();
  const result = await crawlSite(input({
    maxCrawlDepth: 0,
    maxCrawlPages: 10,
    respectRobotsTxtFile: false,
  }), { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.equal(result.summary.stopReason, STOP_REASONS.MAX_DEPTH);
  assert.equal(result.summary.pagesCrawled, 1, 'depth 0 means only the start URL is crawled');
  assert.ok(result.summary.depthLimitedCount > 0, 'links that were deeper are reported');
  assert.deepEqual(server.requests, ['/'], 'depth 0 fetches only the start URL and its robots.txt is not even needed');
});

test('discovers pages from sitemaps and llms.txt when enabled', async () => {
  const result = await crawlSite(input({
    maxCrawlDepth: 1,
    maxCrawlPages: 20,
    useSitemaps: true,
    useLlmsTxt: true,
    excludeUrlGlobs: ['*/filter/*', '*/broken.html', '*/reset.html', '*/deep2.html', '*/deep3.html'],
  }), { requestTimeoutMs: 5000 });

  assertSummaryMatchesRecords(result);

  assert.ok(recordPaths(result).includes('/sitemap/extra.html'), 'sitemap-only page was found');
  assert.ok(recordPaths(result).includes('/llms/guide.html'), 'llms.txt-only page was found');
  assert.equal(result.summary.discovery.llmsTxtFound, true);
  assert.ok(result.summary.discovery.sitemapFilesRead >= 1);

  // Duplicate discovery (a page both linked and listed) must not double-store.
  const extraCount = result.records.filter((record) => record.url.endsWith('/sitemap/extra.html')).length;
  assert.equal(extraCount, 1);
});
