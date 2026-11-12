import { describe, it, expect } from 'vitest';
import {
  MAX_RETRY_DELAY_MS,
  classifySaveError,
  classifySaveResponse,
  retryDelayMs,
} from './board-save-policy';

describe('board save policy', () => {
  it.each([200, 201, 204])('treats %i as saved', (status) => {
    expect(classifySaveResponse(status)).toEqual({ action: 'saved' });
  });

  it('asks for sign-in on 401 instead of navigating away', () => {
    expect(classifySaveResponse(401)).toEqual({ action: 'sign-in-required' });
  });

  it('switches to read-only on 403', () => {
    expect(classifySaveResponse(403)).toEqual({ action: 'revoked' });
  });

  it('keeps editor open and reports limit-reached on 403 LIMIT_REACHED', () => {
    expect(
      classifySaveResponse(403, 0, 'LIMIT_REACHED', undefined, 'Storage limit reached'),
    ).toEqual({
      action: 'limit-reached',
      message: 'Storage limit reached',
    });
  });

  it.each([408, 429, 500, 502, 503, 504])('retries a %i with a delay', (status) => {
    const outcome = classifySaveResponse(status, 0);
    expect(outcome.action).toBe('retry-later');
    if (outcome.action !== 'retry-later') return;
    expect(outcome.retryAfterMs).toBe(1000);
  });

  it('treats a thrown request as transient', () => {
    const outcome = classifySaveError(1);
    expect(outcome.action).toBe('retry-later');
    if (outcome.action !== 'retry-later') return;
    expect(outcome.retryAfterMs).toBe(2000);
  });

  it('backs off exponentially and stays bounded', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(retryDelayMs(6)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(100)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(-2)).toBe(1000);
  });

  it('recognises a rotated project key as a silent re-seal, not a content conflict', () => {
    expect(classifySaveResponse(409, 0, 'KEY_ROTATED')).toEqual({ action: 'key-rotated' });
    expect(classifySaveResponse(409, 0, 'BOARD_CONFLICT', 5)).toEqual({
      action: 'conflict',
      serverRevision: 5,
    });
    expect(classifySaveResponse(409, 0, 'SOMETHING_ELSE').action).toBe('retry-later');
  });

  it('carries the backoff for the current attempt in a retry outcome', () => {
    const outcome = classifySaveResponse(503, 3);
    expect(outcome).toEqual({ action: 'retry-later', retryAfterMs: 8000 });
  });
});
