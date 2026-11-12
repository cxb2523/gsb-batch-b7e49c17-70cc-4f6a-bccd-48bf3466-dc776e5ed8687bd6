import { describe, it, expect } from 'vitest';
import {
  generateSymmetricKey,
  exportKeyToHash,
  importKeyFromHash,
  deriveKEK,
  generateUserIdentityKeypair,
  exportPublicKey,
  importPublicKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  parseBoardHash,
} from './crypto';

describe('Crypto primitives and passphrase identity', () => {
  it('generates 256-bit AES-GCM key and exports/imports via URL hash string', async () => {
    const key = await generateSymmetricKey();
    expect(key).toBeDefined();

    const hashString = await exportKeyToHash(key);
    expect(hashString.length).toBeGreaterThan(20);

    const imported1 = await importKeyFromHash(hashString);
    const imported2 = await importKeyFromHash(`key=${hashString}`);
    const imported3 = await importKeyFromHash(`#key=${hashString}`);
    const imported4 = await importKeyFromHash(`#inviteKey=${hashString}`);
    const imported5 = await importKeyFromHash(`#key=${hashString}&mode=readonly`);
    const imported6 = await importKeyFromHash(`#mode=readonly&key=${hashString}`);

    expect(imported1).toBeDefined();
    expect(imported2).toBeDefined();
    expect(imported3).toBeDefined();
    expect(imported4).toBeDefined();
    expect(imported5).toBeDefined();
    expect(imported6).toBeDefined();
  });

  it('parses board hash into key and mode parameters', async () => {
    const key = await generateSymmetricKey();
    const hashString = await exportKeyToHash(key);

    const parsed1 = parseBoardHash(`#key=${hashString}&mode=readonly`);
    expect(parsed1.key).toBe(hashString);
    expect(parsed1.mode).toBe('readonly');

    const parsed2 = parseBoardHash(`#mode=readonly&key=${hashString}`);
    expect(parsed2.key).toBe(hashString);
    expect(parsed2.mode).toBe('readonly');

    const parsed3 = parseBoardHash(`#key=${hashString}`);
    expect(parsed3.key).toBe(hashString);
    expect(parsed3.mode).toBeUndefined();
  });

  describe('Account-Based E2EE Hierarchy & Key Derivation', () => {
    it('derives KEK from passphrase and salt', async () => {
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const kek1 = await deriveKEK('master-passphrase-123!', salt);
      expect(kek1.algorithm.name).toBe('AES-GCM');
      expect(kek1.type).toBe('secret');

      // Same passphrase and salt derives key that can unwrap what the other wrapped
      const keypair = await generateUserIdentityKeypair();
      const { wrappedPrivateKey, keyWrapIv } = await wrapPrivateKey(keypair.privateKey, kek1);

      const kek2 = await deriveKEK('master-passphrase-123!', salt);
      const unwrapped = await unwrapPrivateKey(wrappedPrivateKey, keyWrapIv, kek2);
      expect(unwrapped.type).toBe('private');
    });

    it('fails to unwrap private key with incorrect passphrase KEK', async () => {
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const kek = await deriveKEK('correct-passphrase', salt);
      const wrongKek = await deriveKEK('wrong-passphrase', salt);

      const keypair = await generateUserIdentityKeypair();
      const { wrappedPrivateKey, keyWrapIv } = await wrapPrivateKey(keypair.privateKey, kek);

      await expect(unwrapPrivateKey(wrappedPrivateKey, keyWrapIv, wrongKek)).rejects.toThrow();
    });

    it('exports and imports RSA-OAEP public key in SPKI format', async () => {
      const keypair = await generateUserIdentityKeypair();
      const spkiStr = await exportPublicKey(keypair.publicKey);
      expect(typeof spkiStr).toBe('string');
      expect(spkiStr.length).toBeGreaterThan(50);

      const importedPub = await importPublicKey(spkiStr);
      expect(importedPub.type).toBe('public');
      expect(importedPub.algorithm.name).toBe('RSA-OAEP');
    });

    it('supports extractable: true during passphrase rotation', async () => {
      const salt1 = window.crypto.getRandomValues(new Uint8Array(16));
      const kek1 = await deriveKEK('old-passphrase', salt1);

      const keypair = await generateUserIdentityKeypair();
      const { wrappedPrivateKey, keyWrapIv } = await wrapPrivateKey(keypair.privateKey, kek1);

      // Unwrap with extractable: true for rotation
      const unwrappedForRotation = await unwrapPrivateKey(
        wrappedPrivateKey,
        keyWrapIv,
        kek1,
        true, // extractable!
      );
      expect(unwrappedForRotation.extractable).toBe(true);

      // Re-wrap with new KEK
      const salt2 = window.crypto.getRandomValues(new Uint8Array(16));
      const kek2 = await deriveKEK('new-passphrase', salt2);
      const rewrapped = await wrapPrivateKey(unwrappedForRotation, kek2);

      // Verify new passphrase can unwrap it with extractable: false for normal caching
      const unwrappedNew = await unwrapPrivateKey(
        rewrapped.wrappedPrivateKey,
        rewrapped.keyWrapIv,
        kek2,
        false,
      );
      expect(unwrappedNew.extractable).toBe(false);
    });
  });
});
