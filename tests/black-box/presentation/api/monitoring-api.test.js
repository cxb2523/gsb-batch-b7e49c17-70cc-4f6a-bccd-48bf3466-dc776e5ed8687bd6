import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApplication } from '../../support/test-server.js';

let app;
before(async () => { app = await startTestApplication(); });
after(async () => { await app?.close(); });

test('GET /api/monitoring conserva los estados de fuente para el tablero', async () => {
  app.backendState.sources.camara1 = { status: 'pending', worker_id: 'worker-1', status_age_seconds: 4 };
  let response = await fetch(`${app.baseUrl}/api/monitoring`);
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.sources.camara1.status, 'pending');
  assert.equal(payload.sources.camara1.worker_id, 'worker-1');

  app.backendState.sources.camara1 = { status: 'running', last_frame_age_seconds: 11 };
  response = await fetch(`${app.baseUrl}/api/monitoring`);
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.sources.camara1.last_frame_age_seconds, 11);

  app.backendState.sources.camara1 = { status: 'stopped' };
  response = await fetch(`${app.baseUrl}/api/monitoring`);
  payload = await response.json();
  assert.equal(payload.sources.camara1.status, 'stopped');
});

test('GET /api/monitoring limpia el snapshot cuando FastAPI cae y se recupera sin reiniciar', async () => {
  app.backendState.sources.camara1 = {
    status: 'running',
    latest_result: { id: 'deteccion-reciente', clase: 'normal' }
  };
  let response = await fetch(`${app.baseUrl}/api/monitoring`);
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.sources.camara1.latest_result.id, 'deteccion-reciente');

  app.backendState.apiAvailable = false;
  response = await fetch(`${app.baseUrl}/api/monitoring`);
  payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.available, false);
  assert.deepEqual(payload.sources, {});
  assert.deepEqual(payload.alerts, []);

  app.backendState.apiAvailable = true;
  response = await fetch(`${app.baseUrl}/api/monitoring`);
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.available, true);
  assert.equal(payload.sources.camara1.latest_result.id, 'deteccion-reciente');
});
