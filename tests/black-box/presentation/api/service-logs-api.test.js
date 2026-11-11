import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApplication } from '../../support/test-server.js';

let app;
before(async () => { app = await startTestApplication(); });
after(async () => { await app?.close(); });

test('GET /api/service-logs normaliza la respuesta paginada', async () => {
  const response = await fetch(`${app.baseUrl}/api/service-logs?level=INFO&limit=10`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.total, 1);
  assert.deepEqual(payload.logs, [{ id: 'log-1', level: 'INFO' }]);
});
