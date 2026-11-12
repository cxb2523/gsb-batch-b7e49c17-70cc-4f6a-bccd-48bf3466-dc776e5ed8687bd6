/**
 * The result of opening a board.
 *
 * Only `new` and `loaded` may be edited. Everything else is a `blocked` outcome, and a blocked
 * board must never mount an editor or accept a save: the whole point of this module is that a
 * load that did not actually succeed can no longer be mistaken for an empty board (audit C3).
 */

import type { AppState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import {
  openBoardPayload,
  readPayloadRevision,
  readPayloadKeyVersion,
  KeyVersionMismatchError,
  UnsupportedFormatError,
} from '@/lib/crypto-format';
import { getHighestSeenRevision, setHighestSeenRevision } from '@/lib/revision-store';

export type BoardLoadBlockedReason =
  /** The server refused access (403). */
  | 'forbidden'
  /** The session is gone (401). */
  | 'unauthenticated'
  /** The payload could not be fetched: 5xx, 429, a network failure, an aborted request. */
  | 'server-error'
  /** The board says it has a payload, but storage has no object for it (404). */
  | 'missing-payload'
  /** The payload was fetched but no available key could decrypt it. */
  | 'cannot-decrypt'
  /** The caller has a grant, but nobody has wrapped the project key for them yet. */
  | 'pending-access'
  /** The blob's format byte or key version is not what this build expects. */
  | 'format-mismatch'
  /** The server returned an older revision than the highest seen on this device (audit H6). */
  | 'rollback-detected';

export interface BoardScene {
  elements: readonly ExcalidrawElement[];
  appState?: Partial<AppState> | undefined;
}

/** The decrypted JSON is untrusted until its top-level shape is checked. */
export function parseBoardScene(value: unknown): BoardScene {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The decrypted canvas is not a board scene.');
  }

  const elements = 'elements' in value ? value.elements : [];
  if (!Array.isArray(elements)) {
    throw new Error('The decrypted canvas has no element list.');
  }

  return {
    elements,
    appState:
      'appState' in value && typeof value.appState === 'object' && value.appState !== null
        ? value.appState
        : undefined,
  };
}

export type BoardLoadOutcome =
  | { kind: 'new'; revision?: number | undefined }
  | { kind: 'loaded'; scene: BoardScene; revision: number }
  | { kind: 'blocked'; reason: BoardLoadBlockedReason };

/** A board that has never been saved. There is no ciphertext to decrypt, so editing is safe. */
export function newBoardOutcome(): BoardLoadOutcome {
  return { kind: 'new' };
}

/**
 * Maps a failed payload request to an outcome. Every non-2xx status is a blocked board, including
 * 404: the caller only asks for the payload when `hasPayload` is true, so a 404 means the object is
 * missing, not that the board is empty.
 */
export function classifyPayloadStatus(status: number): BoardLoadOutcome {
  if (status === 401) return { kind: 'blocked', reason: 'unauthenticated' };
  if (status === 403) return { kind: 'blocked', reason: 'forbidden' };
  if (status === 404) return { kind: 'blocked', reason: 'missing-payload' };
  return { kind: 'blocked', reason: 'server-error' };
}

/** A request that threw (offline, DNS, CORS, abort) is a failed load, never an empty board. */
export function classifyLoadFailure(): BoardLoadOutcome {
  return { kind: 'blocked', reason: 'server-error' };
}

/**
 * Decrypts a fetched payload. A decryption failure is a blocked board: the ciphertext exists and
 * is intact as far as we know, so overwriting it would destroy the only copy.
 */
export async function decryptLoadedPayload(
  key: CryptoKey,
  bytes: ArrayBuffer | Uint8Array,
  context: { boardId: string; keyVersion: number; revision?: number | undefined },
): Promise<BoardLoadOutcome> {
  const bytesArr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let payloadRevision = context.revision ?? 0;
  if (bytesArr.length >= 9 && bytesArr[0] === 0x01) {
    payloadRevision = readPayloadRevision(bytesArr);
  }

  const highest = await getHighestSeenRevision(context.boardId);
  if (highest !== null && payloadRevision < highest) {
    return { kind: 'blocked', reason: 'rollback-detected' };
  }

  try {
    const scene = parseBoardScene(
      await openBoardPayload(key, bytes, {
        boardId: context.boardId,
        keyVersion: context.keyVersion,
        revision: payloadRevision,
      }),
    );
    await setHighestSeenRevision(context.boardId, payloadRevision);
    return {
      kind: 'loaded',
      scene,
      revision: payloadRevision,
    };
  } catch (error) {
    if (error instanceof UnsupportedFormatError || error instanceof KeyVersionMismatchError) {
      return { kind: 'blocked', reason: 'format-mismatch' };
    }
    return { kind: 'blocked', reason: 'cannot-decrypt' };
  }
}

/**
 * Opens a payload kept on this device after a failed save. It was sealed for the revision that was
 * next at the time, which may be an old one by now, so its own header decides what it is opened
 * for. The rollback check is for payloads the server sends; a local copy is never taken for the
 * stored board. Returns null when it cannot be opened (damaged, or sealed under an older key).
 */
export async function openStashedScene(
  key: CryptoKey,
  bytes: Uint8Array,
  boardId: string,
): Promise<BoardScene | null> {
  try {
    return parseBoardScene(
      await openBoardPayload(key, bytes, {
        boardId,
        keyVersion: readPayloadKeyVersion(bytes),
        revision: readPayloadRevision(bytes),
      }),
    );
  } catch {
    return null;
  }
}

/** Whether the outcome allows the canvas to be mounted and edits to be saved. */
export function isEditable(outcome: BoardLoadOutcome | null): boolean {
  return outcome?.kind === 'new' || outcome?.kind === 'loaded';
}

/** The plain-language panel shown for a blocked board. */
export function describeBlockedReason(reason: BoardLoadBlockedReason): {
  title: string;
  message: string;
} {
  switch (reason) {
    case 'rollback-detected':
      return {
        title: 'Older version detected',
        message:
          'The server returned an older version of this canvas. It has not been opened or overwritten. Check your connection or contact an administrator.',
      };
    case 'unauthenticated':
      return {
        title: 'Sign in to open this canvas',
        message:
          'Your session has ended. Sign in again to load this canvas. It has not been touched.',
      };
    case 'forbidden':
      return {
        title: 'Access Restricted',
        message:
          'This canvas is encrypted client-side and your account does not have access to its key. Ask a workspace administrator to grant you access. The canvas has not been touched.',
      };
    case 'missing-payload':
      return {
        title: 'Canvas data is unavailable',
        message:
          'The stored copy of this canvas could not be found. It has not been touched. Try again, or contact your administrator if the problem continues.',
      };
    case 'format-mismatch':
      return {
        title: 'This canvas cannot be read',
        message:
          'The stored canvas uses a format or key generation this version of CanvHQ does not recognise. It has not been touched. Update CanvHQ or ask a workspace administrator to check it.',
      };
    case 'pending-access':
      return {
        title: 'Waiting for access',
        message:
          'An administrator needs to grant you access to this project. Nothing has been changed. Once they grant it, reload this canvas.',
      };
    case 'cannot-decrypt':
      return {
        title: 'Could not decrypt this canvas',
        message:
          'The available key does not open this canvas. Nothing has been changed. Ask a workspace administrator for access, or try again with the right key.',
      };
    case 'server-error':
    default:
      return {
        title: 'Canvas could not be loaded',
        message:
          'The canvas could not be fetched just now. It has not been touched. Check your connection and try again.',
      };
  }
}
