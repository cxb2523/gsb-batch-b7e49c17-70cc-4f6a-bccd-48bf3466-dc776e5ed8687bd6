/**
 * End-to-End Encryption (E2EE) Module.
 * Utilizes the native Web Crypto API:
 * - PBKDF2 (SHA-256, 600,000 iterations) for Key Encryption Key (KEK) derivation.
 * - RSA-OAEP (2048-bit, SHA-256) for asymmetric user identity keypairs and asymmetric wrapping.
 * - AES-GCM (256-bit) with fresh 12-byte IVs for symmetric data & symmetric key wrapping.
 *
 * Keys and unencrypted payloads are strictly processed client-side.
 */

// Helper to convert Uint8Array to URL-safe base64 string
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Helper to convert URL-safe base64 string to Uint8Array
export function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a cryptographically secure 256-bit AES-GCM symmetric key.
 */
export async function generateSymmetricKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

/**
 * Derive a 256-bit AES-GCM Key Encryption Key (KEK) from a user passphrase and salt
 * using PBKDF2 with SHA-256 and 600,000 iterations.
 */
export async function deriveKEK(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    passphraseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Generate an RSA-OAEP 2048-bit keypair for user identity.
 * Private key is extractable so it can be wrapped with the user's KEK.
 */
export async function generateUserIdentityKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Export an RSA-OAEP public key to a base64url string (SPKI format).
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bytesToBase64Url(new Uint8Array(spki));
}

/**
 * Import an RSA-OAEP public key from a base64url string (SPKI format).
 */
export async function importPublicKey(spkiBase64Url: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(spkiBase64Url);
  return crypto.subtle.importKey(
    'spki',
    bytes,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['wrapKey'],
  );
}

/**
 * Wrap a user's RSA-OAEP private key using a derived KEK and a fresh 12-byte IV.
 * Returns wrappedPrivateKey (base64url) and keyWrapIv (base64url).
 */
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  kek: CryptoKey,
): Promise<{ wrappedPrivateKey: string; keyWrapIv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const wrappedBuffer = await crypto.subtle.wrapKey('pkcs8', privateKey, kek, {
    name: 'AES-GCM',
    iv,
  });

  return {
    wrappedPrivateKey: bytesToBase64Url(new Uint8Array(wrappedBuffer)),
    keyWrapIv: bytesToBase64Url(iv),
  };
}

/**
 * Unwrap a user's RSA-OAEP private key using their derived KEK.
 * extractable: false for normal session / IndexedDB storage,
 * extractable: true during passphrase rotation so it can be re-wrapped.
 */
export async function unwrapPrivateKey(
  wrappedPrivateKeyBase64Url: string,
  keyWrapIvBase64Url: string,
  kek: CryptoKey,
  extractable = false,
): Promise<CryptoKey> {
  const wrappedBytes = base64UrlToBytes(wrappedPrivateKeyBase64Url);
  const iv = base64UrlToBytes(keyWrapIvBase64Url);

  return crypto.subtle.unwrapKey(
    'pkcs8',
    wrappedBytes,
    kek,
    {
      name: 'AES-GCM',
      iv,
    },
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    extractable,
    ['unwrapKey'],
  );
}

/**
 * Export a CryptoKey to a URL-safe base64 string.
 */
export async function exportKeyToHash(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64Url(new Uint8Array(raw));
}

/**
 * Parse board hash fragment into key and mode parameters.
 * Supports '#key=...&mode=readonly', '#mode=readonly&key=...', or legacy '#key=...'.
 */
export function parseBoardHash(hashString: string): {
  key?: string | undefined;
  mode?: string | undefined;
} {
  let clean = hashString.trim();
  if (clean.startsWith('#')) {
    clean = clean.slice(1);
  }
  if (clean.includes('&') || clean.includes('=')) {
    const params = new URLSearchParams(clean);
    return {
      key: params.get('key') || params.get('inviteKey') || undefined,
      mode: params.get('mode') || undefined,
    };
  }
  return {
    key: clean || undefined,
    mode: undefined,
  };
}

/**
 * Import a CryptoKey from a URL hash string or base64url string.
 * Handles '#key=...', 'key=...', '#key=...&mode=readonly', or raw base64url.
 */
export async function importKeyFromHash(hashString: string): Promise<CryptoKey> {
  let cleanKey = hashString.trim();
  if (cleanKey.startsWith('#')) {
    cleanKey = cleanKey.slice(1);
  }

  // Handle multi-parameter hash strings like "key=xyz&mode=readonly"
  if (cleanKey.includes('&') || cleanKey.includes('=')) {
    const params = new URLSearchParams(cleanKey);
    const extracted = params.get('key') || params.get('inviteKey');
    if (extracted) {
      cleanKey = extracted;
    }
  }

  if (cleanKey.startsWith('key=')) {
    cleanKey = cleanKey.slice(4);
  }
  if (cleanKey.startsWith('inviteKey=')) {
    cleanKey = cleanKey.slice(10);
  }

  if (!cleanKey) {
    throw new Error('Missing encryption key in hash string');
  }

  const rawBytes = base64UrlToBytes(cleanKey);
  if (rawBytes.byteLength !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes (256-bit), got ${rawBytes.byteLength}`);
  }

  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
    'wrapKey',
    'unwrapKey',
  ]);
}
