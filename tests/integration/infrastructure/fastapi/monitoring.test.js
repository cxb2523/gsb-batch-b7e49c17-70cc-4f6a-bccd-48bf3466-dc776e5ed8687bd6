import assert from 'node:assert/strict';
import test from 'node:test';
import { realApi } from '../../support/real-api.js';

test('FastAPI permite consultar detecciones sin modificar datos', async () => {
  const { response, payload } = await realApi('/detections?limit=10');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload), 'La respuesta de detecciones no es una lista');
});
