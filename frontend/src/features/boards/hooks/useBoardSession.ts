import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';
import { openStashedScene } from '../board-load';
import type { BoardMetadata } from '../board-metadata';
import { exportCanvasImage, placeMermaidDiagram } from '../canvas-actions';
import { mergeRestoredElements } from '../merge-restored-elements';
import { deleteUnsavedPayload } from '../unsaved-store';
import { useBoardLoad } from './useBoardLoad';
import { useBoardSave } from './useBoardSave';

interface UseBoardSessionParams {
  workspaceRef: string | undefined;
  boardId: string | undefined;
  board: BoardMetadata | undefined;
  /** Whether the caller's role allows editing; the server can still take that away mid-session. */
  canEdit: boolean;
  /** Fetches the board record again; Reload needs the server's revision, not the cached one. */
  refreshBoard: () => Promise<{ isError: boolean }>;
}

/**
 * Everything the canvas needs once it knows which board it is: the key and payload load, the
 * auto-save, the locally stashed copy of an unsaved scene, and the edits that start from a menu
 * (Mermaid import). The page only wires the result to the editor and the chrome around it.
 */
export function useBoardSession({
  workspaceRef,
  boardId,
  board,
  canEdit,
  refreshBoard,
}: UseBoardSessionParams) {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSavedJsonRef = useRef('');
  const [isReadOnlyForced, setIsReadOnlyForced] = useState(false);
  const isViewer = isReadOnlyForced || !canEdit;
  const title = board?.title ?? '';

  const load = useBoardLoad({ workspaceRef, board, lastSavedJsonRef });

  const exportImage = useCallback(() => {
    if (excalidrawApiRef.current) void exportCanvasImage(excalidrawApiRef.current, title);
  }, [title]);

  const handleRevoked = useCallback(() => {
    setIsReadOnlyForced(true);
    toast.warning(
      'Your permission to edit this canvas has been revoked. Switched to read-only mode.',
      {
        duration: 10000,
        action: { label: 'Export Image', onClick: exportImage },
      },
    );
  }, [exportImage]);

  /** A retry opens the board from what the server holds now, never from the cached record. */
  const reloadFresh = async () => {
    const { isError } = await refreshBoard();
    if (isError) {
      // Opening again from the cached record is the bug this guards against.
      toast.error('The canvas could not be refreshed. Check your connection and try again.');
      return;
    }
    load.retryLoad();
  };

  const save = useBoardSave({
    workspaceRef,
    boardId,
    cryptoKey: load.cryptoKey,
    setCryptoKey: load.setCryptoKey,
    loadOutcome: load.loadOutcome,
    isCanvasLoading: load.isCanvasLoading,
    isViewer,
    lastSavedJsonRef,
    onRevoked: handleRevoked,
    excalidrawApiRef,
    onReload: reloadFresh,
  });

  const { cryptoKey, pendingStash, setPendingStash } = load;

  const discardStash = async () => {
    if (boardId) await deleteUnsavedPayload(boardId);
    setPendingStash(null);
  };

  /** Puts a stashed scene on the canvas and saves it, if it still decrypts. */
  const restoreStash = async () => {
    if (!pendingStash || !cryptoKey) return;
    const scene = await openStashedScene(cryptoKey, pendingStash.ciphertext, pendingStash.boardId);
    if (!scene) {
      toast.error('The unsaved copy could not be opened and was discarded.');
      await discardStash();
      return;
    }

    const api = excalidrawApiRef.current;
    if (!api) {
      // The copy stays on offer; nothing would carry it to the server without the editor.
      toast.error('The canvas is not ready yet. Try again in a moment.');
      return;
    }
    const elements = mergeRestoredElements(api.getSceneElementsIncludingDeleted(), scene.elements);
    api.updateScene({ elements });
    save.saveScene(elements, api.getAppState());
    setPendingStash(null);
    toast.success('Restored unsaved changes');
  };

  const importMermaid = (skeletons: ExcalidrawElementSkeleton[], files?: BinaryFiles) => {
    const api = excalidrawApiRef.current;
    if (isViewer || !api) return;
    const placed = placeMermaidDiagram(api, skeletons, files);
    if (!placed) return;
    save.saveScene(placed.elements, placed.appState);
    toast.success(`Imported ${placed.importedCount} elements from Mermaid`);
  };

  return {
    isViewer,
    excalidrawApiRef,
    cryptoKey,
    loadOutcome: load.loadOutcome,
    initialData: load.initialData,
    isCanvasLoading: load.isCanvasLoading,
    pendingStash,
    retryLoad: reloadFresh,
    leaveGuard: save.leaveGuard,
    syncState: save.syncState,
    handleCanvasChange: save.handleCanvasChange,
    conflict: save.conflict,
    resolveConflictReload: save.resolveConflictReload,
    resolveConflictOverwrite: save.resolveConflictOverwrite,
    restoreStash,
    discardStash,
    importMermaid,
  };
}
