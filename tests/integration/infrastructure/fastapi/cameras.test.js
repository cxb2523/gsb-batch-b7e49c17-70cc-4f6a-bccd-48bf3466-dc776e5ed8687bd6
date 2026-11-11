import assert from 'node:assert/strict';
import test from 'node:test';
import { streamUrls } from '../../support/real-api.js';

assert.deepEqual(streamUrls, [
  'https://184.194.94.182/camera01/',
  'https://184.194.94.182/camera03/'
]);

for (const streamUrl of streamUrls) {
  const cameraPath = new URL(streamUrl).pathname.replaceAll('/', '');

  test(`${cameraPath} entrega la página real de reproducción`, async () => {
    const response = await fetch(streamUrl, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  });
}
