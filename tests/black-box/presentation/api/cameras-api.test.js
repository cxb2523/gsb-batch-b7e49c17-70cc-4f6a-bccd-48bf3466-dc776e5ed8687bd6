import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApplication } from '../../support/test-server.js';

let app;
before(async () => { app = await startTestApplication(); });
after(async () => { await app?.close(); });

test('GET /api/camera lista las cámaras de FastAPI', async () => {
  const response = await fetch(`${app.baseUrl}/api/camera`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cameras.length, 1);
  assert.equal(payload.cameras[0].id, 'camara1');
});

test('POST /api/camera rechaza fuentes sin HTTPS', async () => {
  const response = await fetch(`${app.baseUrl}/api/camera`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Patio', url: 'http://media.example/camera02/' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /URL HTTPS válida/i);
});

test('POST /api/camera registra una fuente e inicia la inferencia', async () => {
  const response = await fetch(`${app.baseUrl}/api/camera`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Patio', url: 'https://media.example/camera02/' })
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.camera.id, 'camara2');
  assert.equal(payload.inference.available, true);
});

test('DELETE /api/camera detiene y elimina una cámara', async () => {
  const response = await fetch(`${app.baseUrl}/api/camera?id=camara2`, { method: 'DELETE' });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.removed, true);
  assert.equal(payload.inferenceStopped, true);
  assert.equal(app.cameras.some((camera) => camera.source_id === 'camara2'), false);
});
