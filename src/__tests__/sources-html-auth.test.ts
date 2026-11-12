/**
 * Route tests for authenticated HTML sources — the `auth` API + storage (issue
 * #314, `docs/specs/authenticated-html-sources.md`, ADR-003). CouchDB, Strom and
 * the WS controller are mocked — no live services required.
 *
 * Covers, per the accepted v1 spec:
 *  - PATCH sets a Design-B `auth.header`; the credential value is WRITE-ONLY
 *    (never echoed) and stored ENCRYPTED (`encv1:`, never plaintext);
 *  - the masked response echoes `header.valueSet` only;
 *  - 400: auth on a non-html source; header-name allowlist; rotate on a
 *    profile-mode / no-auth source;
 *  - 409: mutating auth (PATCH or rotate) on an on-air source;
 *  - POST /auth/rotate replaces / clears the stored credential;
 *  - GET /auth/profile/status returns the passive profile status;
 *  - POST /auth/profile/provision is GATED → 501 (upstream cefsrc gap).
 *  - a security canary never leaks into any stored doc or response.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GatewayDoc, SourceDoc } from '../db/types.js';
import { decryptHtmlAuthValue, resetHtmlAuthKeyCache } from '../lib/html-auth-crypto.js';

const TEST_API_KEY = 'test-secret-key';
process.env['API_KEY'] = TEST_API_KEY;
// A deterministic 32-byte key so header values are actually encrypted at rest.
const KEY_B64 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');
// A distinct second key, for the key-rotation failure case.
const ALT_KEY_B64 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 100)).toString('base64');
process.env['HTML_AUTH_KEY'] = KEY_B64;

const CANARY = 'Bearer CANARY-9f83b1e0-DO-NOT-LEAK';

// ---- Mock CouchDB ----
const sourcesStore = new Map<string, SourceDoc>();
const gatewaysStore = new Map<string, GatewayDoc>();
// Drives the active-production 409 guard. Push a { name } to simulate on-air.
let activeProductions: Array<{ name: string }> = [];

const gatewaysDb = {
  get: vi.fn(async (id: string) => {
    const doc = gatewaysStore.get(id);
    if (!doc) throw Object.assign(new Error('not_found'), { statusCode: 404 });
    return doc;
  }),
  insert: vi.fn(),
  destroy: vi.fn(),
  find: vi.fn(async () => ({ docs: [] })),
};

const sourcesDb = {
  get: vi.fn(async (id: string) => {
    const doc = sourcesStore.get(id);
    if (!doc) throw Object.assign(new Error('not_found'), { statusCode: 404 });
    return doc;
  }),
  insert: vi.fn(async (doc: SourceDoc) => {
    sourcesStore.set(doc._id, { ...doc, _rev: '2-x' });
    return { ok: true, id: doc._id, rev: '2-x' };
  }),
  destroy: vi.fn(async (id: string) => {
    sourcesStore.delete(id);
    return { ok: true };
  }),
  find: vi.fn(async () => ({ docs: Array.from(sourcesStore.values()) })),
  findTrusted: vi.fn(async () => ({ docs: [] })),
};

const prodDb = {
  get: vi.fn(),
  insert: vi.fn(),
  find: vi.fn(),
  // Returns the simulated active productions so the auth 409 guard can fire.
  findTrusted: vi.fn(async () => ({ docs: activeProductions })),
};

vi.mock('../db/index.js', () => ({
  getDb: () => prodDb,
  getSourcesDb: () => sourcesDb,
  getGatewaysDb: () => gatewaysDb,
  getOutputsDb: () => ({ get: vi.fn(), insert: vi.fn(), find: vi.fn(), destroy: vi.fn() }),
  connectDb: vi.fn().mockResolvedValue(undefined),
  isDbReady: vi.fn().mockResolvedValue(true),
  isDbConnected: vi.fn().mockReturnValue(true),
}));

vi.mock('../ws/controller.js', () => ({
  default: async () => {},
  clearAudioState: vi.fn(),
  clearPipState: vi.fn(),
  clearFxState: vi.fn(),
}));

vi.mock('../lib/flow-generator.js', () => ({
  activateStromFlow: vi.fn(),
  deactivateStromFlow: vi.fn(),
}));

vi.mock('../lib/strom.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/strom.js')>();
  class MockStromClient {
    system = { version: vi.fn(), iceServers: vi.fn() };
    flows = { get: vi.fn(), start: vi.fn(), stop: vi.fn(), delete: vi.fn() };
    mixer = { multiviewEndpoint: vi.fn() };
    ports = { pool: vi.fn(), reservations: { create: vi.fn(), renew: vi.fn(), release: vi.fn(), list: vi.fn(), get: vi.fn(), assign: vi.fn(), unassign: vi.fn() } };
  }
  return { ...actual, StromClient: MockStromClient };
});

vi.mock('../lib/strom-token.js', () => ({
  getStromToken: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('../services/port-reservation.js', () => ({
  getPortReservation: () => ({ start: 9000, end: 9100 }),
}));

vi.mock('../services/listener-ports.js', () => ({
  usedListenerPorts: vi.fn().mockResolvedValue([]),
  clashesAfterWrite: vi.fn().mockReturnValue(undefined),
  listenerPortRequest: vi.fn().mockReturnValue(9000),
  resolveListenerAddress: vi.fn((address: string) => ({ ok: true, address, port: 9000 })),
}));

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

let app: FastifyInstance;

beforeAll(async () => {
  const { buildServer } = await import('../server.js');
  app = await buildServer();
});

beforeEach(() => {
  sourcesStore.clear();
  gatewaysStore.clear();
  activeProductions = [];
  resetHtmlAuthKeyCache();
  process.env['HTML_AUTH_KEY'] = KEY_B64;
  delete process.env['SRT_PASSPHRASE_KEY'];
  delete process.env['NODE_ENV'];
});

afterEach(() => {
  resetHtmlAuthKeyCache();
  process.env['HTML_AUTH_KEY'] = KEY_B64;
  delete process.env['SRT_PASSPHRASE_KEY'];
  delete process.env['NODE_ENV'];
  vi.restoreAllMocks();
});

/** Create a plain (anonymous) HTML source and return its id. */
async function createHtmlSource(): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/sources', headers: AUTH,
    payload: { name: 'dashboard', address: 'https://dashboard.example.com/', streamType: 'html' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('PATCH /api/v1/sources/:id — Design-B header auth', () => {
  it('stores the credential encrypted, echoes it masked, never returns the value', async () => {
    const id = await createHtmlSource();
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auth).toEqual({ mode: 'header', header: { name: 'Authorization', valueSet: true } });
    // The value is never echoed anywhere in the response.
    expect(JSON.stringify(body)).not.toContain('CANARY');

    // Stored at rest as an encv1: ciphertext on the internal field, never plaintext.
    const stored = sourcesStore.get(id)!;
    expect(stored.authHeaderValueEnc).toMatch(/^encv1:/);
    expect(JSON.stringify(stored)).not.toContain('CANARY');
    // A GET likewise never returns the value.
    const get = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(get.json().auth.header.valueSet).toBe(true);
    expect(JSON.stringify(get.json())).not.toContain('CANARY');
  });

  it('accepts auth on create and stores it encrypted', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'dash', address: 'https://dashboard.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'X-Api-Key', value: CANARY } },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().auth).toEqual({ mode: 'header', header: { name: 'X-Api-Key', valueSet: true } });
    expect(sourcesStore.get(res.json().id)!.authHeaderValueEnc).toMatch(/^encv1:/);
  });

  it('rejects auth on a non-html source (400)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'srtcam', address: 'srt://host:9000', streamType: 'srt',
        auth: { mode: 'header', header: { name: 'Authorization', value: 'x' } },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid header name (400)', async () => {
    const id = await createHtmlSource();
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Bad Header:\r\nInjected', value: 'x' } } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears auth entirely when patched with null', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } } },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH, payload: { auth: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toBeUndefined();
    const stored = sourcesStore.get(id)!;
    expect(stored.auth).toBeUndefined();
    expect(stored.authHeaderValueEnc).toBeUndefined();
  });

  it('preserves the stored credential on a header-name-only patch', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } } },
    });
    const before = sourcesStore.get(id)!.authHeaderValueEnc;
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'X-Auth' } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.header).toEqual({ name: 'X-Auth', valueSet: true });
    expect(sourcesStore.get(id)!.authHeaderValueEnc).toBe(before);
  });

  it('refuses to mutate auth on an on-air source (409)', async () => {
    const id = await createHtmlSource();
    activeProductions = [{ name: 'Live Show' }];
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: 'x' } } },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/v1/sources/:id/auth/rotate', () => {
  it('replaces the stored credential with a new one', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: 'old-value' } } },
    });
    const before = sourcesStore.get(id)!.authHeaderValueEnc;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/sources/${id}/auth/rotate`, headers: AUTH,
      payload: { value: CANARY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.header.valueSet).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('CANARY');
    const after = sourcesStore.get(id)!.authHeaderValueEnc;
    expect(after).toMatch(/^encv1:/);
    expect(after).not.toBe(before);
  });

  it('clears the stored credential with clear:true', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: 'v' } } },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/sources/${id}/auth/rotate`, headers: AUTH, payload: { clear: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.header.valueSet).toBe(false);
    expect(sourcesStore.get(id)!.authHeaderValueEnc).toBeUndefined();
  });

  it('404s an unknown source', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sources/nope/auth/rotate', headers: AUTH, payload: { value: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('400s a source with no header-mode auth', async () => {
    const id = await createHtmlSource();
    const res = await app.inject({ method: 'POST', url: `/api/v1/sources/${id}/auth/rotate`, headers: AUTH, payload: { value: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('409s when the source is on air', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: 'v' } } },
    });
    activeProductions = [{ name: 'Live Show' }];
    const res = await app.inject({ method: 'POST', url: `/api/v1/sources/${id}/auth/rotate`, headers: AUTH, payload: { value: 'x' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/v1/sources/:id/auth/profile/status', () => {
  it('reports unprovisioned when the source has no profile-mode auth', async () => {
    const id = await createHtmlSource();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}/auth/profile/status`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('unprovisioned');
  });

  it('reports the server-issued profile status once profile-mode auth is set', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'profile' } },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}/auth/profile/status`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileId).toMatch(/^hprof-/);
    expect(res.json().status).toBe('unprovisioned');
  });

  it('404s an unknown source', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sources/nope/auth/profile/status', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/v1/sources/:id/auth/profile/provision — gated', () => {
  it('returns 501 (upstream cefsrc gap, ADR-003 OQ1/OQ2)', async () => {
    const id = await createHtmlSource();
    const res = await app.inject({ method: 'POST', url: `/api/v1/sources/${id}/auth/profile/provision`, headers: AUTH });
    expect(res.statusCode).toBe(501);
  });

  it('404s an unknown source before the 501', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sources/nope/auth/profile/provision', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * End-to-end create → read → update chain for the encrypted credential, at the
 * sources API level. The pure-crypto cases live in `html-auth-crypto.test.ts`;
 * these prove the route wiring: the ciphertext is bound to the stored source
 * id, the read path actually decrypts with that same id (fail-closed on any
 * mismatch), and it never puts the plaintext on the wire.
 */
describe('credential encryption chain: create → read → update', () => {
  it('encrypts on create, decrypts with the same source id on read, re-encrypts on update', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'dash', address: 'https://dashboard.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const storedEnc = sourcesStore.get(id)!.authHeaderValueEnc!;
    expect(storedEnc).toMatch(/^encv1:/);
    // The write used this source's id as AAD; the read path uses the same id.
    expect(decryptHtmlAuthValue(storedEnc, id)).toBe(CANARY);

    const read = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(read.statusCode).toBe(200);
    expect(read.json().auth).toEqual({ mode: 'header', header: { name: 'Authorization', valueSet: true } });
    expect(JSON.stringify(read.json())).not.toContain('CANARY');

    const UPDATED = 'Bearer updated-secret-2';
    const patched = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: UPDATED } } },
    });
    expect(patched.statusCode).toBe(200);
    const updatedEnc = sourcesStore.get(id)!.authHeaderValueEnc!;
    expect(updatedEnc).toMatch(/^encv1:/);
    expect(updatedEnc).not.toBe(storedEnc);
    expect(decryptHtmlAuthValue(updatedEnc, id)).toBe(UPDATED);
    // The superseded ciphertext still decrypts to its OLD value (under the same
    // key and id) — it must never yield the new value.
    expect(decryptHtmlAuthValue(storedEnc, id)).toBe(CANARY);
    expect(JSON.stringify(patched.json())).not.toContain(UPDATED);
  });

  it('fails closed when the stored ciphertext is copied onto another source', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'a', address: 'https://a.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'X-Api-Key', value: CANARY } },
      },
    });
    const aId = created.json().id as string;
    const copiedEnc = sourcesStore.get(aId)!.authHeaderValueEnc!;

    const other = await createHtmlSource();
    // Simulate a ciphertext copied onto source B's document (same bundle, new id).
    sourcesStore.get(other)!.auth = { mode: 'header', header: { name: 'X-Api-Key' } };
    sourcesStore.get(other)!.authHeaderValueEnc = copiedEnc;

    const res = await app.inject({ method: 'GET', url: `/api/v1/sources/${other}`, headers: AUTH });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('An internal error occurred');
    expect(JSON.stringify(res.json())).not.toContain('CANARY');
    // The original source still reads fine.
    const ok = await app.inject({ method: 'GET', url: `/api/v1/sources/${aId}`, headers: AUTH });
    expect(ok.statusCode).toBe(200);
  });

  it('fails closed on tampered ciphertext and on a too-short bundle', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'dash', address: 'https://dashboard.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } },
      },
    });
    const id = created.json().id as string;

    // Flip a ciphertext byte: the GCM tag check must fail on read.
    const bundle = Buffer.from(sourcesStore.get(id)!.authHeaderValueEnc!.slice('encv1:'.length), 'base64url');
    bundle[bundle.length - 1] = (bundle[bundle.length - 1] ?? 0) ^ 0x01;
    sourcesStore.get(id)!.authHeaderValueEnc = 'encv1:' + bundle.toString('base64url');
    const tampered = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(tampered.statusCode).toBe(500);
    expect(JSON.stringify(tampered.json())).not.toContain('CANARY');

    // A bundle shorter than iv+tag is rejected as malformed.
    sourcesStore.get(id)!.authHeaderValueEnc = 'encv1:' + Buffer.alloc(10).toString('base64url');
    const short = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(short.statusCode).toBe(500);
    expect(JSON.stringify(short.json())).not.toContain('CANARY');
  });

  it('returns 503 (config error, not 500 or plaintext) in production with an existing ciphertext and no key', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'dash', address: 'https://dashboard.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    delete process.env['HTML_AUTH_KEY'];
    delete process.env['SRT_PASSPHRASE_KEY'];
    process.env['NODE_ENV'] = 'production';
    resetHtmlAuthKeyCache();

    const res = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.statusCode).toBe(503);
    expect(body.error).not.toBe('An internal error occurred');
    expect(body.error).toMatch(/HTML_AUTH_KEY/);
    expect(JSON.stringify(body)).not.toContain('CANARY');
  });

  it('fails closed after a key rotation instead of returning garbage or plaintext', async () => {
    const id = await createHtmlSource();
    await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } } },
    });
    // Same stored ciphertext, now a different key: GCM authentication must fail.
    process.env['HTML_AUTH_KEY'] = ALT_KEY_B64;
    resetHtmlAuthKeyCache();

    const res = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain('CANARY');
    // Re-encrypted material under the new key reads fine; old stays unreadable.
    const patched = await app.inject({
      method: 'PATCH', url: `/api/v1/sources/${id}`, headers: AUTH,
      payload: { auth: { mode: 'header', header: { name: 'Authorization', value: 'new-under-new-key' } } },
    });
    expect(patched.statusCode).toBe(200);
    expect(decryptHtmlAuthValue(sourcesStore.get(id)!.authHeaderValueEnc!, id)).toBe('new-under-new-key');
  });

  it('non-production without a key stores plaintext with a loud warning and still reads masked', async () => {
    delete process.env['HTML_AUTH_KEY'];
    delete process.env['SRT_PASSPHRASE_KEY'];
    delete process.env['NODE_ENV'];
    resetHtmlAuthKeyCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.inject({
      method: 'POST', url: '/api/v1/sources', headers: AUTH,
      payload: {
        name: 'dash', address: 'https://dashboard.example.com/', streamType: 'html',
        auth: { mode: 'header', header: { name: 'Authorization', value: CANARY } },
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    // Dev fallback: plaintext at rest, but never echoed by the API.
    expect(sourcesStore.get(id)!.authHeaderValueEnc).toBe(CANARY);
    expect(JSON.stringify(res.json())).not.toContain('CANARY');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/plaintext/i);

    const read = await app.inject({ method: 'GET', url: `/api/v1/sources/${id}`, headers: AUTH });
    expect(read.statusCode).toBe(200);
    expect(read.json().auth.header.valueSet).toBe(true);
    expect(JSON.stringify(read.json())).not.toContain('CANARY');
  });
});
