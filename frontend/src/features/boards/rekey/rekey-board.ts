/**
 * Moves one board from an older project key to the project's current one: the payload and every
 * image are opened with the old board key and sealed again under a fresh one. React-free and
 * Excalidraw-free, so it runs the same in a page and in the re-key worker.
 */

import {
  decryptBoardFile,
  encryptBoardFile,
  openBoardPayload,
  readPayloadRevision,
  sealBoardPayload,
} from '@/lib/crypto-format';
import { ApiError } from '@/lib/http';
import { getBoard, getBoardFile, getBoardPayload, saveBoardPayload, uploadBoardFile } from '../api';
import {
  provisionCurrentBoardKey,
  resolveSealingBoardKey,
  type BoardKeyContext,
} from '../board-keys';
import { parseBoardScene } from '../board-load';
import { toBoardMetadata } from '../board-metadata';
import { sceneFileIds } from '../scene-files';
import { runPool } from './pool';

const FILE_CONCURRENCY = 4;

/** What happened to one board. `retry` means the board changed underneath and should be redone. */
export type BoardOutcome = 'secured' | 'already-current' | 'skipped-public' | 'retry';

/** Answers that mean "read the board again and redo it", not "this board is broken". */
const RETRYABLE_CODES = new Set(['BOARD_CONFLICT', 'KEY_ROTATED']);

/** The server turned the re-key down because a public link now holds the old key. */
const PUBLIC_BOARD_CODE = 'PUBLIC_BOARD_REKEY';

export interface RekeyContext {
  workspaceRef: string;
  keyContext: BoardKeyContext;
}

interface FileMove {
  boardId: string;
  workspaceRef: string;
  from: { key: CryptoKey; version: number };
  to: { key: CryptoKey; version: number };
}

/** Re-encrypts one image at the new version and uploads it; false when the old copy is gone. */
async function moveFile(fileId: string, move: FileMove): Promise<boolean> {
  const { boardId, workspaceRef, from, to } = move;
  let sealedOld: ArrayBuffer;
  try {
    sealedOld = await getBoardFile(workspaceRef, boardId, fileId);
  } catch (error) {
    // The scene names an image the server never stored; there is nothing to move.
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }

  const file = await decryptBoardFile(from.key, sealedOld, {
    boardId,
    boardKeyVersion: from.version,
    fileId,
  });
  const sealedNew = await encryptBoardFile(
    to.key,
    { boardId, boardKeyVersion: to.version, fileId },
    file,
  );
  await uploadBoardFile(workspaceRef, boardId, fileId, sealedNew);
  return true;
}

async function moveFiles(fileIds: string[], move: FileMove): Promise<string[]> {
  const moved: string[] = [];
  await runPool(fileIds, FILE_CONCURRENCY, async (fileId) => {
    if (await moveFile(fileId, move)) moved.push(fileId);
  });
  return moved;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/**
 * Secures one board. Key and decrypt failures throw (the board is left untouched); a board that
 * changed meanwhile answers `retry` so the caller can read it again.
 */
export async function rekeyBoard(boardId: string, context: RekeyContext): Promise<BoardOutcome> {
  const { workspaceRef, keyContext } = context;
  const board = toBoardMetadata(await getBoard(workspaceRef, boardId));
  const targetVersion = board.project.keyVersion;
  if (board.keyVersion >= targetVersion) return 'already-current';
  if (board.publicShareToken) return 'skipped-public';

  const oldKey = await resolveSealingBoardKey(board, keyContext);
  const payload = await getBoardPayload(workspaceRef, boardId);
  const revision = readPayloadRevision(payload);
  const scene = await openBoardPayload(oldKey, payload, {
    boardId,
    keyVersion: board.keyVersion,
    revision,
  });

  const next = await provisionCurrentBoardKey(board, keyContext);
  // The files go first: the server refuses the re-key until every one has a copy at the new version.
  const fileIds = await moveFiles(sceneFileIds(parseBoardScene(scene).elements), {
    boardId,
    workspaceRef,
    from: { key: oldKey, version: board.keyVersion },
    to: { key: next.boardKey, version: targetVersion },
  });

  const sealed = await sealBoardPayload(next.boardKey, scene, {
    boardId,
    keyVersion: targetVersion,
    revision: revision + 1,
  });

  try {
    await saveBoardPayload(workspaceRef, boardId, sealed, {
      encryptedBoardKey: next.encryptedBoardKey,
      revision,
      fileIds,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code !== undefined && RETRYABLE_CODES.has(code)) return 'retry';
    if (code === PUBLIC_BOARD_CODE) return 'skipped-public';
    throw error;
  }
  return 'secured';
}
