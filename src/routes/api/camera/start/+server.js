import { json } from '@sveltejs/kit';
import { CameraNotFoundError } from '#application/cameras/camera-service.js';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

export async function POST({ request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { cameraService } = createServerServices(request.headers.get('authorization'));
  const body = await request.json().catch(() => ({}));
  try {
    return json({ source: await cameraService.start(body.id) });
  } catch (error) {
    if (error instanceof CameraNotFoundError) return json({ error: error.message }, { status: 404 });
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
