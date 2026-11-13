/**
 * Domain-scoped site crawler — local, dependency-free implementation.
 *
 * Public entry point: crawlSite(input, options) -> { records, summary }.
 * See README.md in this folder for the input fields and summary shape.
 */

import { extractAnchorHrefs, extractBaseHref, extractCanonicalHref, extractTitle, countWords } from './html-utils.mjs';
import { isAllowedByRobots, parseRobotsTxt } from './robots.mjs';
import { createUrlFilter } from './url-filters.mjs';
import { hostnameOf, normalizeUrl, originOf, startUrlStrings } from './url-utils.mjs';

export const DEFAULT_USER_AGENT = 'LocalSiteCrawler/1.0 (+local; offline test fixture)';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

/**
 * Machine-readable reasons the crawl stopped. Exactly one is reported per run.
 *
 * - max_pages_reached: the page cap was hit; the crawl stopped immediately.
 * - max_depth_reached: the frontier emptied at maxCrawlDepth and at least one
 *   link could not be followed because it was deeper than that.
 * - all_filtered: nothing beyond the start URLs was stored and at least one
 *   discovered URL was skipped (robots, off-domain, rules, canonical, failure).
 * - no_more_links: the frontier emptied naturally with no deeper links left.
 */
export const STOP_REASONS = Object.freeze({
  MAX_PAGES: 'max_pages_reached',
  MAX_DEPTH: 'max_depth_reached',
  ALL_FILTERED: 'all_filtered',
  NO_MORE_LINKS: 'no_more_links',
});

const SKIP_GROUPS = Object.freeze([
  'robots',
  'offDomain',
  'filtered',
  'canonicalDuplicate',
  'fetchFailed',
]);

/**
 * Normalize and validate the Actor-shaped input.
 *
 * @param {object} input
 * @returns {object}
 */
export function resolveSettings(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('input must be an object');
  }
  const rawStartUrls = startUrlStrings(input.startUrls);
  const maxCrawlDepth = integerField(input.maxCrawlDepth, 10, 'maxCrawlDepth', 0);
  const maxCrawlPages = integerField(input.maxCrawlPages, 20, 'maxCrawlPages', 1);
  const keepUrlFragments = booleanField(input.keepUrlFragments, false, 'keepUrlFragments');
  const ignoreCanonicalUrl = booleanField(input.ignoreCanonicalUrl, false, 'ignoreCanonicalUrl');
  const useSitemaps = booleanField(input.useSitemaps, false, 'useSitemaps');
  const useLlmsTxt = booleanField(input.useLlmsTxt, false, 'useLlmsTxt');
  const respectRobotsTxtFile = booleanField(input.respectRobotsTxtFile, true, 'respectRobotsTxtFile');
  const includeUrlGlobs = stringArrayField(input.includeUrlGlobs, 'includeUrlGlobs');
  const excludeUrlGlobs = stringArrayField(input.excludeUrlGlobs, 'excludeUrlGlobs');
  const includeUrlRegexps = stringArrayField(input.includeUrlRegexps, 'includeUrlRegexps');
  const excludeUrlRegexps = stringArrayField(input.excludeUrlRegexps, 'excludeUrlRegexps');

  const startUrls = [];
  const startSeen = new Set();
  for (const raw of rawStartUrls) {
    const url = normalizeUrl(raw, undefined, { keepFragments: keepUrlFragments });
    if (!url) throw new TypeError(`startUrls contains an invalid http(s) URL: ${raw}`);
    if (startSeen.has(url)) continue;
    startSeen.add(url);
    startUrls.push(url);
  }

  const urlFilter = createUrlFilter({
    includeUrlGlobs,
    excludeUrlGlobs,
    includeUrlRegexps,
    excludeUrlRegexps,
  });

  return {
    startUrls,
    maxCrawlDepth,
    maxCrawlPages,
    useSitemaps,
    useLlmsTxt,
    respectRobotsTxtFile,
    keepUrlFragments,
    ignoreCanonicalUrl,
    urlFilter,
    domain: hostnameOf(startUrls[0]),
  };
}

/**
 * Crawl a site.
 *
 * @param {object} input Actor-shaped input (see README).
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] Injectable fetch (defaults to global fetch).
 * @param {string} [options.userAgent] User agent for pages and robots.txt.
 * @param {number} [options.requestTimeoutMs] Per-request timeout.
 * @returns {Promise<{records: object[], summary: object}>}
 */
