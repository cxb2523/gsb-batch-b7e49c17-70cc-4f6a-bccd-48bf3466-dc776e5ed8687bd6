import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';

describe('AuthController.getConfig', () => {
  let controller: AuthController;
  let mockEnv: Record<string, any>;
  let mockConfigService: any;
  const mockPrisma: any = {
    user: {
      count: vi.fn().mockResolvedValue(1),
    },
  };

  beforeEach(() => {
    mockEnv = {
      NODE_ENV: 'development',
      ENABLE_DEV_LOGIN: true,
      AUTH_SECRET: 'super-secret-key-that-is-at-least-32-chars-long',
      ALLOW_SIGNUPS: true,
      oauthProviders: [],
    };
    mockConfigService = {
      get: vi.fn((key: string) => mockEnv[key]),
    };
    controller = new AuthController(mockPrisma, {} as any, mockConfigService);
  });

  it('returns empty providers array when no social client IDs are configured', async () => {
    const config = await controller.getConfig();
    expect(config.providers).toEqual([]);
    expect(config.analytics.umami).toBeNull();
    expect(config.allowSignups).toBe(true);
    expect(config.isFirstAccountSetup).toBe(false);
  });

  it('reflects first account setup when user count is 0', async () => {
    mockPrisma.user.count.mockResolvedValueOnce(0);
    const config = await controller.getConfig();
    expect(config.isFirstAccountSetup).toBe(true);
  });

  it('reflects disabled signups when ALLOW_SIGNUPS is false', async () => {
    mockEnv.ALLOW_SIGNUPS = false;
    const config = await controller.getConfig();
    expect(config.allowSignups).toBe(false);
  });

  it('returns only configured providers', async () => {
    mockEnv.oauthProviders = ['google'];

    const config = await controller.getConfig();
    expect(config.providers).toEqual(['google']);
  });

  it('returns Umami analytics payload when UMAMI_WEBSITE_ID is set', async () => {
    mockEnv.UMAMI_WEBSITE_ID = 'umami-site-123';
    mockEnv.UMAMI_HOST_URL = 'https://custom.analytics.io';

    const config = await controller.getConfig();
    expect(config.analytics.umami).toEqual({
      websiteId: 'umami-site-123',
      hostUrl: 'https://custom.analytics.io',
    });
  });
});
