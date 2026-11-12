import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request, Response } from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { indexHtmlWithSiteUrl } from '../src/static/index-html.js';

describe('indexHtmlWithSiteUrl', () => {
  let staticDir: string;

  beforeAll(() => {
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvhq-index-html-'));
    fs.writeFileSync(
      path.join(staticDir, 'index.html'),
      '<meta property="og:image" content="__SITE_URL__/banner.png" /><meta name="twitter:image" content="__SITE_URL__/banner.png" />',
    );
  });

  afterAll(() => {
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  function appFor(siteUrl: string) {
    const handler = indexHtmlWithSiteUrl(staticDir, siteUrl);
    if (!handler) throw new Error('expected a page shell');
    const app = new ExpressAdapter().getInstance();
    app.use(handler);
    app.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
    app.get('/banner.png', (_req: Request, res: Response) => res.type('text').send('png-bytes'));
    return app;
  }

  it("fills in the host's own address, wherever the app is installed", async () => {
    const res = await request(appFor('https://canvas.example.org/')).get('/');

    expect(res.text).toContain('content="https://canvas.example.org/banner.png"');
    expect(res.text).not.toContain('__SITE_URL__');
  });

  it('keeps only the origin of a public address that has a path', async () => {
    const res = await request(appFor('https://example.org/canvhq/')).get('/');

    expect(res.text).toContain('content="https://example.org/banner.png"');
  });

  it('answers client-side routes with the same page', async () => {
    const res = await request(appFor('https://canvas.example.org')).get('/w/acme/canvas/abc');

    expect(res.status).toBe(200);
    expect(res.text).toContain('https://canvas.example.org/banner.png');
  });

  it('leaves files and the API to the next handler', async () => {
    const app = appFor('https://canvas.example.org');

    expect((await request(app).get('/banner.png')).text).toBe('png-bytes');
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).post('/')).status).toBe(404);
  });

  it('does nothing when there is no built page to serve', () => {
    expect(indexHtmlWithSiteUrl(path.join(staticDir, 'missing'), 'https://example.org')).toBeNull();
  });
});
