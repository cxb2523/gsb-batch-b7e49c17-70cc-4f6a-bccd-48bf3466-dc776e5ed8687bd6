// Security regression suite for the leaderboard / report Worker (server/src/index.js).
//
// The API is cross-origin by design and its only write-side gatekeepers are:
//   1. the Origin check on POSTs (browsers always send Origin cross-origin; a foreign one is
//      refused before anything runs),
//   2. the fixed-window rate limits keyed by a salted hash of CF-Connecting-IP,
//   3. the request-shape checks (JSON content type, 2 KB body cap),
//   4. the per-tag secret and the run plausibility bounds on /api/score.
// Origin can be forged by any non-browser client, so these tests lock the *layered* boundary:
// who can write, and how much they can write, when one layer is bypassed or absent.
//
// Everything runs against the in-memory FakeD1 (real schema.sql on node:sqlite) with an
// injected `now`; no real network and no real D1. Client IPs are simulated exclusively via
// the CF-Connecting-IP header, exactly as Cloudflare sets it.
//
// Run with: npx vitest run server/test/security.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import worker, { handle, MAX_BODY_BYTES } from '../src/index.js';
import { hashIp } from '../src/crypto.js';
import { ipBucket } from '../src/rate.js';
import { FakeD1 } from './fakeD1.js';

const ORIGIN = 'https://game.example';
const EVIL = 'https://evil.example';
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const HOUR = 3600 * 1000;

function makeEnv(extra = {}) {
  return {
    DB: new FakeD1(),
    IP_SALT: 'test-salt',
    ALLOWED_ORIGINS: `${ORIGIN},https://other-game.example`,
    ...extra,
  };
}

