/** Real `Response` objects for tests that stub `fetch`, so tests exercise the same parsing as production. */

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

/** An error in the shape the backend sends: `{ statusCode, code, message }`. */
export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ statusCode: status, code, message }, { status });
}

/** The server's answer to a stored board payload. */
export function savedPayloadResponse(revision = 1): Response {
  return jsonResponse({
    success: true,
    hasPayload: true,
    revision,
    updatedAt: '2026-10-27T00:00:00.000Z',
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/** The rejection `fetch` produces when the network is down. */
export function networkFailure(message = 'Failed to fetch'): Promise<never> {
  return Promise.reject(new TypeError(message));
}
