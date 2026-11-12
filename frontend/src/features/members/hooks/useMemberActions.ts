import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { fetchColleaguePublicKey, resolveOrgKey, wrapWorkspaceKeyForMember } from '@/lib/keys';
import { errorMessage } from '@/lib/errors';
import {
  cancelWorkspaceInvitation,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '@/features/members/api';
import { workspaceKeys } from '@/features/workspaces/keys';
import { rotationDueIds } from '@/features/workspaces/rotation';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import type { Workspace } from '@/features/workspaces/schemas';
import type { WorkspaceMember } from '@/features/members/schemas';

/** Role changes, removals and invitation revocations for the members section. */
export function useMemberActions(params: {
  workspace: Workspace;
  members: WorkspaceMember[];
  runRotation: (projectIds: string[], rotateWorkspaceFirst?: boolean) => Promise<void>;
}) {
  const { workspace, members, runRotation } = params;
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { privateKey, isUnlocked } = useKeyContext();
  const { invalidateMembers } = useWorkspaceInvalidation(workspace.id);

  /**
   * Wraps the workspace key for a member being promoted to admin. A promotion carries the key in
   * the same request as the role, because an admin without the key cannot open anything. Returns
   * null after telling the user why the promotion cannot go ahead.
   */
  const wrapWorkspaceKeyForPromotion = async (
    target: WorkspaceMember,
    targetName: string,
  ): Promise<string | null> => {
    if (!target.userId) {
      toast.error('Could not resolve the selected member.');
      return null;
    }
    if (!isUnlocked) {
      toast.error('Unlock encryption first to promote an admin.');
      return null;
    }
    if (!workspace.encryptedOrgKey) {
      toast.error('Your workspace key is not available on this device.');
      return null;
    }

    let targetPublicKey: string;
    try {
      targetPublicKey = await fetchColleaguePublicKey(target.userId);
    } catch {
      toast.error(`${targetName} has not set up encryption yet.`);
      return null;
    }

    const actorId = session?.user?.id;
    const workspaceKeyVersion = workspace.keyVersion;
    if (!actorId || workspaceKeyVersion === undefined) {
      toast.error('The workspace key version is unavailable. Reload and try again.');
      return null;
    }

    try {
      const orgKey = await resolveOrgKey(workspace.encryptedOrgKey, privateKey, {
        workspaceId: workspace.id,
        userId: actorId,
        workspaceKeyVersion,
      });
      return await wrapWorkspaceKeyForMember(orgKey, targetPublicKey, {
        workspaceId: workspace.id,
        userId: target.userId,
        workspaceKeyVersion,
      });
    } catch {
      toast.error(`Could not prepare the workspace key for ${targetName}.`);
      return null;
    }
  };

  /** Nothing is changed if any step fails. */
  const changeRole = async (memberId: string, newRole: string) => {
    const target = members.find((m) => m.id === memberId);
    const targetName = target?.name || target?.email || 'This member';

    let wrappedOrgKey: string | undefined;
    if (newRole === 'admin') {
      const wrapped = target ? await wrapWorkspaceKeyForPromotion(target, targetName) : null;
      if (!wrapped) {
        if (!target) toast.error('Could not resolve the selected member.');
        return;
      }
      wrappedOrgKey = wrapped;
    }

    try {
      const updated = await updateWorkspaceMemberRole(workspace.id, memberId, {
        role: newRole,
        ...(wrappedOrgKey ? { encryptedOrgKey: wrappedOrgKey } : {}),
      });
      invalidateMembers();
      const dueIds = rotationDueIds(updated);
      if (dueIds && dueIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
        await runRotation(dueIds, true);
      }
    } catch (err) {
      toast.error(errorMessage(err) ?? `Could not change the role of ${targetName}.`);
    }
  };

  /** Throws on failure; the confirmation dialog reports it. */
  const removeMember = async (memberId: string) => {
    const result = await removeWorkspaceMember(workspace.id, memberId);
    invalidateMembers();
    toast.success('Member removed from workspace');
    const dueIds = rotationDueIds(result);
    if (dueIds) await runRotation(dueIds, true);
  };

  /** Throws on failure; the confirmation dialog reports it. */
  const revokeInvitation = async (invitationId: string) => {
    await cancelWorkspaceInvitation(workspace.id, invitationId);
    invalidateMembers();
    toast.success('Invitation revoked');
  };

  return { changeRole, removeMember, revokeInvitation };
}
