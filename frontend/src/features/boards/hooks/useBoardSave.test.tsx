import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataRouter } from '@/test/data-router';
import type { ReactNode } from 'react';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { toast } from 'sonner';
import { generateSymmetricKey } from '@/lib/crypto';
import { ApiError } from '@/lib/http';
import { clearRevisionStore } from '@/lib/revision-store';
import { deleteUnsavedPayload, getUnsavedPayload } from '../unsaved-store';
import type { BoardLoadOutcome } from '../board-load';
import { boardKeys } from '../keys';
import { saveBoardPayload, uploadBoardFile } from '../api';
import { useBoardSave, type SavedAppState } from './useBoardSave';

vi.mock('../api', () => ({
  getBoard: vi.fn(),
  saveBoardPayload: vi.fn(),
  uploadBoardFile: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } } }),
  authClient: { getSession: vi.fn() },
}));

function isFileId(value: string): value is FileId {
  return typeof value === 'string';
}

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

const mockBoard = {
  id: 'b1',
  title: 'Test Board',
  projectId: 'p1',
  keyVersion: 1,
  revision: 0,
  hasPayload: false,
  project: { id: 'p1', name: 'Project 1', organizationId: 'w1', keyVersion: 1 },
};

// The editor holds the outcome in state, so it keeps the same identity between renders; a literal
// inside the hook callback would read as the board being opened again on every render.
const NEW_BOARD: BoardLoadOutcome = { kind: 'new' };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(boardKeys.detail('w1', 'b1'), mockBoard);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </DataRouter>
    );
  };
}

