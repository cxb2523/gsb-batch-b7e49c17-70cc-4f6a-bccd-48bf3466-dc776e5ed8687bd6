import assert from 'node:assert/strict';

export const apiUrl = String(process.env.INFERENCE_API_URL ?? '').replace(/\/$/, '');
const apiKey = String(process.env.INFERENCE_API_KEY ?? '');

export const streamUrls = (
  process.env.E2E_STREAM_URLS ??
  'https://184.194.94.182/camera01/,https://184.194.94.182/camera03/'
)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

export function requireRealApiConfiguration() {
  assert.ok(apiUrl, 'Falta INFERENCE_API_URL en .env');
  assert.ok(apiKey, 'Falta INFERENCE_API_KEY en .env');
}

export async function realApi(path) {
  requireRealApiConfiguration();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

