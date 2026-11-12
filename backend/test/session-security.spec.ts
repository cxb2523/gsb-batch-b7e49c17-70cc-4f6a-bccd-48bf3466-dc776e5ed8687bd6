import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createAuth } from '../src/auth/auth.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { UsersController } from '../src/users/users.controller.js';
import { validateEnv } from '../src/config/env.schema.js';

describe('Session & Cookie Security Audit', () => {
  it('Better Auth config enforces secure defaults (HttpOnly, SameSite=Lax, Path=/)', () => {
    const testConfig = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/canvhq',
      AUTH_SECRET: 'super-secret-key-that-is-at-least-32-chars-long',
      AUTH_URL: 'http://localhost:3000',
      S3_BUCKET_NAME: 'canvhq-boards',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadminpassword',
    });
    const mockPrisma: any = { user: { count: vi.fn() }, invitation: { findFirst: vi.fn() } };
    const authInstance = createAuth(new ConfigService(testConfig) as any, mockPrisma);

    const advanced = (authInstance.options as any).advanced;
    expect(advanced).toBeDefined();
    expect(advanced.defaultCookieAttributes).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );

    const session = (authInstance.options as any).session;
    expect(session).toBeDefined();
    expect(session.expiresIn).toBe(60 * 60 * 24 * 7); // 7 days
    expect(session.updateAge).toBe(60 * 60 * 24); // 1 day rolling window
  });

  describe('DevLogin Cookie Hardening', () => {
    let authController: AuthController;
    let prismaMock: any;
    let mockConfigService: any;
    const mockAuth: any = {};

    beforeEach(() => {
      mockConfigService = {
        get: vi.fn((key: string) => {
          if (key === 'ENABLE_DEV_LOGIN') return true;
          if (key === 'NODE_ENV') return 'development';
          if (key === 'AUTH_SECRET') return 'super-secret-key-that-is-at-least-32-chars-long';
          if (key === 'ALLOW_SIGNUPS') return true;
          if (key === 'oauthProviders') return [];
          return undefined;
        }),
      };
      prismaMock = {
        user: {
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        account: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        session: {
          create: vi.fn(),
        },
      };
      authController = new AuthController(prismaMock, mockAuth, mockConfigService);
    });

    it('sets session cookie with HttpOnly, SameSite=lax, and path=/', async () => {
      const mockUser = { id: 'usr-1', email: 'q@local.com', name: 'Qarib' };
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.session.create.mockResolvedValue({
        id: 'sess-1',
        token: 'test-token',
        expiresAt: new Date(Date.now() + 100000),
      });

      const mockRes = {
        cookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      await authController.devLogin({ email: 'q@local.com' }, mockRes);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'better-auth.session_token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        }),
      );
    });
  });

  describe('Account Deletion Cookie Invalidation', () => {
    it('clears session cookie with matching security flags upon account deletion', async () => {
      const usersServiceMock = {
        deleteAccount: vi.fn().mockResolvedValue({ success: true }),
      } as any;
      const configServiceMock = {
        get: vi.fn(() => 'development'),
      } as any;
      const usersController = new UsersController(usersServiceMock, configServiceMock);

      const mockReq = { user: { id: 'usr-1' } } as any;
      const mockRes = {
        clearCookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      await usersController.deleteAccount(mockReq.user, mockRes, {});

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'better-auth.session_token',
        expect.objectContaining({
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        '__Secure-better-auth.session_token',
        expect.objectContaining({
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
      expect(usersServiceMock.deleteAccount).toHaveBeenCalledWith('usr-1', {});
    });
  });
});
