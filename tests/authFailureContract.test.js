// tests/authFailureContract.test.js
//
// The authentication/authorisation half of the failure contract, against the REAL
// verifyAdminToken.js with @clerk/backend replaced by fakes. The handler-level tests in
// dataFailureContract.test.js inject a fake verify; this file pins what the production verify
// actually emits:
//
//   no Authorization header / not a bearer  → 401 missing_token
//   verifyToken throws (bad/expired token)   → 401 invalid_token
//   verified token without a subject         → 401 invalid_token
//   Clerk user lookup fails                  → 401 invalid_token
//   access level below the required one      → 403 forbidden
//   CLERK_SECRET_KEY missing                 → 500 auth_not_configured
//
// Hygiene: the token itself and the upstream (Clerk) error text must never appear in a body.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted above every import, and this Vitest build's vi.hoisted factory receives no
// `vi` argument (globals are off), so the fakes are plain functions whose implementation is
// swapped through the hoisted state object — no vi.fn() needed inside the hoisted block.
const clerkMock = vi.hoisted(() => {
  const state = {
    verifyImpl: async () => { throw new Error('verifyToken implementation not set'); },
    getUserImpl: async () => { throw new Error('getUser implementation not set'); },
    verifyCalls: [],
    getUserCalls: []
  };
  return {
    state,
    verifyToken: (...args) => { state.verifyCalls.push(args); return state.verifyImpl(...args); },
    getUser: (...args) => { state.getUserCalls.push(args); return state.getUserImpl(...args); }
  };
});

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { getUser: clerkMock.getUser } }),
  verifyToken: clerkMock.verifyToken
}));

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-bearer-token-value.signature';
const bearer = () => ({ authorization: `Bearer ${TOKEN}` });

let authenticate;
let verifyAccess;

beforeEach(async () => {
  vi.resetModules();
  clerkMock.state.verifyCalls.length = 0;
  clerkMock.state.getUserCalls.length = 0;
  clerkMock.state.verifyImpl = async () => { throw new Error('verifyToken implementation not set'); };
  clerkMock.state.getUserImpl = async () => { throw new Error('getUser implementation not set'); };
  process.env.CLERK_SECRET_KEY = 'sk_test_clerk_secret';
  ({ authenticate, verifyAccess } = await import('../api/_lib/verifyAdminToken.js'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLERK_SECRET_KEY;
});

describe('authenticate()', () => {
  it('401 missing_token when there is no Authorization header', async () => {
    const res = makeRes();
    const user = await authenticate({ headers: {} }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('missing_token');
  });

  it('401 missing_token when the header is not a Bearer scheme', async () => {
    const res = makeRes();
    const user = await authenticate({ headers: { authorization: 'Basic abc123' } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('missing_token');
    expect(clerkMock.state.verifyCalls).toHaveLength(0);
  });

  it('401 invalid_token when Clerk rejects the token, without echoing token or upstream text', async () => {
    clerkMock.state.verifyImpl = async () => { throw new Error('clerk upstream said: token revoked at https://clerk.example/internal'); };
    const res = makeRes();
    const user = await authenticate({ headers: bearer() }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('invalid_token');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('clerk.example');
    expect(serialized).not.toContain('revoked');
  });

  it('401 invalid_token when a verified token carries no subject', async () => {
    clerkMock.state.verifyImpl = async () => ({ azp: 'https://solaredge.anujajay.com' }); // no `sub`
    const res = makeRes();
    const user = await authenticate({ headers: bearer() }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('401 invalid_token when the Clerk user lookup fails', async () => {
    clerkMock.state.verifyImpl = async () => ({ sub: 'user_1' });
    clerkMock.state.getUserImpl = async () => { throw new Error('network failure reaching clerk API'); };
    const res = makeRes();
    const user = await authenticate({ headers: bearer() }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('invalid_token');
    expect(JSON.stringify(res.body)).not.toContain('network failure');
  });

  it('returns the Clerk user on success', async () => {
    clerkMock.state.verifyImpl = async () => ({ sub: 'user_1' });
    const clerkUser = { id: 'user_1', publicMetadata: { role: 'viewer' } };
    clerkMock.state.getUserImpl = async () => clerkUser;
    const res = makeRes();
    const user = await authenticate({ headers: bearer() }, res);
    expect(user).toBe(clerkUser);
    expect(res.body).toBeUndefined(); // nothing sent on success
  });

  it('500 auth_not_configured (not 401) when the server has no CLERK_SECRET_KEY', async () => {
    delete process.env.CLERK_SECRET_KEY;
    vi.resetModules();
    ({ authenticate } = await import('../api/_lib/verifyAdminToken.js'));
    const res = makeRes();
    const user = await authenticate({ headers: bearer() }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('auth_not_configured');
    expect(clerkMock.state.verifyCalls).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});

describe('verifyAccess()', () => {
  const userWith = (publicMetadata) => ({ id: 'user_1', publicMetadata });

  beforeEach(() => {
    clerkMock.state.verifyImpl = async () => ({ sub: 'user_1' });
  });

  it('passes a viewer through a viewer gate', async () => {
    clerkMock.state.getUserImpl = async () => userWith({ role: 'viewer' });
    const req = { headers: bearer() };
    const res = makeRes();
    const user = await verifyAccess(req, res, 'viewer');
    expect(user).not.toBeNull();
    expect(req.accessLevel).toBe('viewer');
    expect(req.authUser).toBe(user);
  });

  it('403 forbidden for a user with no dashboard role, on a viewer gate', async () => {
    clerkMock.state.getUserImpl = async () => userWith({ role: 'user' });
    const res = makeRes();
    const user = await verifyAccess({ headers: bearer() }, res, 'viewer');
    expect(user).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('403 forbidden for a viewer hitting an admin gate, and admin satisfies viewer', async () => {
    // viewer on an admin gate → 403
    clerkMock.state.getUserImpl = async () => userWith({ role: 'viewer' });
    const denied = makeRes();
    expect(await verifyAccess({ headers: bearer() }, denied, 'admin')).toBeNull();
    expect(denied.statusCode).toBe(403);
    expect(denied.body.code).toBe('forbidden');

    // admin on a viewer gate → passes
    clerkMock.state.getUserImpl = async () => userWith({ role: 'admin' });
    const allowed = makeRes();
    const req = { headers: bearer() };
    expect(await verifyAccess(req, allowed, 'viewer')).not.toBeNull();
    expect(req.accessLevel).toBe('admin');
  });

  it('treats the legacy dashboardAccess=real flag as viewer until the role migration finishes', async () => {
    clerkMock.state.getUserImpl = async () => userWith({ dashboardAccess: 'real' });
    const res = makeRes();
    expect(await verifyAccess({ headers: bearer() }, res, 'viewer')).not.toBeNull();
  });
});
