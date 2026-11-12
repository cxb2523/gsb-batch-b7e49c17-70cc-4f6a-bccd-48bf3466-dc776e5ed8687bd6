import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import {
  deriveKEK,
  generateUserIdentityKeypair,
  exportPublicKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  base64UrlToBytes,
  bytesToBase64Url,
} from '@/lib/crypto';
import { getPrivateKey, storePrivateKey } from '@/lib/key-store';
import { EncryptionModal } from '@/components/EncryptionModal';

import {
  getEncryptionParams,
  setupEncryption as apiSetupEncryption,
  updateEncryptionPassphrase as apiUpdateEncryptionPassphrase,
} from '@/features/user/api';

interface EncryptionParams {
  kdfSalt: string | null;
  keyWrapIv: string | null;
  wrappedPrivateKey: string | null;
  publicKey: string | null;
}

interface KeyContextType {
  privateKey: CryptoKey | null;
  publicKeySpki: string | null;
  isUnlocked: boolean;
  isInitialized: boolean | null; // null when loading or unknown, false if setup needed, true if setup complete
  isLoading: boolean;
  /** Set when the encryption parameters could not be fetched; the key state is unknown. */
  keyLoadError: string | null;
  retryKeyLoad: () => void;
  setupEncryption: (passphrase: string) => Promise<void>;
  unlockEncryption: (passphrase: string) => Promise<void>;
  rotatePassphrase: (currentPassphrase: string, newPassphrase: string) => Promise<void>;
  promptUnlock: () => void;
}

const KeyContext = createContext<KeyContextType | null>(null);

