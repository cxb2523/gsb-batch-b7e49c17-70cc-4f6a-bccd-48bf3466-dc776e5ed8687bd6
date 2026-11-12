// shared/data/errorCodes.js
//
// The stable machine-readable failure contract for the API, in one place so the server, the
// browser (src/v3/data/client.js surfaces payload.code as ApiError#code) and the tests agree on
// the spelling. A code is a CONTRACT: once shipped it must not be renamed or reused for a
// different condition — callers branch on it, so a rename is a breaking change even when the
// human-readable `error` string changes.
//
// Codes are grouped by the pipeline layer that emits them, in pipeline order. The point is that
// ops and the frontend can tell WHICH LAYER failed from the response itself, instead of every
// failure looking like a 500:
//
//   transport layer  method_not_allowed
//   authentication   missing_token, invalid_token
//   authorisation    forbidden
//   server config    config_missing_url, config_missing_key, config_key_not_service_role, auth_not_configured
//   rate limiting    rate_limited
//   request shape    not_found, invalid_range, range_too_large, invalid_date, missing_param, invalid_param
//   upstream/data    upstream_unavailable, internal
//
// Every failure response the API sends carries one of these in `{ error, code, ... }`. Failure
// bodies carry NO tokens, keys, upstream error text or database details — only what a caller is
// allowed to know about why the request failed.

export const ERROR_CODES = Object.freeze({
  // Transport / method gate (api/_lib/httpSecurity.js)
  METHOD_NOT_ALLOWED: 'method_not_allowed',

  // Authentication (api/_lib/verifyAdminToken.js) — the request is not (or cannot be)
  // authenticated at all. Always 401.
  MISSING_TOKEN: 'missing_token',
  INVALID_TOKEN: 'invalid_token',
  // The server itself cannot verify tokens because its Clerk secret key is absent. This is a
  // deployment fault, not a caller fault: 500, distinct from a bad token so nobody "fixes" the
  // client against a misconfigured server.
  AUTH_NOT_CONFIGURED: 'auth_not_configured',

  // Authorisation — authenticated, but the access level is too low. Always 403.
  FORBIDDEN: 'forbidden',

  // Server-side Supabase configuration (api/_lib/supabaseServer.js). Always 500, and each code
  // names the exact item that is wrong so the runbook action is unambiguous.
  CONFIG_MISSING_URL: 'config_missing_url',
  CONFIG_MISSING_KEY: 'config_missing_key',
  CONFIG_KEY_NOT_SERVICE_ROLE: 'config_key_not_service_role',

  // Per-user rate limit (api/_lib/data/rateLimit.js → handler). 429, with Retry-After and
  // X-RateLimit-Remaining.
  RATE_LIMITED: 'rate_limited',

  // Request shape / resource resolution (shared/data/*). 4xx.
  NOT_FOUND: 'not_found', // the resource name is not on the allowlist
  INVALID_RANGE: 'invalid_range', // a date-range parameter is malformed or backwards
  RANGE_TOO_LARGE: 'range_too_large', // well-formed range, but bigger than the cap
  INVALID_DATE: 'invalid_date',
  MISSING_PARAM: 'missing_param',
  INVALID_PARAM: 'invalid_param',

  // Upstream / unexpected. A live-source outage we can say something about is 502
  // upstream_unavailable; anything else is a generic 500 whose original text stays in the log.
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  INTERNAL: 'internal'
});
