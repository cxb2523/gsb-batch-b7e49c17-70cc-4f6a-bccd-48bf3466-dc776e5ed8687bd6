import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deleteUnsavedPayload, getUnsavedPayload, saveUnsavedPayload } from './unsaved-store';

describe('unsaved payload store', () => {
  it('round-trips an encrypted payload with its timestamp', async () => {
    const boardId = 'round-trip-board';
    const ciphertext = new Uint8Array([1, 2, 3, 4, 5]);
    const savedAt = 1_700_000_000_000;

    await saveUnsavedPayload(boardId, ciphertext, savedAt);
    const stored = await getUnsavedPayload(boardId);

    expect(stored).not.toBeNull();
    expect(stored?.boardId).toBe(boardId);
    expect(Array.from(stored?.ciphertext ?? [])).toEqual([1, 2, 3, 4, 5]);
    expect(stored?.savedAt).toBe(savedAt);
  });

  it('replaces an earlier stash for the same board', async () => {
    const boardId = 'replace-board';

    await saveUnsavedPayload(boardId, new Uint8Array([1]), 1);
    await saveUnsavedPayload(boardId, new Uint8Array([2, 2]), 2);

    const stored = await getUnsavedPayload(boardId);
    expect(Array.from(stored?.ciphertext ?? [])).toEqual([2, 2]);
    expect(stored?.savedAt).toBe(2);
  });

  it('returns null when there is no stash', async () => {
    expect(await getUnsavedPayload('never-saved-board')).toBeNull();
  });

  it('clears the stash after a successful save or a discard', async () => {
    const boardId = 'cleared-board';

    await saveUnsavedPayload(boardId, new Uint8Array([9]));
    await deleteUnsavedPayload(boardId);

    expect(await getUnsavedPayload(boardId)).toBeNull();
  });
});

describe('unsaved payload store connection', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('canvhq_unsaved');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it('opens one connection however many calls are made', async () => {
    vi.resetModules();
    const openSpy = vi.spyOn(indexedDB, 'open');
    const store = await import('./unsaved-store');

    await store.saveUnsavedPayload('shared-1', new Uint8Array([1]));
    await store.saveUnsavedPayload('shared-2', new Uint8Array([2]));
    await store.getUnsavedPayload('shared-1');
    await store.deleteUnsavedPayload('shared-2');

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('lets another tab upgrade the database instead of blocking it', async () => {
    vi.resetModules();
    const store = await import('./unsaved-store');
    await store.saveUnsavedPayload('upgrade-board', new Uint8Array([7]), 1);

    const upgraded = await new Promise<boolean>((resolve) => {
      const request = indexedDB.open('canvhq_unsaved', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
      request.onblocked = () => resolve(false);
    });

    expect(upgraded).toBe(true);
  });

  it('reopens after the connection was dropped', async () => {
    vi.resetModules();
    const openSpy = vi.spyOn(indexedDB, 'open');
    const store = await import('./unsaved-store');
    await store.saveUnsavedPayload('reopen-board', new Uint8Array([3]), 1);

    // A version bump from another tab makes the store drop its connection.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('canvhq_unsaved', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    // The database is now newer than this build expects, so the reopen fails and the
    // payload still comes back from the in-memory copy.
    const stored = await store.getUnsavedPayload('reopen-board');
    // Store open, the other tab's upgrade, then the store's reopen.
    expect(openSpy).toHaveBeenCalledTimes(3);
    expect(Array.from(stored?.ciphertext ?? [])).toEqual([3]);
  });
});
