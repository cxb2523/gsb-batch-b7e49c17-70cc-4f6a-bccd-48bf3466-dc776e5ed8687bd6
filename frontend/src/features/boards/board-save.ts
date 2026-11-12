/**
 * One save of a board: seal the scene under the right key and upload it, following the server's
 * instructions when the project key rotated underneath the editor. React-free so the sequence of
 * keys, versions and retries can be read in one place.
 */

import { sealBoardPayload } from '@/lib/crypto-format';
import { ApiError } from '@/lib/http';
import { saveBoardPayload } from './api';
import {
  provisionCurrentBoardKey,
  resolveSealingBoardKey,
  type BoardKeyContext,
} from './board-keys';
import type { BoardMetadata } from './board-metadata';

/** Rotation can happen twice in a row at most before the caller backs off. */
const MAX_SEAL_CYCLES = 3;

export interface SealedSaveParams {
  workspaceRef: string;
  boardId: string;
  /** The scene to store, encrypted before it leaves this module. */
  scene: unknown;
  keyContext: BoardKeyContext;
  /** The key and version the editor currently holds for this board. */
  key: CryptoKey | null;
  keyVersion: number;
  /** The current revision before this save (new payload sealed at revision + 1). */
  revision?: number | undefined;
  /** Active file IDs in the scene to prune unreferenced files on the server. */
  fileIds?: string[] | undefined;
  /** The latest metadata, read again for every cycle because a refresh can change it. */
  readBoard: () => BoardMetadata | null;
  /**
   * Uploads every file of the scene encrypted under the new key and version, before a re-key
   * payload is sent. Returns false when a file is not available to re-encrypt, in which case the
   * board keeps its current key and the re-key is tried again on a later save.
   */
  reencryptFiles: (key: CryptoKey, keyVersion: number) => Promise<boolean>;
  /** Re-reads the board after the server says its key rotated. */
  refreshBoard: () => Promise<void>;
  /** Receives each ciphertext as soon as it exists, so a failed upload can still be stashed. */
  onSealed: (ciphertext: Uint8Array) => void;
}

export interface SealedSaveResult {
  /** The HTTP status of the final upload; 0 when the request never reached the server. */
  status: number;
  code?: string | undefined;
  message?: string | undefined;
  /** The key and version the stored payload was sealed under. */
  key: CryptoKey;
  keyVersion: number;
  revision?: number | undefined;
}

async function upload(
  workspaceRef: string,
  boardId: string,
  ciphertext: Uint8Array,
  options: {
    encryptedBoardKey?: string | undefined;
    revision: number;
    fileIds?: string[] | undefined;
  },
): Promise<{
  status: number;
  code?: string | undefined;
  revision?: number | undefined;
  message?: string | undefined;
}> {
  try {
    const res = await saveBoardPayload(workspaceRef, boardId, ciphertext, options);
    return { status: 200, revision: res.revision };
  } catch (err) {
    if (err instanceof ApiError) {
      let conflictRev: number | undefined;
      if (typeof err.details === 'object' && err.details !== null && 'revision' in err.details) {
        conflictRev = Number(err.details.revision);
      }
      return {
        status: err.status,
        code: err.code,
        revision: conflictRev,
        message: err.message,
      };
    }
    return { status: 0 };
  }
}

/**
 * Seals and uploads the scene. Returns null when the cycles ran out or the board is unknown;
 * key errors from `lib/keys` propagate.
 */
export async function sealAndSaveBoard(params: SealedSaveParams): Promise<SealedSaveResult | null> {
  const { workspaceRef, boardId, keyContext } = params;
  let key = params.key;
  let keyVersion = params.keyVersion;
  let allowRekey = true;

  const attempt = async (cycle: number): Promise<SealedSaveResult | null> => {
    if (cycle >= MAX_SEAL_CYCLES) return null;
    const board = params.readBoard();
    if (!board) return null;

    // A board behind its project's key is moved to the current one, unless a public link
    // already carries the old key in its URL.
    const rekey =
      allowRekey && board.keyVersion < board.project.keyVersion && !board.publicShareToken;

    let encryptedBoardKey: string | undefined;
    if (rekey) {
      const provisioned = await provisionCurrentBoardKey(board, keyContext);
      if (!(await params.reencryptFiles(provisioned.boardKey, board.project.keyVersion))) {
        allowRekey = false;
        return attempt(cycle + 1);
      }
      key = provisioned.boardKey;
      keyVersion = board.project.keyVersion;
      encryptedBoardKey = provisioned.encryptedBoardKey;
    } else if (!key || keyVersion !== board.keyVersion) {
      key = await resolveSealingBoardKey(board, keyContext);
      keyVersion = board.keyVersion;
    }
    if (!key) return null;

    const targetRevision = (params.revision ?? 0) + 1;
    const ciphertext = await sealBoardPayload(key, params.scene, {
      boardId,
      keyVersion,
      revision: targetRevision,
    });
    params.onSealed(ciphertext);

    const {
      status,
      code,
      message,
      revision: savedRevision,
    } = await upload(workspaceRef, boardId, ciphertext, {
      encryptedBoardKey,
      revision: params.revision ?? 0,
      fileIds: params.fileIds,
    });

    if (status === 409 && code === 'KEY_ROTATED') {
      await params.refreshBoard();
      key = null;
      return attempt(cycle + 1);
    }
    if (status === 409 && code === 'PUBLIC_BOARD_REKEY') {
      allowRekey = false;
      return attempt(cycle + 1);
    }
    return { status, code, message, key, keyVersion, revision: savedRevision ?? targetRevision };
  };

  return attempt(0);
}
