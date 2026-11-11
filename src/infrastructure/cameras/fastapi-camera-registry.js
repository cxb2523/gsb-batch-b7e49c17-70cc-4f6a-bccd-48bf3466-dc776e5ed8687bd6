import { CAMERA_PLAYBACK_URL } from '$app/env/private';
import { cameraNumberFromId } from '#domain/camera/camera.js';
import { callInference } from '../inference/fastapi-client.js';

/**
 * @typedef {{ id: string, number: number, name: string, url: string, streamPath: string, registeredAt: string, enabled: boolean, active: boolean }} Camera
 */

/** @param {any} payload */
function cameraRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.cameras)) return payload.cameras;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

/** @param {any} row @returns {Camera} */
export function mapCamera(row) {
  const id = String(row?.source_id ?? row?.id ?? '').trim();
  const streamPath = String(row?.stream_path ?? row?.streamPath ?? id).trim();
  // Lectura dinámica: la variable se define en Vercel y no debe llegar al navegador.
  const playbackBaseUrl = String(process.env.CAMERA_PLAYBACK_BASE_URL ?? '').trim();
  const configuredUrl = String(CAMERA_PLAYBACK_URL ?? '').trim();
  let playbackUrl = String(row?.url ?? row?.playback_url ?? '').trim();

  if (!playbackUrl && playbackBaseUrl) {
    playbackUrl = `${playbackBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(streamPath)}/`;
  }
  // Compatibilidad temporal con la variable anterior que contenía una URL completa.
  if (!playbackUrl && configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length) segments[segments.length - 1] = streamPath;
      else segments.push(streamPath);
      parsed.pathname = `/${segments.join('/')}/`;
      playbackUrl = parsed.toString();
    } catch {
      playbackUrl = configuredUrl;
    }
  }

  return {
    id,
    number: Number(row?.number) || cameraNumberFromId(id),
    name: String(row?.name ?? row?.nombre ?? id),
    url: playbackUrl,
    streamPath,
    registeredAt: String(row?.registered_at ?? row?.registeredAt ?? row?.created_at ?? row?.fecha_hora ?? ''),
    enabled: row?.enabled !== false,
    active: row?.active === true
  };
}

/** @param {{ includeDisabled?: boolean, inferenceClient?: typeof callInference }} [options] */
export async function getRegisteredCameras({ includeDisabled = false, inferenceClient = callInference } = {}) {
  const cameras = /** @type {Camera[]} */ (cameraRows(await inferenceClient('/cameras')).map(mapCamera));
  return cameras.filter((camera) => camera.id && (includeDisabled || camera.enabled));
}

/** @param {unknown} id @param {{ inferenceClient?: typeof callInference }} [options] */
export async function getRegisteredCamera(id, { inferenceClient = callInference } = {}) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return null;
  return (await getRegisteredCameras({ inferenceClient })).find((camera) => camera.id === wanted) ?? null;
}

/**
 * Registra la cámara en FastAPI/Neon con el contrato vigente: source_id obligatorio.
 * @param {{ id: string, name: string, streamPath: string }} camera
 * @param {{ inferenceClient?: typeof callInference }} [options]
 */
export async function registerCamera(camera, { inferenceClient = callInference } = {}) {
  const payload = await inferenceClient('/cameras', {
    method: 'POST', body: { source_id: camera.id, name: camera.name, stream_path: camera.streamPath }
  });
  return mapCamera(payload?.camera ?? payload);
}

/** @param {{ id: string, name: string, streamPath: string }} camera @param {{ inferenceClient?: typeof callInference }} [options] */
export async function updateRegisteredCamera(camera, { inferenceClient = callInference } = {}) {
  const payload = await inferenceClient(`/cameras/${encodeURIComponent(camera.id)}`, {
    method: 'PUT', body: { source_id: camera.id, name: camera.name, stream_path: camera.streamPath }
  });
  return mapCamera(payload?.camera ?? payload);
}

/** @param {string} id @param {{ inferenceClient?: typeof callInference }} [options] */
export async function removeRegisteredCamera(id, { inferenceClient = callInference } = {}) {
  return inferenceClient(`/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
