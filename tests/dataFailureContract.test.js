// tests/dataFailureContract.test.js
//
// The observable FAILURE CONTRACT of GET /api/data/[resource].
//
// The browser never reads the database: every private read comes back through this one function,
// so a failure must be self-describing. These tests pin, with injected fakes (no Clerk, no
// Supabase, no network), that every pipeline layer answers with:
//   - the HTTP status the contract assigns to that layer,
//   - a stable machine-readable `code` the frontend/ops can branch on,
//   - no token, key, upstream error text or database detail anywhere in the body.
//
// The pipeline order under test (must not change):
//   method gate → authenticate → authorise → server config → rate limit → resource → query.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDataHandler } from '../api/_lib/data/handler.js';
import { createRateLimiter } from '../api/_lib/data/rateLimit.js';
import { ERROR_CODES } from '../shared/data/errorCodes.js';

// ---- fakes ------------------------------------------------------------------------------------
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const req = (resource, query = {}, extra = {}) => ({
  method: 'GET',
  headers: { authorization: 'Bearer test-token' },
  query: { resource, ...query },
  ...extra
});

// A fake repo whose data calls all succeed for the happy path; individual tests override.
function makeRepo(overrides = {}) {
  const calls = [];
  const track = (name, fn) => async (...a) => { calls.push(name); return fn(...a); };
  return {
    calls,
    dailyRows: track('dailyRows', async () => []),
    bills: track('bills', async () => []),
    uptimeDays: track('uptimeDays', async () => []),
    segments: track('segments', async () => []),
    alarms: track('alarms', async () => []),
    telemetryDay: track('telemetryDay', async () => []),
    telemetryRange: track('telemetryRange', async () => []),
    settings: track('settings', async () => ({ ratePerKwh: 37, capacityKwp: 41.76, acRatedKw: 40 })),
    ...overrides
  };
}

const viewer = { id: 'user_viewer' };
const build = ({
  verify = async () => viewer,
  repo = makeRepo(),
  live = async () => ({ status: 'online' }),
  limiter = createRateLimiter({ limit: 1000 }),
  ready = () => true
} = {}) => createDataHandler({ verify, repo, live, limiter, ready, now: () => Date.parse('2026-11-12T10:00:00Z') });

const call = async (handler, request) => {
  const res = makeRes();
  await handler(request, res);
  return res;
};

// Markers that must NEVER appear in a failure body: a bearer token, a secret key, and the raw
// text a database/upstream would emit on failure.
const SECRET_MARKERS = ['test-token', 'hunter2', 'secret-host', 'db.internal.example', 'password=', 'PGRES', 'supabase_key'];

function expectCleanFailureBody(res) {
  expect(res.body).toBeTypeOf('object');
  const serialized = JSON.stringify(res.body);
  for (const marker of SECRET_MARKERS) {
    expect(serialized, `failure body must not leak ${marker}`).not.toContain(marker);
  }
  // Every failure body is the narrow { error, code, details? } shape — no internal stack or
  // envelope fields ride along.
  const allowedKeys = new Set(['error', 'code', 'details']);
  for (const key of Object.keys(res.body)) {
    expect(allowedKeys.has(key), `unexpected field "${key}" in failure body`).toBe(true);
  }
  expect(typeof res.body.code).toBe('string');
  expect(res.body.code.length).toBeGreaterThan(0);
}

