/**
 * Client-side highest-seen-revision store for canvas rollback detection (Batch 17).
 *
 * Persists the highest revision number seen for each board in IndexedDB.
 * A board load whose revision is strictly less than the recorded highest revision
 * is refused as a blocked state to detect server replays of older valid payloads.
 *
 * Single-connection pattern following unsaved-store.ts with an in-memory fallback cache.
 */

const DB_NAME = 'canvhq_revisions';
const DB_VERSION = 1;
const STORE_NAME = 'revisions';

export interface StoredRevision {
  boardId: string;
  revision: number;
}

function isStoredRevision(value: unknown): value is StoredRevision {
  return (
    typeof value === 'object' &&
    value !== null &&
    'boardId' in value &&
    typeof value.boardId === 'string' &&
    'revision' in value &&
    typeof value.revision === 'number'
  );
}

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return undefined;
}

// In-memory fallback cache in case IndexedDB is unavailable
const memoryRevisions = new Map<string, number>();

// One connection for the whole module, opened on first use.
let connection: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  connection ??= connect();
  return connection;
}

function connect(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.resolve(null);
  }

  const opening: Promise<IDBDatabase | null> = new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    let abandoned = false;

    const forgetConnection = () => {
      if (connection === opening) connection = null;
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'boardId' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        forgetConnection();
      };
      db.onclose = forgetConnection;
      resolve(db);
    };

    request.onerror = () => {
      forgetConnection();
      reject(request.error);
    };

    request.onblocked = () => {
      abandoned = true;
      forgetConnection();
      reject(new Error('Opening the revision database is blocked by another tab.'));
    };
  });

  return opening;
}

/**
 * Returns the highest revision seen on this device for the given board, or null if never seen.
 */
export async function getHighestSeenRevision(boardId: string): Promise<number | null> {
  try {
    const db = await openDatabase();
    if (!db) {
      return memoryRevisions.get(boardId) ?? null;
    }

    return await new Promise<number | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(boardId);
      req.onsuccess = () => {
        const result: unknown = req.result;
        if (isStoredRevision(result)) {
          memoryRevisions.set(boardId, result.revision);
          resolve(result.revision);
        } else {
          resolve(memoryRevisions.get(boardId) ?? null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB getHighestSeenRevision error:', err);
    return memoryRevisions.get(boardId) ?? null;
  }
}

/**
 * Stores the highest revision for a board on this device (stores max(current, revision)).
 * If the provided revision is less than or equal to what is already stored, no update occurs.
 */
export async function setHighestSeenRevision(boardId: string, revision: number): Promise<void> {
  const current = await getHighestSeenRevision(boardId);
  if (current !== null && revision <= current) {
    return;
  }

  const highest = current !== null ? Math.max(current, revision) : revision;
  memoryRevisions.set(boardId, highest);

  try {
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const record: StoredRevision = { boardId, revision: highest };
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB setHighestSeenRevision error:', err);
  }
}

/**
 * Clears all stored board revisions on this device.
 */
export async function clearRevisionStore(): Promise<void> {
  memoryRevisions.clear();

  try {
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB clearRevisionStore error:', err);
  }
}
