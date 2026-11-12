import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from '../src/config/env.schema.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
  AUTH_SECRET: 'a'.repeat(32),
  S3_BUCKET_NAME: 'test-bucket',
  S3_ACCESS_KEY_ID: 'test-access',
  S3_SECRET_ACCESS_KEY: 'test-secret',
};

describe('validateEnv', () => {
  it('treats a variable that compose passes through empty as not set', () => {
    const config = validateEnv({
      ...requiredEnv,
      LIMIT_BOARDS_PER_ACCOUNT: '',
      LIMIT_STORAGE_MB_PER_ACCOUNT: '',
      FIRST_ACCOUNT_EMAIL: '',
      OPERATOR_CONTACT: '',
      TRUST_PROXY: '',
    });

    expect(config.LIMIT_BOARDS_PER_ACCOUNT).toBeUndefined();
    expect(config.LIMIT_STORAGE_MB_PER_ACCOUNT).toBeUndefined();
    expect(config.FIRST_ACCOUNT_EMAIL).toBeUndefined();
    expect(config.OPERATOR_CONTACT).toBeUndefined();
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('keeps an empty value from reaching the app through Nest’s ConfigService', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, requiredEnv, { LIMIT_WORKSPACES_PER_ACCOUNT: '' });
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnv })],
      }).compile();

      expect(moduleRef.get(ConfigService).get('LIMIT_WORKSPACES_PER_ACCOUNT')).toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it('still refuses a value that is set and wrong', () => {
    expect(() => validateEnv({ ...requiredEnv, LIMIT_BOARDS_PER_ACCOUNT: '0' })).toThrow(
      /LIMIT_BOARDS_PER_ACCOUNT/,
    );
  });
});