// IP is only ever set through CF-Connecting-IP; `origin: null` means the header is absent
// (a curl / server-to-server call), not an empty one.
function req(method, path, { body, headers = {}, ip = '198.51.100.1', origin = ORIGIN, raw } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined || raw !== undefined) h['Content-Type'] ??= 'application/json';
  return new Request(`https://api.example${path}`, {
    method,
    headers: h,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function call(env, method, path, opts = {}, now = T0) {
  const res = await handle(req(method, path, opts), env, { waitUntil() {} }, now);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const count = (env, table) => env.DB.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const rateRows = (env, bucket) => env.DB.rows('SELECT * FROM rate WHERE bucket = ?', bucket);

const RUN = { round: 5, kills: 70, headshots: 10, points: 5000, timeSec: 200, version: '0.2.0', device: 'desktop' };

// ---------------------------------------------------------------- foreign Origin

describe('origin boundary (who can write)', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('POST with an Origin outside ALLOWED_ORIGINS is 403 and writes nothing, on every write route', async () => {
    // Attack surface: a browser on evil.example (or a script forging Origin) trying to claim
    // tags, submit scores, recover accounts or file reports cross-origin. The refusal must
    // happen before the handler, so not even a rate-limit row may appear.
    for (const [path, body] of [
      ['/api/claim', { tag: 'Evil' }],
      ['/api/score', { tag: 'Evil', secret: 'e'.repeat(64), run: RUN }],
      ['/api/recover', { tag: 'Evil', recovery: 'AAAA-AAAA-AAAA-AAAA' }],
      ['/api/report', { category: 'bug', message: 'x'.repeat(20) }],
    ]) {
      const r = await call(env, 'POST', path, { body, origin: EVIL });
      expect(r, path).toMatchObject({ status: 403, body: { error: 'origin' } });
      // No CORS headers are granted to the foreign origin, so the browser cannot read even
      // the error body.
      expect(r.headers.get('Access-Control-Allow-Origin'), path).toBeNull();
    }
    for (const table of ['players', 'runs', 'bests', 'rate', 'reports']) {
      expect(count(env, table), table).toBe(0);
    }
  });

  it('an Origin that merely resembles an allowed one is still foreign', async () => {
    // Attack surface: prefix/suffix look-alikes (attacker-controlled domains that string-match
    // naively). The check is an exact list membership, and these tests keep it that way.
    for (const origin of [`${ORIGIN}.evil.example`, `${ORIGIN}.e`, 'https://evil-game.example', ORIGIN.replace('https', 'http')]) {
      const r = await call(env, 'POST', '/api/claim', { body: { tag: 'Lookalike' }, origin });
      expect(r, origin).toMatchObject({ status: 403, body: { error: 'origin' } });
    }
    expect(count(env, 'players')).toBe(0);
  });

  it('GETs stay open to foreign origins (read-only, no CORS grant); only writes are gated', async () => {
    // Attack surface: none for reads — the leaderboard is public. This pins the asymmetry so a
    // future "tighten CORS" change cannot accidentally break cross-origin reads of public data.
    const r = await call(env, 'GET', '/api/leaderboard', { origin: EVIL });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// ---------------------------------------------------------------- no Origin at all

describe('origin-less clients (curl, server-to-server)', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('a POST without Origin is accepted but still enters rate limiting', async () => {
    // Attack surface: Origin is forgeable/absent for any non-browser client, so it can never
    // be the real barrier. The barrier is the per-IP limit: five successful claims without any
    // Origin header go through, the sixth is 429 — the limiter saw every one of them.
    for (let i = 0; i < 5; i++) {
      const r = await call(env, 'POST', '/api/claim', { body: { tag: `Curl ${i}x` }, origin: null });
      expect(r.status, `claim ${i}`).toBe(201);
    }
    const r = await call(env, 'POST', '/api/claim', { body: { tag: 'Curl 9x' }, origin: null });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The limiter counted the origin-less caller under the salted hash of its IP bucket.
    const key = await hashIp(ipBucket('198.51.100.1'), 'test-salt');
    expect(rateRows(env, 'claim:ip').map((row) => row.key)).toEqual([key]);
    expect(rateRows(env, 'claim:ip')[0].count).toBe(5);
  });
});

// ---------------------------------------------------------------- request shape

describe('content type and body size (how much can be pushed in)', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('non-JSON Content-Type is 415 and writes nothing', async () => {
    // Attack surface: content-type confusion — a simple (preflight-less) form POST, or a body
    // the JSON parser would misread. Refusal happens before parsing and before any DB access.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'application/json; charset=latin1']) {
      const r = await call(env, 'POST', '/api/claim', {
        raw: JSON.stringify({ tag: 'Ctype' }),
        headers: { 'Content-Type': type },
      });
      expect(r, type).toMatchObject({ status: 415, body: { error: 'content_type' } });
    }
    // No Content-Type header at all is also 415.
    const bare = await call(env, 'POST', '/api/claim', { raw: '{"tag":"Ctype"}', headers: { 'Content-Type': '' } });
    expect(bare.status).toBe(415);
    expect(count(env, 'players')).toBe(0);
    expect(count(env, 'rate')).toBe(0);
  });

  it('a body declaring more than the cap is 413 before a single byte is read', async () => {
    // Attack surface: memory exhaustion via a huge declared Content-Length. The declared length
    // alone must trigger the refusal — the handler never touches the stream.
    const res = await handle(new Request('https://api.example/api/claim', {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_BODY_BYTES + 1),
        'CF-Connecting-IP': '198.51.100.1',
        Origin: ORIGIN,
      },
    }), env, { waitUntil() {} }, T0);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'too_large' });
    expect(count(env, 'players')).toBe(0);
  });

  it('a body that outgrows the cap mid-stream is 413 even with no honest declaration', async () => {
    // Attack surface: chunked/streamed upload whose Content-Length lies or is absent. The
    // reader must cut the stream off at the cap, so the declared length is never trusted.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(JSON.stringify({ tag: 'Big', pad: 'x'.repeat(MAX_BODY_BYTES) })));
        c.close();
      },
    });
    const res = await handle(new Request('https://api.example/api/claim', {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.1', Origin: ORIGIN },
    }), env, { waitUntil() {} }, T0);
    expect(res.status).toBe(413);
    expect(count(env, 'players')).toBe(0);
  });
});

// ---------------------------------------------------------------- claim rate limit

