import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { StaticAssetsModule, resolveStaticDirectory } from '../src/static/static-assets.module.js';
import { ServeStaticModule, ExpressLoader } from '@nestjs/serve-static';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from '../src/health/health.controller.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';

import { Duplex } from 'stream';

function simulateRequest(
  app: INestApplication,
  method: string,
  url: string,
): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const expressApp = app.getHttpAdapter().getInstance();
    let rawOutput = '';
    const socket = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        rawOutput += chunk.toString('utf8');
        cb();
      },
    });

    const req = new http.IncomingMessage(socket as any);
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', accept: 'text/html,*/*' };

    const res = new http.ServerResponse(req);
    res.assignSocket(socket as any);

    Object.setPrototypeOf(req, expressApp.request);
    Object.setPrototypeOf(res, expressApp.response);

    let isDone = false;
    function finish() {
      if (isDone) return;
      isDone = true;
      const bodyStartIndex = rawOutput.indexOf('\r\n\r\n');
      const body = bodyStartIndex !== -1 ? rawOutput.substring(bodyStartIndex + 4) : rawOutput;
      const headers = (res.getHeaders ? res.getHeaders() : {}) as Record<string, any>;
      resolve({
        status: res.statusCode || 200,
        headers,
        body,
      });
    }

    res.on('finish', finish);
    res.on('close', finish);

    try {
      expressApp.handle(req, res, (err: any) => {
        if (err) return reject(err);
        if (!res.writableEnded) {
          res.statusCode = res.statusCode || 404;
          res.end();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

describe('Unified Container SPA Static Serving (Directus Pattern)', () => {
  let app: INestApplication;
  let tempStaticDir: string;

  beforeAll(async () => {
    // 1. Create a mock frontend/dist directory structure
    tempStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvhq-static-test-'));
    fs.writeFileSync(
      path.join(tempStaticDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>CanvHQ SPA</title></head><body><div id="root">CanvHQ App</div></body></html>',
    );
    const assetsDir = path.join(tempStaticDir, 'assets');
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(assetsDir, 'bundle.js'), 'console.log("CanvHQ Static Asset");');

    // 2. Mock dependencies for HealthController
    const prismaMock = {
      $queryRaw: async () => [{ 1: 1 }],
    };
    const storageServiceMock = {
      checkHealth: async () => true,
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ STATIC_DIR: tempStaticDir })],
        }),
        StaticAssetsModule.forRootAsync(),
      ],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // In Test.createTestingModule(), onModuleInit runs before httpAdapter is bound to app.
    // Explicitly set ExpressLoader and re-invoke onModuleInit before app.init() registers Nest routes and filters:
    const serveStaticModule = moduleFixture.get(ServeStaticModule);
    (serveStaticModule as any).loader = new ExpressLoader();
    serveStaticModule.onModuleInit();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (tempStaticDir && fs.existsSync(tempStaticDir)) {
      fs.rmSync(tempStaticDir, { recursive: true, force: true });
    }
  });

  it('serves SPA index.html on root path GET /', async () => {
    const res = await simulateRequest(app, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>CanvHQ SPA</title>');
    expect(res.body).toContain('<div id="root">CanvHQ App</div>');
  });

  it('serves compiled static assets under /assets/*', async () => {
    const res = await simulateRequest(app, 'GET', '/assets/bundle.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toContain('console.log("CanvHQ Static Asset");');
  });

  it('falls back to index.html for client-side deep SPA routing (e.g., /workspace, /profile)', async () => {
    const res = await simulateRequest(app, 'GET', '/workspace/projects/canvas-123');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>CanvHQ SPA</title>');
  });

  it('does NOT capture /api/* routes and routes them to API controllers', async () => {
    const res = await simulateRequest(app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('ok');
    expect(parsed.services.database).toBe('up');
    expect(parsed.services.storage).toBe('up');
  });

  it('detects STATIC_DIR override when present', () => {
    expect(resolveStaticDirectory(tempStaticDir)).toBe(tempStaticDir);
  });
});
