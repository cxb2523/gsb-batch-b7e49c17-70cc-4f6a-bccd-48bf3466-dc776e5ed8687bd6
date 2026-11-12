import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DataRouter } from '@/test/data-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { generateSymmetricKey } from '@/lib/crypto';
import { errorResponse, jsonResponse, networkFailure, savedPayloadResponse } from '@/test/http';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { toBoardMetadata, type BoardMetadata } from '../board-metadata';
import { boardKeys } from '../keys';
import { deleteUnsavedPayload, getUnsavedPayload } from '../unsaved-store';
import type { SavedAppState } from './useBoardSave';
import { useBoardSession } from './useBoardSession';

const keyContext = vi.hoisted(() => ({
  privateKey: null,
  isUnlocked: true,
  promptUnlock: vi.fn(),
}));
const keyService = vi.hoisted(() => ({
  resolveProjectKey: vi.fn(),
  resolveBoardKey: vi.fn(),
  provisionBoardKeys: vi.fn(),
}));

vi.mock('@/context/KeyContext', () => ({ useKeyContext: () => keyContext }));
vi.mock('@/lib/keys', () => keyService);
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } } }),
  authClient: { getSession: vi.fn() },
}));
// The scene version is real, so an edit differs from the empty canvas the way it does in the editor.
vi.mock('@excalidraw/excalidraw', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@excalidraw/excalidraw')>()),
  exportToBlob: vi.fn(),
  getCommonBounds: vi.fn(),
}));

const serverBoard = {
  id: 'b1',
  title: 'Mesh',
  projectId: 'p1',
  encryptedBoardKey: 'wrapped-board',
  keyVersion: 1,
  hasPayload: false,
  updatedAt: new Date().toISOString(),
  project: {
    id: 'p1',
    name: 'Core',
    organizationId: 'w1',
    keyVersion: 1,
    members: [{ id: 'm1', userId: 'u1', role: 'editor', encryptedProjectKey: 'grant' }],
  },
};

const rectangle: readonly ExcalidrawElement[] = convertToExcalidrawElements([
  { id: 'rect-1', type: 'rectangle', x: 0, y: 0 },
]);
const appState: SavedAppState = {
  viewBackgroundColor: '#ffffff',
  gridModeEnabled: true,
  currentItemRoundness: 'round',
  currentItemRoughness: 0,
};

describe('useBoardSession', () => {
  let queryClient: QueryClient;
  let puts: number;
  const refreshBoard = vi.fn(async () => ({ isError: false }));

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataRouter>{children}</DataRouter>
    </QueryClientProvider>
  );

  function renderSession(options: { canEdit?: boolean; board?: BoardMetadata } = {}) {
    const board = options.board ?? toBoardMetadata(serverBoard);
    return renderHook(
      () =>
        useBoardSession({
          workspaceRef: 'acme',
          boardId: 'b1',
          board,
          canEdit: options.canEdit ?? true,
          refreshBoard,
        }),
      { wrapper },
    );
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await deleteUnsavedPayload('b1');
    puts = 0;
    keyService.resolveBoardKey.mockResolvedValue(await generateSymmetricKey());
    keyService.resolveProjectKey.mockResolvedValue(await generateSymmetricKey());
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(boardKeys.detail('acme', 'b1'), serverBoard);
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'PUT') puts += 1;
      return savedPayloadResponse();
    });
  });

  it('opens a board that has never been saved as an empty, editable canvas', async () => {
    const { result } = renderSession();

    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    expect(result.current.loadOutcome).toEqual({ kind: 'new' });
    expect(result.current.cryptoKey).not.toBeNull();
    expect(result.current.initialData?.elements).toEqual([]);
    expect(result.current.isViewer).toBe(false);
  });

  it('opens the board again after a retry only when the fresh record could be fetched', async () => {
    const { result } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));
    expect(keyService.resolveBoardKey).toHaveBeenCalledTimes(1);

    refreshBoard.mockResolvedValueOnce({ isError: true });
    await act(() => result.current.retryLoad());

    // Opening again from the cached record would open a saved board as an empty one.
    expect(toast.error).toHaveBeenCalledWith(
      'The canvas could not be refreshed. Check your connection and try again.',
    );
    expect(keyService.resolveBoardKey).toHaveBeenCalledTimes(1);

    await act(() => result.current.retryLoad());
    await waitFor(() => expect(keyService.resolveBoardKey).toHaveBeenCalledTimes(2));
  });

  it('blocks a board with no wrapped key instead of opening it', async () => {
    const { result } = renderSession({
      board: toBoardMetadata({ ...serverBoard, encryptedBoardKey: null }),
    });

    await waitFor(() =>
      expect(result.current.loadOutcome).toEqual({ kind: 'blocked', reason: 'cannot-decrypt' }),
    );
    expect(result.current.cryptoKey).toBeNull();
  });

  it('asks for the passphrase instead of loading while the keys are locked', async () => {
    keyContext.isUnlocked = false;
    try {
      const { result } = renderSession();

      await waitFor(() => expect(keyContext.promptUnlock).toHaveBeenCalled());
      expect(result.current.isCanvasLoading).toBe(true);
      expect(result.current.cryptoKey).toBeNull();
    } finally {
      keyContext.isUnlocked = true;
    }
  });

  it('never saves for someone who cannot edit', async () => {
    const { result } = renderSession({ canEdit: false });
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    act(() => result.current.handleCanvasChange(rectangle, appState));
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(result.current.isViewer).toBe(true);
    expect(result.current.syncState).toBe('saved');
    expect(puts).toBe(0);
  });

  it('saves an edit after a pause and reports it saved', async () => {
    const { result } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    act(() => result.current.handleCanvasChange(rectangle, appState));
    expect(result.current.syncState).toBe('unsaved');

    await waitFor(() => expect(result.current.syncState).toBe('saved'), { timeout: 4000 });
    expect(puts).toBe(1);
  });

  it('saves a pending edit when the canvas goes away', async () => {
    const { result, unmount } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    act(() => result.current.handleCanvasChange(rectangle, appState));
    unmount();

    await waitFor(() => expect(puts).toBe(1));
  });

  it('keeps the edit on this device and reports the error when the save fails', async () => {
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) =>
      init.method === 'PUT' ? errorResponse(500, 'INTERNAL', 'Boom') : jsonResponse({}),
    );
    const { result } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    act(() => result.current.handleCanvasChange(rectangle, appState));

    await waitFor(() => expect(result.current.syncState).toBe('error'), { timeout: 4000 });
    expect(toast.error).toHaveBeenCalledWith(
      'Could not save your changes.',
      expect.objectContaining({ id: 'board-save-failed' }),
    );
    expect(await getUnsavedPayload('b1')).not.toBeNull();
  });

  it('keeps the edit on this device when the network is down', async () => {
    global.fetch = vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) =>
      init.method === 'PUT' ? networkFailure() : Promise.resolve(jsonResponse({})),
    );
    const { result } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    act(() => result.current.handleCanvasChange(rectangle, appState));

    await waitFor(() => expect(result.current.syncState).toBe('error'), { timeout: 4000 });
    expect(await getUnsavedPayload('b1')).not.toBeNull();
  });

  it('ignores a Mermaid import while the editor is not mounted', async () => {
    const { result } = renderSession();
    await waitFor(() => expect(result.current.isCanvasLoading).toBe(false));

    const skeletons: ExcalidrawElementSkeleton[] = [{ type: 'rectangle', x: 0, y: 0 }];
    act(() => result.current.importMermaid(skeletons));

    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe('saved');
  });
});
