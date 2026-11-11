import { json } from '@sveltejs/kit';
import { normalizePlaybackUrl, streamPathFromPlaybackUrl } from '#domain/camera/camera.js';
import { createServerServices } from '#presentation/server/server-services.js';
import { requireAuthorization } from '#presentation/server/require-authorization.js';

/** @param {unknown} error @param {string} fallback */
function apiErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/^FastAPI\s+503:/i.test(message)) return 'Servicio no disponible, intenta de nuevo.';
  if (/^FastAPI\s+404:/i.test(message)) return 'La cámara ya no existe. Recarga el inventario.';
  return message.replace(/^FastAPI\s+\d+:\s*/i, '') || fallback;
}
/** @param {unknown} error */
function apiErrorStatus(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = /^FastAPI\s+(\d{3}):/i.exec(message);
  return match ? Number(match[1]) : 500;
}

export async function GET({ request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { cameraService } = createServerServices(request.headers.get('authorization'));
  try {
    return json({ cameras: await cameraService.list() });
  } catch (error) {
    console.error('Error al obtener las cámaras:', error);
    return json({ error: apiErrorMessage(error, 'No se pudieron consultar las cámaras.') }, { status: apiErrorStatus(error) });
  }
}

export async function POST({ request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { cameraService } = createServerServices(request.headers.get('authorization'));
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const normalizedUrl = normalizePlaybackUrl(body?.url);
  const streamPath = streamPathFromPlaybackUrl(normalizedUrl);

  if (!name || name.length > 100) {
    return json({ error: 'El nombre es obligatorio y debe tener como máximo 100 caracteres.' }, { status: 400 });
  }
  if (!normalizedUrl || !streamPath || !/^[a-z0-9_-]{1,64}$/.test(streamPath)) {
    return json({ error: 'Ingresa una URL HTTPS válida cuyo último segmento sea el identificador de la cámara.' }, { status: 400 });
  }

  try {
    return json(await cameraService.register({ name, normalizedUrl, streamPath }), { status: 201 });
  } catch (error) {
    console.error('[SentriX] Error al registrar cámara:', error);
    return json({ error: apiErrorMessage(error, 'No se pudo registrar la cámara.') }, { status: apiErrorStatus(error) });
  }
}

export async function PUT({ request, url }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { cameraService } = createServerServices(request.headers.get('authorization'));
  const id = url.searchParams.get('id')?.trim();
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const normalizedUrl = normalizePlaybackUrl(body?.url);
  const streamPath = streamPathFromPlaybackUrl(normalizedUrl);
  if (!id) return json({ error: 'Falta el identificador de la cámara.' }, { status: 400 });
  if (!name || name.length > 100) return json({ error: 'El nombre es obligatorio y debe tener como máximo 100 caracteres.' }, { status: 400 });
  if (!normalizedUrl || !streamPath || !/^[a-z0-9_-]{1,64}$/.test(streamPath)) {
    return json({ error: 'Ingresa una URL HTTPS válida cuyo último segmento sea el identificador de la cámara.' }, { status: 400 });
  }
  try {
    return json(await cameraService.update(id, { name, normalizedUrl, streamPath }));
  } catch (error) {
    console.error('[SentriX] Error al actualizar cámara:', error);
    return json({ error: apiErrorMessage(error, 'No se pudo actualizar la cámara.') }, { status: apiErrorStatus(error) });
  }
}

export async function DELETE({ url, request }) {
  const unauthorized = requireAuthorization(request); if (unauthorized) return unauthorized;
  const { cameraService } = createServerServices(request.headers.get('authorization'));
  const id = url.searchParams.get('id')?.trim();
  if (!id) return json({ error: 'Falta el identificador de la cámara.' }, { status: 400 });

  try {
    return json(await cameraService.remove(id));
  } catch (error) {
    console.error('[SentriX] Error al eliminar cámara:', error);
    return json({ error: apiErrorMessage(error, 'No se pudo eliminar la cámara.') }, { status: apiErrorStatus(error) });
  }
}
