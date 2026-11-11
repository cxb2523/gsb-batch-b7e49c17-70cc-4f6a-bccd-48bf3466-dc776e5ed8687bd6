/** @param {unknown} value */
export function normalizePlaybackUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/** @param {unknown} value */
export function streamPathFromPlaybackUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    if (parsed.protocol !== 'https:') return '';
    return parsed.pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}

/** @param {unknown} value */
export function cameraNumberFromId(value) {
  const number = Number(String(value ?? '').match(/(?:camara|camera)(\d+)$/i)?.[1]);
  return Number.isInteger(number) ? number : 0;
}

/**
 * @param {Array<{ id: string, number?: number, enabled?: boolean }>} cameras
 */
export function nextAvailableCameraNumber(cameras) {
  const activeNumbers = new Set(cameras.filter((item) => item.enabled !== false).map((item) => {
    const savedNumber = Number(item.number);
    return Number.isInteger(savedNumber) && savedNumber > 0 ? savedNumber : cameraNumberFromId(item.id);
  }).filter((value) => Number.isInteger(value) && value > 0));

  let number = 1;
  while (activeNumbers.has(number)) number += 1;
  return number;
}
