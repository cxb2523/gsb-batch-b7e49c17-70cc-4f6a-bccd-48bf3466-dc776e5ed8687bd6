import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyResponse, errorResponse, jsonResponse, networkFailure } from '@/test/http';
import { http, httpRequest, ApiError } from './http';

function stubFetch(response: Response | Promise<Response>) {
  const mockFetch = vi.fn().mockReturnValue(response);
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('http / httpRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prepends API base URL, includes credentials, and parses JSON response', async () => {
    const mockFetch = stubFetch(jsonResponse({ hello: 'world' }));

    const result = await http<{ hello: string }>('/api/test');

    expect(result).toEqual({ hello: 'world' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/test$/),
      expect.objectContaining({ credentials: 'include', headers: expect.any(Object) }),
    );
  });

  it('sets active-organization header when workspaceId is passed', async () => {
    const mockFetch = stubFetch(jsonResponse({ ok: true }));

    await http('/api/workspaces/w1', { workspaceId: 'w1' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspaces/w1'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'active-organization': 'w1' }),
      }),
    );
  });

  it('serializes JSON bodies and sets application/json content-type', async () => {
    const mockFetch = stubFetch(jsonResponse({ id: '123' }));

    await http.post('/api/projects', { name: 'Test' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('keeps a content-type the caller set', async () => {
    const mockFetch = stubFetch(jsonResponse({}));

    await http.post('/api/x', 'raw', { headers: { 'content-type': 'text/plain' } });

    const sentHeaders = mockFetch.mock.calls[0]?.[1].headers;
    expect(sentHeaders).toEqual({ 'content-type': 'text/plain' });
  });

  it('handles binary bodies and headers like x-encrypted-board-key', async () => {
    const mockFetch = stubFetch(jsonResponse({ success: true }));

    await http.put('/api/boards/b1/payload', new Uint8Array([1, 2, 3, 4]), {
      headers: { 'x-encrypted-board-key': 'key_blob_123' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/payload'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/octet-stream',
          'x-encrypted-board-key': 'key_blob_123',
        }),
      }),
    );
  });

  it('returns binary and text responses as asked', async () => {
    stubFetch(new Response(new Uint8Array([1, 2, 3])));
    const bytes = await httpRequest('/api/boards/b1/payload', { responseType: 'arrayBuffer' });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));

    stubFetch(new Response('plain'));
    expect(await httpRequest('/api/x', { responseType: 'text' })).toBe('plain');
  });

  it('handles 204 No Content gracefully', async () => {
    stubFetch(emptyResponse());

    expect(await http.delete('/api/boards/b1')).toEqual({});
  });

  it('treats an empty 200 body as an empty object', async () => {
    stubFetch(new Response('', { status: 200 }));

    expect(await http('/api/x')).toEqual({});
  });

  it('reports a malformed JSON success body as INVALID_JSON', async () => {
    stubFetch(new Response('{not json', { status: 200 }));

    const error = await rejectionOf(http('/api/x'));

    expect(error.code).toBe('INVALID_JSON');
  });

  it('maps HTTP errors with status, code and details', async () => {
    stubFetch(
      jsonResponse(
        {
          statusCode: 409,
          code: 'WORKSPACE_ROTATION_PENDING',
          message: 'Workspace rotation must happen before project rotation',
          activeOrgKeyVersion: 2,
        },
        { status: 409 },
      ),
    );

    const error = await rejectionOf(http('/api/projects/p1/rotate-key', { method: 'POST' }));

    expect(error.status).toBe(409);
    expect(error.code).toBe('WORKSPACE_ROTATION_PENDING');
    expect(error.message).toBe('Workspace rotation must happen before project rotation');
    expect(error.details).toEqual({ activeOrgKeyVersion: 2 });
  });

  it('joins a validation message array into one message', async () => {
    stubFetch(
      jsonResponse(
        { statusCode: 400, message: ['name is required', 'id is invalid'] },
        { status: 400 },
      ),
    );

    const error = await rejectionOf(http('/api/x'));

    expect(error.message).toBe('name is required, id is invalid');
  });

  it('maps an error with no body to a generic message', async () => {
    stubFetch(new Response(null, { status: 502 }));

    const error = await rejectionOf(http('/api/x'));

    expect(error.status).toBe(502);
    expect(error.message).toBe('Request failed with status 502');
  });

  it('maps a non-JSON error body to its text', async () => {
    stubFetch(new Response('Bad gateway', { status: 502 }));

    const error = await rejectionOf(http('/api/x'));

    expect(error.details).toBe('Bad gateway');
  });

  it('reads the code from the shared error helper', async () => {
    stubFetch(errorResponse(403, 'FORBIDDEN', 'No access'));

    const error = await rejectionOf(http('/api/x'));

    expect([error.status, error.code, error.message]).toEqual([403, 'FORBIDDEN', 'No access']);
  });

  it('converts network failures into ApiError with status 0', async () => {
    stubFetch(networkFailure());

    const error = await rejectionOf(http('/api/test'));

    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toBe('Could not reach the server. Check your connection and try again.');
    // What the browser said is kept for whoever is debugging.
    expect(error.details).toBeInstanceOf(TypeError);
  });

  it('gives the first reason a field was refused instead of "Validation failed"', async () => {
    stubFetch(
      jsonResponse(
        {
          statusCode: 400,
          message: 'Validation failed',
          errors: [
            { path: ['name'], message: 'Project name can only use letters, numbers and spaces' },
            { path: ['id'], message: 'Project ID must be a UUID' },
          ],
        },
        { status: 400 },
      ),
    );

    const error = await rejectionOf(http('/api/x'));

    expect(error.status).toBe(400);
    expect(error.message).toBe('Project name can only use letters, numbers and spaces');
  });

  it('keeps the plain message when a refusal carries no reasons', async () => {
    stubFetch(
      jsonResponse({ statusCode: 400, message: 'Validation failed', errors: [] }, { status: 400 }),
    );

    expect((await rejectionOf(http('/api/x'))).message).toBe('Validation failed');
  });
});
