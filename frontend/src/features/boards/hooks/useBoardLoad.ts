import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { ApiError } from '@/lib/http';
import { decryptBoardFile } from '@/lib/crypto-format';
import { bytesToDataUrl } from '@/lib/image-resize';
import { getBoardFile, getBoardPayload } from '../api';
import { resolveAccountBoardKey } from '../board-keys';
import {
  classifyLoadFailure,
  classifyPayloadStatus,
  decryptLoadedPayload,
  newBoardOutcome,
  type BoardLoadOutcome,
} from '../board-load';
import type { BoardMetadata } from '../board-metadata';
import { initialSceneData } from '../initial-scene';
import { getUnsavedPayload, type UnsavedPayload } from '../unsaved-store';

function isBinaryFileData(value: unknown): value is BinaryFileData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'dataURL' in value &&
    'mimeType' in value &&
    'created' in value
  );
}

async function fetchAndDecryptBoardFiles(
  boardKey: CryptoKey,
  boardId: string,
  keyVersion: number,
  fileIds: string[],
  fetchFile: (fileId: string) => Promise<ArrayBuffer>,
): Promise<BinaryFiles> {
  const result: BinaryFiles = {};
  if (fileIds.length === 0) return result;

  let toastShown = false;

  await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const encryptedBytes = await fetchFile(fileId);
        const { mimeType, data } = await decryptBoardFile(boardKey, encryptedBytes, {
          boardId,
          boardKeyVersion: keyVersion,
          fileId,
        });
        const dataURL = bytesToDataUrl(data, mimeType);
        const entry = {
          id: fileId,
          dataURL,
          mimeType,
          created: Date.now(),
        };
        if (isBinaryFileData(entry)) {
          result[fileId] = entry;
        }
      } catch (err) {
        console.warn(`Failed to load board file ${fileId}:`, err);
        if (!toastShown) {
          toastShown = true;
          toast.error('Could not load one or more images');
        }
      }
    }),
  );

  return result;
}

interface UseBoardLoadParams {
  workspaceRef: string | undefined;
  board: BoardMetadata | undefined;
  /** Updated with the scene that was loaded, so the saver can tell real edits from none. */
  lastSavedJsonRef: MutableRefObject<string>;
}

/**
 * Resolves the board key and loads the payload as one decision.
 *
 * The editor mounts only for a board that was actually opened. Every other outcome (a 403, a 401,
 * a 5xx, a network failure, a missing object, a payload no key opens) is a blocked board that
 * explains itself and offers a retry, and can never issue a save (audit C3).
 */
export function useBoardLoad({ workspaceRef, board, lastSavedJsonRef }: UseBoardLoadParams) {
  const { data: session } = useSession();
  const { privateKey, isUnlocked, promptUnlock } = useKeyContext();
  const userId = session?.user?.id;

  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  /** The only thing that decides whether the editor may mount. */
  const [loadOutcome, setLoadOutcome] = useState<BoardLoadOutcome | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [isCanvasLoading, setIsCanvasLoading] = useState(true);
  const [pendingStash, setPendingStash] = useState<UnsavedPayload | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadedBoardIdRef = useRef<string | null>(null);
  const loadedAttemptRef = useRef<number>(-1);

  useEffect(() => {
    let cancelled = false;

    const block = (outcome: BoardLoadOutcome) => {
      if (cancelled) return;
      setCryptoKey(null);
      setLoadOutcome(outcome);
      setIsCanvasLoading(false);
    };

    const open = (
      boardId: string,
      key: CryptoKey,
      outcome: BoardLoadOutcome,
      data: ExcalidrawInitialDataState,
    ) => {
      loadedBoardIdRef.current = boardId;
      loadedAttemptRef.current = loadAttempt;
      setCryptoKey(key);
      setLoadOutcome(outcome);
      setInitialData(data);
      setIsCanvasLoading(false);
    };

    async function offerStashIfNewer(boardId: string, updatedAt: string) {
      const stash = await getUnsavedPayload(boardId);
      if (cancelled || !stash) return;
      if (stash.savedAt > new Date(updatedAt).getTime()) {
        setPendingStash(stash);
      }
    }

    async function load(current: BoardMetadata, workspace: string) {
      setIsCanvasLoading(true);
      setLoadOutcome(null);
      setCryptoKey(null);
      setPendingStash(null);

      // The board key comes from the account hierarchy only. A board with no wrapped key is
      // blocked; there is no URL fragment or local copy to fall back to.
      if (!current.encryptedBoardKey) {
        block({ kind: 'blocked', reason: 'cannot-decrypt' });
        return;
      }
      if (!isUnlocked) {
        promptUnlock();
        return;
      }

      const account = await resolveAccountBoardKey(current, {
        privateKey,
        userId,
        workspaceRef: workspace,
      });
      if (cancelled) return;
      if (account.kind !== 'key') {
        block({
          kind: 'blocked',
          reason: account.kind === 'pending' ? 'pending-access' : 'cannot-decrypt',
        });
        return;
      }

      // A board that has never been saved has nothing to decrypt yet.
      if (!current.hasPayload) {
        open(current.id, account.key, newBoardOutcome(), initialSceneData());
        await offerStashIfNewer(current.id, current.updatedAt);
        return;
      }

      let encryptedBytes: Uint8Array;
      try {
        encryptedBytes = new Uint8Array(await getBoardPayload(workspace, current.id));
      } catch (err) {
        console.error('Failed to fetch board payload', err);
        block(err instanceof ApiError ? classifyPayloadStatus(err.status) : classifyLoadFailure());
        return;
      }

      const outcome = await decryptLoadedPayload(account.key, encryptedBytes, {
        boardId: current.id,
        keyVersion: current.keyVersion,
        revision: current.revision,
      });
      if (cancelled) return;
      if (outcome.kind !== 'loaded') {
        block(outcome);
        return;
      }

      const activeFileIds: string[] = [];
      for (const el of outcome.scene.elements) {
        if (el.type === 'image' && el.fileId && !el.isDeleted) {
          if (!activeFileIds.includes(el.fileId)) {
            activeFileIds.push(el.fileId);
          }
        }
      }

      let loadedFiles: BinaryFiles = {};
      if (activeFileIds.length > 0) {
        loadedFiles = await fetchAndDecryptBoardFiles(
          account.key,
          current.id,
          current.keyVersion,
          activeFileIds,
          (fileId) => getBoardFile(workspace, current.id, fileId),
        );
        if (cancelled) return;
      }

      lastSavedJsonRef.current = JSON.stringify(outcome.scene.elements);
      open(current.id, account.key, outcome, initialSceneData(outcome.scene, loadedFiles));
      await offerStashIfNewer(current.id, current.updatedAt);
    }

    // A board that was already opened under this attempt is left alone when only its
    // metadata changes (a rename, a new public link).
    const alreadyLoaded =
      loadedBoardIdRef.current === board?.id && loadedAttemptRef.current === loadAttempt;
    if (board && workspaceRef && !alreadyLoaded) {
      void load(board, workspaceRef);
    }
    return () => {
      cancelled = true;
    };
  }, [
    board,
    workspaceRef,
    loadAttempt,
    isUnlocked,
    privateKey,
    userId,
    promptUnlock,
    lastSavedJsonRef,
  ]);

  return {
    cryptoKey,
    setCryptoKey,
    loadOutcome,
    initialData,
    isCanvasLoading,
    pendingStash,
    setPendingStash,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
  };
}
