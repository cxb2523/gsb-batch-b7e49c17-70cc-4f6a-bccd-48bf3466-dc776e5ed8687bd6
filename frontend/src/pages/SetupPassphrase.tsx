import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useKeyContext } from '@/context/KeyContext';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { ShieldCheck, Lock } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export function SetupPassphrase() {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setupEncryption } = useKeyContext();

  // Only an internal path is allowed as the post-setup destination.
  const requestedNext = searchParams.get('next');
  const nextPath =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/workspace';

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!acknowledged) {
      return;
    }

    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match. Please verify and try again.');
      return;
    }

    setLoading(true);

    try {
      await setupEncryption(passphrase);
      void navigate(nextPath, { replace: true });
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to initialize encryption passphrase.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-paper font-sans text-ink antialiased min-h-screen flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Unified Public Header without auth action buttons */}
      <PublicHeader fixed={true} hideAuthActions={true} />

      {/* Main Viewport */}
      <main className="flex-1 flex items-center justify-center pt-24 sm:pt-28 pb-16 px-4 sm:px-6 relative">
        <div className="w-full max-w-[600px] mx-auto">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-3 px-1">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span>A better space to think</span>
          </div>

          {/* Card */}
          <Card className="bg-white border border-border rounded-2xl p-6 sm:p-10 shadow-[0_10px_30px_rgba(29,44,59,0.045)] relative">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              <span>Encrypted canvas</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-2">
              Set your canvas passphrase
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted leading-relaxed mb-6">
              CanvHQ is end-to-end encrypted. Your canvases are locked with this passphrase on your
              device before they are saved, so only you and the teammates you invite can view them.
            </p>

            {error && (
              <div className="mb-6 p-3.5 bg-danger-soft border border-danger-soft-border text-danger-muted text-xs rounded-lg font-medium">
                {error}
              </div>
            )}

            <form className="flex flex-col space-y-5" onSubmit={handleSetup}>
              {/* Passphrase Input */}
              <div className="flex flex-col text-left">
                <Label
                  className="text-xs font-semibold text-ink tracking-[-0.01em] mb-1.5 flex items-center justify-between"
                  htmlFor="passphrase"
                >
                  <span>Passphrase</span>
                  <span className="font-mono text-[10px] text-ink-subtle font-normal uppercase">
                    Min. 8 characters
                  </span>
                </Label>
                <Input
                  id="passphrase"
                  name="passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a secure passphrase"
                  required
                  minLength={8}
                  className="w-full h-11 px-3.5 text-sm"
                />
              </div>

              {/* Confirm Passphrase Input */}
              <div className="flex flex-col text-left">
                <Label
                  className="text-xs font-semibold text-ink tracking-[-0.01em] mb-1.5 flex items-center justify-between"
                  htmlFor="confirm-passphrase"
                >
                  <span>Confirm Passphrase</span>
                  <span className="font-mono text-[10px] text-ink-subtle font-normal uppercase">
                    Required
                  </span>
                </Label>
                <Input
                  id="confirm-passphrase"
                  name="confirm-passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter your passphrase"
                  required
                  minLength={8}
                  className="w-full h-11 px-3.5 text-sm"
                />
              </div>

              {/* Warning Callout Box */}
              <div className="p-4 bg-warning-subtle border border-warning-callout-border rounded-xl text-xs text-warning-callout-text flex items-start gap-3">
                <div className="w-6 h-6 rounded-md bg-white border border-warning-callout-border flex items-center justify-center text-warning-callout-text shrink-0 font-semibold text-xs mt-0.5 shadow-2xs">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-warning-callout-title">
                    Important: Passphrase recovery
                  </span>
                  <p className="text-warning-callout-text text-[11px] leading-relaxed">
                    We cannot reset your passphrase. If you lose it, your canvases cannot be opened.
                  </p>
                </div>
              </div>

              <label
                htmlFor="acknowledge-recovery"
                className="flex items-start gap-2.5 text-[11px] text-warning-callout-title leading-relaxed cursor-pointer"
              >
                <input
                  id="acknowledge-recovery"
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-ink"
                />
                <span>
                  I understand this passphrase cannot be recovered, and if I lose it my canvases
                  cannot be opened.
                </span>
              </label>

              {/* Submit Button */}
              <div className="pt-2">
                <Button
                  id="submit-passphrase-btn"
                  type="submit"
                  disabled={loading || !acknowledged}
                  className="w-full h-11 text-xs font-semibold hover:-translate-y-0.5"
                >
                  <span>
                    {loading ? 'Encrypting workspace...' : 'Complete setup & open workspace ↗'}
                  </span>
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </main>

      {/* Unified Public Footer */}
      <PublicFooter />
    </div>
  );
}
