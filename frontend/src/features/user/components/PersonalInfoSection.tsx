import { useState } from 'react';
import { User } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateUserProfile } from '../api';
import { useFeedback } from '../hooks/useFeedback';
import { FeedbackBanner } from './FeedbackBanner';
import { ProfileSectionCard } from './ProfileSectionCard';

export function PersonalInfoSection() {
  const { data: session } = useSession();
  // null until the user types, so the field follows the session name without copying it into state
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { feedback, showError, showSuccess, clear } = useFeedback();

  const name = draftName ?? session?.user?.name ?? '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    clear();
    try {
      await updateUserProfile({ name: name.trim() });
      showSuccess('Profile updated successfully');
    } catch (err) {
      showError(errorMessage(err) ?? 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ProfileSectionCard
      id="personal"
      title="Personal Information"
      icon={<User className="w-4 h-4" />}
    >
      <FeedbackBanner feedback={feedback} />

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-ink" htmlFor="profile-name">
              Display Name
            </Label>
            <Input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setDraftName(e.target.value)}
              required
              className="h-9 px-3 bg-paper border border-border rounded-xl text-xs text-ink outline-none focus:bg-white focus:border-ink transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-ink" htmlFor="profile-email">
              Email Address
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={session?.user?.email || ''}
              disabled
              className="h-9 px-3 bg-surface-2 border border-border rounded-xl text-xs text-ink-muted cursor-not-allowed font-mono opacity-80"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSaving}
            className="h-9 px-4 rounded-xl text-xs font-semibold"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </ProfileSectionCard>
  );
}
