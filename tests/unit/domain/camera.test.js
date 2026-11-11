import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraNumberFromId,
  nextAvailableCameraNumber,
  normalizePlaybackUrl,
  streamPathFromPlaybackUrl
} from '../../../src/domain/camera/camera.js';

test('normaliza la URL de reproducción', () => {
  assert.equal(normalizePlaybackUrl('  https://media.example/camera01///  '), 'https://media.example/camera01');
  assert.equal(normalizePlaybackUrl(null), '');
});

test('obtiene el stream path de una URL HTTPS', () => {
  assert.equal(streamPathFromPlaybackUrl('https://media.example/live/CAMERA_01/'), 'camera_01');
});

test('rechaza URLs que no utilizan HTTPS', () => {
  assert.equal(streamPathFromPlaybackUrl('http://media.example/camera01'), '');
  assert.equal(streamPathFromPlaybackUrl('rtsp://media.example/camera01'), '');
  assert.equal(streamPathFromPlaybackUrl('no-es-url'), '');
});

test('obtiene el número desde identificadores camera y camara', () => {
  assert.equal(cameraNumberFromId('camara12'), 12);
  assert.equal(cameraNumberFromId('camera7'), 7);
  assert.equal(cameraNumberFromId('entrada'), 0);
});

test('selecciona el primer número disponible', () => {
  const cameras = [
    { id: 'camara1', number: 1, enabled: true },
    { id: 'camara3', number: 3, enabled: true }
  ];
  assert.equal(nextAvailableCameraNumber(cameras), 2);
});

test('permite reutilizar el número de una cámara deshabilitada', () => {
  const cameras = [
    { id: 'camara1', number: 1, enabled: true },
    { id: 'camara2', number: 2, enabled: false }
  ];
  assert.equal(nextAvailableCameraNumber(cameras), 2);
});
