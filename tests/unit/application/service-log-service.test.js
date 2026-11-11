import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceLogService } from '../../../src/application/logs/service-log-service.js';

test('construye filtros y normaliza una respuesta con items', async () => {
  let requestedPath = '';
  const service = createServiceLogService({
    inferenceClient: async (path) => {
      requestedPath = path;
      return { items: [{ id: 'log-1', level: 'INFO' }], total: 1 };
    }
  });
  const result = await service.list({
    camera: 'camara1', level: 'INFO', eventType: 'inference_completed', limit: 10
  });

  assert.equal(requestedPath, '/inference-logs?camera=camara1&level=INFO&event_type=inference_completed&limit=10');
  assert.equal(result.total, 1);
  assert.deepEqual(result.logs, [{ id: 'log-1', level: 'INFO' }]);
});

test('acepta una lista directa de logs', async () => {
  const logs = [{ id: 'log-2', level: 'WARNING' }];
  const service = createServiceLogService({ inferenceClient: async () => logs });
  assert.deepEqual(await service.list({ limit: 100 }), { logs, total: 1 });
});
