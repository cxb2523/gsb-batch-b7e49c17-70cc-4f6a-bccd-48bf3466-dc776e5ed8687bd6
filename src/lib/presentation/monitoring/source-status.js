/** Intervalo máximo acordado para actualizar el tablero de monitoreo. */
export const MONITOR_POLL_INTERVAL_MS = 3_000;

/** Una fuente sin fotogramas durante más de este tiempo se considera sin señal. */
export const MAX_FRAME_AGE_SECONDS = 10;

/** @param {{ status?: string, last_frame_age_seconds?: number | null, status_age_seconds?: number | null } | null | undefined} source */
export function isSourceReceiving(source) {
  return ['receiving', 'running'].includes(String(source?.status ?? '').toLowerCase());
}

/** @param {{ status?: string, last_frame_age_seconds?: number | null, status_age_seconds?: number | null } | null | undefined} source */
export function hasVideoSignal(source) {
  if (!isSourceReceiving(source)) return false;
  const statusAge = source?.status_age_seconds;
  if (statusAge != null && (!Number.isFinite(Number(statusAge)) || Number(statusAge) > MAX_FRAME_AGE_SECONDS)) return false;
  const age = source?.last_frame_age_seconds;
  return age == null || (Number.isFinite(Number(age)) && Number(age) <= MAX_FRAME_AGE_SECONDS);
}

/** @param {{ status?: string, status_age_seconds?: number | null } | null | undefined} source */
export function sourceStatusLabel(source, available = true) {
  if (!available) return 'No disponible';
  const statusAge = source?.status_age_seconds;
  if (statusAge != null && (!Number.isFinite(Number(statusAge)) || Number(statusAge) > MAX_FRAME_AGE_SECONDS)) return 'Sin datos recientes';
  const status = String(source?.status ?? '').toLowerCase();
  if (status === 'pending') return 'Esperando procesamiento';
  if (status === 'connecting') return 'Conectando';
  if (status === 'reconnecting') return 'Reconectando';
  if (isSourceReceiving(source)) return 'En análisis';
  if (status === 'stopped') return 'Detenida';
  return status || 'Sin estado';
}
