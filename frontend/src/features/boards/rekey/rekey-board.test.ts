import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSymmetricKey } from '@/lib/crypto';
import {
  decryptBoardFile,
  encryptBoardFile,
  openBoardPayload,
  sealBoardPayload,
} from '@/lib/crypto-format';
import { ApiError } from '@/lib/http';
import { getBoard, getBoardFile, getBoardPayload, saveBoardPayload, uploadBoardFile } from '../api';
import { provisionCurrentBoardKey, resolveSealingBoardKey } from '../board-keys';
import type { Board } from '../schemas';
import { rekeyBoard, type RekeyContext } from './rekey-board';

vi.mock('../api', () => ({
  getBoard: vi.fn(),
  getBoardFile: vi.fn(),
  getBoardPayload: vi.fn(),
  saveBoardPayload: vi.fn(),
  uploadBoardFile: vi.fn(),
}));
vi.mock('../board-keys', () => ({
  provisionCurrentBoardKey: vi.fn(),
  resolveSealingBoardKey: vi.fn(),
}));

const context: RekeyContext = {
  workspaceRef: 'w1',
  keyContext: { privateKey: null, userId: 'u1', workspaceRef: 'w1' },
};

const scene = { elements: [{ type: 'image', fileId: 'img1' }, { type: 'rectangle' }] };
const imageBytes = new Uint8Array([9, 8, 7, 6]);

const behindBoard = (overrides: Partial<Board> = {}): Board => ({
  id: 'b1',
  title: 'Mesh',
  projectId: 'p1',
  keyVersion: 1,
  project: { id: 'p1', organizationId: 'w1', name: 'Core', keyVersion: 2 },
  ...overrides,
});

describe('rekeyBoard', () => {
  let oldKey: CryptoKey;
  let newKey: CryptoKey;
  let order: string[];

  beforeEach(async () => {
    vi.resetAllMocks();
    oldKey = await generateSymmetricKey();
    newKey = await generateSymmetricKey();
    order = [];

    vi.mocked(getBoard).mockResolvedValue(behindBoard());
    vi.mocked(resolveSealingBoardKey).mockResolvedValue(oldKey);
    vi.mocked(provisionCurrentBoardKey).mockResolvedValue({
      boardKey: newKey,
      encryptedBoardKey: 'wrapped-v2',
    });
    vi.mocked(getBoardPayload).mockResolvedValue(
      (await sealBoardPayload(oldKey, scene, { boardId: 'b1', keyVersion: 1, revision: 3 })).buffer,
    );
    vi.mocked(getBoardFile).mockResolvedValue(
      (
        await encryptBoardFile(
          oldKey,
          { boardId: 'b1', boardKeyVersion: 1, fileId: 'img1' },
          { mimeType: 'image/webp', data: imageBytes },
        )
      ).buffer,
    );
    vi.mocked(uploadBoardFile).mockImplementation(async (_w, _b, fileId) => {
      order.push(`file:${fileId}`);
    });
    vi.mocked(saveBoardPayload).mockImplementation(async () => {
      order.push('payload');
      return { success: true, hasPayload: true, revision: 4, updatedAt: '' };
    });
  });

  it('moves the images, then the payload, to the new key at the next revision', async () => {
    expect(await rekeyBoard('b1', context)).toBe('secured');

    expect(order).toEqual(['file:img1', 'payload']);
    expect(saveBoardPayload).toHaveBeenCalledWith('w1', 'b1', expect.any(Uint8Array), {
      encryptedBoardKey: 'wrapped-v2',
      revision: 3,
      fileIds: ['img1'],
    });

    const sealedPayload = vi.mocked(saveBoardPayload).mock.calls[0]?.[2];
    const sealedFile = vi.mocked(uploadBoardFile).mock.calls[0]?.[3];
    if (!(sealedPayload instanceof Uint8Array) || !sealedFile) throw new Error('nothing uploaded');
    expect(
      await openBoardPayload(newKey, sealedPayload, { boardId: 'b1', keyVersion: 2, revision: 4 }),
    ).toEqual(scene);
    expect(
      await decryptBoardFile(newKey, sealedFile, {
        boardId: 'b1',
        boardKeyVersion: 2,
        fileId: 'img1',
      }),
    ).toEqual({ mimeType: 'image/webp', data: imageBytes });
  });

  it('leaves a board that is already at the current key alone', async () => {
    vi.mocked(getBoard).mockResolvedValue(behindBoard({ keyVersion: 2 }));

    expect(await rekeyBoard('b1', context)).toBe('already-current');
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it('skips a board whose public link carries the old key', async () => {
    vi.mocked(getBoard).mockResolvedValue(behindBoard({ publicShareToken: 'tok' }));

    expect(await rekeyBoard('b1', context)).toBe('skipped-public');
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it('uploads nothing for a board the old key cannot open', async () => {
    vi.mocked(resolveSealingBoardKey).mockResolvedValue(await generateSymmetricKey());

    await expect(rekeyBoard('b1', context)).rejects.toThrow();
    expect(uploadBoardFile).not.toHaveBeenCalled();
    expect(saveBoardPayload).not.toHaveBeenCalled();
  });

  it('asks to be redone when the board changed underneath', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(
      new ApiError({ status: 409, code: 'BOARD_CONFLICT', message: 'changed' }),
    );

    expect(await rekeyBoard('b1', context)).toBe('retry');
  });

  it('treats a public link created meanwhile as a skip', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(
      new ApiError({ status: 409, code: 'PUBLIC_BOARD_REKEY', message: 'public' }),
    );

    expect(await rekeyBoard('b1', context)).toBe('skipped-public');
  });

  it('reports any other refusal instead of hiding it', async () => {
    vi.mocked(saveBoardPayload).mockRejectedValue(
      new ApiError({ status: 400, code: 'BAD', message: 'refused' }),
    );

    await expect(rekeyBoard('b1', context)).rejects.toThrow('refused');
  });

  it('carries on without an image the server never stored', async () => {
    vi.mocked(getBoardFile).mockRejectedValue(
      new ApiError({ status: 404, message: 'File not found' }),
    );

    expect(await rekeyBoard('b1', context)).toBe('secured');
    expect(uploadBoardFile).not.toHaveBeenCalled();
    expect(saveBoardPayload).toHaveBeenCalledWith(
      'w1',
      'b1',
      expect.any(Uint8Array),
      expect.objectContaining({ fileIds: [] }),
    );
  });
});
