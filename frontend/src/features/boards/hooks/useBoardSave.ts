import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { useBlocker, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getSceneVersion } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { authClient, useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { encryptBoardFile } from '@/lib/crypto-format';
import { dataUrlToBytes } from '@/lib/image-resize';
import { setHighestSeenRevision } from '@/lib/revision-store';
import { getBoard, uploadBoardFile } from '../api';
import { sealAndSaveBoard, type SealedSaveResult } from '../board-save';
import { isEditable, type BoardLoadOutcome } from '../board-load';
import { toBoardMetadata, type BoardMetadata } from '../board-metadata';
import { classifySaveError, classifySaveResponse } from '../board-save-policy';
import { boardKeys } from '../keys';
import { sceneFileIds } from '../scene-files';
import type { Board } from '../schemas';
import { deleteUnsavedPayload, saveUnsavedPayload } from '../unsaved-store';

export type SyncState = 'saved' | 'saving' | 'unsaved' | 'error' | 'needs-sign-in';

export interface ConflictState {
  hasConflict: true;
  serverRevision: number;
}

/** The part of the editor state that is stored with the scene. */
export type SavedAppState = Pick<
  AppState,
  'viewBackgroundColor' | 'gridModeEnabled' | 'currentItemRoundness' | 'currentItemRoughness'
>;

/** The saved part of the editor state, with the editor's own defaults filled in. */
function savedAppStateOf(appState?: Partial<AppState>): SavedAppState {
  return {
    viewBackgroundColor: appState?.viewBackgroundColor || '#ffffff',
    gridModeEnabled: appState?.gridModeEnabled !== false,
    currentItemRoundness: appState?.currentItemRoundness || 'round',
    currentItemRoughness: appState?.currentItemRoughness ?? 0,
  };
}

function appStateDiffers(saved: SavedAppState | null, current: SavedAppState | null): boolean {
  return (
    !saved ||
    saved.viewBackgroundColor !== current?.viewBackgroundColor ||
    saved.gridModeEnabled !== current?.gridModeEnabled ||
    saved.currentItemRoundness !== current?.currentItemRoundness ||
    saved.currentItemRoughness !== current?.currentItemRoughness
  );
}

const SAVE_FAILED_TOAST_ID = 'board-save-failed';
const SAVE_SIGN_IN_TOAST_ID = 'board-save-sign-in';
const MAX_WAIT_MS = 5000;
const DEBOUNCE_MS = 1000;
const BUSY_RETRY_MS = 500;
const FALLBACK_RETRY_MS = 1000;

interface UseBoardSaveParams {
  workspaceRef: string | undefined;
  boardId: string | undefined;
  cryptoKey: CryptoKey | null;
  setCryptoKey: (key: CryptoKey) => void;
  loadOutcome: BoardLoadOutcome | null;
  isCanvasLoading: boolean;
  isViewer: boolean;
  lastSavedJsonRef: MutableRefObject<string>;
  /** The server refused the save because the caller may no longer edit this board. */
  onRevoked: () => void;
  excalidrawApiRef?: MutableRefObject<ExcalidrawImperativeAPI | null> | undefined;
  onReload?: (() => Promise<void> | void) | undefined;
}

/**
 * Debounced auto-save.
 *
 * A failed save keeps the user's work: the scene stays in memory, the already-encrypted payload
 * is stashed locally, and the save is retried. A 401 never navigates away (audit H11).
 */
export function useBoardSave(params: UseBoardSaveParams) {
  const { boardId, cryptoKey, loadOutcome, isCanvasLoading, isViewer } = params;
  const { lastSavedJsonRef } = params;
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();

  const [syncState, setSyncStateValue] = useState<SyncState>('saved');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const lastSavedSceneVersionRef = useRef<number>(-1);
  const lastSavedAppStateRef = useRef<SavedAppState | null>(null);
  const currentRevisionRef = useRef<number>(0);
  const uploadedFileIdsRef = useRef<Set<string>>(new Set());

  // Timers and listeners read the state through the ref, so both are always written together.
  const syncStateRef = useRef<SyncState>('saved');
  const setSyncState = useCallback((state: SyncState) => {
    syncStateRef.current = state;
    setSyncStateValue(state);
  }, []);

  // Opening a board, or opening it again after Reload, starts the status over from "saved". Done
  // while rendering, which is how React keeps state in step with a value it follows.
  const [openedAs, setOpenedAs] = useState(loadOutcome);
  if (openedAs !== loadOutcome) {
    setOpenedAs(loadOutcome);
    setSyncStateValue('saved');
  }

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstChangeTimeRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const pendingAppStateRef = useRef<SavedAppState | null>(null);
  const isSavingRef = useRef(false);
  const saveAttemptRef = useRef(0);
  const performSaveRef = useRef<() => Promise<void>>(async () => {});

  // The save runs from timers and listeners that outlive a render, so it reads what it needs
  // through one ref instead of closing over values that go stale.
  const userId = session?.user?.id;
  const latest = useRef({ ...params, privateKey, userId, location });
  useEffect(() => {
    latest.current = { ...params, privateKey, userId, location };
  });

  const clearSaveTimers = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // A board was opened (or opened again after Reload). What the server holds is the baseline, an
  // empty canvas for a board never saved, so nothing is written until the person changes something,
  // and nothing left over from an earlier session of this editor can be written over it. A layout
  // effect, so the baseline is in place before the editor can report its first change.
  useLayoutEffect(() => {
    clearSaveTimers();
    firstChangeTimeRef.current = null;
    pendingElementsRef.current = null;
    pendingAppStateRef.current = null;
    saveAttemptRef.current = 0;
    syncStateRef.current = 'saved';
    toast.dismiss(SAVE_FAILED_TOAST_ID);
    toast.dismiss(SAVE_SIGN_IN_TOAST_ID);

    if (!loadOutcome || loadOutcome.kind === 'blocked') return;
    const scene = loadOutcome.kind === 'loaded' ? loadOutcome.scene : null;
    currentRevisionRef.current = loadOutcome.revision ?? 0;
    lastSavedSceneVersionRef.current = getSceneVersion(scene?.elements ?? []);
    lastSavedAppStateRef.current = savedAppStateOf(scene?.appState);
  }, [loadOutcome, clearSaveTimers]);

  const retryLater = useCallback(
    (delayMs: number) => {
      setSyncState('error');
      toast.error('Could not save your changes.', {
        id: SAVE_FAILED_TOAST_ID,
        description:
          'Your work is kept on this device and will be saved automatically when the connection returns.',
        duration: Infinity,
        action: {
          label: 'Retry now',
          onClick: () => void performSaveRef.current(),
        },
      });
      retryTimerRef.current = setTimeout(() => {
        void performSaveRef.current();
      }, delayMs);
    },
    [setSyncState],
  );

  const readBoard = useCallback((): BoardMetadata | null => {
    const { workspaceRef: workspace, boardId: id } = latest.current;
    const cached = queryClient.getQueryData<Board>(boardKeys.detail(workspace ?? '', id ?? ''));
    return cached ? toBoardMetadata(cached) : null;
  }, [queryClient]);

  const refreshBoard = useCallback(async () => {
    const { workspaceRef: workspace, boardId: id } = latest.current;
    try {
      await queryClient.fetchQuery({
        queryKey: boardKeys.detail(workspace ?? '', id ?? ''),
        queryFn: () => getBoard(workspace ?? '', id ?? ''),
        staleTime: 0,
      });
    } catch {
      // Best effort: the next attempt runs against the metadata already held.
    }
  }, [queryClient]);

  /** The board now lives at the key version its payload was sealed for. */
  const adoptSealedKey = useCallback(
    (sealed: SealedSaveResult) => {
      const { workspaceRef: workspace, boardId: id } = latest.current;
      if (sealed.keyVersion === readBoard()?.keyVersion) return;
      queryClient.setQueryData<Board>(boardKeys.detail(workspace ?? '', id ?? ''), (board) =>
        board ? { ...board, keyVersion: sealed.keyVersion } : board,
      );
      latest.current.setCryptoKey(sealed.key);
    },
    [queryClient, readBoard],
  );

  const showSignInRequired = useCallback(() => {
    setSyncState('needs-sign-in');
    toast.error('Your session expired. Your changes are kept on this device.', {
      id: SAVE_SIGN_IN_TOAST_ID,
      duration: Infinity,
      action: {
        label: 'Sign in again',
        onClick: () => {
          const { pathname, search } = latest.current.location;
          window.open(
            `/login?redirect=${encodeURIComponent(pathname + search)}`,
            '_blank',
            'noopener,noreferrer',
          );
        },
      },
    });
  }, [setSyncState]);

  const performSave = useCallback(async () => {
    clearSaveTimers();
    firstChangeTimeRef.current = null;

    const current = latest.current;
    const { boardId: id, workspaceRef: workspace, cryptoKey: activeKey } = current;
    // A blocked board has no key and must never be written over.
    if (current.isViewer || !activeKey || !id || !workspace) return;
    if (!isEditable(current.loadOutcome)) return;

    const elements = pendingElementsRef.current;
    if (!elements) return;
    const appState = pendingAppStateRef.current;

    const sceneVersion = getSceneVersion(elements);
    if (
      sceneVersion === lastSavedSceneVersionRef.current &&
      !appStateDiffers(lastSavedAppStateRef.current, appState)
    ) {
      setSyncState('saved');
      return;
    }

    const elementsJson = JSON.stringify(elements);

    if (isSavingRef.current) {
      saveTimeoutRef.current = setTimeout(() => {
        void performSaveRef.current();
      }, BUSY_RETRY_MS);
      return;
    }

    isSavingRef.current = true;
    setSyncState('saving');

    let ciphertext: Uint8Array | null = null;
    const stash = async () => {
      if (ciphertext) await saveUnsavedPayload(id, ciphertext);
    };

    try {
      const activeFileIds = sceneFileIds(elements);

      const files = current.excalidrawApiRef?.current?.getFiles?.() || {};
      const uploadFiles = async (fileIds: string[], key: CryptoKey, keyVersion: number) => {
        const uploads = fileIds.map(async (fileId) => {
          const file = files[fileId];
          if (!file?.dataURL) return false;
          const { data, mimeType } = dataUrlToBytes(file.dataURL);
          const sealedFile = await encryptBoardFile(
            key,
            { boardId: id, boardKeyVersion: keyVersion, fileId },
            { mimeType, data },
          );
          await uploadBoardFile(workspace, id, fileId, sealedFile);
          return true;
        });
        return (await Promise.all(uploads)).every(Boolean);
      };

      const pendingUploads = activeFileIds.filter(
        (fileId) => !uploadedFileIdsRef.current.has(fileId),
      );
      await uploadFiles(pendingUploads, activeKey, readBoard()?.keyVersion ?? 1);
      for (const fileId of pendingUploads) {
        if (files[fileId]?.dataURL) uploadedFileIdsRef.current.add(fileId);
      }

      const sealed = await sealAndSaveBoard({
        workspaceRef: workspace,
        boardId: id,
        scene: {
          elements,
          appState: {
            viewBackgroundColor: appState?.viewBackgroundColor,
            gridModeEnabled: appState?.gridModeEnabled,
            currentItemRoundness: appState?.currentItemRoundness,
            currentItemRoughness: appState?.currentItemRoughness,
          },
        },
        keyContext: {
          privateKey: current.privateKey,
          userId: current.userId,
          workspaceRef: workspace,
        },
        key: current.cryptoKey,
        keyVersion: readBoard()?.keyVersion ?? 1,
        revision: currentRevisionRef.current,
        fileIds: activeFileIds,
        reencryptFiles: (newKey, newKeyVersion) =>
          uploadFiles(activeFileIds, newKey, newKeyVersion),
        readBoard,
        refreshBoard,
        onSealed: (sealedBytes) => {
          ciphertext = sealedBytes;
        },
      });
      if (!sealed) throw new Error('The save did not produce a response');

      const outcome = classifySaveResponse(
        sealed.status,
        saveAttemptRef.current,
        sealed.code,
        sealed.revision,
        sealed.message,
      );

      if (outcome.action === 'saved') {
        adoptSealedKey(sealed);
        lastSavedSceneVersionRef.current = sceneVersion;
        lastSavedAppStateRef.current = appState;
        lastSavedJsonRef.current = elementsJson;
        currentRevisionRef.current = sealed.revision ?? currentRevisionRef.current + 1;
        await setHighestSeenRevision(id, currentRevisionRef.current);
        saveAttemptRef.current = 0;
        // An edit made while this save was in flight is still waiting for its own save.
        setSyncState(saveTimeoutRef.current ? 'unsaved' : 'saved');
        toast.dismiss(SAVE_FAILED_TOAST_ID);
        toast.dismiss(SAVE_SIGN_IN_TOAST_ID);
        await deleteUnsavedPayload(id);
        return;
      }

      saveAttemptRef.current += 1;
      await stash();

      if (outcome.action === 'conflict') {
        clearSaveTimers();
        setSyncState('error');
        setConflict({
          hasConflict: true,
          serverRevision: outcome.serverRevision ?? currentRevisionRef.current + 1,
        });
        return;
      }

      if (outcome.action === 'limit-reached') {
        clearSaveTimers();
        setSyncState('error');
        toast.error(
          outcome.message || 'Storage limit reached. Ask the instance operator to raise the limit.',
          { id: SAVE_FAILED_TOAST_ID },
        );
        return;
      }

      if (outcome.action === 'revoked') {
        setSyncState('error');
        latest.current.onRevoked();
      } else if (outcome.action === 'sign-in-required') {
        showSignInRequired();
      } else if (outcome.action === 'key-rotated') {
        retryLater(FALLBACK_RETRY_MS);
      } else {
        retryLater(outcome.retryAfterMs);
      }
    } catch (err) {
      console.error('Auto-save failed', err);
      saveAttemptRef.current += 1;
      await stash();
      const retryOutcome = classifySaveError(saveAttemptRef.current);
      retryLater(
        retryOutcome.action === 'retry-later' ? retryOutcome.retryAfterMs : FALLBACK_RETRY_MS,
      );
    } finally {
      isSavingRef.current = false;
    }
  }, [
    clearSaveTimers,
    setSyncState,
    retryLater,
    readBoard,
    refreshBoard,
    adoptSealedKey,
    showSignInRequired,
    lastSavedJsonRef,
  ]);
  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  const canSave = !isViewer && cryptoKey && boardId && !isCanvasLoading && isEditable(loadOutcome);

  /** Saves after a pause, and at the latest every 5 s. */
  const queueSave = (elements: readonly ExcalidrawElement[], appState: SavedAppState) => {
    pendingElementsRef.current = elements;
    pendingAppStateRef.current = appState;
    setSyncState('unsaved');

    const now = Date.now();
    firstChangeTimeRef.current ??= now;
    const elapsed = now - firstChangeTimeRef.current;

    if (elapsed >= MAX_WAIT_MS) {
      void performSave();
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(
      () => void performSave(),
      Math.min(DEBOUNCE_MS, MAX_WAIT_MS - elapsed),
    );
  };

  /** Called by the editor on every change. */
  const handleCanvasChange = (elements: readonly ExcalidrawElement[], appState: SavedAppState) => {
    if (!canSave) return;

    // The editor reports every change, including scrolling and selecting; only an edit is saved.
    if (
      getSceneVersion(elements) === lastSavedSceneVersionRef.current &&
      !appStateDiffers(lastSavedAppStateRef.current, appState)
    ) {
      return;
    }
    queueSave(elements, appState);
  };

  /**
   * Saves a scene put on the canvas by an action (a restored copy, an import) rather than reported
   * by the editor. The scene version is a sum, so a different scene can add up to the same number;
   * the person asked for this one, so it is saved either way.
   */
  const saveScene = (elements: readonly ExcalidrawElement[], appState: SavedAppState) => {
    if (!canSave) return;
    lastSavedSceneVersionRef.current = -1;
    queueSave(elements, appState);
  };

  // Anything but 'saved' is work the server does not hold: waiting for the pause, being sent, or
  // failed and kept on this device.
  const hasUnsavedWork = useCallback(
    () => syncStateRef.current !== 'saved' || saveTimeoutRef.current !== null,
    [],
  );

  // Closing or reloading the tab asks the browser to confirm first, as a mail composer does.
  useEffect(() => {
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedWork]);

  // Moving to another page inside the app is held until the person decides.
  const leaveGuard = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && hasUnsavedWork(),
  );

  // An edit still waiting for the pause is sent at once when the tab is hidden and when the editor
  // goes away. A save that already failed is kept on this device and retried on its own schedule.
  const hasPendingEdit = useCallback(
    () => syncStateRef.current === 'unsaved' || saveTimeoutRef.current !== null,
    [],
  );

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden' && hasPendingEdit()) {
        void performSave();
      }
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => document.removeEventListener('visibilitychange', flushWhenHidden);
  }, [performSave, hasPendingEdit]);

  useEffect(() => {
    return () => {
      if (hasPendingEdit()) {
        void performSave();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [performSave, hasPendingEdit]);

  // Retry when the connection returns, and after a sign-in elsewhere.
  useEffect(() => {
    const retryAfterSignIn = async () => {
      if (syncStateRef.current !== 'needs-sign-in') return;
      const result = await authClient.getSession?.();
      if (result?.data?.session) {
        void performSave();
      }
    };
    const onFocus = () => void retryAfterSignIn();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void retryAfterSignIn();
    };
    const onOnline = () => {
      if (syncStateRef.current === 'error') void performSave();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [performSave]);

  const resolveConflictReload = useCallback(async () => {
    setConflict(null);
    if (latest.current.onReload) {
      await latest.current.onReload();
    }
  }, []);

  const resolveConflictOverwrite = useCallback(async () => {
    const rev = conflict?.serverRevision ?? currentRevisionRef.current + 1;
    setConflict(null);
    currentRevisionRef.current = rev;
    void performSave();
  }, [conflict, performSave]);

  return {
    syncState,
    handleCanvasChange,
    saveScene,
    leaveGuard,
    conflict,
    resolveConflictReload,
    resolveConflictOverwrite,
  };
}
