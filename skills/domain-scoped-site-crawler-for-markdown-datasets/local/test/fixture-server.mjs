/**
 * Test-only HTTP server for the local fixture site.
 *
 * Serves files from fixtures/site and adds two failure behaviours used by the
 * tests:
 * - /broken.html responds with HTTP 500
 * - /reset.html destroys the socket (simulating a connection failure)
 *
 * It also records every request path so tests can assert that pages skipped by
 * robots.txt were never fetched at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = path.join(here, '..', 'fixtures', 'site');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Start the fixture server.
 *
 * @param {{ port?: number }} [options] Port to listen on; 0 (default) picks an
 *   ephemeral port.
 * @returns {Promise<{ origin: string, requests: string[], lastUserAgent: () => string|null,
 *                     resetRequests: () => void, close: () => Promise<void> }>}
 */
export async function startFixtureServer({ port = 0 } = {}) {
  const { default: http } = await import('node:http');
  const requests = [];
  let lastUserAgent = null;

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://fixture.local');
    const pathname = decodeURIComponent(requestUrl.pathname);
    requests.push(pathname);
    if (typeof request.headers['user-agent'] === 'string') {
      lastUserAgent = request.headers['user-agent'];
    }

    if (pathname === '/broken.html') {
      response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><body><h1>500</h1></body></html>');
      return;
    }
    if (pathname === '/reset.html') {
      request.socket.destroy();
      return;
    }

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(FIXTURE_ROOT, relative);
    // Only serve files inside the fixture root.
    if (!filePath.startsWith(FIXTURE_ROOT + path.sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }
      const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': contentType });
      response.end(content);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    requests,
    lastUserAgent: () => lastUserAgent,
    resetRequests() {
      requests.length = 0;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