export function KeyProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending: isSessionPending } = useSession();
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKeySpki, setPublicKeySpki] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<'setup' | 'unlock' | null>(null);

  const serverParamsRef = useRef<EncryptionParams | null>(null);

  const { pathname: currentPath } = useLocation();

  // Static pages and onboarding steps (/security, /terms, /privacy, /create-workspace, /setup-passphrase) are completely exempt from modal overlays
  const isExemptRoute =
    currentPath === '/security' ||
    currentPath === '/terms' ||
    currentPath === '/privacy' ||
    currentPath === '/create-workspace' ||
    currentPath === '/setup-passphrase';

  // Load encryption params & cached key on session change, and on an explicit Retry.
  //
  // The run counter makes a retry supersede anything still in flight, and an unmount cancels the
  // current run, so a late response can never write key state after the session changed.
  const keyRunRef = useRef(0);

  const loadKeyState = useCallback(async () => {
    const runId = ++keyRunRef.current;
    const cancelled = () => runId !== keyRunRef.current;

    if (isSessionPending) return;
    if (!session?.user?.id) {
      setPrivateKey(null);
      setPublicKeySpki(null);
      setIsInitialized(null);
      setShowModal(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setKeyLoadError(null);

    // The server parameters decide whether this page may be rendered at all. A failure here is
    // an unknown key state, not "no keys" and not "ready": retry rather than guess.
    let params: EncryptionParams;
    try {
      const data = await getEncryptionParams();
      params = {
        kdfSalt: data.kdfSalt ?? null,
        keyWrapIv: data.keyWrapIv ?? null,
        wrappedPrivateKey: data.wrappedPrivateKey ?? null,
        publicKey: data.publicKey ?? null,
      };
    } catch (err) {
      if (!cancelled()) {
        setKeyLoadError('Could not load your encryption status.');
        setIsInitialized(null);
        setPrivateKey(null);
        setPublicKeySpki(null);
        setShowModal(null);
        setIsLoading(false);
      }
      console.error('KeyContext initialization error:', err);
      return;
    }

    if (cancelled()) return;
    serverParamsRef.current = params;
    setPublicKeySpki(params.publicKey);

    if (!params.wrappedPrivateKey) {
      // Encryption is NOT initialized - redirected via route guard to /setup-passphrase
      setIsInitialized(false);
      setPrivateKey(null);
      setShowModal(null);
      setIsLoading(false);
      return;
    }

    // Encryption is initialized in the DB
    setIsInitialized(true);

    // 2. Check local IndexedDB cache for unwrapped PrivateKey. A cache read failure only means
    // "ask for the passphrase"; the account itself is known to be initialized.
    try {
      const cachedKey = await getPrivateKey(session.user.id);
      if (cancelled()) return;

      if (cachedKey) {
        setPrivateKey(cachedKey);
        setShowModal(null);
      } else {
        setPrivateKey(null);
        setShowModal('unlock');
      }
    } catch (err) {
      if (!cancelled()) {
        setPrivateKey(null);
        setShowModal('unlock');
      }
      console.error('Key cache read error:', err);
    } finally {
      if (!cancelled()) setIsLoading(false);
    }
  }, [session?.user?.id, isSessionPending]);

  useEffect(() => {
    // A deferred start keeps the first state write out of the effect's render pass.
    const pending = setTimeout(() => void loadKeyState(), 0);
    return () => {
      clearTimeout(pending);
      keyRunRef.current += 1;
    };
  }, [loadKeyState]);

  // Setup Encryption Passphrase & Identity Keypair
  const setupEncryption = useCallback(
    async (passphrase: string) => {
      if (!session?.user?.id) throw new Error('No active session');

      // 1. Generate 16-byte random salt
      const salt = window.crypto.getRandomValues(new Uint8Array(16));

      // 2. Derive 256-bit KEK (PBKDF2 SHA-256 600,000 iterations)
      const kek = await deriveKEK(passphrase, salt);

      // 3. Generate RSA-OAEP 2048-bit keypair
      const keypair = await generateUserIdentityKeypair();

      // 4. Wrap privateKey using KEK with 12-byte random IV
      const { wrappedPrivateKey, keyWrapIv } = await wrapPrivateKey(keypair.privateKey, kek);

      // 5. Export plaintext publicKey to SPKI base64url
      const pubSpki = await exportPublicKey(keypair.publicKey);

      // 6. Save parameters to server
      await apiSetupEncryption({
        kdfSalt: bytesToBase64Url(salt),
        keyWrapIv,
        wrappedPrivateKey,
        publicKey: pubSpki,
      });

      // 7. Store non-extractable private key in IndexedDB for session persistence
      // Note: We unwrap the wrapped key with extractable=false for storage
      const nonExtractablePrivateKey = await unwrapPrivateKey(
        wrappedPrivateKey,
        keyWrapIv,
        kek,
        false,
      );

      await storePrivateKey(session.user.id, nonExtractablePrivateKey);

      serverParamsRef.current = {
        kdfSalt: bytesToBase64Url(salt),
        keyWrapIv,
        wrappedPrivateKey,
        publicKey: pubSpki,
      };

      setPrivateKey(nonExtractablePrivateKey);
      setPublicKeySpki(pubSpki);
      setIsInitialized(true);
      setShowModal(null);
    },
    [session?.user?.id],
  );

  // Unlock Encryption with Existing Passphrase
  const unlockEncryption = useCallback(
    async (passphrase: string) => {
      if (!session?.user?.id) throw new Error('No active session');

      // Fetch or use cached server params
      let params = serverParamsRef.current;
      if (!params || !params.wrappedPrivateKey || !params.kdfSalt || !params.keyWrapIv) {
        const data = await getEncryptionParams();
        params = {
          kdfSalt: data.kdfSalt ?? null,
          keyWrapIv: data.keyWrapIv ?? null,
          wrappedPrivateKey: data.wrappedPrivateKey ?? null,
          publicKey: data.publicKey ?? null,
        };
        serverParamsRef.current = params;
      }

      if (!params || !params.wrappedPrivateKey || !params.kdfSalt || !params.keyWrapIv) {
        throw new Error('Encryption is not set up on this account');
      }

      const salt = base64UrlToBytes(params.kdfSalt);
      const kek = await deriveKEK(passphrase, salt);

      // Unwrap private key with extractable: false for normal session usage
      const unwrappedKey = await unwrapPrivateKey(
        params.wrappedPrivateKey,
        params.keyWrapIv,
        kek,
        false,
      );

      // Cache in IndexedDB
      await storePrivateKey(session.user.id, unwrappedKey);

      setPrivateKey(unwrappedKey);
      setPublicKeySpki(params.publicKey);
      setShowModal(null);
    },
    [session?.user?.id],
  );

  // Passphrase Rotation (Extractable in-memory unwrap -> re-wrap with new KEK)
  const rotatePassphrase = useCallback(
    async (currentPassphrase: string, newPassphrase: string) => {
      if (!session?.user?.id) throw new Error('No active session');

      // 1. Fetch current server encryption params
      const data = await getEncryptionParams();
      const params: EncryptionParams = {
        kdfSalt: data.kdfSalt ?? null,
        keyWrapIv: data.keyWrapIv ?? null,
        wrappedPrivateKey: data.wrappedPrivateKey ?? null,
        publicKey: data.publicKey ?? null,
      };

      if (!params.wrappedPrivateKey || !params.kdfSalt || !params.keyWrapIv) {
        throw new Error('Encryption is not set up on this account');
      }

      // 2. Derive Current KEK
      const currentSalt = base64UrlToBytes(params.kdfSalt);
      const currentKek = await deriveKEK(currentPassphrase, currentSalt);

      // 3. Temporarily unwrap with extractable: true in memory so wrapKey does not fail!
      let extractablePrivateKey: CryptoKey;
      try {
        extractablePrivateKey = await unwrapPrivateKey(
          params.wrappedPrivateKey,
          params.keyWrapIv,
          currentKek,
          true, // extractable!
        );
      } catch {
        throw new Error('Incorrect current passphrase');
      }

      // 4. Generate new salt and derive new KEK
      const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
      const newKek = await deriveKEK(newPassphrase, newSalt);

      // 5. Re-wrap the extractable privateKey with new KEK
      const { wrappedPrivateKey: newWrappedPrivateKey, keyWrapIv: newKeyWrapIv } =
        await wrapPrivateKey(extractablePrivateKey, newKek);

      // 6. Update server record via PUT /api/user/encryption-passphrase
      await apiUpdateEncryptionPassphrase({
        kdfSalt: bytesToBase64Url(newSalt),
        keyWrapIv: newKeyWrapIv,
        wrappedPrivateKey: newWrappedPrivateKey,
      });

      // 7. Store non-extractable version in IndexedDB
      const nonExtractableKey = await unwrapPrivateKey(
        newWrappedPrivateKey,
        newKeyWrapIv,
        newKek,
        false,
      );

      await storePrivateKey(session.user.id, nonExtractableKey);
      setPrivateKey(nonExtractableKey);

      serverParamsRef.current = {
        ...params,
        kdfSalt: bytesToBase64Url(newSalt),
        keyWrapIv: newKeyWrapIv,
        wrappedPrivateKey: newWrappedPrivateKey,
      };
    },
    [session?.user?.id],
  );

  const retryKeyLoad = useCallback(() => {
    void loadKeyState();
  }, [loadKeyState]);

  const promptUnlock = useCallback(() => {
    if (isInitialized === false) {
      setShowModal('setup');
    } else {
      setShowModal('unlock');
    }
  }, [isInitialized]);

  return (
    <KeyContext.Provider
      value={{
        privateKey,
        publicKeySpki,
        isUnlocked: !!privateKey,
        isInitialized,
        isLoading,
        keyLoadError,
        retryKeyLoad,
        setupEncryption,
        unlockEncryption,
        rotatePassphrase,
        promptUnlock,
      }}
    >
      {children}

      {showModal && session?.user && !isExemptRoute && (
        <EncryptionModal
          mode={showModal}
          email={session.user.email}
          onSuccess={() => setShowModal(null)}
          setupEncryption={setupEncryption}
          unlockEncryption={unlockEncryption}
        />
      )}
    </KeyContext.Provider>
  );
}

export function useKeyContext() {
  const context = useContext(KeyContext);
  if (!context) {
    return {
      privateKey: null,
      publicKeySpki: null,
      isUnlocked: false,
      isInitialized: null,
      isLoading: false,
      keyLoadError: null,
      retryKeyLoad: () => {},
      setupEncryption: async () => {},
      unlockEncryption: async () => {},
      rotatePassphrase: async () => {},
      promptUnlock: () => {},
    };
  }
  return context;
}
