export class MonitoringUnavailableError extends Error {}

/**
 * @param {{
 *   inferenceClient: (path: string, options?: { method?: string, body?: unknown }) => Promise<any>,
 *   cameraRegistry: { list: () => Promise<any[]>, get: (id: unknown) => Promise<any> }
 * }} dependencies
 */
export function createMonitoringService({ inferenceClient, cameraRegistry }) {
  return {
    // Resumen eficiente: una salud global, alertas globales y un estado por cámara.
    // No descarga el historial de detecciones durante el sondeo.
    async getDashboardSnapshot() {
      let health;
      try { health = await inferenceClient('/health'); }
      catch (error) { throw new MonitoringUnavailableError(error instanceof Error ? error.message : String(error)); }
      const cameras = await cameraRegistry.list();
      try {
        const [alertsPage, sourcesPayload] = await Promise.all([
          inferenceClient('/alerts?status=active&limit=100&offset=0'),
          inferenceClient('/sources')
        ]);
    const values = Array.isArray(sourcesPayload) ? sourcesPayload : (sourcesPayload?.sources ?? sourcesPayload?.items ?? []);
        const sources = Array.isArray(values)
          ? Object.fromEntries(values.map((source) => [source.source_id ?? source.id, source]).filter(([id]) => typeof id === 'string'))
          : values;
        const workers = health?.rtsp?.workers;
        const workerCount = Array.isArray(workers) ? workers.length : workers && typeof workers === 'object' ? Object.keys(workers).length : 0;
        return { available: health?.status === 'ok' && workerCount > 0, health, alerts: alertsPage.items ?? [], sources };
      } catch (error) {
        return { available: health?.status === 'ok', health, alerts: [], sources: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    /** @param {string | null} requestedId */
    async getSnapshot(requestedId) {
      let health;
      try {
        health = await inferenceClient('/health');
      } catch (error) {
        throw new MonitoringUnavailableError(error instanceof Error ? error.message : String(error));
      }

      let camera;
      try {
        camera = requestedId ? await cameraRegistry.get(requestedId) : (await cameraRegistry.list())[0] ?? null;
      } catch (error) {
        return {
          available: health?.status === 'ok', health, source: null, latestDetection: null,
          alerts: [], detections: [], error: error instanceof Error ? error.message : String(error)
        };
      }
      if (!camera) {
        return {
          available: health?.status === 'ok', health, source: null,
          latestDetection: null, alerts: [], detections: []
        };
      }

      try {
        const [source, detections, alertsPage] = await Promise.all([
          inferenceClient(`/sources/${encodeURIComponent(camera.id)}/status`),
          inferenceClient(`/detections?camera=${encodeURIComponent(camera.id)}&limit=500&offset=0`),
          inferenceClient(`/alerts?camera=${encodeURIComponent(camera.id)}&limit=30`)
        ]);
        const registeredTime = new Date(camera.registeredAt).getTime();
        /** @param {{ fecha_hora: string }} row */
        const isRecent = (row) => !Number.isFinite(registeredTime) || new Date(row.fecha_hora).getTime() >= registeredTime;
        return {
          available: health?.status === 'ok',
          health,
          source,
          detections: detections.filter(isRecent),
          latestDetection: detections.find(isRecent) ?? null,
          alerts: (alertsPage.items ?? []).filter(isRecent)
        };
      } catch (error) {
        return {
          available: health?.status === 'ok', health, source: null, latestDetection: null,
          alerts: [], detections: [], error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
