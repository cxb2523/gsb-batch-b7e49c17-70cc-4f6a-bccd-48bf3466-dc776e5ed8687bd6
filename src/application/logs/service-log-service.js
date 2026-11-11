/**
 * @param {{ inferenceClient: (path: string) => Promise<any> }} dependencies
 */
export function createServiceLogService({ inferenceClient }) {
  return {
    /** @param {{ camera?: string, level?: string, eventType?: string, limit: number }} filters */
    async list({ camera, level, eventType, limit }) {
      const params = new URLSearchParams();
      if (camera) params.set('camera', camera);
      if (level) params.set('level', level);
      if (eventType) params.set('event_type', eventType);
      params.set('limit', String(limit));

      const payload = await inferenceClient(`/inference-logs?${params.toString()}`);
      const logs = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.logs)
            ? payload.logs
            : [];
      return { logs, total: payload?.total ?? logs.length };
    }
  };
}
