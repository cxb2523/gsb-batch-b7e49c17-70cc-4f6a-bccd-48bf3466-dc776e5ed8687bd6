import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createCache } from '../lib/cache.js';

// Minimal app with no cache and a fetch that must never be called for blocked URLs.
function makeApp() {
  return createApp({
    cache: null,
    extractWeb: async () => ({ markdown: 'should not reach', title: 't', source: 'web', metadata: {} }),
  });
}

async function get(app, path) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

test('GET /api with a metadata URL returns 403', async () => {
  const app = makeApp();
  const res = await get(app, '/api?url=' + encodeURIComponent('http://100.100.100.200/latest/user-data'));
  assert.equal(res.status, 403);
});

test('GET /api with a private-IP URL returns 403', async () => {
  const app = makeApp();
  const res = await get(app, '/api?url=' + encodeURIComponent('http://10.0.0.5/'));
  assert.equal(res.status, 403);
});

test('GET /api with a public URL is not rejected as SSRF', async () => {
  const app = makeApp();
  const res = await get(app, '/api?url=' + encodeURIComponent('https://example.com/'));
  assert.notEqual(res.status, 403);
});

// GHSA-26wr-prg5-vr77: a block that only shows up below the up-front check
// (redirect hop, render-time navigation) must still be a 403 and never 502.
test('GET /api answers 403 when the extraction hits the guard on a later hop', async () => {
  const { SsrfError } = await import('../lib/ssrf.js');
  const app = createApp({
    cache: null,
    extractWeb: async () => { throw new SsrfError('blocked address 172.20.0.4 for host internal-secret (via http://internal-secret:9000/)'); },
  });
  const res = await get(app, '/api?url=' + encodeURIComponent('https://example.com/refresh-inward') + '&render=force');
  assert.equal(res.status, 403);
  assert.match(res.body, /URL not allowed: blocked address 172\.20\.0\.4/);
});

test('GET /api/stream reports a later-hop block as an error event with the URL-not-allowed wording', async () => {
  const { SsrfError } = await import('../lib/ssrf.js');
  const app = createApp({
    cache: null,
    extractWeb: async () => { throw new SsrfError('blocked address 172.20.0.4 for host internal-secret'); },
  });
  const res = await get(app, '/api/stream?url=' + encodeURIComponent('https://example.com/refresh-inward') + '&render=force');
  assert.match(res.body, /event: error/);
  assert.match(res.body, /URL not allowed: blocked address 172\.20\.0\.4/);
});

test('a forced-render refusal returns 403 and never writes the cache', async () => {
  const { SsrfError } = await import('../lib/ssrf.js');
  const url = 'https://example.com/refresh-inward';
  const cache = createCache(':memory:');
  const app = createApp({
    cache,
    extractWeb: async () => { throw new SsrfError('blocked address 172.20.0.4 for host internal-secret (via http://internal-secret:9000/)'); },
  });
  const res = await get(app, '/api?url=' + encodeURIComponent(url) + '&render=force');
  assert.equal(res.status, 403);
  assert.match(res.body, /URL not allowed: blocked address 172\.20\.0\.4/);
  assert.equal(cache.get(url), null, 'a policy refusal must not be cached');
});

test('GET /api/stream emits an error event (no result) for a forced-render refusal and writes no cache', async () => {
  const { SsrfError } = await import('../lib/ssrf.js');
  const url = 'https://example.com/refresh-inward';
  const cache = createCache(':memory:');
  const app = createApp({
    cache,
    extractWeb: async () => { throw new SsrfError('blocked address 172.20.0.4 for host internal-secret'); },
  });
  const res = await get(app, '/api/stream?url=' + encodeURIComponent(url) + '&render=force');
  assert.match(res.body, /event: error/);
  assert.match(res.body, /URL not allowed: blocked address 172\.20\.0\.4/);
  assert.doesNotMatch(res.body, /event: result/);
  assert.equal(cache.get(url), null);
});

test('an allowlisted internal address is served normally through /api and cached', async () => {
  const prev = process.env.PULLMD_ALLOWED_HOSTS;
  process.env.PULLMD_ALLOWED_HOSTS = '10.0.0.0/24';
  const url = 'http://10.0.0.10/internal-wiki';
  try {
    const cache = createCache(':memory:');
    const app = createApp({
      cache,
      extractWeb: async () => ({ markdown: '# Internal\n\nbody', title: 'Internal', source: 'readability', metadata: { sourceUrl: url } }),
    });
    const res = await get(app, '/api?url=' + encodeURIComponent(url));
    assert.equal(res.status, 200);
    assert.match(res.body, /Internal/);
    assert.notEqual(cache.get(url), null, 'an allowlisted internal fetch is a normal, cacheable result');
  } finally {
    if (prev === undefined) delete process.env.PULLMD_ALLOWED_HOSTS;
    else process.env.PULLMD_ALLOWED_HOSTS = prev;
  }
});

test('GET /api/stream emits an error event with the URL-not-allowed wording for an initial blocked URL', async () => {
  const app = createApp({
    cache: null,
    extractWeb: async () => ({ markdown: 'should not reach', title: 't', source: 'web', metadata: {} }),
  });
  const res = await get(app, '/api/stream?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'));
  assert.match(res.body, /event: error/);
  assert.match(res.body, /URL not allowed: blocked address 169\.254\.169\.254/);
  assert.doesNotMatch(res.body, /event: result/);
});