describe('useBoardSave', () => {
  let cryptoKey: CryptoKey;
  const lastSavedJsonRef = { current: '' };

  const defaultAppState: SavedAppState = {
    viewBackgroundColor: '#ffffff',
    gridModeEnabled: true,
    currentItemRoundness: 'round',
    currentItemRoughness: 0,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearRevisionStore();
    await deleteUnsavedPayload('b1');
    cryptoKey = await generateSymmetricKey();
    lastSavedJsonRef.current = '';
    vi.mocked(saveBoardPayload).mockResolvedValue({
      success: true,
      hasPayload: true,
      revision: 1,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(uploadBoardFile).mockResolvedValue(undefined);
  });

  it('does NOT call JSON.stringify on elements when scene version is unchanged', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');

    const { result } = renderHook(
      () =>
        useBoardSave({
          workspaceRef: 'w1',
          boardId: 'b1',
          cryptoKey,
          setCryptoKey: vi.fn(),
          loadOutcome: NEW_BOARD,
          isCanvasLoading: false,
          isViewer: false,
          lastSavedJsonRef,
          onRevoked: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    const elements = convertToExcalidrawElements([
      {
        id: 'rect-1',
        type: 'rectangle',
        x: 0,
        y: 0,
      },
    ]);

    stringifySpy.mockClear();

    // Call handleCanvasChange 5 times with unchanged elements
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.handleCanvasChange(elements, defaultAppState);
      }
    });

    // None of the handleCanvasChange calls should call JSON.stringify on elements
    const elementStringifyCallsBeforeDebounce = stringifySpy.mock.calls.filter(
      (call) => call[0] === elements,
    );
    expect(elementStringifyCallsBeforeDebounce).toHaveLength(0);

    // Wait for the debounced save to run
    await waitFor(() => expect(result.current.syncState).toBe('saved'), { timeout: 3000 });

    // Inside performSave, JSON.stringify(elements) is called
    const elementStringifyCallsAfterSave = stringifySpy.mock.calls.filter(
      (call) => call[0] === elements,
    );
    expect(elementStringifyCallsAfterSave.length).toBeGreaterThanOrEqual(1);

    // Calling handleCanvasChange again with unchanged elements does not call stringify
    stringifySpy.mockClear();
    act(() => {
      result.current.handleCanvasChange(elements, defaultAppState);
    });

    expect(stringifySpy.mock.calls.filter((call) => call[0] === elements)).toHaveLength(0);

    stringifySpy.mockRestore();
  });

  it('handles conflict (409 BOARD_CONFLICT) by stopping retries, showing banner, and supporting Reload and Overwrite', async () => {
    const conflictError = new ApiError({
      status: 409,
      code: 'BOARD_CONFLICT',
      message: 'This canvas was changed elsewhere',
      details: { revision: 10 },
    });
    vi.mocked(saveBoardPayload).mockRejectedValueOnce(conflictError);

    const onReload = vi.fn();
    const { result } = renderHook(
      () =>
        useBoardSave({
          workspaceRef: 'w1',
          boardId: 'b1',
          cryptoKey,
          setCryptoKey: vi.fn(),
          loadOutcome: NEW_BOARD,
          isCanvasLoading: false,
          isViewer: false,
          lastSavedJsonRef,
          onRevoked: vi.fn(),
          onReload,
        }),
      { wrapper: createWrapper() },
    );

    const elements = convertToExcalidrawElements([
      {
        id: 'rect-1',
        type: 'rectangle',
        x: 0,
        y: 0,
      },
    ]);

    act(() => {
      result.current.handleCanvasChange(elements, defaultAppState);
    });

    await waitFor(() => expect(result.current.conflict).not.toBeNull(), { timeout: 3000 });

    expect(result.current.conflict).toEqual({
      hasConflict: true,
      serverRevision: 10,
    });
    expect(result.current.syncState).toBe('error');

    // Local work must be stashed
    const stash = await getUnsavedPayload('b1');
    expect(stash).not.toBeNull();

    // Test Reload
    await act(async () => {
      await result.current.resolveConflictReload();
    });
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toBeNull();

    // Re-trigger conflict for Overwrite test
    vi.mocked(saveBoardPayload).mockRejectedValueOnce(conflictError);
    act(() => {
      result.current.handleCanvasChange(
        convertToExcalidrawElements([
          {
            id: 'rect-1',
            type: 'rectangle',
            x: 0,
            y: 0,
            version: 2,
          },
        ]),
        defaultAppState,
      );
    });
    await waitFor(() => expect(result.current.conflict).not.toBeNull(), { timeout: 3000 });

    // Test Overwrite: should resave using the server's revision (10)
    vi.mocked(saveBoardPayload).mockResolvedValueOnce({
      success: true,
      hasPayload: true,
      revision: 11,
      updatedAt: new Date().toISOString(),
    });

    await act(async () => {
      await result.current.resolveConflictOverwrite();
    });

    expect(result.current.conflict).toBeNull();
    await waitFor(
      () =>
        expect(saveBoardPayload).toHaveBeenLastCalledWith(
          'w1',
          'b1',
          expect.any(Uint8Array),
          expect.objectContaining({ revision: 10 }),
        ),
      { timeout: 3000 },
    );
  });

  it('uploads un-uploaded images before saving the payload', async () => {
    const excalidrawApiRef = {
      current: {
        getFiles: () => ({
          'file-img-1': {
            id: 'file-img-1',
            dataURL:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mimeType: 'image/png',
          },
        }),
      } as unknown as ExcalidrawImperativeAPI,
    };

    const { result } = renderHook(
      () =>
        useBoardSave({
          workspaceRef: 'w1',
          boardId: 'b1',
          cryptoKey,
          setCryptoKey: vi.fn(),
          loadOutcome: NEW_BOARD,
          isCanvasLoading: false,
          isViewer: false,
          lastSavedJsonRef,
          onRevoked: vi.fn(),
          excalidrawApiRef,
        }),
      { wrapper: createWrapper() },
    );

    const testFileId = 'file-img-1';
    if (!isFileId(testFileId)) throw new Error('invalid file id');

    const elements = convertToExcalidrawElements([
      {
        id: 'img-el-1',
        type: 'image',
        fileId: testFileId,
        x: 0,
        y: 0,
      },
    ]);

    act(() => {
      result.current.handleCanvasChange(elements, defaultAppState);
    });

    await waitFor(
      () => {
        expect(uploadBoardFile).toHaveBeenCalledTimes(1);
        expect(saveBoardPayload).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    expect(uploadBoardFile).toHaveBeenCalledWith('w1', 'b1', 'file-img-1', expect.any(Uint8Array));
    expect(saveBoardPayload).toHaveBeenCalledWith(
      'w1',
      'b1',
      expect.any(Uint8Array),
      expect.objectContaining({ fileIds: ['file-img-1'] }),
    );
  });

  it('keeps local stash when image upload fails', async () => {
    vi.mocked(uploadBoardFile).mockRejectedValueOnce(new Error('Upload to S3 failed'));

    const excalidrawApiRef = {
      current: {
        getFiles: () => ({
          'file-img-1': {
            id: 'file-img-1',
            dataURL:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mimeType: 'image/png',
          },
        }),
      } as unknown as ExcalidrawImperativeAPI,
    };

    const { result } = renderHook(
      () =>
        useBoardSave({
          workspaceRef: 'w1',
          boardId: 'b1',
          cryptoKey,
          setCryptoKey: vi.fn(),
          loadOutcome: NEW_BOARD,
          isCanvasLoading: false,
          isViewer: false,
          lastSavedJsonRef,
          onRevoked: vi.fn(),
          excalidrawApiRef,
        }),
      { wrapper: createWrapper() },
    );

    const testFileId = 'file-img-1';
    if (!isFileId(testFileId)) throw new Error('invalid file id');

    const elements = convertToExcalidrawElements([
      {
        id: 'img-el-1',
        type: 'image',
        fileId: testFileId,
        x: 0,
        y: 0,
      },
    ]);

    act(() => {
      result.current.handleCanvasChange(elements, defaultAppState);
    });

    await waitFor(() => expect(result.current.syncState).toBe('error'), {
      timeout: 3000,
    });
    expect(saveBoardPayload).not.toHaveBeenCalled();
  });

  it('keeps editor open and preserves stash when save fails with LIMIT_REACHED', async () => {
    const onRevoked = vi.fn();
    vi.mocked(saveBoardPayload).mockRejectedValueOnce(
      new ApiError({
        status: 403,
        code: 'LIMIT_REACHED',
        message: 'Storage limit reached. Ask the instance operator to raise the limit.',
      }),
    );

    const { result } = renderHook(
      () =>
        useBoardSave({
          workspaceRef: 'w1',
          boardId: 'b1',
          cryptoKey,
          setCryptoKey: vi.fn(),
          loadOutcome: NEW_BOARD,
          isCanvasLoading: false,
          isViewer: false,
          lastSavedJsonRef,
          onRevoked,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleCanvasChange(
        convertToExcalidrawElements([
          {
            id: 'el-limit',
            type: 'rectangle',
            x: 0,
            y: 0,
            version: 1,
          },
        ]),
        defaultAppState,
      );
    });

    await waitFor(() => expect(result.current.syncState).toBe('error'), { timeout: 3000 });
    expect(onRevoked).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Storage limit reached. Ask the instance operator to raise the limit.',
      expect.anything(),
    );
    const stashed = await getUnsavedPayload('b1');
    expect(stashed).not.toBeNull();
  });

  describe('what counts as an edit', () => {
    const rectangle = convertToExcalidrawElements([
      { id: 'rect-1', type: 'rectangle', x: 0, y: 0 },
    ]);

    function renderSave(loadOutcome: BoardLoadOutcome) {
      return renderHook(
        (props: { loadOutcome: BoardLoadOutcome }) =>
          useBoardSave({
            workspaceRef: 'w1',
            boardId: 'b1',
            cryptoKey,
            setCryptoKey: vi.fn(),
            loadOutcome: props.loadOutcome,
            isCanvasLoading: false,
            isViewer: false,
            lastSavedJsonRef,
            onRevoked: vi.fn(),
          }),
        { wrapper: createWrapper(), initialProps: { loadOutcome } },
      );
    }

    it('writes nothing for a board that was never saved until something is drawn', async () => {
      const { result } = renderSave(NEW_BOARD);

      // The editor reports its first render, and every scroll and selection, with no elements.
      act(() => result.current.handleCanvasChange([], defaultAppState));
      await new Promise((resolve) => setTimeout(resolve, 1300));

      expect(saveBoardPayload).not.toHaveBeenCalled();
      expect(result.current.syncState).toBe('saved');

      act(() => result.current.handleCanvasChange(rectangle, defaultAppState));
      expect(result.current.syncState).toBe('unsaved');
      await waitFor(() => expect(saveBoardPayload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    });

    it('writes nothing for a saved board that was only opened, and starts from its revision', async () => {
      const loaded: BoardLoadOutcome = {
        kind: 'loaded',
        scene: { elements: rectangle, appState: { viewBackgroundColor: '#ffffff' } },
        revision: 4,
      };
      const { result } = renderSave(loaded);

      act(() => result.current.handleCanvasChange(rectangle, defaultAppState));
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(saveBoardPayload).not.toHaveBeenCalled();

      const withSecond = convertToExcalidrawElements([
        { id: 'rect-1', type: 'rectangle', x: 0, y: 0 },
        { id: 'rect-2', type: 'rectangle', x: 40, y: 0 },
      ]);
      act(() => result.current.handleCanvasChange(withSecond, defaultAppState));
      await waitFor(() => expect(saveBoardPayload).toHaveBeenCalledTimes(1), { timeout: 3000 });
      expect(vi.mocked(saveBoardPayload).mock.calls[0]?.[3]).toMatchObject({ revision: 4 });
    });

    it('saves a scene put on the canvas by an action even when it looks like the saved one', async () => {
      const loaded: BoardLoadOutcome = {
        kind: 'loaded',
        scene: { elements: rectangle, appState: { viewBackgroundColor: '#ffffff' } },
        revision: 4,
      };
      const { result } = renderSave(loaded);

      act(() => result.current.saveScene(rectangle, defaultAppState));

      await waitFor(() => expect(saveBoardPayload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    });

    it('does not report saved while an edit made during the save is still waiting', async () => {
      let finishFirstSave: () => void = () => {};
      vi.mocked(saveBoardPayload).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstSave = () =>
              resolve({ success: true, hasPayload: true, revision: 1, updatedAt: 'now' });
          }),
      );
      const { result } = renderSave(NEW_BOARD);

      act(() => result.current.handleCanvasChange(rectangle, defaultAppState));
      await waitFor(() => expect(result.current.syncState).toBe('saving'), { timeout: 3000 });

      // The person keeps drawing while the first save is on its way.
      const withSecond = convertToExcalidrawElements([
        { id: 'rect-1', type: 'rectangle', x: 0, y: 0 },
        { id: 'rect-2', type: 'rectangle', x: 40, y: 0 },
      ]);
      act(() => result.current.handleCanvasChange(withSecond, defaultAppState));
      await act(async () => {
        finishFirstSave();
        // Long enough for the first save to finish, short enough that the pause before the
        // second one has not run out.
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.syncState).toBe('unsaved');
      await waitFor(() => expect(saveBoardPayload).toHaveBeenCalledTimes(2), { timeout: 4000 });
      await waitFor(() => expect(result.current.syncState).toBe('saved'));
    });

    it('forgets what was waiting to be saved when the board is opened again', async () => {
      const first: BoardLoadOutcome = { kind: 'new' };
      const { result, rerender } = renderSave(first);
      act(() => result.current.handleCanvasChange(rectangle, defaultAppState));
      expect(result.current.syncState).toBe('unsaved');

      // Reload: the board is opened again from the server.
      rerender({ loadOutcome: { kind: 'new' } });

      expect(result.current.syncState).toBe('saved');
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(saveBoardPayload).not.toHaveBeenCalled();
    });
  });
});
