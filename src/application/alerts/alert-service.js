/**
 * Servicio de aplicación para los eventos de seguridad.
 * Mantiene el contrato de FastAPI fuera de las rutas HTTP de SvelteKit.
 *
 * @param {{ inferenceClient: (path: string) => Promise<any> }} dependencies
 */
export function createAlertService({ inferenceClient }) {
  return {
    /** @param {{ camera?: string | null, status?: string | null, limit?: number, offset?: number }} filters */
    async list({ camera, status, limit = 100, offset = 0 } = {}) {
      const query = new URLSearchParams({ limit: String(boundedInteger(limit, 100, 1, 500)), offset: String(boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER)) });
      if (typeof camera === 'string' && camera.trim()) query.set('camera', camera.trim().slice(0, 100));
      if (typeof status === 'string' && status.trim()) query.set('status', status.trim().slice(0, 32));
      return inferenceClient(`/alerts?${query}`);
    },
    /** @param {string} id */
    get(id) { return inferenceClient(`/alerts/${encodeURIComponent(id)}`); },
    /** @param {string} id */
    getClip(id) { return inferenceClient(`/alerts/${encodeURIComponent(id)}/clip`); }
  };
}

/** Evita que parámetros externos como NaN, Infinity o decimales lleguen al backend. */
/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), minimum), maximum);
}
