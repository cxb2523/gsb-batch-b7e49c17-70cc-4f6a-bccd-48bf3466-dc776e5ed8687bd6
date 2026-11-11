import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickUserAgent,
  maybeRefreshUaPool,
  _resetUaPoolForTest,
  _setUaPoolFetchedAt,
  _getUaPool,
  _UA_SEED_POOL,
} from '../lib/user-agent.js';

const SAVED_ENV = {};
function clearEnv() {
  for (const k of ['PULLMD_USER_AGENT', 'PULLMD_UA_FEED_URL']) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
}
function restoreEnv() {
  for (const k of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
}

function fakeFeed(uas) {
  return {
    user_agents: uas.map((ua) => ({
      ua,
      device_type: 'computer',
      browser: { name: 'X', version: '1' },
      os: { name: 'Y', version: '1' },
    })),
  };
}

describe('user-agent — seed pool', () => {
  beforeEach(() => { clearEnv(); _resetUaPoolForTest(); });
  afterEach(() => restoreEnv());

  it('seed pool has at least 5 desktop UAs', () => {
    assert.ok(_UA_SEED_POOL.length >= 5, `expected >=5 seed UAs, got ${_UA_SEED_POOL.length}`);
    for (const ua of _UA_SEED_POOL) {
      assert.ok(ua.startsWith('Mozilla/'), `seed UA does not start with Mozilla/: ${ua}`);
      assert.ok(!/Mobile|Android|iPhone|iPad/i.test(ua), `seed contains a mobile UA: ${ua}`);
    }
  });

  it('pickUserAgent() returns a string that looks like a real UA', () => {
    const ua = pickUserAgent();
    assert.equal(typeof ua, 'string');
    assert.ok(ua.startsWith('Mozilla/5.0'));
    assert.ok(ua.length >= 40);
  });

  it('pickUserAgent() varies across many calls (random selection from pool)', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(pickUserAgent());
    assert.ok(seen.size >= 2, `expected >=2 distinct UAs in 50 calls, got ${seen.size}`);
  });
});

describe('user-agent — PULLMD_USER_AGENT override', () => {
  beforeEach(() => { clearEnv(); _resetUaPoolForTest(); });
  afterEach(() => restoreEnv());

  it('always returns the override when PULLMD_USER_AGENT is set', () => {
    process.env.PULLMD_USER_AGENT = 'CustomBot/2.0 (+https://example.com)';
    for (let i = 0; i < 20; i++) {
      assert.equal(pickUserAgent(), 'CustomBot/2.0 (+https://example.com)');
    }
  });
});

describe('user-agent — live refresh', () => {
  beforeEach(() => { clearEnv(); _resetUaPoolForTest(); });
  afterEach(() => restoreEnv());

  it('fetches the feed when TTL has expired and replaces the pool', async () => {
    const fresh = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:200.0) Gecko/20100101 Firefox/200.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/30.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/199.0.0.0 Safari/537.36',
    ];
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => fakeFeed(fresh) }; };
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.equal(calls, 1, 'should hit the feed exactly once');
    assert.deepEqual(_getUaPool(), fresh);
  });

  it('skips the fetch when within TTL', async () => {
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => fakeFeed([
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:200.0) Gecko/20100101 Firefox/200.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/30.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/199.0.0.0 Safari/537.36',
    ]) }; };
    await maybeRefreshUaPool({ fetch: fetchFn });
    await maybeRefreshUaPool({ fetch: fetchFn });
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.equal(calls, 1, 'TTL should suppress the second and third refresh');
  });

  it('refreshes again after TTL expiry', async () => {
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => fakeFeed([
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:200.0) Gecko/20100101 Firefox/200.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/30.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/199.0.0.0 Safari/537.36',
    ]) }; };
    await maybeRefreshUaPool({ fetch: fetchFn });
    _setUaPoolFetchedAt(Date.now() - 49 * 60 * 60 * 1000); // pretend 49h have passed
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.equal(calls, 2);
  });

  it('keeps the existing pool when the feed errors', async () => {
    const before = _getUaPool();
    const fetchFn = async () => { throw new Error('network down'); };
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.deepEqual(_getUaPool(), before, 'pool must be unchanged on error');
    assert.ok(_getUaPool().length >= 5);
  });

  it('keeps the existing pool when the feed returns fewer than 5 desktop UAs', async () => {
    const before = _getUaPool();
    const fetchFn = async () => ({ ok: true, json: async () => fakeFeed([
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:200.0) Gecko/20100101 Firefox/200.0',
    ]) });
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.deepEqual(_getUaPool(), before, 'pool must be unchanged when feed is too small');
  });

  it('filters out mobile UAs from the feed', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        user_agents: [
          { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36', device_type: 'computer' },
          { ua: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Mobile Safari/537.36', device_type: 'mobile' },
          { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:200.0) Gecko/20100101 Firefox/200.0', device_type: 'computer' },
          { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36', device_type: 'computer' },
          { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:200.0) Gecko/20100101 Firefox/200.0', device_type: 'computer' },
          { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/30.0 Safari/605.1.15', device_type: 'computer' },
          { ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15', device_type: 'tablet' },
        ],
      }),
    });
    await maybeRefreshUaPool({ fetch: fetchFn });
    const pool = _getUaPool();
    assert.equal(pool.length, 5, 'only computer UAs should land in the pool');
    assert.ok(!pool.some((ua) => /Mobile|iPad/.test(ua)), 'no mobile/tablet UAs allowed');
  });
});

describe('user-agent — PULLMD_UA_FEED_URL', () => {
  beforeEach(() => { clearEnv(); _resetUaPoolForTest(); });
  afterEach(() => restoreEnv());

  it('empty string disables live refresh entirely', async () => {
    process.env.PULLMD_UA_FEED_URL = '';
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => fakeFeed([]) }; };
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.equal(calls, 0, 'feed must not be hit when explicitly disabled');
  });

  it('custom URL is used as the feed source', async () => {
    process.env.PULLMD_UA_FEED_URL = 'https://example.com/my-feed.json';
    let seenUrl = null;
    const fetchFn = async (url) => {
      seenUrl = url;
      return { ok: true, json: async () => fakeFeed([
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:200.0) Gecko/20100101 Firefox/200.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/30.0 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/200.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/199.0.0.0 Safari/537.36',
      ]) };
    };
    await maybeRefreshUaPool({ fetch: fetchFn });
    assert.equal(seenUrl, 'https://example.com/my-feed.json');
  });
});
