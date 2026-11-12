import { vi } from 'vitest';
import { errorResponse } from './http';

type RouteHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** The address a stubbed `fetch` was called with, query string included. */
export function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

/**
 * Stubs `fetch` with a table keyed by `"METHOD /path"`. Each handler builds a fresh `Response`, so
 * the app's real parsing runs. Unlisted routes answer 404 so a missing stub fails loudly.
 * Pair with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubFetchRoutes(routes: Record<string, RouteHandler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(urlOf(input), 'http://localhost').pathname;
    const handler = routes[`${method} ${path}`];
    return handler
      ? handler(init)
      : errorResponse(404, 'NOT_FOUND', `No stub for ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The JSON body a request was sent with. */
export function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

/** Requests the stub saw for `"METHOD /path"`, in order. */
export function requestsTo(fetchMock: ReturnType<typeof stubFetchRoutes>, route: string) {
  const [method, path] = route.split(' ');
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      (init?.method ?? 'GET').toUpperCase() === method &&
      new URL(urlOf(input), 'http://localhost').pathname === path,
  );
}
