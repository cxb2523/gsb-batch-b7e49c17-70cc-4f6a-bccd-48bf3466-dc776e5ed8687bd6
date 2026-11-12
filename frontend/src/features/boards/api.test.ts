import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listBoards,
  getBoard,
  saveBoardPayload,
  uploadBoardFile,
  getBoardFile,
  getPublicBoardFile,
} from './api';
import { ApiError } from '@/lib/http';
import { errorResponse, jsonResponse } from '@/test/http';

/** The server's answer to a stored payload. */
const saved = (revision: number) =>
  jsonResponse({
    success: true,
    hasPayload: true,
    revision,
    updatedAt: '2026-10-27T00:00:00.000Z',
  });

describe('boards api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listBoards parses boards array', async () => {
    const mockBoards = [
      { id: 'b1', title: 'Diagram 1', projectId: 'p1', keyVersion: 1 },
      { id: 'b2', title: 'Diagram 2', projectId: 'p1', keyVersion: 1 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(mockBoards)));

    const result = await listBoards('w1');
    expect(result).toHaveLength(2);
    if (Array.isArray(result)) {
      expect(result[0]?.title).toBe('Diagram 1');
    }
  });

  it('getBoard parses board metadata with project', async () => {
    const mockBoard = {
      id: 'b1',
      title: 'Diagram 1',
      projectId: 'p1',
      project: { id: 'p1', organizationId: 'w1', keyVersion: 1 },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(mockBoard)));

    const result = await getBoard('w1', 'b1');
    expect(result.id).toBe('b1');
    expect(result.project?.organizationId).toBe('w1');
  });

  it('saveBoardPayload passes binary payload and header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(saved(1));
    vi.stubGlobal('fetch', mockFetch);

    const payload = new Uint8Array([1, 2, 3]);
    const result = await saveBoardPayload('w1', 'b1', payload, {
      revision: 0,
      encryptedBoardKey: 'enc_board_key_xyz',
    });
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/payload'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-encrypted-board-key': 'enc_board_key_xyz',
          'active-organization': 'w1',
        }),
      }),
    );
  });

  it('saveBoardPayload passes binary payload, revision, and fileIds headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(saved(5));
    vi.stubGlobal('fetch', mockFetch);

    const payload = new Uint8Array([1, 2, 3]);
    const result = await saveBoardPayload('w1', 'b1', payload, {
      encryptedBoardKey: 'enc_board_key_xyz',
      revision: 4,
      fileIds: ['f1', 'f2'],
    });
    expect(result.success).toBe(true);
    expect(result.revision).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/payload'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-encrypted-board-key': 'enc_board_key_xyz',
          'x-board-revision': '4',
          'x-board-file-ids': 'f1,f2',
          'active-organization': 'w1',
        }),
      }),
    );
  });

  it('saveBoardPayload sends an empty file list so the server prunes removed images', async () => {
    const mockFetch = vi.fn().mockResolvedValue(saved(2));
    vi.stubGlobal('fetch', mockFetch);

    await saveBoardPayload('w1', 'b1', new Uint8Array([1]), { revision: 1, fileIds: [] });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/payload'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-board-file-ids': '' }),
      }),
    );
  });

  it('uploadBoardFile sends binary PUT', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, fileId: 'f1', size: 3 }));
    vi.stubGlobal('fetch', mockFetch);

    const data = new Uint8Array([10, 20, 30]);
    await uploadBoardFile('w1', 'b1', 'f1', data);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/files/f1'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'active-organization': 'w1',
        }),
      }),
    );
  });

  it('getBoardFile fetches file binary data', async () => {
    const buffer = new ArrayBuffer(8);
    const mockFetch = vi.fn().mockResolvedValue(new Response(buffer));
    vi.stubGlobal('fetch', mockFetch);

    const result = await getBoardFile('w1', 'b1', 'f1');
    expect(result.byteLength).toBe(8);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/boards/b1/files/f1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'active-organization': 'w1',
        }),
      }),
    );
  });

  it('getPublicBoardFile fetches public file binary data', async () => {
    const buffer = new ArrayBuffer(16);
    const mockFetch = vi.fn().mockResolvedValue(new Response(buffer));
    vi.stubGlobal('fetch', mockFetch);

    const result = await getPublicBoardFile('token123', 'f1');
    expect(result.byteLength).toBe(16);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/boards/token123/files/f1'),
      expect.any(Object),
    );
  });

  it('throws UNEXPECTED_RESPONSE on schema failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ unexpected: 123 })));

    await expect(getBoard('w1', 'b1')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe('UNEXPECTED_RESPONSE');
      }
      return true;
    });
  });

  it('surfaces the server error for a refused request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(404, 'NOT_FOUND', 'Board not found')),
    );

    await expect(getBoard('w1', 'missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Board not found',
    });
  });
});
