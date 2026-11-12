import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  storePrivateKey,
  getPrivateKey,
  clearPrivateKey,
  clearAllKeys,
  clearLocalKeyMaterial,
} from './key-store';
import { queryClient } from './query-client';
import { generateUserIdentityKeypair } from './crypto';

describe('IndexedDB Key Store', () => {
  beforeEach(async () => {
    await clearAllKeys();
  });

  it('stores and retrieves a private key for a user', async () => {
    const keypair = await generateUserIdentityKeypair();
    const userId = 'usr_test_123';

    await storePrivateKey(userId, keypair.privateKey);
    const retrieved = await getPrivateKey(userId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('private');
  });

  it('clears a specific user key', async () => {
    const keypair = await generateUserIdentityKeypair();
    const userId = 'usr_test_456';

    await storePrivateKey(userId, keypair.privateKey);
    await clearPrivateKey(userId);

    const retrieved = await getPrivateKey(userId);
    expect(retrieved).toBeNull();
  });

  it('clears all keys on logout', async () => {
    const keypair = await generateUserIdentityKeypair();
    await storePrivateKey('u1', keypair.privateKey);
    await storePrivateKey('u2', keypair.privateKey);

    await clearAllKeys();
    expect(await getPrivateKey('u1')).toBeNull();
    expect(await getPrivateKey('u2')).toBeNull();
  });

  it('clears query cache and all local key material on sign-out', async () => {
    queryClient.setQueryData(['access', 'w1'], { canCreateWorkspace: true });
    expect(queryClient.getQueryData(['access', 'w1'])).toBeDefined();

    window.localStorage.setItem('canvhq_key_test', 'secret');

    await clearLocalKeyMaterial();

    expect(queryClient.getQueryData(['access', 'w1'])).toBeUndefined();
    expect(window.localStorage.getItem('canvhq_key_test')).toBeNull();
  });
});
