import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clearRevisionStore,
  getHighestSeenRevision,
  setHighestSeenRevision,
} from './revision-store';

describe('revision store', () => {
  afterEach(async () => {
    await clearRevisionStore();
  });

  it('returns null when no revision has been recorded for a board', async () => {
    expect(await getHighestSeenRevision('board-never-seen')).toBeNull();
  });

  it('stores and retrieves the revision for a board', async () => {
    await setHighestSeenRevision('board-1', 5);
    expect(await getHighestSeenRevision('board-1')).toBe(5);
  });

  it('updates when a higher revision is set', async () => {
    await setHighestSeenRevision('board-2', 3);
    expect(await getHighestSeenRevision('board-2')).toBe(3);

    await setHighestSeenRevision('board-2', 7);
    expect(await getHighestSeenRevision('board-2')).toBe(7);
  });

  it('ignores an attempt to set a lower revision', async () => {
    await setHighestSeenRevision('board-3', 10);
    expect(await getHighestSeenRevision('board-3')).toBe(10);

    await setHighestSeenRevision('board-3', 4);
    expect(await getHighestSeenRevision('board-3')).toBe(10);

    await setHighestSeenRevision('board-3', 10);
    expect(await getHighestSeenRevision('board-3')).toBe(10);
  });

  it('clears all recorded revisions', async () => {
    await setHighestSeenRevision('board-a', 2);
    await setHighestSeenRevision('board-b', 8);

    expect(await getHighestSeenRevision('board-a')).toBe(2);
    expect(await getHighestSeenRevision('board-b')).toBe(8);

    await clearRevisionStore();

    expect(await getHighestSeenRevision('board-a')).toBeNull();
    expect(await getHighestSeenRevision('board-b')).toBeNull();
  });
});

describe('revision store connection', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('canvhq_revisions');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it('opens one connection however many calls are made', async () => {
    vi.resetModules();
    const openSpy = vi.spyOn(indexedDB, 'open');
    const store = await import('./revision-store');

    await store.setHighestSeenRevision('board-x', 1);
    await store.setHighestSeenRevision('board-y', 2);
    await store.getHighestSeenRevision('board-x');
    await store.clearRevisionStore();

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('lets another tab upgrade the database instead of blocking it', async () => {
    vi.resetModules();
    const store = await import('./revision-store');
    await store.setHighestSeenRevision('upgrade-board', 1);

    const upgraded = await new Promise<boolean>((resolve) => {
      const request = indexedDB.open('canvhq_revisions', 2);
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
    const store = await import('./revision-store');
    await store.setHighestSeenRevision('reopen-board', 3);

    // A version bump from another tab makes the store drop its connection.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('canvhq_revisions', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    // The database is now newer than this build expects, so the reopen fails and the
    // revision still comes back from the in-memory copy.
    const stored = await store.getHighestSeenRevision('reopen-board');
    expect(openSpy).toHaveBeenCalledTimes(3);
    expect(stored).toBe(3);
  });
});
