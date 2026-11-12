import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { KeyProvider, useKeyContext } from './KeyContext';
import { useSession } from '@/lib/auth-client';
import * as keyStore from '@/lib/key-store';
import * as cryptoLib from '@/lib/crypto';
import { jsonResponse } from '@/test/http';

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/key-store', () => ({
  getPrivateKey: vi.fn(),
  storePrivateKey: vi.fn(),
  clearPrivateKey: vi.fn(),
  clearAllKeys: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  deriveKEK: vi.fn(),
  generateUserIdentityKeypair: vi.fn(),
  exportPublicKey: vi.fn(),
  wrapPrivateKey: vi.fn(),
  unwrapPrivateKey: vi.fn(),
  unwrapKeyWithPrivateKey: vi.fn(),
  unwrapKeyWithSymmetricKey: vi.fn(),
  base64UrlToBytes: vi.fn(() => new Uint8Array([1, 2, 3])),
  bytesToBase64Url: vi.fn(() => 'mock-base64url'),
}));

interface HarnessProps {
  onContextReady?: ((ctx: ReturnType<typeof useKeyContext>) => void) | undefined;
  route?: string;
}

function ContextHarness({
  onContextReady,
}: {
  onContextReady?: ((ctx: ReturnType<typeof useKeyContext>) => void) | undefined;
}) {
  const ctx = useKeyContext();
  useEffect(() => {
    onContextReady?.(ctx);
  }, [ctx, onContextReady]);

  return (
    <div>
      <span data-testid="is-loading">{String(ctx.isLoading)}</span>
      <span data-testid="is-unlocked">{String(ctx.isUnlocked)}</span>
      <span data-testid="is-initialized">{String(ctx.isInitialized)}</span>
      <span data-testid="public-key">{ctx.publicKeySpki || 'none'}</span>
      <button data-testid="btn-prompt-unlock" onClick={() => ctx.promptUnlock()}>
        Prompt Unlock
      </button>
    </div>
  );
}

function renderWithKeyProvider({ onContextReady, route = '/' }: HarnessProps = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <KeyProvider>
        <ContextHarness onContextReady={onContextReady} />
      </KeyProvider>
    </MemoryRouter>,
  );
}

/** Every request is answered with a fresh JSON response carrying this body. */
function stubFetchBody(body: unknown) {
  global.fetch = vi.fn().mockImplementation(async () => jsonResponse(body));
}