describe('claim rate limit (how much one IP can write)', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('5 successful claims per IP per hour, then 429 with a matching Retry-After', async () => {
    // Attack surface: tag-squatting / namespace exhaustion from one address. The 6th success
    // must be refused, and Retry-After must tell the truth about the window boundary.
    for (let i = 0; i < 5; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: `Tag ${i}x` } })).status).toBe(201);
    }
    const r = await call(env, 'POST', '/api/claim', { body: { tag: 'Tag 9x' } });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    const retryAfter = Number(r.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(r.body.retryAfter).toBe(retryAfter);
    // The refused claim left no trace: still 5 players, and the window expires on schedule.
    expect(count(env, 'players')).toBe(5);
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Tag 8x' } }, T0 + HOUR)).status).toBe(201);
  });

  it('IPv6 addresses are merged by /64, so rotating the low 64 bits does not reset the limit', async () => {
    // Attack surface: a residential IPv6 user typically controls a whole /64 (2^64 addresses);
    // per-address limits would be unbounded for them. All of these claims share one bucket.
    for (let i = 1; i <= 5; i++) {
      const r = await call(env, 'POST', '/api/claim', { body: { tag: `Six ${i}x` }, ip: `2001:db8:aa:bb::${i}` });
      expect(r.status, `claim ${i}`).toBe(201);
    }
    const same64 = await call(env, 'POST', '/api/claim', { body: { tag: 'Six 9x' }, ip: '2001:db8:aa:bb:1234:5678:9abc:def0' });
    expect(same64).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    // A neighbouring /64 is a different bucket and is unaffected.
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Six 9x' }, ip: '2001:db8:aa:bc::1' })).status).toBe(201);
    // The stored key is the salted hash of the /64 bucket, never a raw address.
    const key = await hashIp(ipBucket('2001:db8:aa:bb::1'), 'test-salt');
    expect(rateRows(env, 'claim:ip').map((row) => row.key)).toContain(key);
    expect(JSON.stringify(env.DB.rows('SELECT * FROM rate'))).not.toContain('2001:db8');
  });
});

// ---------------------------------------------------------------- score secret & quota

describe('score secret and per-tag quota', () => {
  let env;
  let secret;
  beforeEach(async () => {
    env = makeEnv();
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Grinder' } });
    expect(c.status).toBe(201);
    secret = c.body.secret;
  });

  it('a wrong secret is 403 and never touches the score:tag quota', async () => {
    // Attack surface: griefing — spamming wrong secrets against a victim's tag to burn their
    // 30 submissions/hour and lock them out of their own leaderboard writes. The per-tag
    // counter only starts counting after the secret checks out.
    for (let i = 0; i < 40; i++) {
      const r = await call(env, 'POST', '/api/score', {
        body: { tag: 'Grinder', secret: 'e'.repeat(64), run: RUN },
        ip: `10.7.${i}.1`,
      });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: 'bad_secret' });
    }
    expect(rateRows(env, 'score:tag')).toEqual([]);
    expect(count(env, 'runs')).toBe(0);
    // The legitimate player still has their full quota afterwards.
    for (let i = 0; i < 30; i++) {
      const r = await call(env, 'POST', '/api/score', { body: { tag: 'Grinder', secret, run: RUN }, ip: `10.6.${i}.1` });
      expect(r.status, `score ${i}`).toBe(200);
    }
    const over = await call(env, 'POST', '/api/score', { body: { tag: 'Grinder', secret, run: RUN }, ip: '10.6.200.1' });
    expect(over).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('a correct secret with an implausible run is 422 and stores nothing', async () => {
    // Attack surface: score forgery by the tag's real owner (or anyone who leaked the secret) —
    // the secret proves identity, not honesty. Physics bounds on the run are the last gate.
    const r = await call(env, 'POST', '/api/score', {
      body: { tag: 'Grinder', secret, run: { ...RUN, kills: 9999 } },
    });
    expect(r).toMatchObject({ status: 422, body: { error: 'implausible_run', reason: 'kills_impossible' } });
    const absurd = await call(env, 'POST', '/api/score', {
      body: { tag: 'Grinder', secret, run: { ...RUN, round: 999, kills: 0, headshots: 0 } },
    });
    expect(absurd).toMatchObject({ status: 422, body: { error: 'implausible_run' } });
    expect(count(env, 'runs')).toBe(0);
    expect(count(env, 'bests')).toBe(0);
    expect(env.DB.rows('SELECT games FROM players')[0].games).toBe(0);
  });
});

// ---------------------------------------------------------------- wiring sanity

describe('suite wiring', () => {
  it('uses the injected clock and the default export, no real network', async () => {
    // Pins the harness itself: `handle` takes `now` explicitly and the default export (the
    // real Worker entry) routes through the same code path the tests exercise.
    const env = makeEnv();
    const res = await worker.fetch(req('GET', '/api/health'), env, { waitUntil() {} });
    expect(res.status).toBe(200);
    const stale = await call(env, 'POST', '/api/claim', { body: { tag: 'Clock' } }, T0 - 40 * 24 * HOUR);
    expect(stale.status).toBe(201);
    const rows = env.DB.rows('SELECT window_start FROM rate');
    expect(rows.every((r) => r.window_start < T0)).toBe(true);
  });
});
