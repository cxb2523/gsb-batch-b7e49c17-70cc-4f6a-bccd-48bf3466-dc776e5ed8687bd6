/**
 * Local stash of board payloads that could not be saved.
 *
 * The payload is always the already-encrypted ciphertext produced by `sealBoardPayload`, bound to
 * its board id and key version; nothing
 * unencrypted is ever written here, exactly as with the key store. The stash lets a failed save
 * keep the user's work across a reload instead of losing it with the tab (audit H11).
 */

const DB_NAME = 'canvhq_unsaved';
const DB_VERSION = 1;
const STORE_NAME = 'unsaved_payloads';

export interface UnsavedPayload {
  boardId: string;
  /** Ciphertext exactly as it would have been sent to the server. */
  ciphertext: Uint8Array;
  /** When the stash was written, used to decide whether it is newer than the stored board. */
  savedAt: number;
}

function isUnsavedPayload(value: unknown): value is UnsavedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'boardId' in value &&
    'ciphertext' in value &&
    'savedAt' in value
  );
}

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return undefined;
}

// Memory fallback cache in case IndexedDB is unavailable, so a failed save still survives a
// re-render within the same page.
const memoryStash = new Map<string, UnsavedPayload>();

// One connection for the whole module, opened on first use. It is dropped whenever the browser
// closes it or another tab wants to upgrade the database, so the next call opens a fresh one.
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

    // A late event from an old connection must not drop a newer one.
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
      // Closing on versionchange lets another tab's upgrade proceed instead of waiting on us.
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
    // A blocked open would otherwise leave every caller waiting; they fall back to memory.
    request.onblocked = () => {
      abandoned = true;
      forgetConnection();
      reject(new Error('Opening the unsaved-changes database is blocked by another tab.'));
    };
  });
  return opening;
}

/** Stores the latest encrypted payload for a board, replacing any earlier stash. */
export async function saveUnsavedPayload(
  boardId: string,
  ciphertext: Uint8Array,
  savedAt = Date.now(),
): Promise<void> {
  const record: UnsavedPayload = { boardId, ciphertext, savedAt };
  memoryStash.set(boardId, record);

  try {
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB saveUnsavedPayload error:', err);
  }
}

/** Returns the stashed payload for a board, if there is one. */
export async function getUnsavedPayload(boardId: string): Promise<UnsavedPayload | null> {
  try {
    const db = await openDatabase();
    if (!db) {
      return memoryStash.get(boardId) ?? null;
    }

    return await new Promise<UnsavedPayload | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(boardId);
      req.onsuccess = () => {
        const result: unknown = req.result;
        resolve(isUnsavedPayload(result) ? result : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB getUnsavedPayload error:', err);
    return memoryStash.get(boardId) ?? null;
  }
}

/** Removes the stash after a successful save, or when the user discards it. */
export async function deleteUnsavedPayload(boardId: string): Promise<void> {
  memoryStash.delete(boardId);

  try {
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(boardId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB deleteUnsavedPayload error:', err);
  }
}