export async function crawlSite(input, options = {}) {
  const settings = resolveSettings(input);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const { keepUrlFragments, maxCrawlDepth, maxCrawlPages, domain, urlFilter } = settings;

  /** @type {object[]} one row per successfully stored page */
  const records = [];
  const crawledUrls = new Set();
  const dispositions = new Map(); // url -> 'queued' | 'stored' | 'skipped' | 'failed' | 'duplicate'
  const skippedUrls = Object.fromEntries(SKIP_GROUPS.map((group) => [group, []]));
  const skippedCounts = Object.fromEntries(SKIP_GROUPS.map((group) => [group, 0]));
  const skippedSeen = new Set();
  const depthLimitedUrls = [];
  const depthLimitedSeen = new Set();
  const discoveryWarnings = [];

  const queue = [];
  let queueIndex = 0;

  function known(url) {
    return dispositions.has(url);
  }

  function recordSkipped(group, entry) {
    if (skippedSeen.has(entry.url) || crawledUrls.has(entry.url)) return false;
    skippedSeen.add(entry.url);
    skippedUrls[group].push(entry);
    skippedCounts[group] += 1;
    dispositions.set(entry.url, 'skipped');
    return true;
  }

  async function fetchText(url) {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      ok: response.ok,
      finalUrl: response.url || url,
      contentType: response.headers?.get?.('content-type') ?? '',
      text,
    };
  }

  function addDepthLimited(url) {
    if (known(url) || depthLimitedSeen.has(url)) return;
    depthLimitedSeen.add(url);
    depthLimitedUrls.push(url);
  }

  // robots.txt is fetched at most once per origin; sitemaps may reference it.
  const robotsCache = new Map();

  async function getRobots(origin) {
    if (robotsCache.has(origin)) return robotsCache.get(origin);
    const robotsUrl = `${origin}/robots.txt`;
    let parsed = { groups: new Map(), sitemaps: [] };
    try {
      const response = await fetchText(robotsUrl);
      if (response.ok) {
        parsed = parseRobotsTxt(response.text);
      } else {
        discoveryWarnings.push(`robots.txt at ${robotsUrl} returned HTTP ${response.statusCode}; treating it as absent`);
      }
    } catch (error) {
      discoveryWarnings.push(`robots.txt at ${robotsUrl} could not be fetched (${error.message}); treating it as absent`);
    }
    robotsCache.set(origin, parsed);
    return parsed;
  }

  async function robotsAllows(url) {
    if (!settings.respectRobotsTxtFile) return true;
    const parsed = await getRobots(originOf(url));
    return isAllowedByRobots(parsed, url, userAgent);
  }

  /**
   * Apply the discovery rules to a candidate URL and enqueue it when it passes.
   * Every rejected candidate lands in exactly one skip group, so the summary
   * can account for all discovered URLs.
   */
  async function considerDiscovered(candidate, { depth, sourceUrl }) {
    if (known(candidate)) return 'known';
    if (hostnameOf(candidate) !== domain) {
      recordSkipped('offDomain', { url: candidate, depth, sourceUrl, detail: `hostname ${hostnameOf(candidate)} is outside ${domain}` });
      return 'offDomain';
    }
    if (!urlFilter(candidate)) {
      recordSkipped('filtered', { url: candidate, depth, sourceUrl, detail: 'URL did not pass the include/exclude rules' });
      return 'filtered';
    }
    if (depth > maxCrawlDepth) {
      addDepthLimited(candidate);
      return 'depth';
    }
    if (!(await robotsAllows(candidate))) {
      recordSkipped('robots', { url: candidate, depth, sourceUrl, detail: 'disallowed by robots.txt' });
      return 'robots';
    }
    dispositions.set(candidate, 'queued');
    queue.push({ url: candidate, depth, sourceUrl, isStart: false });
    return 'queued';
  }

  // ---- Sitemap and llms.txt discovery -------------------------------------

  function resolveAgainst(value, base, keep) {
    return normalizeUrl(value, base, { keepFragments: keep });
  }

  async function readSitemap(url, visited, pageUrls, depthBudget) {
    const normalized = normalizeUrl(url, undefined, { keepFragments: false });
    if (!normalized || visited.has(normalized)) return;
    if (visited.size >= 50) {
      discoveryWarnings.push('sitemap discovery stopped after 50 sitemap files');
      return;
    }
    if (hostnameOf(normalized) !== domain) {
      discoveryWarnings.push(`sitemap ${normalized} is outside ${domain}; ignored`);
      return;
    }
    visited.add(normalized);
    let response;
    try {
      response = await fetchText(normalized);
    } catch (error) {
      discoveryWarnings.push(`sitemap ${normalized} could not be fetched (${error.message})`);
      return;
    }
    if (!response.ok) {
      discoveryWarnings.push(`sitemap ${normalized} returned HTTP ${response.statusCode}`);
      return;
    }
    const locs = [...response.text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map((match) => decodeXml(match[1].trim()));
    const isIndex = /<sitemapindex\b/i.test(response.text);
    for (const loc of locs) {
      // Sitemap <loc> must be an absolute URL by spec. Relative values are a
      // fixture convenience; resolve them against the sitemap's directory so
      // they do not accidentally become paths on the site root.
      const resolved = resolveAgainst(loc, response.finalUrl, false);
      if (!resolved) continue;
      if (isIndex && depthBudget > 0) {
        await readSitemap(resolved, visited, pageUrls, depthBudget - 1);
      } else if (!isIndex) {
        pageUrls.push(resolved);
      }
    }
  }

  async function discoverFromSitemaps(firstOrigin) {
    if (!settings.useSitemaps || maxCrawlDepth < 1) return;
    const pageUrls = [];
    const visited = new Set();
    const robots = await getRobots(firstOrigin);
    for (const sitemapUrl of robots.sitemaps) {
      const resolved = resolveAgainst(sitemapUrl, `${firstOrigin}/`, false);
      if (resolved) await readSitemap(resolved, visited, pageUrls, 2);
      else discoveryWarnings.push(`robots.txt lists an unusable sitemap URL: ${sitemapUrl}`);
    }
    await readSitemap(`${firstOrigin}/sitemap.xml`, visited, pageUrls, 2);
    for (const url of pageUrls) {
      await considerDiscovered(url, { depth: 1, sourceUrl: null });
    }
    summaryDiscovery.sitemapFilesRead = visited.size;
    summaryDiscovery.sitemapPageUrls = pageUrls.length;
  }

  async function discoverFromLlmsTxt(firstOrigin) {
    if (!settings.useLlmsTxt || maxCrawlDepth < 1) return;
    const llmsUrl = `${firstOrigin}/llms.txt`;
    let text = null;
    try {
      const response = await fetchText(llmsUrl);
      if (response.ok) text = response.text;
      else discoveryWarnings.push(`llms.txt at ${llmsUrl} returned HTTP ${response.statusCode}`);
    } catch (error) {
      discoveryWarnings.push(`llms.txt at ${llmsUrl} could not be fetched (${error.message})`);
    }
    if (text === null) return;
    summaryDiscovery.llmsTxtFound = true;
    const hrefs = extractMarkdownLinks(text);
    for (const href of hrefs) {
      const resolved = resolveAgainst(href, llmsUrl, keepUrlFragments);
      if (!resolved) continue;
      await considerDiscovered(resolved, { depth: 1, sourceUrl: llmsUrl });
    }
  }

  const summaryDiscovery = {
    sitemapFilesRead: 0,
    sitemapPageUrls: 0,
    llmsTxtFound: false,
  };

  // ---- Crawl --------------------------------------------------------------

  for (const startUrl of settings.startUrls) {
    dispositions.set(startUrl, 'queued');
    queue.push({ url: startUrl, depth: 0, sourceUrl: null, isStart: true });
  }

  if (settings.useSitemaps || settings.useLlmsTxt) {
    const firstOrigin = originOf(settings.startUrls[0]);
    await discoverFromSitemaps(firstOrigin);
    await discoverFromLlmsTxt(firstOrigin);
  }

  let stopReason = null;
  let stopReasonDetail = '';

  while (queueIndex < queue.length) {
    if (records.length >= maxCrawlPages) {
      stopReason = STOP_REASONS.MAX_PAGES;
      stopReasonDetail = `Reached maxCrawlPages (${maxCrawlPages}) and stopped immediately.`;
      break;
    }

    const item = queue[queueIndex];
    queueIndex += 1;
    const { url, depth, sourceUrl } = item;

    let page;
    try {
      page = await fetchText(url);
    } catch (error) {
      recordSkipped('fetchFailed', {
        url,
        depth,
        sourceUrl,
        statusCode: null,
        error: error.message,
        detail: `request failed: ${error.message}`,
      });
      continue;
    }

    if (!page.ok) {
      recordSkipped('fetchFailed', {
        url,
        depth,
        sourceUrl,
        statusCode: page.statusCode,
        error: `HTTP ${page.statusCode}`,
        detail: `HTTP ${page.statusCode}`,
      });
      continue;
    }

    // Canonical duplicate check happens before the page is stored so the
    // duplicate never takes a slot under maxCrawlPages.
    if (!settings.ignoreCanonicalUrl) {
      const href = extractCanonicalHref(page.text);
      if (href) {
        const canonicalUrl = normalizeUrl(href, page.finalUrl, { keepFragments: keepUrlFragments });
        if (canonicalUrl && canonicalUrl !== url && crawledUrls.has(canonicalUrl)) {
          recordSkipped('canonicalDuplicate', {
            url,
            depth,
            sourceUrl,
            canonicalUrl,
            detail: `canonical points to already-crawled ${canonicalUrl}`,
          });
          dispositions.set(url, 'duplicate');
          continue;
        }
      }
    }

    const title = extractTitle(page.text);
    const wordCount = countWords(page.text);
    records.push({ url, title, depth, wordCount, httpStatusCode: page.statusCode });
    crawledUrls.add(url);
    dispositions.set(url, 'stored');

    // "Reaching the page cap stops the crawl immediately": do not even read
    // links from the page that filled the last slot.
    if (records.length >= maxCrawlPages) {
      stopReason = STOP_REASONS.MAX_PAGES;
      stopReasonDetail = `Reached maxCrawlPages (${maxCrawlPages}) and stopped immediately.`;
      break;
    }

    const baseHref = extractBaseHref(page.text);
    const baseUrl = baseHref ? normalizeUrl(baseHref, page.finalUrl, { keepFragments: keepUrlFragments }) ?? page.finalUrl : page.finalUrl;
    const childDepth = depth + 1;
    const hrefs = extractAnchorHrefs(page.text);
    for (const href of hrefs) {
      const candidate = normalizeUrl(href, baseUrl, { keepFragments: keepUrlFragments });
      if (!candidate) continue;
      await considerDiscovered(candidate, { depth: childDepth, sourceUrl: url });
    }
  }

  // URLs that were discovered, tracked, and never stored or skipped because
  // the page cap ended the crawl first. They are reported separately so no URL
  // disappears between the records and the skip groups.
  const unvisitedUrls = [...dispositions.entries()]
    .filter(([, state]) => state === 'queued')
    .map(([url]) => url);
  // A depth-limited URL may later have been reached through a shallower path;
  // only URLs still unseen are genuinely beyond the depth cap.
  const genuinelyDepthLimited = depthLimitedUrls.filter((url) => dispositions.get(url) === undefined);

  if (stopReason === null) {
    if (genuinelyDepthLimited.length > 0) {
      stopReason = STOP_REASONS.MAX_DEPTH;
      stopReasonDetail = `Frontier exhausted at maxCrawlDepth ${maxCrawlDepth}; ${genuinelyDepthLimited.length} URL(s) were deeper and not followed.`;
    } else {
      const storedBeyondStarts = records.filter((record) => !itemIsStart(record.url, settings)).length;
      if (skippedSeen.size > 0 && storedBeyondStarts === 0) {
        stopReason = STOP_REASONS.ALL_FILTERED;
        stopReasonDetail = `Nothing beyond the start URLs was stored; all ${skippedSeen.size} discovered URL(s) were skipped.`;
      } else {
        stopReason = STOP_REASONS.NO_MORE_LINKS;
        stopReasonDetail = 'Frontier exhausted: no undiscovered same-domain links left.';
      }
    }
  }

  const totalSkippedUrls = skippedSeen.size;

  return {
    records,
    summary: {
      startUrl: settings.startUrls[0],
      startUrlsSeen: [...settings.startUrls],
      domain,
      stopReason,
      stopReasonDetail,
      maxCrawlDepth,
      maxCrawlPages,
      pagesCrawled: records.length,
      pagesFetched: records.length + skippedCounts.canonicalDuplicate + skippedCounts.fetchFailed,
      uniqueUrlsTracked: records.length + totalSkippedUrls + unvisitedUrls.length + genuinelyDepthLimited.length,
      totalSkippedUrls,
      skippedCounts,
      skippedUrls,
      depthLimitedCount: genuinelyDepthLimited.length,
      depthLimitedUrls: [...genuinelyDepthLimited],
      unvisitedCount: unvisitedUrls.length,
      unvisitedUrls,
      discovery: {
        ...summaryDiscovery,
        warnings: discoveryWarnings,
      },
    },
  };
}

function itemIsStart(url, settings) {
  return settings.startUrls.includes(url);
}

function extractMarkdownLinks(text) {
  const hrefs = [];
  const regexp = /\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  let match;
  while ((match = regexp.exec(text)) !== null) {
    let href = match[1].trim();
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    hrefs.push(href);
  }
  return hrefs;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function integerField(value, defaultValue, name, minimum) {
  if (value === undefined || value === null) return defaultValue;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  return number;
}

function booleanField(value, defaultValue, name) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function stringArrayField(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return value;
}
