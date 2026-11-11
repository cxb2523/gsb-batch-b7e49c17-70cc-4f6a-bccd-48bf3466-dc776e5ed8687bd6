import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startRealFrontend } from '../../support/frontend-server.js';

let app;
before(async () => { app = await startRealFrontend(); });
after(async () => { await app?.close(); });

test('el frontend comprueba la disponibilidad real de inferencia sin registrar una cámara', async () => {
  const inferenceResponse = await fetch(`${app.baseUrl}/api/inference`, {
    signal: AbortSignal.timeout(30_000)
  });
  const inference = await inferenceResponse.json();
  assert.equal(inferenceResponse.status, 200);
  assert.equal(inference.available, true, inference.error ?? 'La inferencia no está disponible');
  assert.equal(inference.health?.status, 'ok');
});
