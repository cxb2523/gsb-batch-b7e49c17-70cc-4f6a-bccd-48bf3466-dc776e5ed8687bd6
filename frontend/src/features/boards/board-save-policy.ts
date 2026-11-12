/**
 * What to do after a save attempt. Kept free of React and of the editor so the rules can be tested
 * on their own, and so the failure paths are explicit rather than scattered through a callback.
 *
 * A failed save must never navigate the user away from unsaved work (audit H11).
 */

export type SaveOutcome =
  /** The payload was stored. */
  | { action: 'saved' }
  /** The user may no longer edit this board (403). Existing behaviour is read-only plus export. */
  | { action: 'revoked' }
  /** Instance or account storage limit reached (403 LIMIT_REACHED). Keep editor open, stash work, toast error. */
  | { action: 'limit-reached'; message?: string | undefined }
  /** The session expired (401). Keep the editor open and let the user sign in again. */
  | { action: 'sign-in-required' }
  /** The project key rotated; re-fetch the keys, re-seal and retry without a dialog. */
  | { action: 'key-rotated' }
  /** Concurrent modification conflict (409 BOARD_CONFLICT). */
  | { action: 'conflict'; serverRevision?: number | undefined }
  /** Network failure, 5xx, 429 or anything else transient. Retry after a delay. */
  | { action: 'retry-later'; retryAfterMs: number };

/** Retries never wait longer than this, however many attempts have failed. */
export const MAX_RETRY_DELAY_MS = 30_000;

const BASE_RETRY_DELAY_MS = 1_000;
const MAX_BACKOFF_STEP = 5;

/** Exponential backoff, bounded: 1s, 2s, 4s, 8s, 16s, then 30s forever. */
export function retryDelayMs(attempt: number): number {
  const step = Math.min(Math.max(Math.trunc(attempt), 0), MAX_BACKOFF_STEP);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** step, MAX_RETRY_DELAY_MS);
}

/** Classifies the status of a save that reached the server. */
export function classifySaveResponse(
  status: number,
  attempt = 0,
  code?: string,
  revision?: number,
  message?: string,
): SaveOutcome {
  if (status >= 200 && status < 300) return { action: 'saved' };
  if (status === 409 && code === 'KEY_ROTATED') return { action: 'key-rotated' };
  if (status === 409 && code === 'BOARD_CONFLICT') {
    return { action: 'conflict', serverRevision: revision };
  }
  if (status === 401) return { action: 'sign-in-required' };
  if (status === 403 && code === 'LIMIT_REACHED') {
    return { action: 'limit-reached', message };
  }
  if (status === 403) return { action: 'revoked' };
  return { action: 'retry-later', retryAfterMs: retryDelayMs(attempt) };
}

/** Classifies a save that threw before producing a status: always transient. */
export function classifySaveError(attempt = 0): SaveOutcome {
  return { action: 'retry-later', retryAfterMs: retryDelayMs(attempt) };
}
