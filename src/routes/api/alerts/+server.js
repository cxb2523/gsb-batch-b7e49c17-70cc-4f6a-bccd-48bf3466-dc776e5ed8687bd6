import { json } from '@sveltejs/kit';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

export async function GET({ url, request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { alertService } = createServerServices(request.headers.get('authorization'));
  const camera = url.searchParams.get('camera')?.trim() || null;
  const status = url.searchParams.get('status')?.trim() || null;
  const limit = Number(url.searchParams.get('limit')) || 100;
  const offset = Number(url.searchParams.get('offset')) || 0;
  try {
    return json(await alertService.list({ camera, status, limit, offset }));
  } catch (error) {
    return json({ items: [], total: 0, limit, offset, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
