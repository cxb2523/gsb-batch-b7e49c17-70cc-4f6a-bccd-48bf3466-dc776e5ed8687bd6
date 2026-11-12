import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPublicBoardMetadata, getPublicBoardPayload } from './api';
import { ApiError } from '@/lib/http';
import { errorResponse, jsonResponse } from '@/test/http';

describe('public-boards api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getPublicBoardMetadata parses board metadata', async () => {
    const mockBoard = {
      id: 'b1',
      title: 'Shared Board',
      hasPayload: true,
      keyVersion: 1,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(mockBoard)));

    const result = await getPublicBoardMetadata('tok123');
    expect(result.id).toBe('b1');
    expect(result.title).toBe('Shared Board');
  });

  it('getPublicBoardPayload returns arrayBuffer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array(16), { status: 200 })),
    );

    const result = await getPublicBoardPayload('tok123');
    expect(result.byteLength).toBe(16);
  });

  it('throws UNEXPECTED_RESPONSE on schema failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ missingIdAndTitle: true })));

    await expect(getPublicBoardMetadata('tok123')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe('UNEXPECTED_RESPONSE');
      }
      return true;
    });
  });

  it('reports a revoked link as a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(404, 'NOT_FOUND', 'This link was revoked')),
    );

    await expect(getPublicBoardMetadata('tok123')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
