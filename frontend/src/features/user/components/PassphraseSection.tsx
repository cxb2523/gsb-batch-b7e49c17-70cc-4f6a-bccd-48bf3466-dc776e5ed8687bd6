import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFeedback } from '../hooks/useFeedback';
import { FeedbackBanner } from './FeedbackBanner';
import { ProfileSectionCard } from './ProfileSectionCard';

const MIN_PASSPHRASE_LENGTH = 8;
const passphraseInputClass =
  'h-9 px-3 bg-paper border border-border rounded-xl text-xs text-ink font-mono outline-none focus:bg-white focus:border-ink transition-colors';

export function PassphraseSection() {
  const { data: session } = useSession();
  const { rotatePassphrase, isUnlocked } = useKeyContext();
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState('');
  const [isRotating, setIsRotating] = useState(false);
  const { feedback, showError, showSuccess, clear } = useFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();

    if (!currentPassphrase.trim() || !newPassphrase.trim()) {
      showError('Please enter both current and new passphrases.');
      return;
    }
    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      showError('New passphrase must be at least 8 characters long.');
      return;
    }
    if (newPassphrase !== confirmNewPassphrase) {
      showError('New passphrases do not match.');
      return;
    }

    setIsRotating(true);
    try {
      await rotatePassphrase(currentPassphrase, newPassphrase);
      showSuccess('Encryption passphrase updated successfully.');
      setCurrentPassphrase('');
      setNewPassphrase('');
      setConfirmNewPassphrase('');
    } catch (err) {
      showError(errorMessage(err) ?? 'Failed to change passphrase.');
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <ProfileSectionCard
      id="security"
      title="Security & Encryption Passphrase"
      icon={<ShieldCheck className="w-4 h-4 text-success" />}
      badge={
        <div className="flex items-center gap-1.5 font-mono text-[10px] bg-ink text-white px-2 py-0.5 rounded-md font-semibold">
          <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse"></span>
          <span>{isUnlocked ? 'SESSION UNLOCKED' : 'LOCKED'}</span>
        </div>
      }
    >
      <p className="text-xs text-ink-muted -mt-2 leading-relaxed">
        Your canvas is encrypted in your browser before saving. You can change your passphrase at
        any time without resetting your encryption keys.
      </p>

      <FeedbackBanner feedback={feedback} showIcon={feedback?.tone === 'success'} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={session?.user?.email || ''}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          style={{ display: 'none' }}
        />

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold text-ink" htmlFor="current-passphrase">
            Current Passphrase
          </Label>
          <Input
            id="current-passphrase"
            type="password"
            autoComplete="current-password"
            placeholder="Enter current encryption passphrase..."
            value={currentPassphrase}
            onChange={(e) => setCurrentPassphrase(e.target.value)}
            required
            className={passphraseInputClass}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-ink" htmlFor="new-passphrase">
              New Passphrase
            </Label>
            <Input
              id="new-passphrase"
              type="password"
              autoComplete="new-password"
              placeholder="Minimum 8 characters..."
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              required
              className={passphraseInputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-ink" htmlFor="confirm-new-passphrase">
              Confirm New Passphrase
            </Label>
            <Input
              id="confirm-new-passphrase"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter new passphrase..."
              value={confirmNewPassphrase}
              onChange={(e) => setConfirmNewPassphrase(e.target.value)}
              required
              className={passphraseInputClass}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isRotating}
            className="h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-2"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{isRotating ? 'Updating Passphrase...' : 'Change Encryption Passphrase'}</span>
          </Button>
        </div>
      </form>
    </ProfileSectionCard>
  );
}
