import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEncryptionParams, updateUserProfile, getAuthConfig, getUserPublicKey } from './api';
import { ApiError } from '@/lib/http';

describe('user api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getEncryptionParams parses params correctly', async () => {
    const mockParams = {
      kdfSalt: 'salt123',
      keyWrapIv: 'iv123',
      wrappedPrivateKey: 'wrappedKey',
      publicKey: 'pubKey',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockParams),
      }),
    );

    const result = await getEncryptionParams();
    expect(result.kdfSalt).toBe('salt123');
    expect(result.wrappedPrivateKey).toBe('wrappedKey');
  });

  it('updateUserProfile parses profile details', async () => {
    const mockProfile = {
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockProfile),
      }),
    );

    const result = await updateUserProfile({ name: 'Alice' });
    expect(result.id).toBe('u1');
    expect(result.email).toBe('alice@example.com');
  });

  it('getAuthConfig parses providers and dev login flag', async () => {
    const mockConfig = {
      devLoginEnabled: true,
      providers: ['github', 'google'],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockConfig),
      }),
    );

    const result = await getAuthConfig();
    expect(result.devLoginEnabled).toBe(true);
    expect(result.providers).toContain('github');
  });

  it('getUserPublicKey parses public key', async () => {
    const mockKey = { id: 'u1', publicKey: 'spki_data' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockKey),
      }),
    );

    const result = await getUserPublicKey('u1');
    expect(result.publicKey).toBe('spki_data');
  });

  it('throws UNEXPECTED_RESPONSE on schema failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ wrong: true }),
      }),
    );

    await expect(getUserPublicKey('u1')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe('UNEXPECTED_RESPONSE');
      }
      return true;
    });
  });
});
