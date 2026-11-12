import { describe, it, expect } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import { CreateBoardDto, UpdateBoardSchema } from '../src/boards/dto/board.dto.js';
import { PaginationQuerySchema } from '../src/common/dto/pagination.dto.js';
import { CreateProjectSchema } from '../src/projects/dto/project.dto.js';
import { InviteMemberSchema } from '../src/workspaces/dto/workspace.dto.js';
import { DevLoginSchema } from '../src/auth/dto/auth.dto.js';
import { V1_WRAPPED_KEY } from './integration/fixtures.js';

describe('Zod DTO Validation & Production Schema Enforcement', () => {
  const pipe = new ZodValidationPipe();

  describe('Board DTOs', () => {
    it('validates and accepts clean board creation input', () => {
      const valid = {
        id: '2a6c7e8f-3b4d-4c5e-9f01-23456789abcd',
        projectId: 'p123',
        title: 'Network Topology',
        encryptedBoardKey: V1_WRAPPED_KEY,
        projectKeyVersion: 1,
      };
      const res = pipe.transform(valid, { type: 'body', metatype: CreateBoardDto });
      expect(res.title).toBe('Network Topology');
      expect(res.projectId).toBe('p123');
    });

    it('rejects board creation when title or projectId is missing', () => {
      expect(() =>
        pipe.transform(
          { projectId: '', title: 'Valid Title' },
          { type: 'body', metatype: CreateBoardDto },
        ),
      ).toThrow();

      expect(() =>
        pipe.transform(
          { projectId: 'p123', title: '   ' },
          { type: 'body', metatype: CreateBoardDto },
        ),
      ).toThrow();
    });

    it('enforces title character limit in UpdateBoardSchema', () => {
      const longTitle = 'a'.repeat(101);
      expect(() => UpdateBoardSchema.parse({ title: longTitle })).toThrow();
      expect(UpdateBoardSchema.parse({ title: 'Short Title' }).title).toBe('Short Title');
    });
  });

  describe('Pagination Query Coercion & Minimum 20 Rule', () => {
    it('coerces string page and limit to numbers', () => {
      const parsed = PaginationQuerySchema.parse({ page: '2', limit: '25' });
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(25);
    });

    it('enforces minimum limit of 20 items per page when smaller is passed', () => {
      const parsed = PaginationQuerySchema.parse({ page: '1', limit: '5' });
      expect(parsed.limit).toBe(20);
    });

    it('caps limit at 100 items per page', () => {
      const parsed = PaginationQuerySchema.parse({ page: '1', limit: '500' });
      expect(parsed.limit).toBe(100);
    });
  });

  describe('Project & Workspace DTOs', () => {
    it('rejects empty project names in CreateProjectSchema', () => {
      expect(() => CreateProjectSchema.parse({ name: '' })).toThrow();
      expect(
        CreateProjectSchema.parse({
          id: '0f9a2f4e-7f8b-4b4e-9a3c-c3f6f4f0a1b2',
          name: 'Alpha Core',
          encryptedProjectKey: V1_WRAPPED_KEY,
          creatorEncryptedProjectKey: V1_WRAPPED_KEY,
        }).name,
      ).toBe('Alpha Core');
    });

    it('validates email formatting in InviteMemberSchema', () => {
      expect(() => InviteMemberSchema.parse({ email: 'not-an-email' })).toThrow();
      expect(InviteMemberSchema.parse({ email: 'dev@company.com' }).email).toBe('dev@company.com');
    });

    it('validates email in DevLoginSchema', () => {
      expect(() => DevLoginSchema.parse({ email: 'invalid' })).toThrow();
      expect(DevLoginSchema.parse({ email: 'user@local.com' }).email).toBe('user@local.com');
    });
  });

  describe('Configurable Rate Limiter Environment Schema', () => {
    it('defaults rate limiter to enabled with 60s TTL and 100 requests limit', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');
      const baseEnv = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        AUTH_SECRET: '12345678901234567890123456789012',
        S3_BUCKET_NAME: 'test-bucket',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        ENABLE_DEV_LOGIN: 'true',
      };

      const parsed = envSchema.parse(baseEnv);
      expect(parsed.RATE_LIMIT_ENABLED).toBe(true);
      expect(parsed.RATE_LIMIT_TTL).toBe(60);
      expect(parsed.RATE_LIMIT_LIMIT).toBe(100);
    });

    it('allows overriding rate limiter variables for custom environments', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');
      const customEnv = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        AUTH_SECRET: '12345678901234567890123456789012',
        S3_BUCKET_NAME: 'test-bucket',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        ENABLE_DEV_LOGIN: 'true',
        RATE_LIMIT_ENABLED: 'false',
        RATE_LIMIT_TTL: '120',
        RATE_LIMIT_LIMIT: '500',
      };

      const parsed = envSchema.parse(customEnv);
      expect(parsed.RATE_LIMIT_ENABLED).toBe(false);
      expect(parsed.RATE_LIMIT_TTL).toBe(120);
      expect(parsed.RATE_LIMIT_LIMIT).toBe(500);
    });
  });

  describe('TRUST_PROXY, Limits, and Demo Mode Configuration', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: '12345678901234567890123456789012',
      S3_BUCKET_NAME: 'test-bucket',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    };

    it('defaults TRUST_PROXY to false and limits to unlimited', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');
      const parsed = envSchema.parse(baseEnv);
      expect(parsed.TRUST_PROXY).toBe(false);
      expect(parsed.LIMIT_SIGNUPS_PER_IP).toBeUndefined();
      expect(parsed.LIMIT_SIGNUPS_WINDOW_SECONDS).toBe(3600);
      expect(parsed.LIMIT_WORKSPACES_PER_ACCOUNT).toBeUndefined();
      expect(parsed.LIMIT_BOARDS_PER_ACCOUNT).toBeUndefined();
      expect(parsed.LIMIT_STORAGE_MB_PER_ACCOUNT).toBeUndefined();
      expect(parsed.DEMO_MODE).toBe(false);
    });

    it('parses valid hop counts and IP/CIDR lists for TRUST_PROXY', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      const hop1 = envSchema.parse({ ...baseEnv, TRUST_PROXY: '1' });
      expect(hop1.TRUST_PROXY).toBe(1);

      const hop2 = envSchema.parse({ ...baseEnv, TRUST_PROXY: '2' });
      expect(hop2.TRUST_PROXY).toBe(2);

      const cidr = envSchema.parse({
        ...baseEnv,
        TRUST_PROXY: '10.0.0.0/8, 172.16.0.0/12, 192.168.1.1',
      });
      expect(cidr.TRUST_PROXY).toBe('10.0.0.0/8, 172.16.0.0/12, 192.168.1.1');
    });

    it('rejects invalid TRUST_PROXY values (true, 0, negative, invalid text)', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      expect(() => envSchema.parse({ ...baseEnv, TRUST_PROXY: 'true' })).toThrow();
      expect(() => envSchema.parse({ ...baseEnv, TRUST_PROXY: '0' })).toThrow();
      expect(() => envSchema.parse({ ...baseEnv, TRUST_PROXY: '-1' })).toThrow();
      expect(() => envSchema.parse({ ...baseEnv, TRUST_PROXY: 'invalid-proxy' })).toThrow();
    });

    it('validates instance limits as positive integers', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      const parsed = envSchema.parse({
        ...baseEnv,
        LIMIT_SIGNUPS_PER_IP: '5',
        LIMIT_SIGNUPS_WINDOW_SECONDS: '7200',
        LIMIT_WORKSPACES_PER_ACCOUNT: '3',
        LIMIT_BOARDS_PER_ACCOUNT: '10',
        LIMIT_STORAGE_MB_PER_ACCOUNT: '100',
      });

      expect(parsed.LIMIT_SIGNUPS_PER_IP).toBe(5);
      expect(parsed.LIMIT_SIGNUPS_WINDOW_SECONDS).toBe(7200);
      expect(parsed.LIMIT_WORKSPACES_PER_ACCOUNT).toBe(3);
      expect(parsed.LIMIT_BOARDS_PER_ACCOUNT).toBe(10);
      expect(parsed.LIMIT_STORAGE_MB_PER_ACCOUNT).toBe(100);

      expect(() => envSchema.parse({ ...baseEnv, LIMIT_BOARDS_PER_ACCOUNT: '0' })).toThrow();
      expect(() => envSchema.parse({ ...baseEnv, LIMIT_WORKSPACES_PER_ACCOUNT: '-2' })).toThrow();
    });

    it('allows DEMO_MODE=true in production without OAuth providers', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      const parsed = envSchema.parse({
        ...baseEnv,
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
      });

      expect(parsed.DEMO_MODE).toBe(true);
      expect(parsed.NODE_ENV).toBe('production');
    });

    it('refuses DEMO_MODE=true together with ENABLE_DEV_LOGIN=true', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      expect(() =>
        envSchema.parse({
          ...baseEnv,
          DEMO_MODE: 'true',
          ENABLE_DEV_LOGIN: 'true',
        }),
      ).toThrow(/DEMO_MODE cannot be enabled together with ENABLE_DEV_LOGIN/);
    });

    it('refuses production mode without OAuth and without DEMO_MODE', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      expect(() =>
        envSchema.parse({
          ...baseEnv,
          NODE_ENV: 'production',
        }),
      ).toThrow(/Production mode requires a configured sign-in provider/);
    });

    it('validates FIRST_ACCOUNT_EMAIL correctly', async () => {
      const { envSchema } = await import('../src/config/env.schema.js');

      const valid = envSchema.parse({
        ...baseEnv,
        FIRST_ACCOUNT_EMAIL: 'operator@canvhq.com',
      });
      expect(valid.FIRST_ACCOUNT_EMAIL).toBe('operator@canvhq.com');

      expect(() =>
        envSchema.parse({
          ...baseEnv,
          FIRST_ACCOUNT_EMAIL: 'invalid-email',
        }),
      ).toThrow();

      expect(() =>
        envSchema.parse({
          ...baseEnv,
          DEMO_MODE: 'true',
          FIRST_ACCOUNT_EMAIL: 'operator@canvhq.com',
        }),
      ).toThrow(/FIRST_ACCOUNT_EMAIL cannot be enabled together with DEMO_MODE/);
    });
  });
});
