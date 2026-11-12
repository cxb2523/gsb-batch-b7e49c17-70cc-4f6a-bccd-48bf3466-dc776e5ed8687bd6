const test = require('node:test');
const assert = require('node:assert/strict');

const { discover, FAILURE_CATEGORIES } = require('../src/discovery');
const { FetchError } = require('../src/fetch/client');

// --- fakes -----------------------------------------------------------------
// A whole discovery run is driven from a hand-written CDX response and a fake
// board client, so no network and no database are involved.

const INDEX_ID = 'CC-MAIN-2026-30';

function cdxLines(paths) {
  return paths.map((url) => JSON.stringify({ url })).join('\n');
}

// `fetchIndex` mirrors src.discovery.fetchCdx: the first call is collinfo.json,
// the second is the CDX query for the source's domain.
function fakeIndex(lines) {
  const calls = [];
  const fetchIndex = async (url) => {
    calls.push(String(url));
    if (String(url).includes('collinfo.json')) return JSON.stringify([{ id: INDEX_ID }]);
    return lines;
  };
  fetchIndex.calls = calls;
  return fetchIndex;
}

// Keyed by the exact slug (so a wrongly-cased SmartRecruiters request is a
// miss); values are the value fetchJobBoard resolves with or throws.
function fakeBoard(behaviour) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchBoard = async (slug, _source) => {
    calls.push(slug);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const outcome = behaviour[slug];
      if (outcome instanceof Error) throw outcome;
      return outcome ?? { jobs: [] };
    } finally {
      inFlight--;
    }
  };
  fetchBoard.calls = calls;
  fetchBoard.maxInFlight = () => maxInFlight;
  return fetchBoard;
}

function fakeStore({ trackedSlugs = [], failRead = false } = {}) {
  const writes = [];
  const state = {
    writes,
    initDbCalls: 0,
    initDb: async () => {
      state.initDbCalls++;
    },
    getPool: () => ({
      query: async () => {
        if (failRead) throw new Error('database is not reachable');
        return { rows: trackedSlugs.map((slug) => ({ slug })) };
      },
    }),
    upsertCompany: async (name, slug, source) => {
      writes.push({ name, slug, source });
    },
  };
  return state;
}

function run(source, paths, behaviour, { dryRun = false, verifyLimit = 300, trackedSlugs = [], failRead = false, registry = [] } = {}) {
  const fetchIndex = fakeIndex(cdxLines(paths));
  const fetchBoard = fakeBoard(behaviour);
  const store = fakeStore({ trackedSlugs, failRead });
  const result = discover(
    source,
    { cdxLimit: 100, verifyLimit, dryRun },
    { fetchIndex, fetchBoard, store, loadRegistry: () => registry }
  );
  return { result, fetchBoard, store, fetchIndex };
}

// Compact view of the stats that the task asks to be verifiable.
function stats(r) {
  return {
    candidates: r.candidates,
    excluded: r.excluded,
    verified: r.verified,
    written: r.written,
    failed: r.failed,
  };
}

const apiError = (slug) => new FetchError(`Fetch failed for ${slug} (ashby): HTTP 500`, slug, 500, true, 'http');
const badStructure = (slug) =>
  new FetchError(`Invalid response structure for ${slug} (ashby)`, slug, 200, false, 'invalid-structure');

// --- the acceptance run ----------------------------------------------------

