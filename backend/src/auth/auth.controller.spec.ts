import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { AUTH, CLIENT_IP_HEADER } from './auth.js';

// What Better Auth's node handler was given, so the test can see the request it would have served.
const handled = vi.hoisted(() => ({ headers: {} as IncomingHttpHeaders }));

vi.mock('better-auth/node', () => ({
  toNodeHandler: () => (req: IncomingMessage, res: ServerResponse) => {
    handled.headers = req.headers;
    res.statusCode = 200;
    res.end('handled');
  },
}));

describe('AuthController', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
    },
    account: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
  };

  let env: Record<string, unknown>;
  let app: INestApplication;

  beforeEach(async () => {
    env = {
      NODE_ENV: 'development',
      ENABLE_DEV_LOGIN: true,
      AUTH_SECRET: 'super-secret-key-that-is-at-least-32-chars-long',
      ALLOW_SIGNUPS: true,
      oauthProviders: [],
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: AUTH, useValue: {} },
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should delegate request handling to Better Auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set(CLIENT_IP_HEADER, '203.0.113.99');

    expect(response.status).toBe(200);
    expect(response.text).toBe('handled');
    // A client-sent value is replaced by the address Express resolved from TRUST_PROXY.
    expect(handled.headers[CLIENT_IP_HEADER]).toMatch(/127\.0\.0\.1$/);
  });

  it('should return auth configuration from injected config', async () => {
    env.oauthProviders = ['google', 'github'];

    const { body } = await request(app.getHttpServer()).get('/api/auth/config');

    expect(body.devLoginEnabled).toBe(true);
    expect(body.allowSignups).toBe(true);
    expect(body.isFirstAccountSetup).toBe(false);
    expect(body.providers).toEqual(['google', 'github']);
  });

  it('reports first-account setup on an empty instance, but never in demo mode', async () => {
    prisma.user.count.mockResolvedValueOnce(0);
    const first = await request(app.getHttpServer()).get('/api/auth/config');
    expect(first.body.isFirstAccountSetup).toBe(true);

    // A demo instance is empty after every nightly wipe, and nobody there is setting up an administrator.
    env.DEMO_MODE = true;
    prisma.user.count.mockResolvedValueOnce(0);
    const demo = await request(app.getHttpServer()).get('/api/auth/config');
    expect(demo.body.isFirstAccountSetup).toBe(false);
  });

  it('should reject dev login when disabled or in production', async () => {
    env.ENABLE_DEV_LOGIN = false;

    const response = await request(app.getHttpServer())
      .post('/api/auth/dev-login')
      .send({ email: 'q@local.com' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Dev login is disabled');
  });

  it('should reject dev login for non-test email domains (e.g. victim@corporate.com)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/dev-login')
      .send({ email: 'victim@corporate.com' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      'Dev login is restricted to local development test domains (*@local.com, *@canvhq.internal)',
    );
  });

  it('should issue dev login session and cookie for q@local.com using injected secret', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'usr_1',
      name: 'Qarib',
      email: 'q@local.com',
      image: null,
    });
    prisma.account.findFirst.mockResolvedValueOnce({ id: 'acc_1' });
    prisma.session.create.mockResolvedValueOnce({
      id: 'ses_1',
      token: 'dev_tok_test',
      userId: 'usr_1',
      expiresAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/dev-login')
      .send({ email: 'q@local.com' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, user: { id: 'usr_1' } });
    expect(response.headers['set-cookie']?.[0]).toContain('better-auth.session_token=dev_tok_');
  });
});
