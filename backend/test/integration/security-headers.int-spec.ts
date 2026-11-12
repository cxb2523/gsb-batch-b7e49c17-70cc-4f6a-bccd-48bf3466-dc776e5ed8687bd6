import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';

describe('Production HTTP Security Headers (Integration)', () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  it('attaches Helmet CSP, X-Content-Type-Options, X-Frame-Options, and CORP headers on responses', async () => {
    const res = await harness.request().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self';");
    expect(res.headers['content-security-policy']).not.toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(res.headers['content-security-policy']).toContain("font-src 'self'");
    expect(res.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('answers a NUL character in an id or a title with 400, not a server error', async () => {
    const user = await harness.signIn('nul-probe');

    const asId = await harness.request().get('/api/boards/%00').set('Cookie', user.cookie);
    expect(asId.status).toBe(400);

    const asTitle = await harness
      .request()
      .post('/api/projects')
      .set('Cookie', user.cookie)
      .send({ name: 'bad\u0000name' });
    expect(asTitle.status).toBeLessThan(500);
  });

  it('has no route that lets a signed-in user trigger the table-wide cleanup', async () => {
    const user = await harness.signIn('cleanup-probe');

    const res = await harness.request().post('/api/privacy/cleanup').set('Cookie', user.cookie);

    expect(res.status).toBe(404);
  });
});
