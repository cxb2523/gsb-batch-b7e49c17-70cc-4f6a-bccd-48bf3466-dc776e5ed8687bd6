import { json } from '@sveltejs/kit';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

export async function GET({ url, request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { detectionService } = createServerServices(request.headers.get('authorization'));
  try { return json(await detectionService.summary({ date: url.searchParams.get('date') ?? undefined })); }
  catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
