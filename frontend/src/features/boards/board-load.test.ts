import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyLoadFailure,
  classifyPayloadStatus,
  decryptLoadedPayload,
  describeBlockedReason,
  isEditable,
  newBoardOutcome,
  openStashedScene,
  type BoardLoadBlockedReason,
} from './board-load';
import { generateSymmetricKey } from '@/lib/crypto';
import { sealBoardPayload } from '@/lib/crypto-format';
import { clearRevisionStore, setHighestSeenRevision } from '@/lib/revision-store';

const context = { boardId: 'board-1', keyVersion: 1, revision: 1 };

describe('board load outcomes', () => {
  beforeEach(async () => {
    await clearRevisionStore();
  });
  it('treats a board that has never been saved as editable', () => {
    const outcome = newBoardOutcome();
    expect(outcome).toEqual({ kind: 'new' });
    expect(isEditable(outcome)).toBe(true);
  });

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'missing-payload'],
    [429, 'server-error'],
    [500, 'server-error'],
    [502, 'server-error'],
    [503, 'server-error'],
  ])('maps a %i payload response to a blocked board (%s)', (status, reason) => {
    const outcome = classifyPayloadStatus(status);
    expect(outcome).toEqual({ kind: 'blocked', reason });
    expect(isEditable(outcome)).toBe(false);
  });

  it('treats a thrown request as a server error, never an empty board', () => {
    const outcome = classifyLoadFailure();
    expect(outcome).toEqual({ kind: 'blocked', reason: 'server-error' });
    expect(isEditable(outcome)).toBe(false);
  });

  it('loads a payload that decrypts with the key', async () => {
    const key = await generateSymmetricKey();
    const ciphertext = await sealBoardPayload(
      key,
      {
        elements: [{ id: 'rect-1', type: 'rectangle' }],
        appState: { gridModeEnabled: true },
      },
      context,
    );

    const outcome = await decryptLoadedPayload(key, ciphertext, context);

    expect(outcome.kind).toBe('loaded');
    if (outcome.kind !== 'loaded') return;
    expect(outcome.scene.elements).toEqual([{ id: 'rect-1', type: 'rectangle' }]);
    expect(outcome.scene.appState).toEqual({ gridModeEnabled: true });
    expect(isEditable(outcome)).toBe(true);
  });

  it('blocks a payload encrypted with a different key', async () => {
    const key = await generateSymmetricKey();
    const otherKey = await generateSymmetricKey();
    const ciphertext = await sealBoardPayload(otherKey, { elements: [] }, context);

    const outcome = await decryptLoadedPayload(key, ciphertext, context);

    expect(outcome).toEqual({ kind: 'blocked', reason: 'cannot-decrypt' });
    expect(isEditable(outcome)).toBe(false);
  });

  it('blocks a payload stored under a different key version', async () => {
    const key = await generateSymmetricKey();
    const ciphertext = await sealBoardPayload(key, { elements: [] }, context);

    const outcome = await decryptLoadedPayload(key, ciphertext, { ...context, keyVersion: 2 });

    expect(outcome).toEqual({ kind: 'blocked', reason: 'format-mismatch' });
  });

  it('blocks a payload that is not valid ciphertext', async () => {
    const key = await generateSymmetricKey();

    const outcome = await decryptLoadedPayload(key, new Uint8Array([1, 2, 3]), context);

    expect(outcome).toEqual({ kind: 'blocked', reason: 'format-mismatch' });
  });

  it('normalises a decrypted payload without elements', async () => {
    const key = await generateSymmetricKey();
    const ciphertext = await sealBoardPayload(key, { appState: {} }, context);

    const outcome = await decryptLoadedPayload(key, ciphertext, context);

    expect(outcome.kind).toBe('loaded');
    if (outcome.kind !== 'loaded') return;
    expect(outcome.scene.elements).toEqual([]);
  });

  it.each<BoardLoadBlockedReason>([
    'forbidden',
    'unauthenticated',
    'server-error',
    'missing-payload',
    'cannot-decrypt',
    'format-mismatch',
  ])('explains a %s block in plain words', (reason) => {
    const described = describeBlockedReason(reason);
    expect(described.title.length).toBeGreaterThan(0);
    expect(described.message.length).toBeGreaterThan(0);
  });

  it('refuses rollback when payload revision is less than highest recorded revision', async () => {
    const key = await generateSymmetricKey();
    await setHighestSeenRevision('board-1', 5);

    const ciphertext = await sealBoardPayload(
      key,
      { elements: [] },
      { boardId: 'board-1', keyVersion: 1, revision: 3 },
    );

    const outcome = await decryptLoadedPayload(key, ciphertext, {
      boardId: 'board-1',
      keyVersion: 1,
      revision: 3,
    });

    expect(outcome).toEqual({ kind: 'blocked', reason: 'rollback-detected' });
    expect(isEditable(outcome)).toBe(false);
  });

  describe('a copy kept on this device after a failed save', () => {
    const scene = { elements: [{ id: 'kept-offline', type: 'rectangle' }] };

    it('opens even though the board has moved on to a later revision', async () => {
      const key = await generateSymmetricKey();
      // Sealed for revision 2; the server is at 5 and this device has seen 5.
      const stashed = await sealBoardPayload(key, scene, {
        boardId: 'board-1',
        keyVersion: 1,
        revision: 2,
      });
      await setHighestSeenRevision('board-1', 5);

      const opened = await openStashedScene(key, stashed, 'board-1');

      expect(opened?.elements).toEqual(scene.elements);
    });

    it('is not opened for another board, with another key, or when damaged', async () => {
      const key = await generateSymmetricKey();
      const stashed = await sealBoardPayload(key, scene, {
        boardId: 'board-1',
        keyVersion: 1,
        revision: 2,
      });

      expect(await openStashedScene(key, stashed, 'board-2')).toBeNull();
      expect(await openStashedScene(await generateSymmetricKey(), stashed, 'board-1')).toBeNull();
      expect(await openStashedScene(key, stashed.slice(0, 12), 'board-1')).toBeNull();
      expect(await openStashedScene(key, new Uint8Array([9, 9, 9]), 'board-1')).toBeNull();
    });
  });

  it('only allows editing for new and loaded boards', () => {
    expect(isEditable(null)).toBe(false);
    expect(isEditable({ kind: 'blocked', reason: 'forbidden' })).toBe(false);
    expect(isEditable({ kind: 'loaded', scene: { elements: [] }, revision: 1 })).toBe(true);
  });
});
