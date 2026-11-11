import { json } from '@sveltejs/kit';
import { MonitoringUnavailableError } from '#application/monitoring/monitoring-service.js';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

export async function GET({ url, request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { monitoringService } = createServerServices(request.headers.get('authorization'));
  try {
    return json(await monitoringService.getSnapshot(url.searchParams.get('id')));
  } catch (error) {
    if (!(error instanceof MonitoringUnavailableError)) throw error;
    return json({
      available: false, health: null, source: null, latestDetection: null,
      alerts: [], detections: [], error: error instanceof Error ? error.message : String(error)
    }, { status: 502 });
  }
}
