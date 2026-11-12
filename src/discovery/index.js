const { logger, delay } = require('../utils');
const { fetchJobBoard, FetchError } = require('../fetch');
const { loadRegistry, isValidSlug, normalizeSlug, slugKey, CASE_SENSITIVE_SOURCES } = require('../sources');
const store = require('../store');

// Domains here share one hosted job-board domain with a path-based company slug
// (jobs.ashbyhq.com/{slug}), which is what slugFromCrawledUrl()'s path-segment
// extraction assumes — confirmed indexed by Common Crawl and CCBot-permitted in
// robots.txt for all four. Lever explicitly blocks CCBot in robots.txt, so it has
// no free crawl index to query and isn't supported here (use search-engine
// `site:jobs.lever.co` queries for that one instead).
const CDX_DOMAINS = {
  ashby: 'jobs.ashbyhq.com',
  greenhouse: 'job-boards.greenhouse.io',
  workable: 'apply.workable.com',
  smartrecruiters: 'jobs.smartrecruiters.com',
};

// These give each company its own subdomain (acme.recruitee.com) instead of a
// path slug. Common Crawl indexes only 1-5 CDX pages per domain for them, so
// every page is read — full coverage, unlike the single capped request the
// path-based domains above get.
const CDX_SUBDOMAIN_DOMAINS = {
  recruitee: 'recruitee.com',
  teamtailor: 'teamtailor.com',
  pinpoint: 'pinpointhq.com',
  workday: 'myworkdayjobs.com',
  keka: 'keka.com',
};

// Bounds the requests per run if one of those indexes ever balloons.
const MAX_CDX_PAGES = 10;

// The providers' own sites on those domains, not company boards.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'auth', 'blog', 'docs', 'help', 'jobs', 'status', 'support']);

// Paths on jobs.ashbyhq.com that are Ashby app routes, not company slugs (see its robots.txt).
const ASHBY_RESERVED_PATHS = new Set(['meeting', 'b', 'api']);

// SmartRecruiters company identifiers are case-sensitive (e.g. "BMWDealerCareers") —
// every other source's slug is lowercase-insensitive. The rule itself lives in
// src/sources (normalizeSlug/slugKey) so discovery, the registry and the store
// can't drift apart; CASE_SENSITIVE_SOURCES is re-exported here for callers.

const VERIFY_CONCURRENCY = 5;
const VERIFY_DELAY_MS = 300;

// Common Crawl's index server sheds load with 502/503/504s and dropped
// connections. From a GitHub runner it started refusing every request after
// about 8 in two minutes (2026-10-07), and 5-10s retries all failed. It wants
// clients to slow down, so wait 15s, 30s, then 60s, or as long as Retry-After asks.
const CDX_ATTEMPTS = 4;

