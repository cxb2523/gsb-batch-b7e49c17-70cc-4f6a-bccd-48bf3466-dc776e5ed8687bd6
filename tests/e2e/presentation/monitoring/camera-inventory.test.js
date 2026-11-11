import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startRealFrontend } from '../../support/frontend-server.js';

let app;
before(async () => { app = await startRealFrontend(); });
after(async () => { await app?.close(); });

test('el frontend consulta /api/camera sin exigir registros previos', async () => {
  const response = await fetch(`${app.baseUrl}/api/camera`, { signal: AbortSignal.timeout(20_000) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.cameras));
});
