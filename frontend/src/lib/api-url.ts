/**
 * Resolves the backend API base URL with full unified container and dev proxy support.
 *
 * 1. If VITE_API_URL is explicitly configured, use it (custom backend origin).
 * 2. If running inside a browser:
 *    - In dev mode on port 5173 without explicit VITE_API_URL, fallback to http://localhost:3000
 *    - In production (or unified container / reverse proxy), use window.location.origin (same-origin, 0 CORS overhead)
 * 3. Default fallback for SSR/testing: http://localhost:3000
 */
export function getApiBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // `location` exists in a page and in a Web Worker alike; `window` does not exist in a worker.
  if (typeof location !== 'undefined') {
    if (location.port === '5173') {
      return 'http://localhost:3000';
    }
    return location.origin;
  }
  return 'http://localhost:3000';
}
