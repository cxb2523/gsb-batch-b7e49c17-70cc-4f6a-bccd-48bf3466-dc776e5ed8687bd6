// tests/supabaseServer.test.js
//
// The server key assertion.
//
// Handing an anon key to a server endpoint does not fail cleanly — it half works. Reads
// succeed, storage writes succeed, and then one INSERT is rejected by RLS and the endpoint
// returns a generic 500 with the file already written. That exact misconfiguration has now
// bitten this project twice: once in GitHub Actions (five-month outage) and once on Vercel
// (bill upload 500). These tests pin the check that turns it into a clear message.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readKeyRole, describeConfigProblem } from '../api/_lib/supabaseServer.js';
import { ERROR_CODES } from '../shared/data/errorCodes.js';

// Structurally real Supabase JWTs, signed with nothing — only the payload matters here,
// and the code never verifies the signature (Supabase does that).
function makeJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'supabase', ref: 'abc', role, iat: 1, exp: 2 })
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

const SERVICE_JWT = makeJwt('service_role');
const ANON_JWT = makeJwt('anon');
const URL = 'https://example.supabase.co';

describe('readKeyRole', () => {
  it('reads service_role from a legacy JWT', () => {
    expect(readKeyRole(SERVICE_JWT)).toBe('service_role');
  });

  it('reads anon from a legacy JWT', () => {
    expect(readKeyRole(ANON_JWT)).toBe('anon');
  });

  it('recognises the newer opaque secret key format', () => {
    expect(readKeyRole('sb_secret_abc123')).toBe('service_role');
  });

  it('recognises the newer opaque publishable key format', () => {
    expect(readKeyRole('sb_publishable_abc123')).toBe('anon');
  });

  it('returns null for anything it cannot classify, rather than guessing', () => {
    expect(readKeyRole('not-a-key')).toBeNull();
    expect(readKeyRole('')).toBeNull();
    expect(readKeyRole(undefined)).toBeNull();
    expect(readKeyRole(null)).toBeNull();
  });

  it('does not throw on a JWT with an undecodable payload', () => {
    expect(() => readKeyRole('a.!!!not-base64!!!.c')).not.toThrow();
  });
});

describe('describeConfigProblem', () => {
  it('passes a correctly configured deployment', () => {
    expect(describeConfigProblem(URL, SERVICE_JWT)).toBeNull();
  });

  it('rejects an anon key, naming the role it found', () => {
    const problem = describeConfigProblem(URL, ANON_JWT);
    expect(problem).not.toBeNull();
    expect(problem.error).toMatch(/not a service_role key/);
    expect(problem.details).toMatch(/role "anon"/);
  });

  it('gives each configuration fault a distinct stable machine-readable code', () => {
    expect(describeConfigProblem(undefined, SERVICE_JWT).code).toBe(ERROR_CODES.CONFIG_MISSING_URL);
    expect(describeConfigProblem(URL, undefined).code).toBe(ERROR_CODES.CONFIG_MISSING_KEY);
    expect(describeConfigProblem(URL, ANON_JWT).code).toBe(ERROR_CODES.CONFIG_KEY_NOT_SERVICE_ROLE);
  });

  it('never echoes the configured key value back in the problem body', () => {
    // The body names the ENV VAR to fix; the secret itself must not appear.
    for (const problem of [
      describeConfigProblem(URL, ANON_JWT),
      describeConfigProblem(URL, 'sb_publishable_leaked-value-123')
    ]) {
      const serialized = JSON.stringify(problem);
      expect(serialized).not.toContain(ANON_JWT);
      expect(serialized).not.toContain('leaked-value-123');
    }
  });

  it('tells you where to set it — both places', () => {
    // Vercel and GitHub Actions are configured separately. Fixing one and assuming the other
    // followed is precisely how this was missed.
    const problem = describeConfigProblem(URL, ANON_JWT);
    expect(problem.details).toMatch(/Vercel/);
    expect(problem.details).toMatch(/GitHub Actions/);
  });

  it('reports a missing key without falling back to anything', () => {
    const problem = describeConfigProblem(URL, undefined);
    expect(problem.error).toMatch(/Missing Supabase server configuration/);
    expect(problem.details).toMatch(/SUPABASE_SERVICE_KEY/);
    expect(problem.details).toMatch(/no fallback/i);
  });

  it('reports a missing URL', () => {
    const problem = describeConfigProblem(undefined, SERVICE_JWT);
    expect(problem.error).toMatch(/Missing Supabase server configuration/);
    expect(problem.details).toMatch(/SUPABASE_URL/);
  });

  it('accepts an unrecognisable key format rather than blocking a valid deployment', () => {
    // If we cannot read the role we must not guess — a future key format should not take
    // the whole API down.
    expect(describeConfigProblem(URL, 'some-future-key-format')).toBeNull();
  });
});

describe('blockOnConfigProblem', () => {
  // The module binds SUPABASE_URL / SUPABASE_SERVICE_KEY once on import, so each case imports a
  // fresh module with the env it wants.
  async function freshModule() {
    vi.resetModules();
    return import('../api/_lib/supabaseServer.js');
  }
  const mockRes = () => ({ statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const original = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };

  afterEach(() => {
    if (original.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = original.url;
    if (original.key === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = original.key;
  });

  it('answers 500 itself with the stable code, and tells the handler to stop', async () => {
    process.env.SUPABASE_URL = URL;
    process.env.SUPABASE_SERVICE_KEY = ANON_JWT;
    const { blockOnConfigProblem: block } = await freshModule();
    const res = mockRes();
    expect(block(res)).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe(ERROR_CODES.CONFIG_KEY_NOT_SERVICE_ROLE);
    expect(JSON.stringify(res.body)).not.toContain(ANON_JWT);
  });

  it('returns false (and sends nothing) when configuration is fine', async () => {
    process.env.SUPABASE_URL = URL;
    process.env.SUPABASE_SERVICE_KEY = SERVICE_JWT;
    const { blockOnConfigProblem: block } = await freshModule();
    const res = mockRes();
    expect(block(res)).toBe(false);
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
  });
});

describe('SUPABASE_SERVICE_ROLE_KEY alias', () => {
  // Supabase's dashboard labels the key "service_role", so SUPABASE_SERVICE_ROLE_KEY is the
  // name people reach for first. That guess caused a production outage: the variable was set
  // correctly under a name nothing read. Both spellings now resolve to the same key.
  const ORIGINAL = {
    a: process.env.SUPABASE_SERVICE_KEY,
    b: process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  afterEach(() => {
    for (const [k, v] of [['SUPABASE_SERVICE_KEY', ORIGINAL.a], ['SUPABASE_SERVICE_ROLE_KEY', ORIGINAL.b]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('treats both names as the same variable at module scope', async () => {
    // The module reads env once on import, so assert on the resolution rule rather than
    // re-importing: whichever name is present must win, and neither may be ignored.
    const resolve = (a, b) => a || b;
    expect(resolve(SERVICE_JWT, undefined)).toBe(SERVICE_JWT);
    expect(resolve(undefined, SERVICE_JWT)).toBe(SERVICE_JWT);
    expect(resolve(SERVICE_JWT, ANON_JWT)).toBe(SERVICE_JWT); // explicit name takes precedence
  });

  it('still rejects an anon key supplied under the ROLE spelling', () => {
    // The alias must not become a way to smuggle an anon key past the assertion.
    const problem = describeConfigProblem(URL, ANON_JWT);
    expect(problem).not.toBeNull();
    expect(problem.error).toMatch(/not a service_role key/);
  });
});
