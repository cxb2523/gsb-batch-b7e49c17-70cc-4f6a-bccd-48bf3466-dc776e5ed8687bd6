import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { generateSymmetricKey } from '@/lib/crypto';
import { encryptBoardFile, sealBoardPayload } from '@/lib/crypto-format';
import { clearRevisionStore, setHighestSeenRevision } from '@/lib/revision-store';
import { getBoardFile, getBoardPayload } from '../api';
import { resolveAccountBoardKey } from '../board-keys';
import type { BoardMetadata } from '../board-metadata';
import { useBoardLoad } from './useBoardLoad';

vi.mock('../api', () => ({
  getBoardPayload: vi.fn(),
  getBoardFile: vi.fn(),
}));

vi.mock('../board-keys', () => ({
  resolveAccountBoardKey: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } } }),
}));

const mockKeyContext = {
  privateKey: null,
  isUnlocked: true,
  promptUnlock: vi.fn(),
};
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => mockKeyContext,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return buf;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe('useBoardLoad', () => {
  let cryptoKey: CryptoKey;
  const lastSavedJsonRef = { current: '' };

  const testBoard: BoardMetadata = {
    id: 'b1',
    title: 'Test Board',
    projectId: 'p1',
    keyVersion: 1,
    revision: 1,
    hasPayload: true,
    encryptedBoardKey: 'wrapped-key',
    publicShareToken: null,
    updatedAt: new Date().toISOString(),
    project: { id: 'p1', name: 'Project 1', organizationId: 'w1', keyVersion: 1 },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearRevisionStore();
    cryptoKey = await generateSymmetricKey();
    lastSavedJsonRef.current = '';
    vi.mocked(resolveAccountBoardKey).mockResolvedValue({
      kind: 'key',
      key: cryptoKey,
    });
  });

  it('refuses rollback when payload revision is less than highest recorded revision on device', async () => {
    // Record that device has seen revision 5
    await setHighestSeenRevision('b1', 5);

    // Payload from server has older revision 2
    const olderPayload = await sealBoardPayload(
      cryptoKey,
      { elements: [] },
      { boardId: 'b1', keyVersion: 1, revision: 2 },
    );
    vi.mocked(getBoardPayload).mockResolvedValue(toArrayBuffer(olderPayload));

    const rollbackBoard = { ...testBoard, revision: 2 };

    const { result } = renderHook(
      () =>
        useBoardLoad({
          workspaceRef: 'w1',
          board: rollbackBoard,
          lastSavedJsonRef,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    expect(result.current.loadOutcome).toEqual({
      kind: 'blocked',
      reason: 'rollback-detected',
    });
    expect(result.current.cryptoKey).toBeNull();
  });

  it('fetches and decrypts images into initialData.files', async () => {
    const boardId = 'b2';
    const rawImageBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encryptedFile = await encryptBoardFile(
      cryptoKey,
      { boardId, boardKeyVersion: 1, fileId: 'img-1' },
      { mimeType: 'image/png', data: rawImageBytes },
    );

    const payload = await sealBoardPayload(
      cryptoKey,
      {
        elements: [
          {
            id: 'el-1',
            type: 'image',
            fileId: 'img-1',
            isDeleted: false,
          },
        ],
      },
      { boardId, keyVersion: 1, revision: 1 },
    );

    vi.mocked(getBoardPayload).mockResolvedValue(toArrayBuffer(payload));
    vi.mocked(getBoardFile).mockResolvedValue(toArrayBuffer(encryptedFile));

    const { result } = renderHook(
      () =>
        useBoardLoad({
          workspaceRef: 'w1',
          board: { ...testBoard, id: boardId },
          lastSavedJsonRef,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    expect(result.current.loadOutcome?.kind).toBe('loaded');
    expect(result.current.initialData?.files).toBeDefined();
    expect(result.current.initialData?.files?.['img-1']).toBeDefined();
    expect(result.current.initialData?.files?.['img-1']?.mimeType).toBe('image/png');
    expect(result.current.initialData?.files?.['img-1']?.dataURL).toContain(
      'data:image/png;base64,',
    );
  });

  it('shows toast once and does not block canvas when an image fails to decrypt', async () => {
    const payload = await sealBoardPayload(
      cryptoKey,
      {
        elements: [
          {
            id: 'el-1',
            type: 'image',
            fileId: 'corrupt-img-1',
            isDeleted: false,
          },
          {
            id: 'el-2',
            type: 'image',
            fileId: 'corrupt-img-2',
            isDeleted: false,
          },
        ],
      },
      { boardId: 'b1', keyVersion: 1, revision: 1 },
    );

    vi.mocked(getBoardPayload).mockResolvedValue(payload.buffer);
    // Return corrupted file bytes
    vi.mocked(getBoardFile).mockResolvedValue(new Uint8Array([0, 1, 2]).buffer);

    const { result } = renderHook(
      () =>
        useBoardLoad({
          workspaceRef: 'w1',
          board: testBoard,
          lastSavedJsonRef,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    // Canvas is NOT blocked
    expect(result.current.loadOutcome?.kind).toBe('loaded');
    expect(result.current.initialData).not.toBeNull();

    // Toast error called once
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Could not load one or more images');
  });
});
