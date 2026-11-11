import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApplication } from '../../support/test-server.js';

let app;
before(async () => { app = await startTestApplication(); });
after(async () => { await app?.close(); });

test('GET /api/inference compone estado, detecciones y alertas', async () => {
  const response = await fetch(`${app.baseUrl}/api/inference?id=camara1`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.available, true);
  assert.equal(payload.source.status, 'running');
  assert.equal(payload.latestDetection.id, 'det-1');
  assert.equal(payload.detections.length, 1);
  assert.deepEqual(payload.alerts, []);
});
