import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';

describe('Global Rate Limiting via ThrottlerGuard (Integration)', () => {
  let harness: IntegrationHarness;
  const limit = 3;

  beforeAll(async () => {
    harness = await createIntegrationHarness({
      env: {
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_LIMIT: String(limit),
        RATE_LIMIT_TTL: '60',
      },
    });
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  it('allows requests up to RATE_LIMIT_LIMIT and returns 429 on the (N+1)th request', async () => {
    const r1 = await harness.request().get('/api/health');
    const r2 = await harness.request().get('/api/health');
    const r3 = await harness.request().get('/api/health');
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);

    const throttledRes = await harness.request().get('/api/health');
    expect(throttledRes.status).toBe(429);
  });
});

describe("Better Auth's own sign-in limiter follows RATE_LIMIT_ENABLED (Integration)", () => {
  const signInTimes = 6;

  async function signInStatuses(rateLimitEnabled: 'true' | 'false'): Promise<number[]> {
    const harness = await createIntegrationHarness({
      env: {
        DEMO_MODE: 'true',
        ENABLE_DEV_LOGIN: 'false',
        RATE_LIMIT_ENABLED: rateLimitEnabled,
        RATE_LIMIT_LIMIT: '1000',
      },
    });
    try {
      // One after the other, so the order the limiter sees is the order of the list.
      return await Array.from({ length: signInTimes }).reduce<Promise<number[]>>(async (soFar) => {
        const statuses = await soFar;
        const res = await harness.request().post('/api/auth/sign-in/anonymous').send({});
        return [...statuses, res.status];
      }, Promise.resolve([]));
    } finally {
      await harness.close();
    }
  }

  it('refuses the fourth sign-in within ten seconds when limits are on', async () => {
    const statuses = await signInStatuses('true');

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
  });

  it('never refuses a sign-in when limits are off, however many arrive together', async () => {
    const statuses = await signInStatuses('false');

    expect(statuses).toEqual(Array(signInTimes).fill(200));
  });
});
