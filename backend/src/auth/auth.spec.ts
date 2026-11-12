import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createAuth } from './auth.js';
import { validateEnv } from '../config/env.schema.js';

describe('createAuth factory', () => {
  const mockPrisma: any = {
    user: { count: vi.fn() },
    invitation: { findFirst: vi.fn() },
  };

  it('builds provider with configured baseURL, secret, and trustedOrigins (Q-B4 regression)', () => {
    const config = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/canvhq',
      AUTH_SECRET: 'a-super-secret-key-that-is-at-least-32-chars-long',
      AUTH_URL: 'https://auth.custom-domain.com',
      FRONTEND_URL: 'https://app.custom-domain.com',
      S3_BUCKET_NAME: 'canvhq-boards',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadminpassword',
    });

    const auth = createAuth(new ConfigService(config) as any, mockPrisma);

    expect(auth.options.baseURL).toBe('https://auth.custom-domain.com');
    expect(auth.options.secret).toBe('a-super-secret-key-that-is-at-least-32-chars-long');
    expect(auth.options.trustedOrigins).toEqual(config.trustedOrigins);
  });

  it('registers only configured social providers and no placeholders', () => {
    const config = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/canvhq',
      AUTH_SECRET: 'a-super-secret-key-that-is-at-least-32-chars-long',
      S3_BUCKET_NAME: 'canvhq-boards',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadminpassword',
      GOOGLE_CLIENT_ID: 'real-google-id',
      GOOGLE_CLIENT_SECRET: 'real-google-secret',
    });

    const auth = createAuth(new ConfigService(config) as any, mockPrisma);

    expect(Object.keys(auth.options.socialProviders ?? {})).toEqual(['google']);
    expect((auth.options.socialProviders as any).google).toEqual({
      clientId: 'real-google-id',
      clientSecret: 'real-google-secret',
    });
  });
});
