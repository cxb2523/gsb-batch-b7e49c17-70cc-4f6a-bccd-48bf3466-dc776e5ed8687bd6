import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteAccountModal } from './DeleteAccountModal';
import { ProfileSectionCard } from './ProfileSectionCard';

export function DangerZoneSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <ProfileSectionCard
        id="danger"
        title="Danger Zone"
        tone="danger"
        gap="gap-4"
        icon={<AlertTriangle className="w-4 h-4 text-danger" />}
        badge={
          <span className="font-mono text-[10px] bg-danger-subtle text-danger border border-danger-border px-2 py-0.5 rounded-md font-semibold">
            IRREVERSIBLE
          </span>
        }
      >
        <p className="text-xs text-ink-muted leading-relaxed">
          Permanently delete your account and personal data. If you are the owner of any workspaces,
          you must transfer ownership to a team member or confirm workspace deletion.
        </p>

        <div className="pt-2">
          <Button
            variant="destructive"
            onClick={() => setIsModalOpen(true)}
            className="h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Personal Account</span>
          </Button>
        </div>
      </ProfileSectionCard>

      {isModalOpen && <DeleteAccountModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
