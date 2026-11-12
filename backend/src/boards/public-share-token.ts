/**
 * A public share token is one URL path segment: letters, digits, `_` and `-`, at most 64.
 * Tokens that do not fit this shape are malformed requests (400), not unknown links (404).
 */
const PUBLIC_SHARE_TOKEN_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

export function isPublicShareTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && PUBLIC_SHARE_TOKEN_FORMAT.test(token);
}
