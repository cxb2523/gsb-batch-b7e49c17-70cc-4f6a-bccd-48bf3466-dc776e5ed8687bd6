import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasVideoSignal,
  MAX_FRAME_AGE_SECONDS,
  MONITOR_POLL_INTERVAL_MS,
  sourceStatusLabel
} from '../../../src/lib/presentation/monitoring/source-status.js';

test('el sondeo de monitoreo se ejecuta cada tres segundos', () => {
  assert.equal(MONITOR_POLL_INTERVAL_MS, 3_000);
});

test('distingue fuente activa, sin señal, estados de worker y datos vencidos', () => {
  assert.equal(hasVideoSignal({ status: 'running', last_frame_age_seconds: MAX_FRAME_AGE_SECONDS }), true);
  assert.equal(hasVideoSignal({ status: 'running', last_frame_age_seconds: MAX_FRAME_AGE_SECONDS + 1 }), false);
  assert.equal(sourceStatusLabel({ status: 'pending' }), 'Esperando procesamiento');
  assert.equal(sourceStatusLabel({ status: 'connecting' }), 'Conectando');
  assert.equal(sourceStatusLabel({ status: 'reconnecting' }), 'Reconectando');
  assert.equal(sourceStatusLabel({ status: 'receiving', status_age_seconds: 11 }), 'Sin datos recientes');
  assert.equal(sourceStatusLabel({ status: 'stopped' }), 'Detenida');
  assert.equal(sourceStatusLabel({ status: 'running' }, false), 'No disponible');
});
