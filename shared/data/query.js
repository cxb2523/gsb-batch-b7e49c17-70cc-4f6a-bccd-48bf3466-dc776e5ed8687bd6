// api/_lib/data/query.js
//
// Input validation for the read API. Everything a caller sends is untrusted: each helper either
// returns a clean value or throws an HttpError that the handler turns into a 4xx. Nothing here
// touches the database, so none of it can be reached with an unvalidated value.

import { diffDays, isDateKey } from '../domain/time.js';
import { ERROR_CODES } from './errorCodes.js';

export class HttpError extends Error {
  constructor(status, message, code = ERROR_CODES.INVALID_PARAM) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const one = (v) => (Array.isArray(v) ? v[0] : v);

/** A required, valid, ordered, size-capped date range. */
export function parseRange(query, { maxDays = 3660 } = {}) {
  const from = one(query?.from);
  const to = one(query?.to);
  if (!isDateKey(from) || !isDateKey(to)) throw new HttpError(400, "'from' and 'to' must be dates in YYYY-MM-DD form", ERROR_CODES.INVALID_RANGE);
  const n = diffDays(from, to);
  if (n < 0) throw new HttpError(400, "'from' must not be after 'to'", ERROR_CODES.INVALID_RANGE);
  if (n + 1 > maxDays) throw new HttpError(400, `range is limited to ${maxDays} days`, ERROR_CODES.RANGE_TOO_LARGE);
  return { from, to, days: n + 1 };
}

export function parseDate(query, name) {
  const v = one(query?.[name]);
  if (!isDateKey(v)) throw new HttpError(400, `'${name}' must be a date in YYYY-MM-DD form`, ERROR_CODES.INVALID_DATE);
  return v;
}

export function parseEnum(query, name, allowed, fallback) {
  const v = one(query?.[name]);
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `'${name}' is required`, ERROR_CODES.MISSING_PARAM);
  }
  if (!allowed.includes(v)) throw new HttpError(400, `'${name}' must be one of: ${allowed.join(', ')}`, ERROR_CODES.INVALID_PARAM);
  return v;
}

export function parseIntBounded(query, name, { min, max, fallback }) {
  const raw = one(query?.[name]);
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(String(raw))) throw new HttpError(400, `'${name}' must be an integer`, ERROR_CODES.INVALID_PARAM);
  const n = Number(raw);
  if (n < min || n > max) throw new HttpError(400, `'${name}' must be between ${min} and ${max}`, ERROR_CODES.INVALID_PARAM);
  return n;
}

/** compare=prev,yoy → a de-duplicated subset of the two known baselines. */
export function parseCompare(query) {
  const raw = one(query?.compare);
  if (raw === undefined || raw === '') return [];
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = ['prev', 'yoy'];
  for (const p of parts) if (!allowed.includes(p)) throw new HttpError(400, `'compare' accepts: ${allowed.join(', ')}`, ERROR_CODES.INVALID_PARAM);
  return [...new Set(parts)];
}

export function parseYear(query) {
  const y = parseIntBounded(query, 'year', { min: 2000, max: 2100, fallback: undefined });
  if (y === undefined) throw new HttpError(400, "'year' is required", ERROR_CODES.MISSING_PARAM);
  return y;
}
