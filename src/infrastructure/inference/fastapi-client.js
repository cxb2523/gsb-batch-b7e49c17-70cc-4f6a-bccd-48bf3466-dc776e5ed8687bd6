// SOLO servidor. Nunca importar este modulo en +page.svelte.
import { INFERENCE_API_URL, INFERENCE_API_KEY } from '$app/env/private';

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, timeoutMs?: number, retryOnTimeout?: boolean, authorization?: string | null, includeHeaders?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function callInference(path, { method = 'GET', body, timeoutMs = 10_000, retryOnTimeout = true, authorization = null, includeHeaders = false } = {}) {
  const base = INFERENCE_API_URL?.replace(/\/$/, '');
  const key = INFERENCE_API_KEY;
  if (!base || (!authorization && !key)) {
    throw new Error('Configura INFERENCE_API_URL y una sesión Clerk o INFERENCE_API_KEY en .env');
  }
  /** @param {number} timeout */
  const request = async (timeout) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : { 'X-API-Key': key }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = Array.isArray(data.detail)
        ? data.detail.map((/** @type {any} */ item) => `${Array.isArray(item?.loc) ? item.loc.at(-1) : 'dato'}: ${item?.msg ?? 'inválido'}`).join('; ')
        : typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`;
      throw new Error(`FastAPI ${response.status}: ${detail}`);
    }
    if (!includeHeaders) return data;
    return { data, headers: Object.fromEntries(response.headers.entries()) };
  };

  try { return await request(timeoutMs); }
  catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    if (!retryOnTimeout || !timedOut || timeoutMs >= 70_000) throw error;
    // Render puede despertar tras inactividad; se intenta una sola vez con margen amplio.
    return request(70_000);
  }
}
