import { Modal } from '@/components/Modal';
import React, { useState } from 'react';
import {
  KeyRound,
  AlertCircle,
  ArrowRight,
  Lock,
  ExternalLink,
  ShieldAlert,
  LogOut,
} from 'lucide-react';
import { signOut } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { errorMessage, errorName } from '@/lib/errors';

interface EncryptionModalProps {
  mode: 'setup' | 'unlock';
  email: string;
  onSuccess: () => void;
  setupEncryption: (passphrase: string) => Promise<void>;
  unlockEncryption: (passphrase: string) => Promise<void>;
}

export function EncryptionModal({
  mode,
  email,
  onSuccess,
  setupEncryption,
  unlockEncryption,
}: EncryptionModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSetup = mode === 'setup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passphrase.trim()) {
      setError('Please enter your passphrase.');
      return;
    }

    if (isSetup) {
      if (passphrase.length < 8) {
        setError('Passphrase must be at least 8 characters long.');
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError('Passphrases do not match.');
        return;
      }
    }

    setLoading(true);

    try {
      if (isSetup) {
        await setupEncryption(passphrase);
      } else {
        await unlockEncryption(passphrase);
      }
      onSuccess();
    } catch (err) {
      console.error('Encryption passphrase action failed:', err);
      if (
        errorName(err) === 'OperationError' ||
        errorMessage(err)?.includes('OperationError') ||
        errorMessage(err)?.includes('decrypt') ||
        errorMessage(err)?.includes('unwrap')
      ) {
        setError('Incorrect passphrase.');
      } else {
        setError(
          errorMessage(err) ?? 'Operation failed. Please verify your passphrase and try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onOpenChange={() => {}}
      showCloseButton={false}
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 sm:p-7 flex flex-col gap-5 text-left select-text"
    >
      {/* Modal Title & Icon */}
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 bg-brand-subtle border border-brand-border text-brand-strong flex items-center justify-center flex-shrink-0 rounded-xl mt-0.5">
          {isSetup ? (
            <KeyRound className="w-5 h-5 text-brand-strong" />
          ) : (
            <Lock className="w-5 h-5 text-brand-strong" />
          )}
        </div>
        <div className="flex flex-col">
          <h2 className="text-base font-bold text-ink tracking-tight font-sans">
            {isSetup ? 'Set Your Canvas Passphrase' : 'Unlock Your Canvases'}
          </h2>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            {isSetup
              ? 'CanvHQ is end-to-end encrypted. Your canvases are locked with this passphrase on your device before they are saved, so only you and the colleagues you invite can view them.'
              : 'Enter your passphrase to access and edit your workspace canvases on this device.'}
          </p>
        </div>
      </div>

      {/* Friendly Safety Notice */}
      {isSetup && (
        <div className="p-3.5 bg-warning-subtle border border-warning-border text-warning text-xs leading-relaxed rounded-xl flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <span>
            <strong>Keep your passphrase safe.</strong> We cannot reset your passphrase. If you lose
            it, your canvases cannot be opened.
          </span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-3.5 bg-danger-subtle border border-danger-border text-danger text-xs rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Standard Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Hidden Email Input for Credential Autofill */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          style={{ display: 'none' }}
        />

        {isSetup ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="new-encryption-passphrase"
                className="text-xs font-semibold text-ink flex justify-between"
              >
                <span>Passphrase</span>
                <span className="text-[11px] font-normal text-ink-subtle">Min. 8 characters</span>
              </label>
              <input
                id="new-encryption-passphrase"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Choose a strong passphrase..."
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
                required
                className="w-full h-10 px-3.5 bg-paper hover:bg-white focus:bg-white text-ink text-xs border border-border-strong hover:border-ink-subtle focus:border-brand rounded-xl outline-none shadow-2xs focus:ring-2 focus:ring-brand/30 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirm-encryption-passphrase"
                className="text-xs font-semibold text-ink"
              >
                Confirm Passphrase
              </label>
              <input
                id="confirm-encryption-passphrase"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your passphrase..."
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                required
                className="w-full h-10 px-3.5 bg-paper hover:bg-white focus:bg-white text-ink text-xs border border-border-strong hover:border-ink-subtle focus:border-brand rounded-xl outline-none shadow-2xs focus:ring-2 focus:ring-brand/30 transition-all"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="current-encryption-passphrase"
              className="text-xs font-semibold text-ink"
            >
              Passphrase
            </label>
            <input
              id="current-encryption-passphrase"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your passphrase..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              required
              className="w-full h-10 px-3.5 bg-paper hover:bg-white focus:bg-white text-ink text-xs border border-border-strong hover:border-ink-subtle focus:border-brand rounded-xl outline-none shadow-2xs focus:ring-2 focus:ring-brand/30 transition-all"
            />
          </div>
        )}

        {/* Learn More Technical Link */}
        <div className="pt-1">
          <a
            href="/security"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors group cursor-pointer"
          >
            <span className="underline underline-offset-2">How CanvHQ protects your canvases</span>
            <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-ink transition-colors" />
          </a>
        </div>

        {/* Form Actions */}
        <div className="flex flex-col gap-2.5 pt-3 border-t border-surface-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 bg-ink hover:bg-ink-hover text-white text-xs font-semibold flex items-center justify-center gap-2 rounded-xl transition-all shadow-2xs cursor-pointer disabled:opacity-60"
          >
            <span>
              {loading
                ? isSetup
                  ? 'Setting up encryption...'
                  : 'Unwrapping keys...'
                : isSetup
                  ? 'Set Passphrase & Continue'
                  : 'Unlock Canvases'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={async () => {
              await clearLocalKeyMaterial();
              await signOut();
              if (typeof window !== 'undefined') {
                window.location.href = '/login';
              }
            }}
            className="w-full py-1.5 text-center text-xs font-mono text-ink-muted hover:text-ink transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out / Switch account</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
