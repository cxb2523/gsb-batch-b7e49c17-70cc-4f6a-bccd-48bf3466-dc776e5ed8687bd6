/** @param {{ inferenceClient: (path: string, options?: any) => Promise<any> }} dependencies */
export function createDetectionService({ inferenceClient }) {
  return {
    /** @param {{ limit?: number, offset?: number }} options */
    async list({ limit = 10, offset = 0 } = {}) {
      const safeLimit = boundedInteger(limit, 10, 1, 100);
      const safeOffset = boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const response = await inferenceClient(`/detections?limit=${safeLimit}&offset=${safeOffset}`, { includeHeaders: true });
      const payload = response?.data ?? response;
      const headerTotal = Number(response?.headers?.['x-total-count']);
      return Array.isArray(payload)
        ? { items: payload, total: Number.isFinite(headerTotal) ? headerTotal : null }
        : { items: payload.items ?? payload.detections ?? [], total: Number.isFinite(payload.total) ? payload.total : (Number.isFinite(headerTotal) ? headerTotal : null) };
    },
    /** @param {{ date?: string }} options */
    async summary({ date } = {}) {
      const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : undefined;
      const query = safeDate ? `?date=${encodeURIComponent(safeDate)}` : '';
      return inferenceClient(`/detections/summary${query}`);
    }
  };
}

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), minimum), maximum);
}
