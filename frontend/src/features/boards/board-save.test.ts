import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSymmetricKey } from '@/lib/crypto';
import { ApiError } from '@/lib/http';
import { saveBoardPayload } from './api';
import { provisionCurrentBoardKey, resolveSealingBoardKey } from './board-keys';
import type { BoardMetadata } from './board-metadata';
import { sealAndSaveBoard, type SealedSaveParams } from './board-save';

vi.mock('./api', () => ({ saveBoardPayload: vi.fn() }));
vi.mock('./board-keys', () => ({
  provisionCurrentBoardKey: vi.fn(),
  resolveSealingBoardKey: vi.fn(),
}));

const board = (overrides: Partial<BoardMetadata> = {}, projectKeyVersion = 1): BoardMetadata => ({
  id: 'b1',
  title: 'Mesh',
  projectId: 'p1',
  keyVersion: 1,
  publicShareToken: null,
  updatedAt: '',
  project: { id: 'p1', name: 'Core', organizationId: 'w1', keyVersion: projectKeyVersion },
  ...overrides,
});

const rejection = (status: number, code?: string) =>
  new ApiError({ status, code, message: 'refused' });

describe('sealAndSaveBoard', () => {
  let key: CryptoKey;
  let params: SealedSaveParams;
  let current: BoardMetadata | null;

  beforeEach(async () => {
    vi.resetAllMocks();
    key = await generateSymmetricKey();
    current = board();
    params = {
      workspaceRef: 'acme',
      boardId: 'b1',
      scene: { elements: [] },
      keyContext: { privateKey: null, userId: 'u1', workspaceRef: 'acme' },
      key,
      keyVersion: 1,
      reencryptFiles: vi.fn(async () => true),
      readBoard: () => current,
      refreshBoard: vi.fn(async () => {}),
      onSealed: vi.fn(),
    };
    vi.mocked(saveBoardPayload).mockResolvedValue({
      success: true,
      hasPayload: true,
      revision: 1,
      updatedAt: '',
    });
  });

  it('uploads under the key the editor already holds', async () => {
    const result = await sealAndSaveBoard(params);

    expect(result).toMatchObject({ status: 200, key, keyVersion: 1 });
    expect(saveBoardPayload).toHaveBeenCalledWith(
      'acme',
      'b1',
      expect.any(Uint8Array),
      expect.objectContaining({ revision: 0 }),
    );
    expect(resolveSealingBoardKey).not.toHaveBeenCalled();
  });

  it('hands every ciphertext to the caller before the upload, so a failure can be stashed', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(rejection(500));

    const result = await sealAndSaveBoard(params);

    expect(result?.status).toBe(500);
    expect(params.onSealed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(params.onSealed).mock.calls[0]?.[0][0]).toBe(0x01);
  });

  it('reports a request that never reached the server as status 0', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await sealAndSaveBoard(params)).toMatchObject({ status: 0 });
  });

  it('moves a board behind its project key to the current key and sends the new wrapped key', async () => {
    const newKey = await generateSymmetricKey();
    current = board({}, 2);
    vi.mocked(provisionCurrentBoardKey).mockResolvedValue({
      boardKey: newKey,
      encryptedBoardKey: 'wrapped-v2',
    });

    const result = await sealAndSaveBoard(params);

    expect(result).toMatchObject({ status: 200, key: newKey, keyVersion: 2 });
    expect(saveBoardPayload).toHaveBeenCalledWith(
      'acme',
      'b1',
      expect.any(Uint8Array),
      expect.objectContaining({ encryptedBoardKey: 'wrapped-v2' }),
    );
  });

  it('uploads the files under the new key before the re-key payload', async () => {
    const newKey = await generateSymmetricKey();
    current = board({}, 2);
    vi.mocked(provisionCurrentBoardKey).mockResolvedValue({
      boardKey: newKey,
      encryptedBoardKey: 'wrapped-v2',
    });
    const order: string[] = [];
    vi.mocked(params.reencryptFiles).mockImplementation(async () => {
      order.push('files');
      return true;
    });
    vi.mocked(saveBoardPayload).mockImplementation(async () => {
      order.push('payload');
      return { success: true, hasPayload: true, revision: 1, updatedAt: '' };
    });

    await sealAndSaveBoard(params);

    expect(params.reencryptFiles).toHaveBeenCalledWith(newKey, 2);
    expect(order).toEqual(['files', 'payload']);
  });

  it('keeps the current key when a file cannot be re-encrypted', async () => {
    current = board({}, 2);
    vi.mocked(provisionCurrentBoardKey).mockResolvedValue({
      boardKey: await generateSymmetricKey(),
      encryptedBoardKey: 'wrapped-v2',
    });
    vi.mocked(params.reencryptFiles).mockResolvedValue(false);

    const result = await sealAndSaveBoard(params);

    expect(result).toMatchObject({ status: 200, keyVersion: 1 });
    expect(saveBoardPayload).toHaveBeenCalledWith(
      'acme',
      'b1',
      expect.any(Uint8Array),
      expect.not.objectContaining({ encryptedBoardKey: expect.anything() }),
    );
  });

  it('does not re-key a board that has a public link', async () => {
    current = board({ publicShareToken: 'tok' }, 2);

    const result = await sealAndSaveBoard(params);

    expect(provisionCurrentBoardKey).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 200, keyVersion: 1 });
  });

  it('refreshes the board and seals again when the server says the key rotated', async () => {
    const reopened = await generateSymmetricKey();
    vi.mocked(saveBoardPayload)
      .mockRejectedValueOnce(rejection(409, 'KEY_ROTATED'))
      .mockResolvedValueOnce({
        success: true,
        hasPayload: true,
        revision: 1,
        updatedAt: '',
      });
    vi.mocked(resolveSealingBoardKey).mockResolvedValue(reopened);
    vi.mocked(params.refreshBoard).mockImplementation(async () => {
      current = board({ keyVersion: 2 }, 2);
    });

    const result = await sealAndSaveBoard(params);

    expect(params.refreshBoard).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 200, key: reopened, keyVersion: 2 });
    expect(saveBoardPayload).toHaveBeenCalledTimes(2);
  });

  it('stops re-keying when the server says a public link holds the old key', async () => {
    current = board({}, 2);
    vi.mocked(provisionCurrentBoardKey).mockResolvedValue({
      boardKey: await generateSymmetricKey(),
      encryptedBoardKey: 'wrapped-v2',
    });
    // Back to the board's own key version, as the server asked.
    vi.mocked(resolveSealingBoardKey).mockResolvedValue(key);
    vi.mocked(saveBoardPayload)
      .mockRejectedValueOnce(rejection(409, 'PUBLIC_BOARD_REKEY'))
      .mockResolvedValueOnce({
        success: true,
        hasPayload: true,
        revision: 1,
        updatedAt: '',
      });

    const result = await sealAndSaveBoard(params);

    expect(provisionCurrentBoardKey).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 200, keyVersion: 1 });
  });

  it('gives up after three rotations in a row', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(rejection(409, 'KEY_ROTATED'));
    vi.mocked(resolveSealingBoardKey).mockResolvedValue(key);

    expect(await sealAndSaveBoard(params)).toBeNull();
    expect(saveBoardPayload).toHaveBeenCalledTimes(3);
  });

  it('does nothing when the board is not known', async () => {
    current = null;

    expect(await sealAndSaveBoard(params)).toBeNull();
    expect(saveBoardPayload).not.toHaveBeenCalled();
  });

  it('lets key errors from the key service reach the caller', async () => {
    current = board({}, 2);
    vi.mocked(provisionCurrentBoardKey).mockRejectedValue(new Error('no project key'));

    await expect(sealAndSaveBoard(params)).rejects.toThrow('no project key');
    expect(saveBoardPayload).not.toHaveBeenCalled();
  });
});
