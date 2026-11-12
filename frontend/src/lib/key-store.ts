import { queryClient } from './query-client';

/**
 * Client-Side IndexedDB Key Store for Non-Extractable RSA-OAEP Identity Keys.
 *
 * Web Crypto allows non-extractable CryptoKey objects to be persisted across
 * browser reloads via IndexedDB's Structured Clone algorithm, preventing
 * key extraction or theft via XSS while keeping the session unlocked.
 */

const DB_NAME = 'canvhq_e2ee';
const DB_VERSION = 1;
const STORE_NAME = 'identity_keys';

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return undefined;
}

// Memory fallback cache in case IndexedDB is unavailable
const memoryKeyCache = new Map<string, CryptoKey>();

function isStoredKey(value: unknown): value is { key: CryptoKey } {
  return (
    typeof value === 'object' && value !== null && 'key' in value && value.key instanceof CryptoKey
  );
}

export function openKeyDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Cache unwrapped RSA-OAEP private key for the logged in user.
 */
export async function storePrivateKey(userId: string, privateKey: CryptoKey): Promise<void> {
  memoryKeyCache.set(userId, privateKey);

  try {
    const db = await openKeyDatabase();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ userId, key: privateKey, storedAt: Date.now() });

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // The cache is best-effort: without it the user is asked for the passphrase again.
    console.warn('IndexedDB storePrivateKey error:', err);
  }
}

/**
 * Retrieve cached RSA-OAEP private key for the logged in user.
 */
export async function getPrivateKey(userId: string): Promise<CryptoKey | null> {
  if (memoryKeyCache.has(userId)) {
    return memoryKeyCache.get(userId) || null;
  }

  try {
    const db = await openKeyDatabase();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(userId);

      req.onsuccess = () => {
        const result: unknown = req.result;
        if (isStoredKey(result)) {
          memoryKeyCache.set(userId, result.key);
          resolve(result.key);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // An unreadable cache reads as "locked", which prompts for the passphrase.
    console.warn('IndexedDB getPrivateKey error:', err);
    return null;
  }
}

/**
 * Remove cached private key for a specific user.
 */
export async function clearPrivateKey(userId: string): Promise<void> {
  memoryKeyCache.delete(userId);

  try {
    const db = await openKeyDatabase();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(userId);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // Sign-out must not be blocked by a storage failure; the key is non-extractable and local only.
    console.warn('IndexedDB clearPrivateKey error:', err);
  }
}

/** Every local trace of key material: the cached private key and any legacy board-key copy. */
export async function clearLocalKeyMaterial(): Promise<void> {
  await clearAllKeys();
  queryClient.clear();

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (key.startsWith('canvhq_key_')) {
        storage.removeItem(key);
      }
    }
  }
}

/**
 * Clear all cached private keys on user logout.
 */
export async function clearAllKeys(): Promise<void> {
  memoryKeyCache.clear();

  try {
    const db = await openKeyDatabase();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // Sign-out must not be blocked by a storage failure; the keys are non-extractable and local only.
    console.warn('IndexedDB clearAllKeys error:', err);
  }
}
