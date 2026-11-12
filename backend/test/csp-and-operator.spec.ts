import { describe, it, expect, vi } from 'vitest';
import { buildCspDirectives } from '../src/app.setup.js';
import { envSchema } from '../src/config/env.schema.js';
import { AuthController } from '../src/auth/auth.controller.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { EnvConfig } from '../src/config/env.schema.js';
import type { Auth } from '../src/auth/auth.js';

function isConfigService(val: unknown): val is ConfigService<EnvConfig, true> {
  return typeof val === 'object' && val !== null;
}

function isPrisma(val: unknown): val is PrismaService {
  return typeof val === 'object' && val !== null;
}

function isAuth(val: unknown): val is Auth {
  return typeof val === 'object' && val !== null;
}

describe('Content Security Policy (H3) and Operator Identity', () => {
  describe('buildCspDirectives', () => {
    it('generates strict CSP with no analytics when unconfigured (Config A)', () => {
      const directives = buildCspDirectives({});

      expect(directives.defaultSrc).toEqual(["'self'"]);
      expect(directives.scriptSrc).toEqual(["'self'"]);
      expect(directives.scriptSrc).not.toContain("'unsafe-inline'");
      expect(directives.styleSrc).toEqual(["'self'", "'unsafe-inline'"]);
      expect(directives.fontSrc).toEqual(["'self'"]);
      expect(directives.imgSrc).toEqual(["'self'", 'data:', 'blob:', 'https:']);
      expect(directives.connectSrc).toEqual(["'self'"]);
      expect(directives.workerSrc).toEqual(["'self'", 'blob:']);
      expect(directives.objectSrc).toEqual(["'none'"]);
      expect(directives.baseUri).toEqual(["'self'"]);
      expect(directives.formAction).toEqual(["'self'"]);
      expect(directives.frameAncestors).toEqual(["'none'"]);
    });

    it('adds Umami host to script-src and connect-src when analytics is configured (Config B)', () => {
      const directives = buildCspDirectives({
        UMAMI_WEBSITE_ID: 'test-site-id',
        UMAMI_HOST_URL: 'https://umami.myhost.com',
      });

      expect(directives.scriptSrc).toEqual(["'self'", 'https://umami.myhost.com']);
      expect(directives.scriptSrc).not.toContain("'unsafe-inline'");
      expect(directives.connectSrc).toEqual(["'self'", 'https://umami.myhost.com']);
    });

    it('defaults Umami host to cloud.umami.is when UMAMI_HOST_URL is unset', () => {
      const directives = buildCspDirectives({
        UMAMI_WEBSITE_ID: 'test-site-id',
      });
      expect(directives.scriptSrc).toEqual(["'self'", 'https://cloud.umami.is']);
      expect(directives.connectSrc).toEqual(["'self'", 'https://cloud.umami.is']);
    });

    it('adds custom API origin from AUTH_URL to connect-src (Config C)', () => {
      const directives = buildCspDirectives({
        AUTH_URL: 'https://api.canvhq.internal:8443/subpath',
      });

      expect(directives.connectSrc).toEqual(["'self'", 'https://api.canvhq.internal:8443']);
    });
  });

  describe('Operator Identity env schema', () => {
    const baseValidEnv = {
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
      AUTH_SECRET: 'a'.repeat(32),
      S3_BUCKET_NAME: 'test-bucket',
      S3_ACCESS_KEY_ID: 'test-access',
      S3_SECRET_ACCESS_KEY: 'test-secret',
    };

    it('allows unset operator name and contact', () => {
      const parsed = envSchema.safeParse(baseValidEnv);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OPERATOR_NAME).toBeUndefined();
        expect(parsed.data.OPERATOR_CONTACT).toBeUndefined();
      }
    });

    it('accepts valid email contact', () => {
      const parsed = envSchema.safeParse({
        ...baseValidEnv,
        OPERATOR_NAME: 'Alice Ops',
        OPERATOR_CONTACT: 'ops@company.org',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OPERATOR_NAME).toBe('Alice Ops');
        expect(parsed.data.OPERATOR_CONTACT).toBe('ops@company.org');
      }
    });

    it('accepts valid URL contact', () => {
      const parsed = envSchema.safeParse({
        ...baseValidEnv,
        OPERATOR_NAME: 'Bob Ops',
        OPERATOR_CONTACT: 'https://support.example.com/contact',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OPERATOR_NAME).toBe('Bob Ops');
        expect(parsed.data.OPERATOR_CONTACT).toBe('https://support.example.com/contact');
      }
    });

    it('rejects invalid contact that is neither email nor URL', () => {
      const parsed = envSchema.safeParse({
        ...baseValidEnv,
        OPERATOR_NAME: 'Charlie',
        OPERATOR_CONTACT: 'phone:123456789',
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('AuthController config route exposes operator details', () => {
    it('returns operator name and contact from config', async () => {
      const configMock: unknown = {
        get: (key: string) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'ENABLE_DEV_LOGIN') return true;
          if (key === 'ALLOW_SIGNUPS') return true;
          if (key === 'DEMO_MODE') return false;
          if (key === 'oauthProviders') return ['google'];
          if (key === 'OPERATOR_NAME') return 'CanvHQ Operator';
          if (key === 'OPERATOR_CONTACT') return 'help@canvhq.local';
          return undefined;
        },
      };
      if (!isConfigService(configMock)) throw new Error('invalid config');

      const prismaMock: unknown = {
        user: { count: vi.fn().mockResolvedValue(1) },
      };
      if (!isPrisma(prismaMock)) throw new Error('invalid prisma');
      const authMock: unknown = {};
      if (!isAuth(authMock)) throw new Error('invalid auth');

      const controller = new AuthController(prismaMock, authMock, configMock);

      const res = await controller.getConfig();
      expect(res.operator).toEqual({
        name: 'CanvHQ Operator',
        contact: 'help@canvhq.local',
      });
    });

    it('returns null operator values when unset', async () => {
      const configMock: unknown = {
        get: (key: string) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'ENABLE_DEV_LOGIN') return true;
          if (key === 'ALLOW_SIGNUPS') return true;
          if (key === 'DEMO_MODE') return false;
          if (key === 'oauthProviders') return [];
          return undefined;
        },
      };
      if (!isConfigService(configMock)) throw new Error('invalid config');

      const prismaMock: unknown = {
        user: { count: vi.fn().mockResolvedValue(0) },
      };
      if (!isPrisma(prismaMock)) throw new Error('invalid prisma');
      const authMock: unknown = {};
      if (!isAuth(authMock)) throw new Error('invalid auth');

      const controller = new AuthController(prismaMock, authMock, configMock);

      const res = await controller.getConfig();
      expect(res.operator).toEqual({
        name: null,
        contact: null,
      });
    });
  });
});
