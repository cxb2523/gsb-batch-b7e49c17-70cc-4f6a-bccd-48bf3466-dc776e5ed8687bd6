import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWeb } from '../lib/web.js';
import { SsrfError } from '../lib/ssrf.js';

test('extractWeb refuses a metadata-IP URL without fetching', async () => {
  let fetched = false;
  const fetchFn = async () => { fetched = true; return new Response('secret', { status: 200 }); };
  await assert.rejects(
    () => extractWeb('http://100.100.100.200/latest/user-data', { fetch: fetchFn }),
    SsrfError,
  );
  assert.equal(fetched, false);
});

test('extractWeb refuses a private-IP literal URL', async () => {
  const fetchFn = async () => new Response('x', { status: 200 });
  await assert.rejects(
    () => extractWeb('http://127.0.0.1:8080/', { fetch: fetchFn }),
    SsrfError,
  );
});

// GHSA-26wr-prg5-vr77: the Playwright sidecar refuses a navigation to a blocked
// host (meta refresh, 3xx, script) and reports it as SsrfError via the client.
const ARTICLE_HTML = `
  <html><head><title>Article</title></head>
  <body><article>
    <h1>Article</h1>
    <p>Body paragraph one with enough text for Readability to commit to this content. The article needs at least 200 chars in the readability output, so the prose has to be a bit longer than usual.</p>
    <p>Body paragraph two providing additional substance so the static extractor finds plenty of weight in this candidate node and chooses it.</p>
  </article></body></html>
`;
const articleFetch = async () => new Response(ARTICLE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const refusingRender = async () => { throw new SsrfError('blocked address 172.20.0.4 for host internal-secret (via http://internal-secret:9000/)'); };

test('render=force with a sidecar-refused navigation rejects with SsrfError, nothing to cache', async () => {
  await assert.rejects(
    () => extractWeb('https://example.com/refresh-inward', { fetch: articleFetch, render: 'force', renderClient: refusingRender }),
    (err) => err instanceof SsrfError && /internal-secret/.test(err.message),
  );
});

test('extractor=playwright with a sidecar-refused navigation rejects with SsrfError', async () => {
  await assert.rejects(
    () => extractWeb('https://example.com/refresh-inward', { fetch: articleFetch, extractor: 'playwright', renderClient: refusingRender }),
    SsrfError,
  );
});

test('automatic render fallback keeps the static result when the sidecar refuses the navigation', async () => {
  // A thin static result trips renderDecision; the sidecar then refuses.
  const thinFetch = async () => new Response('<html><head><title>T</title></head><body><p>short</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const r = await extractWeb('https://example.com/thin', { fetch: thinFetch, renderClient: refusingRender });
  assert.notEqual(r.source, 'playwright');
  assert.match(r.metadata.extractorReason, /playwright render refused, URL not allowed: .*internal-secret/);
});

test('a redirect from an allowed first URL to a blocked address is rejected without reaching the target', async () => {
  // First hop is a routable public literal IP (passes the policy) and answers
  // with a redirect into the cloud-metadata range. safeFetch must re-validate
  // the hop and throw before a second network call touches 169.254.169.254.
  let hits = 0;
  const fetchFn = async (u) => {
    hits++;
    if (u.startsWith('http://93.184.216.34/')) {
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    }
    throw new Error(`blocked target must never be fetched, got ${u}`);
  };
  await assert.rejects(
    () => extractWeb('http://93.184.216.34/start', { fetch: fetchFn }),
    (err) => err instanceof SsrfError && /blocked address 169\.254\.169\.254/.test(err.message),
  );
  assert.equal(hits, 1, 'only the initial public hop may be fetched');
});

test('an allowlisted internal address is fetched and extracted normally', async () => {
  const prev = process.env.PULLMD_ALLOWED_HOSTS;
  process.env.PULLMD_ALLOWED_HOSTS = '10.0.0.0/24';
  try {
    const fetchFn = async () => new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const r = await extractWeb('http://10.0.0.10/internal-wiki', { fetch: fetchFn, render: 'skip' });
    assert.ok(r.markdown.includes('Article'));
    assert.equal(r.metadata.sourceUrl, 'http://10.0.0.10/internal-wiki');
  } finally {
    if (prev === undefined) delete process.env.PULLMD_ALLOWED_HOSTS;
    else process.env.PULLMD_ALLOWED_HOSTS = prev;
  }
});
