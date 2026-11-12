import { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck, UserPlus } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import type { PageInfo } from '@/features/pagination';
import { InvitationRow } from '@/features/members/components/InvitationRow';
import {
  InviteMemberModal,
  type InviteFeedback,
} from '@/features/members/components/InviteMemberModal';
import { MemberRow } from '@/features/members/components/MemberRow';
import { OwnershipTransferDialog } from '@/features/members/components/OwnershipTransferDialog';
import { useMemberActions } from '@/features/members/hooks/useMemberActions';
import {
  DeleteTargetDialog,
  type DeleteTarget,
} from '@/features/workspaces/components/DeleteTargetDialog';
import type { Project } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';
import type { WorkspaceInvitation, WorkspaceMember } from '@/features/members/schemas';

const INVITE_FEEDBACK_MS = 8000;

interface MembersSectionProps {
  workspace: Workspace;
  members: WorkspaceMember[];
  pagination: PageInfo;
  onPrevPage: () => void;
  onNextPage: () => void;
  invitations: WorkspaceInvitation[];
  /** The projects an invitation can pre-assign. */
  projects: Project[];
  currentUserId: string | undefined;
  can: (action: string, subject: string) => boolean;
  runRotation: (projectIds: string[], rotateWorkspaceFirst?: boolean) => Promise<void>;
}

export function MembersSection({
  workspace,
  members,
  pagination,
  onPrevPage,
  onNextPage,
  invitations,
  projects,
  currentUserId,
  can,
  runRotation,
}: MembersSectionProps) {
  const actions = useMemberActions({ workspace, members, runRotation });
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<InviteFeedback | null>(null);
  const [transferTarget, setTransferTarget] = useState<WorkspaceMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    if (!inviteFeedback) return undefined;
    const timer = setTimeout(() => setInviteFeedback(null), INVITE_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [inviteFeedback]);

  const openInvitations = invitations.filter(
    (i) => i.status === 'pending' || i.status === 'expired',
  );

  const askToRemoveMember = (member: WorkspaceMember) =>
    setDeleteTarget({
      type: 'member',
      id: member.id,
      title: member.name || member.email || 'this member',
      description: 'They will immediately lose access to all workspace projects and canvases.',
    });

  const askToRevokeInvitation = (invitation: WorkspaceInvitation) =>
    setDeleteTarget({
      type: 'invitation',
      id: invitation.id,
      title: invitation.email,
      description: 'The invitation link will immediately expire and cannot be used to join.',
    });

  const confirmDelete = (target: DeleteTarget) =>
    target.type === 'member'
      ? actions.removeMember(target.id)
      : actions.revokeInvitation(target.id);

  return (
    <div
      id="members"
      className="scroll-mt-24 sm:scroll-mt-28 bg-white rounded-2xl border border-border shadow-xs p-6 flex flex-col gap-5"
    >
      <div className="flex items-center justify-between border-b border-border-subtle pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand-subtle text-brand flex items-center justify-center font-bold text-xs">
            ♙
          </div>
          <h2 className="text-sm font-bold text-ink">Workspace Members & Access Control</h2>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-ink-muted">
            {pagination.total} {pagination.total === 1 ? 'Member' : 'Members'}
          </span>
          {can('create', 'Invitation') && (
            <button
              type="button"
              onClick={() => setIsInviteOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink hover:bg-ink-hover text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>＋ Invite member</span>
            </button>
          )}
        </div>
      </div>

      {inviteFeedback && (
        <div
          role={inviteFeedback.tone === 'error' ? 'alert' : 'status'}
          className={
            inviteFeedback.tone === 'error'
              ? 'p-3 bg-danger-subtle border border-danger-border text-danger text-xs rounded-xl font-medium flex items-center gap-2'
              : 'p-3 bg-brand-subtle border border-brand-border text-brand-strong text-xs rounded-xl font-medium flex items-center gap-2'
          }
        >
          {inviteFeedback.tone === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-success shrink-0" />
          )}
          <span className="break-all">{inviteFeedback.message}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="divide-y divide-border-subtle flex flex-col">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isCurrentUser={member.userId === currentUserId}
              canChangeRole={can('update', 'Member')}
              canTransfer={can('transfer', 'Workspace')}
              canRemove={can('delete', 'Member')}
              onRoleChange={(role) => void actions.changeRole(member.id, role)}
              onTransfer={() => setTransferTarget(member)}
              onRemove={() => askToRemoveMember(member)}
            />
          ))}

          {openInvitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              canRevoke={can('delete', 'Invitation')}
              onRevoke={() => askToRevokeInvitation(invitation)}
            />
          ))}

          {members.length === 0 && openInvitations.length === 0 && (
            <div className="p-4 text-center font-mono text-xs text-ink-subtle">
              No members or pending invitations found.
            </div>
          )}
        </div>

        <Pagination
          page={pagination.page}
          limit={pagination.limit}
          total={pagination.total}
          hasPrevPage={pagination.hasPrevPage}
          hasNextPage={pagination.hasNextPage}
          onPrev={onPrevPage}
          onNext={onNextPage}
          entityName="MEMBERS"
        />
      </div>

      <InviteMemberModal
        workspaceId={workspace.id}
        projects={projects}
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        onResult={setInviteFeedback}
      />
      <OwnershipTransferDialog
        workspaceId={workspace.id}
        target={transferTarget}
        onClose={() => setTransferTarget(null)}
      />
      <DeleteTargetDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