async function fetchCdx(url) {
  let lastError;
  for (let attempt = 1; attempt <= CDX_ATTEMPTS; attempt++) {
    let waitMs = 15000 * 2 ** (attempt - 1);
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastError = new Error(`Common Crawl returned HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) waitMs = Math.min(retryAfter, 120) * 1000;
    } catch (err) {
      lastError = err;
    }
    if (attempt < CDX_ATTEMPTS) {
      logger.warn(`Common Crawl request failed (${lastError.message}); retrying in ${waitMs / 1000}s`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

async function getLatestCdxIndexId(fetchIndex = fetchCdx) {
  const data = JSON.parse(await fetchIndex('https://index.commoncrawl.org/collinfo.json'));
  return data[0].id;
}

// The company identifier a crawled URL points at, in the form fetchJobBoard
// expects, or null if it isn't a company board.
function slugFromCrawledUrl(source, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  let slug;
  const subdomainDomain = CDX_SUBDOMAIN_DOMAINS[source];
  if (!subdomainDomain) {
    slug = url.pathname.split('/').filter(Boolean)[0];
  } else {
    if (!url.hostname.endsWith(`.${subdomainDomain}`)) return null;
    const labels = url.hostname.slice(0, -subdomainDomain.length - 1).split('.');
    if (source === 'workday') {
      // acme.wd5.myworkdayjobs.com/en-US/Careers/job/... — the site is the
      // first path segment after an optional locale.
      const segments = url.pathname.split('/').filter(Boolean);
      const site = /^[a-z]{2}(-[a-z]{2})?$/i.test(segments[0] ?? '') ? segments[1] : segments[0];
      if (labels.length !== 2 || !/^wd\d+$/.test(labels[1]) || !site) return null;
      slug = `${labels[0]}/${labels[1]}/${site}`;
    } else if (source === 'teamtailor' && labels.length === 2 && labels[1] === 'na') {
      slug = labels.join('.');
    } else {
      if (labels.length !== 1 || RESERVED_SUBDOMAINS.has(labels[0])) return null;
      // Every Keka customer has acme.keka.com (its HR app); only /careers is a job board.
      if (source === 'keka' && !url.pathname.toLowerCase().startsWith('/careers')) return null;
      slug = labels[0];
    }
  }

  if (!slug) return null;
  if (source === 'ashby' && ASHBY_RESERVED_PATHS.has(slug.toLowerCase())) return null;
  // Common Crawl URLs occasionally decode into garbage (stray punctuation from a
  // query string bleeding into the path) — the registry's own slug rule rejects
  // those before they ever hit the live API.
  if (!isValidSlug(slug, source)) return null;
  return normalizeSlug(slug, source);
}

// Common Crawl's CDX API returns newline-delimited JSON, one crawled URL per line.
async function fetchCandidateSlugs(source, cdxLimit, fetchIndex = fetchCdx) {
  const indexId = await getLatestCdxIndexId(fetchIndex);
  const endpoint = `https://index.commoncrawl.org/${indexId}-index`;
  const responses = [];

  const subdomainDomain = CDX_SUBDOMAIN_DOMAINS[source];
  if (subdomainDomain) {
    const query = new URLSearchParams({ url: `*.${subdomainDomain}`, output: 'json', fl: 'url' });
    const { pages } = JSON.parse(await fetchIndex(`${endpoint}?${query}&showNumPages=true`));
    if (pages > MAX_CDX_PAGES) logger.warn(`Reading ${MAX_CDX_PAGES} of ${pages} Common Crawl pages for ${subdomainDomain}`);
    for (let page = 0; page < Math.min(pages, MAX_CDX_PAGES); page++) {
      // A page that still fails after retries (Workday's are several MB and
      // time out) costs only its own candidates, not the whole run's.
      try {
        responses.push(await fetchIndex(`${endpoint}?${query}&page=${page}`));
      } catch (err) {
        logger.warn(`Skipping Common Crawl page ${page + 1}/${pages} for ${subdomainDomain}: ${err.message}`);
      }
    }
  } else {
    const url = new URL(endpoint);
    url.searchParams.set('url', `${CDX_DOMAINS[source]}/*`);
    url.searchParams.set('output', 'json');
    url.searchParams.set('limit', cdxLimit);
    responses.push(await fetchIndex(url));
  }

  // One entry per (case-folded) slug: Common Crawl's pages overlap and the same
  // board is crawled under many paths, so dedupe on identity — not on the raw
  // string — keeps the first-seen canonical spelling (SmartRecruiters' casing,
  // every other source lowercased) and guarantees each slug is verified once.
  const slugs = new Map(); // slugKey -> canonical slug
  let duplicateEntries = 0;
  for (const line of responses.join('\n').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const slug = slugFromCrawledUrl(source, entry.url);
    if (!slug) continue;
    const key = slugKey(slug, source);
    if (slugs.has(key)) {
      duplicateEntries++;
      continue;
    }
    slugs.set(key, slug);
  }
  return { slugs: [...slugs.values()], duplicateEntries };
}

async function getKnownSlugs(source, companyStore = store, registryLoader = loadRegistry, { tolerateDbError = false } = {}) {
  const known = new Set();
  // Registry and DB are both case-folded regardless of source: a board we
  // already track must be excluded even when the crawled casing differs
  // ("Notion" vs "notion", "BMWDealerCareers" vs "bmwdealercareers").
  for (const c of registryLoader()) {
    if ((c.source || 'ashby') === source) known.add(slugKey(c.slug, source));
  }
  try {
    const pool = companyStore.getPool();
    const { rows } = await pool.query('SELECT slug FROM companies WHERE source = $1', [source]);
    for (const row of rows) known.add(slugKey(row.slug, source));
  } catch (err) {
    // A real run calls initDb() first, so a failed read means the database is
    // genuinely unhealthy and the upserts would fail too — surface it. A dry
    // run doesn't set the schema up (that's a write) and must still preview,
    // so it falls back to the registry.
    if (!tolerateDbError) throw err;
    logger.warn(`Could not read tracked companies from the database: ${err.message}`);
  }
  return known;
}

// The slug, capitalized — minus Workday's wdHost/site segments and
// Teamtailor's region suffix, which aren't part of the company's name.
function companyName(slug, source) {
  const name = source === 'workday' ? slug.split('/')[0] : slug.replace(/\.na$/, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// How a failed verification is reported. The three verification outcomes are:
//   api-error         — the request/response failed (HTTP status, timeout,
//                       network, bad JSON, unknown source)
//   invalid-structure — the endpoint answered, but the body had no jobs array
//   no-jobs           — the endpoint answered correctly with an empty list
// "no-jobs" isn't an operational error — the board is live, it just has nothing
// open — but it still didn't become a tracked company, so it counts as a failure.
// A database-side write failure is *not* a verification outcome and so isn't one
// of these buckets; it's reported separately (see writeFailures in the result) so
// a DB outage is never mislabelled as a board problem.
const FAILURE_CATEGORY_API_ERROR = 'api-error';
const FAILURE_CATEGORY_INVALID_STRUCTURE = 'invalid-structure';
const FAILURE_CATEGORY_NO_JOBS = 'no-jobs';

function failureCategory(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'invalid-structure') return FAILURE_CATEGORY_INVALID_STRUCTURE;
  // A FetchError from src/fetch/client.js always carries a code, but a caller
  // substituting fetchJobBoard (tests, tooling) may throw a plain Error with
  // the same wording. Honour it rather than mislabel it as an API error.
  if (err instanceof FetchError && /Invalid response structure/i.test(err.message)) {
    return FAILURE_CATEGORY_INVALID_STRUCTURE;
  }
  return FAILURE_CATEGORY_API_ERROR;
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

// Verifies each unverified slug against the live posting API and, if it has
// open jobs, records it — either printed (--dry-run) or upserted into the
// companies table, which getEnabledCompaniesWithDb() already picks up on the
// next scrape run without any registry.json edit.
//
// Input is deduplicated by identity (slugKey) as a second line of defence behind
// fetchCandidateSlugs(): duplicate URLs can otherwise resolve to the same board
// and Promise.allSettled would request it in two slots of one batch, then upsert
// it twice. The write itself is also guarded, so a slug is written at most once.
async function verifyAndAdd(slugs, source, { dryRun }, { fetchBoard = fetchJobBoard, companyStore = store } = {}) {
  const unique = [];
  const seen = new Set();
  for (const slug of slugs) {
    const key = slugKey(slug, source);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slug);
  }

  const succeeded = [];
  const failures = [];
  const writeFailures = [];
  let checked = 0;

  for (let i = 0; i < unique.length; i += VERIFY_CONCURRENCY) {
    const batch = unique.slice(i, i + VERIFY_CONCURRENCY);
    // allSettled, not all: one dead board must not cancel the rest of its batch.
    // The async arrow also turns a synchronous throw from an injected client
    // into a rejected promise instead of aborting the whole batch.
    const results = await Promise.allSettled(
      batch.map(async (slug) => fetchBoard(slug, source))
    );

    for (let j = 0; j < results.length; j++) {
      const slug = batch[j];
      const result = results[j];
      checked++;

      if (result.status === 'rejected') {
        failures.push({ slug, category: failureCategory(result.reason), reason: errorMessage(result.reason) });
        continue;
      }

      const data = result.value;
      if (!data || !Array.isArray(data.jobs)) {
        // fetchJobBoard already rejects this, but a different implementation
        // may resolve with a malformed envelope — classify it the same way.
        failures.push({
          slug,
          category: FAILURE_CATEGORY_INVALID_STRUCTURE,
          reason: `Response has no jobs array for ${slug} (${source})`,
        });
        continue;
      }

      const jobCount = data.jobs.length;
      if (jobCount === 0) {
        failures.push({ slug, category: FAILURE_CATEGORY_NO_JOBS, reason: `${slug} (${source}) has no open jobs` });
        continue;
      }

      try {
        if (dryRun) {
          logger.info(`[dry-run] would add "${slug}" (${source}, ${jobCount} jobs)`);
        } else {
          await companyStore.upsertCompany(companyName(slug, source), slug, source);
          logger.info(`Added "${slug}" (${source}, ${jobCount} jobs)`);
        }
        succeeded.push({ slug, jobCount });
      } catch (err) {
        // The board is real, but nothing was written; report it as a write
        // failure rather than a success so written === successes.
        writeFailures.push({ slug, reason: errorMessage(err) });
      }
    }

    if (i + VERIFY_CONCURRENCY < unique.length) await delay(VERIFY_DELAY_MS);
  }

  return { checked, succeeded, failures, writeFailures };
}

// Aggregates the per-slug failures into the counters and the slug lists ops
// reads in the logs / workflow summary.
function summarizeFailures(failures) {
  const byCategory = {
    [FAILURE_CATEGORY_API_ERROR]: [],
    [FAILURE_CATEGORY_INVALID_STRUCTURE]: [],
    [FAILURE_CATEGORY_NO_JOBS]: [],
  };
  for (const failure of failures) {
    (byCategory[failure.category] ??= []).push(failure.slug);
  }
  return byCategory;
}

async function discoverCompanies({ source, cdxLimit = 3000, verifyLimit = 300, dryRun = false }) {
  return discover(source, { cdxLimit, verifyLimit, dryRun });
}

// The implementation, with its side effects injectable so a test can drive a
// whole run against a fake CDX index and a fake board client. discoverCompanies
// keeps the public shape and wires the real ones.
async function discover(source, { cdxLimit, verifyLimit, dryRun }, deps = {}) {
  const fetchIndex = deps.fetchIndex ?? fetchCdx;
  const fetchBoard = deps.fetchBoard ?? fetchJobBoard;
  const companyStore = deps.store ?? store;
  const registryLoader = deps.loadRegistry ?? loadRegistry;

  const crawled = CDX_DOMAINS[source] ?? (CDX_SUBDOMAIN_DOMAINS[source] && `*.${CDX_SUBDOMAIN_DOMAINS[source]}`);
  if (!crawled) {
    const supported = [...Object.keys(CDX_DOMAINS), ...Object.keys(CDX_SUBDOMAIN_DOMAINS)];
    throw new Error(`Unsupported source "${source}" — must be one of: ${supported.join(', ')}`);
  }

  logger.info(`Fetching crawled URLs for ${crawled} from Common Crawl...`);
  const { slugs: candidates, duplicateEntries } = await fetchCandidateSlugs(source, cdxLimit, fetchIndex);
  logger.info(
    `${candidates.length} unique candidate slugs found` +
    (duplicateEntries > 0 ? ` (${duplicateEntries} duplicate/case-variant URLs collapsed)` : '')
  );

  // initDb() runs schema migrations — a write. A dry run must not touch the
  // database at all, so it skips this and reads whatever is already there
  // (getKnownSlugs falls back to the registry if the DB isn't reachable).
  if (dryRun) {
    logger.info('[dry-run] skipping database initialization (no writes)');
  } else {
    await companyStore.initDb();
  }

  const known = await getKnownSlugs(source, companyStore, registryLoader, { tolerateDbError: dryRun });
  const unknown = candidates.filter((slug) => !known.has(slugKey(slug, source)));
  const excluded = candidates.length - unknown.length;
  logger.info(`${excluded} already tracked, ${unknown.length} new — verifying up to ${verifyLimit} live`);

  const toVerify = unknown.slice(0, verifyLimit);
  const { checked, succeeded, failures, writeFailures } = await verifyAndAdd(
    toVerify, source, { dryRun }, { fetchBoard, companyStore }
  );
  const failuresByCategory = summarizeFailures(failures);

  // Per-slug lines, not just counts: the point of the summary is that an
  // operator can see which candidate failed and why without re-running.
  if (failures.length > 0) {
    logger.warn(
      `Verification failures: ${failures.length} (` +
      `${FAILURE_CATEGORY_API_ERROR}=${failuresByCategory[FAILURE_CATEGORY_API_ERROR].length}, ` +
      `${FAILURE_CATEGORY_INVALID_STRUCTURE}=${failuresByCategory[FAILURE_CATEGORY_INVALID_STRUCTURE].length}, ` +
      `${FAILURE_CATEGORY_NO_JOBS}=${failuresByCategory[FAILURE_CATEGORY_NO_JOBS].length})`
    );
    for (const failure of failures) {
      logger.warn(`  [${failure.category}] ${failure.slug} — ${failure.reason}`);
    }
  }
  for (const failure of writeFailures) {
    logger.error(`  [write-error] ${failure.slug} — ${failure.reason}`);
  }

  logger.info(
    `Discovery summary (${source}): candidates=${candidates.length}, excluded=${excluded}, ` +
    `verified=${checked}, ${dryRun ? 'would-write' : 'written'}=${succeeded.length}, ` +
    `failed=${failures.length}${writeFailures.length ? `, write-failures=${writeFailures.length}` : ''}`
  );

  return {
    source,
    dryRun,
    // Counts ops asked for: candidates after dedupe, already-tracked
    // exclusions, slugs actually verified, successful writes, failures.
    // Invariant: verified === written + failed + writeFailures.length.
    candidates: candidates.length,
    excluded,
    unknown: unknown.length,
    verified: checked,
    written: succeeded.length,
    failed: failures.length,
    writeFailed: writeFailures.length,
    // URLs that resolved to an already-seen slug: the dedupe stage's saving.
    duplicateEntries,
    // Backwards-compatible aliases for callers of the old result shape
    // (`checked` was the verified count, `added` the successful count).
    checked,
    added: succeeded.length,
    // Which slug fell into which bucket, plus the reason per slug.
    failures: failuresByCategory,
    failureDetails: failures,
    writeFailureDetails: writeFailures,
    addedSlugs: succeeded,
  };
}

module.exports = {
  discoverCompanies,
  // Exposed for tests: a whole run against a fake CDX index / board client.
  discover,
  slugFromCrawledUrl,
  CASE_SENSITIVE_SOURCES,
  FAILURE_CATEGORIES: [
    FAILURE_CATEGORY_API_ERROR,
    FAILURE_CATEGORY_INVALID_STRUCTURE,
    FAILURE_CATEGORY_NO_JOBS,
  ],
};