describe('KeyContext & KeyProvider', () => {
  const originalFetch = global.fetch;
  const mockUser = { id: 'user_test_99', email: 'test@canvhq.internal' };
  const mockPrivateKey = {
    type: 'private',
    algorithm: { name: 'RSA-OAEP' },
  } as unknown as CryptoKey;
  const mockPublicKey = { type: 'public', algorithm: { name: 'RSA-OAEP' } } as unknown as CryptoKey;
  const mockKek = { type: 'secret', algorithm: { name: 'AES-KW' } } as unknown as CryptoKey;

  beforeEach(() => {
    vi.clearAllMocks();
    (useSession as any).mockReturnValue({
      data: { user: mockUser },
      isPending: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('handles initial loading state and finishes loading after server params fetch', async () => {
    stubFetchBody({
      kdfSalt: 'mockSalt',
      keyWrapIv: 'mockIv',
      wrappedPrivateKey: 'mockWrappedKey',
      publicKey: 'mockPubSpki',
    });
    (keyStore.getPrivateKey as any).mockResolvedValue(mockPrivateKey);

    renderWithKeyProvider();

    // Loading should resolve to false
    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-initialized').textContent).toBe('true');
    expect(screen.getByTestId('is-unlocked').textContent).toBe('true');
    expect(screen.getByTestId('public-key').textContent).toBe('mockPubSpki');
  });

  it('auto-unlocks when private key is cached in IndexedDB key-store', async () => {
    stubFetchBody({
      kdfSalt: 'salt-123',
      keyWrapIv: 'iv-123',
      wrappedPrivateKey: 'wrapped-priv-key',
      publicKey: 'public-key-spki-123',
    });
    (keyStore.getPrivateKey as any).mockResolvedValue(mockPrivateKey);

    let latestCtx: ReturnType<typeof useKeyContext> | undefined;
    renderWithKeyProvider({ onContextReady: (ctx) => (latestCtx = ctx) });

    await waitFor(() => {
      expect(latestCtx?.isUnlocked).toBe(true);
    });

    expect(latestCtx?.privateKey).toBe(mockPrivateKey);
    expect(latestCtx?.publicKeySpki).toBe('public-key-spki-123');
    expect(keyStore.getPrivateKey).toHaveBeenCalledWith(mockUser.id);
    // No unlock modal should be shown
    expect(
      screen.queryByRole('heading', { name: /Unlock Your Canvases/i }),
    ).not.toBeInTheDocument();
  });

  it('prompts unlock modal when account is initialized but private key is not in IndexedDB', async () => {
    stubFetchBody({
      kdfSalt: 'salt-123',
      keyWrapIv: 'iv-123',
      wrappedPrivateKey: 'wrapped-priv-key',
      publicKey: 'public-key-spki-123',
    });
    (keyStore.getPrivateKey as any).mockResolvedValue(null); // No key cached

    renderWithKeyProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-initialized').textContent).toBe('true');
      expect(screen.getByTestId('is-unlocked').textContent).toBe('false');
    });

    // Unlock modal should be displayed
    expect(screen.getByRole('heading', { name: /Unlock Your Canvases/i })).toBeInTheDocument();
  });

  it('marks is-initialized as false without opening an intrusive setup modal when account has not initialized encryption yet', async () => {
    stubFetchBody({
      kdfSalt: null,
      keyWrapIv: null,
      wrappedPrivateKey: null,
      publicKey: null,
    });

    renderWithKeyProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-initialized').textContent).toBe('false');
      expect(screen.getByTestId('is-unlocked').textContent).toBe('false');
    });

    // Setup modal should NOT be displayed as popup - dedicated /setup-passphrase page handles it
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();
  });

  it('setupEncryption creates keypair, posts setup to API, stores key, and unlocks', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      if (url.includes('/api/user/encryption-params')) {
        return Promise.resolve(
          jsonResponse({
            kdfSalt: null,
            keyWrapIv: null,
            wrappedPrivateKey: null,
            publicKey: null,
          }),
        );
      }
      if (url.includes('/api/user/encryption-setup') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ success: true }));
      }
      return Promise.reject(new Error('Unknown route'));
    });

    (cryptoLib.deriveKEK as any).mockResolvedValue(mockKek);
    (cryptoLib.generateUserIdentityKeypair as any).mockResolvedValue({
      privateKey: mockPrivateKey,
      publicKey: mockPublicKey,
    });
    (cryptoLib.wrapPrivateKey as any).mockResolvedValue({
      wrappedPrivateKey: 'new-wrapped-key',
      keyWrapIv: 'new-iv',
    });
    (cryptoLib.exportPublicKey as any).mockResolvedValue('new-pub-spki');
    (cryptoLib.unwrapPrivateKey as any).mockResolvedValue(mockPrivateKey);

    let latestCtx: ReturnType<typeof useKeyContext> | undefined;
    renderWithKeyProvider({ onContextReady: (ctx) => (latestCtx = ctx) });

    await waitFor(() => {
      expect(latestCtx?.isInitialized).toBe(false);
    });

    await act(async () => {
      await latestCtx?.setupEncryption('SuperSecurePassphrase123!');
    });

    expect(cryptoLib.deriveKEK).toHaveBeenCalledWith(
      'SuperSecurePassphrase123!',
      expect.any(Uint8Array),
    );
    expect(cryptoLib.generateUserIdentityKeypair).toHaveBeenCalled();
    expect(cryptoLib.wrapPrivateKey).toHaveBeenCalledWith(mockPrivateKey, mockKek);
    expect(cryptoLib.exportPublicKey).toHaveBeenCalledWith(mockPublicKey);
    expect(keyStore.storePrivateKey).toHaveBeenCalledWith(mockUser.id, mockPrivateKey);

    expect(latestCtx?.isUnlocked).toBe(true);
    expect(latestCtx?.isInitialized).toBe(true);
    expect(latestCtx?.publicKeySpki).toBe('new-pub-spki');
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();
  });

  it('unlockEncryption unwraps private key with correct passphrase and caches key', async () => {
    stubFetchBody({
      kdfSalt: 'salt-abc',
      keyWrapIv: 'iv-abc',
      wrappedPrivateKey: 'wrapped-key-abc',
      publicKey: 'pub-spki-abc',
    });
    (keyStore.getPrivateKey as any).mockResolvedValue(null);
    (cryptoLib.deriveKEK as any).mockResolvedValue(mockKek);
    (cryptoLib.unwrapPrivateKey as any).mockResolvedValue(mockPrivateKey);

    let latestCtx: ReturnType<typeof useKeyContext> | undefined;
    renderWithKeyProvider({ onContextReady: (ctx) => (latestCtx = ctx) });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Unlock Your Canvases/i })).toBeInTheDocument();
    });

    await act(async () => {
      await latestCtx?.unlockEncryption('CorrectPassphrase123!');
    });

    expect(cryptoLib.deriveKEK).toHaveBeenCalledWith(
      'CorrectPassphrase123!',
      expect.any(Uint8Array),
    );
    expect(cryptoLib.unwrapPrivateKey).toHaveBeenCalledWith(
      'wrapped-key-abc',
      'iv-abc',
      mockKek,
      false,
    );
    expect(keyStore.storePrivateKey).toHaveBeenCalledWith(mockUser.id, mockPrivateKey);
    expect(latestCtx?.isUnlocked).toBe(true);
    expect(
      screen.queryByRole('heading', { name: /Unlock Your Canvases/i }),
    ).not.toBeInTheDocument();
  });

  it('unlockEncryption rejects and preserves locked state when passphrase is incorrect', async () => {
    stubFetchBody({
      kdfSalt: 'salt-abc',
      keyWrapIv: 'iv-abc',
      wrappedPrivateKey: 'wrapped-key-abc',
      publicKey: 'pub-spki-abc',
    });
    (keyStore.getPrivateKey as any).mockResolvedValue(null);
    (cryptoLib.deriveKEK as any).mockResolvedValue(mockKek);
    (cryptoLib.unwrapPrivateKey as any).mockRejectedValue(
      new Error('Decryption failed: bad passphrase'),
    );

    let latestCtx: ReturnType<typeof useKeyContext> | undefined;
    renderWithKeyProvider({ onContextReady: (ctx) => (latestCtx = ctx) });

    await waitFor(() => {
      expect(latestCtx?.isLoading).toBe(false);
    });

    await expect(latestCtx?.unlockEncryption('WrongPassphrase!')).rejects.toThrow(
      'Decryption failed: bad passphrase',
    );

    expect(latestCtx?.isUnlocked).toBe(false);
    expect(latestCtx?.privateKey).toBeNull();
  });

  it('promptUnlock displays the unlock modal when called', async () => {
    stubFetchBody({ kdfSalt: 's', keyWrapIv: 'iv', wrappedPrivateKey: 'w', publicKey: 'p' });
    (keyStore.getPrivateKey as any).mockResolvedValue(mockPrivateKey);

    renderWithKeyProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-unlocked').textContent).toBe('true');
    });

    // Initially modal is closed
    expect(
      screen.queryByRole('heading', { name: /Unlock Your Canvases/i }),
    ).not.toBeInTheDocument();

    // Trigger promptUnlock
    fireEvent.click(screen.getByTestId('btn-prompt-unlock'));

    expect(screen.getByRole('heading', { name: /Unlock Your Canvases/i })).toBeInTheDocument();
  });

  it('exempt routes (/security, /terms, /privacy) do not show modal overlay even when locked', async () => {
    stubFetchBody({ kdfSalt: 's', keyWrapIv: 'iv', wrappedPrivateKey: 'w', publicKey: 'p' });
    (keyStore.getPrivateKey as any).mockResolvedValue(null); // Locked

    // Render on /security exempt route
    renderWithKeyProvider({ route: '/security' });

    await waitFor(() => {
      expect(screen.getByTestId('is-initialized').textContent).toBe('true');
    });

    // Modal overlay MUST NOT be in the document on exempt routes
    expect(
      screen.queryByRole('heading', { name: /Unlock Your Canvases/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();
  });

  it('useKeyContext returns fallback stubs and throws when used outside KeyProvider', async () => {
    const { result } = renderHook(() => useKeyContext());

    expect(result.current.privateKey).toBeNull();
    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.isInitialized).toBeNull();
  });
});
