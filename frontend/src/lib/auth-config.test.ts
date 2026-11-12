import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthConfig, clearAuthConfigCache } from './auth-config';
import { errorResponse, jsonResponse, networkFailure } from '@/test/http';

const FALLBACK_CONFIG = {
  devLoginEnabled: false,
  demoMode: false,
  allowSignups: true,
  isFirstAccountSetup: false,
  providers: [],
};

describe('auth-config module', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAuthConfigCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and returns auth config from the API', async () => {
    const mockConfig = {
      devLoginEnabled: true,
      demoMode: false,
      allowSignups: true,
      isFirstAccountSetup: false,
      providers: ['google', 'github'],
      analytics: {
        umami: {
          websiteId: 'test-id',
          hostUrl: 'https://analytics.example.com',
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue(jsonResponse(mockConfig));

    const config = await getAuthConfig();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(config).toEqual(mockConfig);
  });

  it('caches the result and does not re-fetch on subsequent calls', async () => {
    const mockConfig = {
      devLoginEnabled: false,
      allowSignups: true,
      isFirstAccountSetup: false,
      providers: ['google'],
    };

    global.fetch = vi.fn().mockResolvedValue(jsonResponse(mockConfig));

    const config1 = await getAuthConfig();
    const config2 = await getAuthConfig();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(config1).toEqual(config2);
  });

  it('de-duplicates concurrent in-flight requests into a single network fetch', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const slowResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    global.fetch = vi.fn().mockReturnValue(slowResponse);

    const p1 = getAuthConfig();
    const p2 = getAuthConfig();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(
      jsonResponse({
        devLoginEnabled: true,
        allowSignups: false,
        providers: ['github'],
      }),
    );

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1).toEqual(res2);
    expect(res1.devLoginEnabled).toBe(true);
    expect(res1.allowSignups).toBe(false);
    expect(res1.providers).toEqual(['github']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns fallback config when fetch returns non-200 HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(500, 'INTERNAL', 'Server error'));

    const config = await getAuthConfig();

    expect(config).toEqual({ ...FALLBACK_CONFIG, analytics: undefined });
  });

  it('returns fallback config when network error occurs', async () => {
    global.fetch = vi.fn().mockImplementation(() => networkFailure('Network connection lost'));

    const config = await getAuthConfig();

    expect(config).toEqual(FALLBACK_CONFIG);
  });

  it('forces a new network fetch after clearAuthConfigCache is called', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          devLoginEnabled: false,
          allowSignups: true,
          providers: ['github'],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          devLoginEnabled: true,
          allowSignups: false,
          providers: ['google', 'microsoft'],
        }),
      );

    const config1 = await getAuthConfig();
    expect(config1.devLoginEnabled).toBe(false);
    expect(config1.providers).toEqual(['github']);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clearAuthConfigCache();

    const config2 = await getAuthConfig();
    expect(config2.devLoginEnabled).toBe(true);
    expect(config2.providers).toEqual(['google', 'microsoft']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('normalizes malformed or missing fields safely', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        devLoginEnabled: 'not-a-boolean',
        allowSignups: 123,
        isFirstAccountSetup: null,
        providers: 'not-an-array',
      }),
    );

    const config = await getAuthConfig();

    expect(config.devLoginEnabled).toBe(false);
    expect(config.allowSignups).toBe(true);
    expect(config.isFirstAccountSetup).toBe(false);
    expect(config.providers).toEqual([]);
  });
});