test('one run: dedupe, case folding, every failure bucket, one write per success', async () => {
  const paths = [
    'https://jobs.ashbyhq.com/acme/1',
    'https://jobs.ashbyhq.com/acme/2',       // duplicate slug
    'https://jobs.ashbyhq.com/Acme/careers', // case variant of the same board
    'https://jobs.ashbyhq.com/beta/1',
    'https://jobs.ashbyhq.com/gamma/1',
    'https://jobs.ashbyhq.com/delta/1',
    'https://jobs.ashbyhq.com/epsilon/1',
  ];
  const behaviour = {
    acme: { jobs: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    beta: apiError('beta'),
    gamma: badStructure('gamma'),
    delta: { jobs: [] },
    epsilon: { jobs: [{ id: 1 }] },
  };

  const { result, fetchBoard, store } = await run('ashby', paths, behaviour);
  const r = await result;

  // Candidates are counted after dedupe (one entry for acme/Acme).
  assert.deepEqual(stats(r), { candidates: 5, excluded: 0, verified: 5, written: 2, failed: 3 });
  assert.equal(r.duplicateEntries, 2, 'two duplicate/case-variant URLs were collapsed');

  // Every slug is requested exactly once, in canonical lowercase form.
  assert.deepEqual(fetchBoard.calls, ['acme', 'beta', 'gamma', 'delta', 'epsilon']);
  assert.equal(new Set(fetchBoard.calls).size, fetchBoard.calls.length);

  // Writes match successes exactly, and carry a canonical (lowercased) slug.
  assert.equal(store.writes.length, r.written);
  assert.deepEqual(store.writes.map((w) => w.slug), ['acme', 'epsilon']);

  // Failure buckets and their slugs are exact.
  assert.deepEqual(r.failures['api-error'], ['beta']);
  assert.deepEqual(r.failures['invalid-structure'], ['gamma']);
  assert.deepEqual(r.failures['no-jobs'], ['delta']);
  assert.equal(r.failed, 3);
  // Every verified slug is a write, a classified failure, or a write failure.
  assert.equal(r.verified, r.written + r.failed + r.writeFailed);
  assert.equal(r.failed, Object.values(r.failures).reduce((n, list) => n + list.length, 0));
  assert.deepEqual(r.failureDetails.map((f) => [f.slug, f.category]), [
    ['beta', 'api-error'],
    ['gamma', 'invalid-structure'],
    ['delta', 'no-jobs'],
  ]);
  // The reason is kept, not just the category.
  assert.match(r.failureDetails[0].reason, /HTTP 500/);
  assert.match(r.failureDetails[1].reason, /Invalid response structure/);

  // Verification stays batched (concurrency 5), not serialised.
  assert.ok(fetchBoard.maxInFlight() > 1, `expected concurrent verification, saw max ${fetchBoard.maxInFlight()}`);
  assert.ok(fetchBoard.maxInFlight() <= 5);
});

test('already-tracked slugs are excluded case-insensitively (registry and DB)', async () => {
  const paths = [
    'https://jobs.ashbyhq.com/Acme/1',
    'https://jobs.ashbyhq.com/beta/1',
  ];
  const behaviour = { beta: { jobs: [{ id: 1 }] } };

  // "ACME" in the DB, "Acme" in the registry — candidate is "Acme"/"acme";
  // none of these casings may count as a new company.
  const { result, fetchBoard } = await run('ashby', paths, behaviour, {
    trackedSlugs: ['ACME'],
    registry: [{ company: 'Acme', slug: 'Acme', source: 'ashby' }],
  });
  const r = await result;

  assert.deepEqual(stats(r), { candidates: 2, excluded: 1, verified: 1, written: 1, failed: 0 });
  assert.deepEqual(fetchBoard.calls, ['beta']);
});

test('SmartRecruiters keeps its case for the request and the write, but dedupes case-insensitively', async () => {
  const paths = [
    'https://jobs.smartrecruiters.com/BMWDealerCareers/123',
    'https://jobs.smartrecruiters.com/bmwdealercareers/456',
    'https://jobs.smartrecruiters.com/bMwDealerCareers/jobs',
  ];
  // Only the exact-cased identifier answers — a lowercased request would
  // throw here, which is the real API's behaviour.
  const behaviour = { BMWDealerCareers: { jobs: [{ id: 1 }, { id: 2 }] } };

  const { result, fetchBoard, store } = await run('smartrecruiters', paths, behaviour);
  const r = await result;

  assert.deepEqual(stats(r), { candidates: 1, excluded: 0, verified: 1, written: 1, failed: 0 });
  assert.deepEqual(fetchBoard.calls, ['BMWDealerCareers']);
  assert.deepEqual(store.writes.map((w) => w.slug), ['BMWDealerCareers']);
});

test('a tracked SmartRecruiters board is excluded regardless of crawled casing', async () => {
  const paths = ['https://jobs.smartrecruiters.com/BMWDealerCareers/1'];
  const { result, fetchBoard } = await run('smartrecruiters', paths, {}, {
    trackedSlugs: ['bmwdealercareers'],
  });
  const r = await result;

  assert.deepEqual(stats(r), { candidates: 1, excluded: 1, verified: 0, written: 0, failed: 0 });
  assert.deepEqual(fetchBoard.calls, []);
});

test('dry-run writes nothing and reports identical stats to the real run', async () => {
  const paths = [
    'https://jobs.ashbyhq.com/acme/1',
    'https://jobs.ashbyhq.com/acme/2',
    'https://jobs.ashbyhq.com/beta/1',
    'https://jobs.ashbyhq.com/delta/1',
    'https://jobs.ashbyhq.com/epsilon/1',
  ];
  const behaviour = {
    acme: { jobs: [{ id: 1 }] },
    beta: apiError('beta'),
    delta: { jobs: [] },
    epsilon: { jobs: [{ id: 1 }, { id: 2 }] },
  };

  const real = await run('ashby', paths, behaviour);
  const realRun = await real.result;

  const dry = await run('ashby', paths, behaviour, { dryRun: true });
  const dryRun = await dry.result;

  assert.equal(dry.store.writes.length, 0, 'dry-run must not upsert companies');
  assert.equal(dry.store.initDbCalls, 0, 'dry-run must not run schema migrations');
  assert.equal(real.store.initDbCalls, 1);
  assert.equal(real.store.writes.length, realRun.written);

  // Same counting rules: "written" means "would be written".
  assert.deepEqual(stats(dryRun), stats(realRun));
  assert.deepEqual(dryRun.failures, realRun.failures);
  assert.deepEqual(dry.fetchBoard.calls, real.fetchBoard.calls);
  assert.equal(dryRun.dryRun, true);
});

test('dry-run falls back to the registry when the database is unreachable', async () => {
  const paths = ['https://jobs.ashbyhq.com/acme/1', 'https://jobs.ashbyhq.com/beta/1'];
  const behaviour = { beta: { jobs: [{ id: 1 }] } };

  const { result, store } = await run('ashby', paths, behaviour, {
    dryRun: true,
    failRead: true,
    registry: [{ company: 'Acme', slug: 'acme', source: 'ashby' }],
  });
  const r = await result;

  assert.deepEqual(stats(r), { candidates: 2, excluded: 1, verified: 1, written: 1, failed: 0 });
  assert.equal(store.writes.length, 0);
});

test('verifyLimit truncates verification but keeps the counts consistent', async () => {
  // Not "b": that's an Ashby app route (jobs.ashbyhq.com/b), not a company slug
  // — ASHBY_RESERVED_PATHS drops it before it ever becomes a candidate.
  const paths = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((s) => `https://jobs.ashbyhq.com/${s}/1`);
  const behaviour = {
    alpha: { jobs: [{ id: 1 }] },
    bravo: { jobs: [] },
  };

  const { result, fetchBoard } = await run('ashby', paths, behaviour, { verifyLimit: 2 });
  const r = await result;

  assert.deepEqual(stats(r), { candidates: 5, excluded: 0, verified: 2, written: 1, failed: 1 });
  assert.deepEqual(fetchBoard.calls, ['alpha', 'bravo']);
  assert.equal(r.unknown, 5);
});

test('a failing write is not counted as a success and is reported separately', async () => {
  const paths = ['https://jobs.ashbyhq.com/acme/1'];
  const behaviour = { acme: { jobs: [{ id: 1 }] } };
  const fetchIndex = fakeIndex(cdxLines(paths));
  const fetchBoard = fakeBoard(behaviour);
  const store = fakeStore();
  store.upsertCompany = async (name, slug, source) => {
    throw new Error(`insert failed for ${slug} (${source})`);
  };

  const r = await discover('ashby', { cdxLimit: 100, verifyLimit: 300, dryRun: false }, {
    fetchIndex, fetchBoard, store, loadRegistry: () => [],
  });

  // Verification succeeded but the write did not: it must not be counted as a
  // write, and it must not be blamed on the board's API either.
  assert.deepEqual(stats(r), { candidates: 1, excluded: 0, verified: 1, written: 0, failed: 0 });
  assert.equal(r.writeFailed, 1);
  assert.deepEqual(r.writeFailureDetails.map((f) => f.slug), ['acme']);
  assert.deepEqual(r.failures['api-error'], []);
  assert.ok(r.verified === r.written + r.failed + r.writeFailed);
});

test('failure categories are exactly the three documented buckets', () => {
  assert.deepEqual(FAILURE_CATEGORIES, ['api-error', 'invalid-structure', 'no-jobs']);
});
