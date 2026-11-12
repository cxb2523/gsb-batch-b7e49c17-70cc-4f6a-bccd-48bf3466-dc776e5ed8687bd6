import { useEffect, useState } from 'react';
import { Check, Copy, Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceInvitation } from '@/features/members/schemas';

function inviteLink(invitation: WorkspaceInvitation): string {
  const { inviteUrl } = invitation;
  return inviteUrl?.startsWith('http')
    ? inviteUrl
    : `${window.location.origin}/invite/${invitation.id}`;
}

/** A pending or expired invitation, with a copyable link (invitations are never emailed). */
export function InvitationRow({
  invitation,
  canRevoke,
  onRevoke,
}: {
  invitation: WorkspaceInvitation;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isPending = invitation.status === 'pending';

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(invitation));
      setCopied(true);
      toast.success(`Copied invite link for ${invitation.email}`);
    } catch {
      toast.error(
        'The invite link could not be copied. Copy it from the address shown after inviting.',
      );
    }
  };

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 bg-surface hover:bg-surface transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-warning-subtle border border-warning-border text-warning flex items-center justify-center shrink-0">
          <Mail className="w-3.5 h-3.5 text-warning-amber" />
        </div>
        <div className="flex flex-col min-w-0">
          <strong className="text-xs font-semibold text-ink truncate block">
            {invitation.email}
          </strong>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted truncate font-mono">
            <span>Invited as {invitation.role}</span>
            <span>·</span>
            {isPending ? (
              <span className="text-warning font-medium">Pending</span>
            ) : (
              <span className="text-ink-subtle font-medium">Expired</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void copyLink()}
          title="Copy invitation link"
          className="px-2.5 py-1 text-[11px] font-mono bg-white hover:bg-surface-2 border border-border text-ink rounded-md transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-ink-subtle" />
              <span>Copy Link</span>
            </>
          )}
        </button>

        {canRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            title="Revoke invitation"
            className="p-1 text-ink-subtle hover:text-danger transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
