import assert from 'node:assert/strict';
import test from 'node:test';
import { realApi } from '../../support/real-api.js';

test('FastAPI real responde correctamente en /health', async () => {
  const { response, payload } = await realApi('/health');
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
});
