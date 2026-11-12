// api/_lib/data/handler.js
//
// The read API's request pipeline, built from injected dependencies so it is tested end to end
// without Clerk, Supabase or Solis (api/data/[resource].js wires the real ones).
//
// Order matters and is deliberate, and every LAYER's failure carries a stable machine-readable
// `code` (shared/data/errorCodes.js) so a caller can tell where the failure happened from the
// response itself, instead of every failure looking like a 500:
//   1. CORS / method (GET only)          cheap, reveals nothing        405 method_not_allowed
//   2. authenticate + authorise (viewer) BEFORE touching any data     401 missing_token /
//        or even validating the resource                               invalid_token
//                                                                      403 forbidden
//   3. server configuration guard                                       500 config_*
//   4. rate limit per user                after auth, so anonymous     429 rate_limited
//                                        traffic cannot fill the table  (Retry-After +
//                                                                       X-RateLimit-Remaining)
//   5. resource lookup (allowlist)                                      404 not_found
//   6. validation + query (resources.js)                               400 invalid_* /
//                                                                       missing_param
//   7. response, with no-store-style private caching
//
// Errors: HttpError → its status and message; anything else → a generic 500 (the detail is
// logged, never returned: error text from a database or upstream API is not for callers). A
// failure body never echoes a token, a key, upstream error text or database details.

import { handlePreflightAndMethod } from '../httpSecurity.js';
import { localDateKey } from '../../../shared/domain/time.js';
import { HttpError } from '../../../shared/data/query.js';
import { resolveResource } from '../../../shared/data/resources.js';
import { ERROR_CODES } from '../../../shared/data/errorCodes.js';

const CACHE_SECONDS = 30;

export function createDataHandler({ verify, repo, live, limiter, ready = () => true, now = () => Date.now() }) {
  return async function handler(req, res) {
    if (handlePreflightAndMethod(req, res, ['GET'])) return;

    const user = await verify(req, res); // sends 401/403 itself, with missing_token/invalid_token/forbidden
    if (!user) return;

    if (!ready(res)) return; // a config guard: sends 500 config_* itself

    const limit = limiter.check(user.id);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      return res.status(429).json({ error: 'Too many requests', code: ERROR_CODES.RATE_LIMITED });
    }

    try {
      const name = Array.isArray(req.query?.resource) ? req.query.resource[0] : req.query?.resource;
      const run = resolveResource(name); // 404 not_found for an unknown resource name
      const result = await run(repo, req.query ?? {}, { todayKey: localDateKey(now()), live });

      // Private data: a shared cache (CDN) must never serve one user's response to another.
      res.setHeader('Cache-Control', `private, max-age=${CACHE_SECONDS}`);
      res.setHeader('Vary', 'Authorization');

      if (typeof result.csv === 'string') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        return res.status(200).send(result.csv);
      }
      return res.status(200).json(result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        // 404 not_found (unknown resource) is deliberately distinct from the 400 invalid_*
        // validation codes, so a typo in the path is distinguishable from a bad query parameter.
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      // The original error may carry hostnames, credentials or SQL: log it, answer generically.
      console.error('data handler: unexpected error', err?.message);
      return res.status(500).json({ error: 'Internal error', code: ERROR_CODES.INTERNAL });
    }
  };
}
