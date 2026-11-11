import { json } from '@sveltejs/kit';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

export async function GET({ url, request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { serviceLogService } = createServerServices(request.headers.get('authorization'));
  const camera = url.searchParams.get('camera')?.trim();
  const level = url.searchParams.get('level')?.trim();
  const eventType = url.searchParams.get('event_type')?.trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);

  try {
    return json(await serviceLogService.list({ camera, level, eventType, limit }));
  } catch (error) {
    return json({ logs: [], total: 0, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
