import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraNotFoundError, createCameraService } from '../../../src/application/cameras/camera-service.js';

function registry(cameras = []) {
  return {
    list: async () => cameras,
    get: async (id) => cameras.find((camera) => camera.id === id) ?? null,
    register: async (camera) => { cameras.push(camera); return { ...camera, number: cameras.length, registeredAt: '2026-10-31T00:00:00.000Z', enabled: true }; },
    update: async (camera) => {
      const index = cameras.findIndex((item) => item.id === camera.id);
      if (index >= 0) cameras[index] = { ...cameras[index], ...camera };
      return { ...cameras[index], number: 1, enabled: true };
    },
    remove: async (id) => {
      const index = cameras.findIndex((camera) => camera.id === id);
      if (index >= 0) cameras.splice(index, 1);
    }
  };
}

test('persiste en el repositorio y usa el ID de la cámara registrada', async () => {
  const calls = [];
  const cameras = [];
  const inferenceClient = async (path, options = {}) => {
    calls.push({ path, options });
    return { source_id: options.body.source_id, status: 'running' };
  };
  const service = createCameraService({ inferenceClient, cameraRegistry: registry(cameras) });

  const result = await service.register({
    name: 'Entrada', normalizedUrl: 'https://media.example/camera01', streamPath: 'camera01'
  });

  assert.equal(result.camera.id, 'camara1');
  assert.equal(result.camera.streamPath, 'camera01');
  assert.equal(cameras.length, 1);
  assert.equal(result.inference.available, true);
  assert.deepEqual(calls.map((call) => call.path), ['/sources/start']);
});

test('mantiene la cámara registrada por el backend aunque inferencia no esté disponible', async () => {
  const cameras = [];
  const service = createCameraService({
    inferenceClient: async () => { throw new Error('sin conexión'); },
    cameraRegistry: registry(cameras)
  });

  const result = await service.register({
    name: 'Patio', normalizedUrl: 'https://media.example/camera03', streamPath: 'camera03'
  });

  assert.equal(cameras.length, 1);
  assert.equal(result.camera.id, 'camara1');
  assert.equal(result.inference.available, false);
});

test('recalcula source_id una vez cuando otra sesión registra la cámara primero', async () => {
  const attempts = [];
  let lists = 0;
  const service = createCameraService({
    inferenceClient: async (_path, options) => ({ source_id: options.body.source_id, status: 'pending' }),
    cameraRegistry: {
      list: async () => ++lists === 1 ? [] : [{ id: 'camara1' }],
      get: async () => null,
      register: async (camera) => {
        attempts.push(camera.id);
        if (attempts.length === 1) throw new Error('FastAPI 409: source_id ya existe');
        return { ...camera, number: 2, enabled: true };
      },
      remove: async () => {}
    }
  });

  const result = await service.register({ name: 'Patio', normalizedUrl: 'https://media.example/camera03', streamPath: 'camera03' });
  assert.deepEqual(attempts, ['camara1', 'camara2']);
  assert.equal(result.camera.id, 'camara2');
});

test('start informa cuando la cámara no existe', async () => {
  const service = createCameraService({
    inferenceClient: async () => ({}), cameraRegistry: registry([])
  });
  await assert.rejects(() => service.start('camara99'), CameraNotFoundError);
});

test('actualiza nombre y fuente a través del registro remoto', async () => {
  const cameras = [{ id: 'camara1', name: 'Entrada', streamPath: 'camera01' }];
  const service = createCameraService({ inferenceClient: async () => ({}), cameraRegistry: registry(cameras) });
  const updated = await service.update('camara1', {
    name: 'Puerta principal', normalizedUrl: 'https://media.example/camera02', streamPath: 'camera02'
  });
  assert.equal(updated.camera.name, 'Puerta principal');
  assert.equal(updated.camera.streamPath, 'camera02');
});

test('detiene y reinicia una cámara activa al editarla', async () => {
  const calls = [];
  const cameras = [{ id: 'camara1', name: 'Entrada', streamPath: 'camera01', active: true }];
  let waited = 0;
  const service = createCameraService({
    inferenceClient: async (path, options = {}) => {
      calls.push({ path, options });
      return { status: 'running' };
    },
    cameraRegistry: registry(cameras),
    wait: async (milliseconds) => { waited = milliseconds; }
  });
  const result = await service.update('camara1', {
    name: 'Puerta principal', normalizedUrl: 'https://media.example/camera02', streamPath: 'camera02'
  });
  assert.deepEqual(calls.map((call) => call.path), ['/sources/camara1', '/sources/start']);
  assert.equal(waited, 5_000);
  assert.equal(result.inference.available, true);
  assert.equal(result.camera.streamPath, 'camera02');
});

test('remove no llama al backend cuando la cámara no existe', async () => {
  let calls = 0;
  const service = createCameraService({
    inferenceClient: async () => { calls += 1; }, cameraRegistry: registry([])
  });
  assert.deepEqual(await service.remove('camara99'), { removed: true });
  assert.equal(calls, 0);
});
