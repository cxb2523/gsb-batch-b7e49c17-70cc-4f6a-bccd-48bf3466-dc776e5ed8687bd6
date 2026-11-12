import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env.schema.js';

describe('Environment Validation (validateEnv)', () => {
  const baseValidEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/canvhq',
    AUTH_SECRET: 'a-super-secret-key-that-is-at-least-32-chars-long',
    S3_BUCKET_NAME: 'canvhq-boards',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadminpassword',
    ENABLE_DEV_LOGIN: 'true',
  };

  it('passes with valid development configuration and parses typed booleans and numbers', () => {
    const config = validateEnv(baseValidEnv as any);
    expect(config.DATABASE_URL).toBe(baseValidEnv.DATABASE_URL);
    expect(config.AUTH_SECRET).toBe(baseValidEnv.AUTH_SECRET);
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_POOL_SIZE).toBe(10);
    expect(config.ENABLE_DEV_LOGIN).toBe(true);
    expect(config.ALLOW_SIGNUPS).toBe(true);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
    expect(config.RATE_LIMIT_TTL).toBe(60);
    expect(config.RATE_LIMIT_LIMIT).toBe(100);
    expect(config.S3_FORCE_PATH_STYLE).toBeUndefined();
    expect(config.oauthProviders).toEqual([]);
    expect(config.trustedOrigins).toContain('http://localhost:5173');
  });

  it('rejects non-boolean strings for boolean flags', () => {
    const invalidBoolEnv = { ...baseValidEnv, ENABLE_DEV_LOGIN: 'yes' };
    expect(() => validateEnv(invalidBoolEnv as any)).toThrow(/ENABLE_DEV_LOGIN/);
  });

  it('rejects legacy BETTER_AUTH_SECRET when AUTH_SECRET is missing', () => {
    const legacyEnv = {
      ...baseValidEnv,
      AUTH_SECRET: undefined,
      BETTER_AUTH_SECRET: 'another-legacy-secret-key-at-least-32-chars-long',
    };
    expect(() => validateEnv(legacyEnv as any)).toThrow(/AUTH_SECRET/);
  });

  it('throws when DATABASE_URL is missing', () => {
    const invalidEnv = { ...baseValidEnv, DATABASE_URL: '' };
    expect(() => validateEnv(invalidEnv as any)).toThrow(/DATABASE_URL is required/);
  });

  it('throws when S3 credentials are missing', () => {
    const invalidEnv = { ...baseValidEnv, S3_ACCESS_KEY_ID: '' };
    expect(() => validateEnv(invalidEnv as any)).toThrow(/S3_ACCESS_KEY_ID is required/);
  });

  it('throws when AUTH_SECRET is shorter than 32 characters', () => {
    const invalidEnv = { ...baseValidEnv, AUTH_SECRET: 'short-secret' };
    expect(() => validateEnv(invalidEnv as any)).toThrow(/at least 32 characters long/);
  });

  it('reports all missing environment variables together in production mode', () => {
    const prodBrokenEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/canvhq',
    };

    expect(() => validateEnv(prodBrokenEnv as any)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /AUTH_SECRET[\s\S]*S3_BUCKET_NAME[\s\S]*S3_ACCESS_KEY_ID[\s\S]*S3_SECRET_ACCESS_KEY[\s\S]*GOOGLE_CLIENT_ID/,
        ),
      }),
    );
  });

  it('throws in production when no social auth provider is configured and dev login is disabled', () => {
    const prodEnvWithoutSocial = {
      ...baseValidEnv,
      NODE_ENV: 'production',
      ENABLE_DEV_LOGIN: 'false',
    };
    expect(() => validateEnv(prodEnvWithoutSocial as any)).toThrow(
      /Production mode requires a configured sign-in provider \(Google/,
    );
  });

  it('passes in production when at least one social auth provider is fully configured', () => {
    const prodEnvWithGoogle = {
      ...baseValidEnv,
      NODE_ENV: 'production',
      ENABLE_DEV_LOGIN: 'false',
      GOOGLE_CLIENT_ID: 'google-client-id-123',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-xyz',
    };
    const config = validateEnv(prodEnvWithGoogle as any);
    expect(config.GOOGLE_CLIENT_ID).toBe('google-client-id-123');
    expect(config.oauthProviders).toEqual(['google']);
    expect(config.trustedOrigins).toEqual(['http://localhost:5173']);
  });

  it('throws in production when ENABLE_DEV_LOGIN is enabled', () => {
    const prodEnvWithDevLogin = {
      ...baseValidEnv,
      NODE_ENV: 'production',
      ENABLE_DEV_LOGIN: 'true',
      GOOGLE_CLIENT_ID: 'google-client-id-123',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-xyz',
    };
    expect(() => validateEnv(prodEnvWithDevLogin as any)).toThrow(
      /ENABLE_DEV_LOGIN cannot be enabled in production mode/,
    );
  });
});
