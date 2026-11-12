/**
 * Origins of the stack under test. The defaults match the stock `.env` (VITE_API_URL, FRONTEND_URL
 * and AUTH_URL are `localhost`); cookies and CORS fail if the page and API hosts differ.
 * Override both with E2E_BASE_URL / E2E_API_URL when the stack is configured differently.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

/** Cookie domain for a session injected into a browser context: the session belongs to the API host. */
export const COOKIE_DOMAIN = new URL(API_URL).hostname;