let consoleSpy;
beforeEach(() => { consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- the six required paths -------------------------------------------------------------------

describe('data API failure contract', () => {
  it('path 1 — happy read: 200, private caching, Vary: Authorization, and a body without a code', async () => {
    const handler = build();
    const res = await call(handler, req('settings'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toMatch(/^private, max-age=\d+$/);
    expect(res.headers.Vary).toBe('Authorization');
    expect(res.body.code).toBeUndefined(); // success is not an error envelope
  });

  it('path 2a — unauthenticated (no bearer): 401 missing_token, and nothing downstream runs', async () => {
    const repo = makeRepo();
    const limiter = createRateLimiter({ limit: 1000 });
    const check = vi.spyOn(limiter, 'check');
    const verify = vi.fn(async (_q, res) => {
      res.status(401).json({ error: 'Unauthorized - No token provided', code: ERROR_CODES.MISSING_TOKEN });
      return null;
    });
    const handler = build({ verify, repo, limiter });
    const res = await call(handler, req('settings', {}, { headers: {} }));
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe(ERROR_CODES.MISSING_TOKEN);
    expectCleanFailureBody(res);
    expect(repo.calls).toEqual([]); // auth fails before the repo or limiter is touched
    expect(check).not.toHaveBeenCalled();
  });

  it('path 2b — invalid token: 401 invalid_token, distinct from a missing token', async () => {
    const verify = vi.fn(async (_q, res) => {
      res.status(401).json({ error: 'Unauthorized - Invalid token', code: ERROR_CODES.INVALID_TOKEN });
      return null;
    });
    const handler = build({ verify });
    const res = await call(handler, req('settings'));
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe(ERROR_CODES.INVALID_TOKEN);
    expectCleanFailureBody(res);
  });

  it('path 3 — authorised but too low a level: 403 forbidden, even for an unknown resource', async () => {
    // Authorisation runs BEFORE resource validation, so probing names while forbidden only ever
    // yields 403 — an anonymous/low-level caller cannot enumerate resources.
    const verify = vi.fn(async (_q, res) => {
      res.status(403).json({ error: 'Forbidden - Dashboard access required', code: ERROR_CODES.FORBIDDEN });
      return null;
    });
    const handler = build({ verify });
    const res = await call(handler, req('definitely-not-a-resource'));
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
    expectCleanFailureBody(res);
  });

  it('path 4 — server misconfiguration: 500 with a config_* code that names what is missing', async () => {
    const repo = makeRepo();
    // Mirrors supabaseServer.blockOnConfigProblem: the guard answers itself and says stop.
    const ready = (res) => {
      res.status(500).json({
        error: 'Missing Supabase server configuration',
        code: ERROR_CODES.CONFIG_MISSING_KEY,
        details: 'Neither SUPABASE_SERVICE_KEY nor SUPABASE_SERVICE_ROLE_KEY is set on this deployment.'
      });
      return false;
    };
    const handler = build({ repo, ready });
    const res = await call(handler, req('settings'));
    expect(res.statusCode).toBe(500);
    expect(res.body.code.startsWith('config_')).toBe(true);
    expect(res.body.code).toBe(ERROR_CODES.CONFIG_MISSING_KEY);
    expect(res.body.details).toMatch(/SUPABASE_SERVICE_KEY|SUPABASE_URL/);
    expectCleanFailureBody(res);
    expect(repo.calls).toEqual([]); // the guard stops before any database access
  });

  it('path 5 — over the limit: 429 rate_limited with Retry-After and the remaining count', async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 });
    const handler = build({ limiter });
    expect((await call(handler, req('settings'))).statusCode).toBe(200);
    expect((await call(handler, req('settings'))).statusCode).toBe(200);
    const blocked = await call(handler, req('settings'));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
    expect(blocked.headers['X-RateLimit-Remaining']).toBe('0');
    expectCleanFailureBody(blocked);
  });

  it('path 6a — unknown resource name: 404 not_found, distinguishable from a bad parameter', async () => {
    const handler = build();
    for (const name of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      const res = await call(handler, req(name));
      expect(res.statusCode, name).toBe(404);
      expect(res.body.code, name).toBe(ERROR_CODES.NOT_FOUND);
      expectCleanFailureBody(res);
    }
  });

  it('path 6b — illegal parameter on a known resource: 400 invalid_range, NOT not_found', async () => {
    const repo = makeRepo();
    const handler = build({ repo });
    const res = await call(handler, req('range', { from: '2026-11-09', to: '2026-11-01' }));
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(ERROR_CODES.INVALID_RANGE);
    expect(res.body.code).not.toBe(ERROR_CODES.NOT_FOUND);
    expectCleanFailureBody(res);
    expect(repo.calls).toEqual([]); // validation rejects before any query
  });
});

// ---- hygiene across every layer ---------------------------------------------------------------

describe('failure-body hygiene', () => {
  it('a generic 500 keeps database/upstream error text in the log, not the body', async () => {
    const repo = makeRepo({
      settings: async () => {
        throw new Error('connect to db.internal.example:5432 failed: password=hunter2 (PGRES_FATAL_ERROR)');
      }
    });
    const handler = build({ repo });
    const res = await call(handler, req('settings'));
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe(ERROR_CODES.INTERNAL);
    expectCleanFailureBody(res);
    // The detail is still observable where it is allowed to be: the server log.
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('a rate-limited body never contains the token even though the request carried one', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    const handler = build({ limiter });
    await call(handler, req('settings'));
    const blocked = await call(handler, req('settings'));
    expect(JSON.stringify(blocked.body)).not.toContain('test-token');
  });

  it('every failure response across all layers carries a non-empty stable code', async () => {
    const cases = [];

    // 405 method gate
    {
      const handler = build();
      cases.push([await call(handler, { ...req('settings'), method: 'POST' }), 405]);
    }
    // 401 / 403 via fakes
    for (const [status, code] of [[401, ERROR_CODES.INVALID_TOKEN], [403, ERROR_CODES.FORBIDDEN]]) {
      const handler = build({ verify: async (_q, res) => { res.status(status).json({ error: 'x', code }); return null; } });
      cases.push([await call(handler, req('settings')), status]);
    }
    // 500 config
    {
      const handler = build({
        ready: (res) => {
          res.status(500).json({ error: 'cfg', code: ERROR_CODES.CONFIG_MISSING_URL, details: 'SUPABASE_URL is not set' });
          return false;
        }
      });
      cases.push([await call(handler, req('settings')), 500]);
    }
    // 429
    {
      const handler = build({ limiter: createRateLimiter({ limit: 1, now: () => 0 }) });
      await call(handler, req('settings'));
      cases.push([await call(handler, req('settings')), 429]);
    }
    // 404 / 400
    {
      const handler = build();
      cases.push([await call(handler, req('ghost')), 404]);
      cases.push([await call(handler, req('telemetry', { date: 'yesterday' })), 400]);
    }

    for (const [res, expectedStatus] of cases) {
      expect(res.statusCode).toBe(expectedStatus);
      expect(typeof res.body.code).toBe('string');
      expect(res.body.code.length).toBeGreaterThan(0);
      expectCleanFailureBody(res);
    }
  });

  it('the order of layers is preserved: method → auth → config → limiter → resource', async () => {
    const order = [];
    const verify = vi.fn(async () => { order.push('auth'); return viewer; });
    const ready = vi.fn(() => { order.push('config'); return true; });
    const limiter = createRateLimiter({ limit: 1000 });
    const wrappedLimiter = { check: (id) => { order.push('limiter'); return limiter.check(id); } };
    const repo = makeRepo();
    const handler = build({ verify, ready, limiter: wrappedLimiter, repo });

    // A POST stops at the method gate; auth is never reached.
    const post = await call(handler, { ...req('settings'), method: 'POST' });
    expect(post.statusCode).toBe(405);
    expect(verify).not.toHaveBeenCalled();

    // A GET walks auth → config → limiter, and only then resolves the resource.
    const get = await call(handler, req('settings'));
    expect(get.statusCode).toBe(200);
    expect(order).toEqual(['auth', 'config', 'limiter']);
  });
});
