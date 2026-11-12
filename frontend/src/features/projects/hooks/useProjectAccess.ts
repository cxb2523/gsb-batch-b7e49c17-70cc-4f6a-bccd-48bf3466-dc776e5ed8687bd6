import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { prepareProjectGrant, type ProjectGrant } from '@/lib/keys';
import { errorMessage } from '@/lib/errors';
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
} from '@/features/projects/api';
import { projectKeys } from '@/features/projects/keys';
import { memberKeys } from '@/features/members/keys';
import { rotationDueIds } from '@/features/workspaces/rotation';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import type { Workspace } from '@/features/workspaces/schemas';
import type { Project, ProjectMemberItem } from '@/features/projects/schemas';

/** A grant that has been prepared (key wrapped for the person) but not yet sent. */
export interface PendingGrant extends ProjectGrant {
  member: ProjectMemberItem;
}

export function memberUserId(member: ProjectMemberItem): string {
  return member.userId || member.user?.id || '';
}

const GRANT_FAILED = 'No access was granted.';

/**
 * Every write the project access dialog makes. Each one reports its own failure with a toast and
 * resolves to whether it took effect, so the dialog never has to guess what happened.
 */
export function useProjectAccess(params: {
  workspace: Workspace;
  project: Project;
  runRotation: (projectIds: string[]) => Promise<void>;
  /** Only an Owner or Admin holds the workspace key that a new project key is wrapped under. */
  isAdministrator: boolean;
}) {
  const { workspace, project, runRotation, isAdministrator } = params;
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();
  const { invalidateMembers } = useWorkspaceInvalidation(workspace.id);

  /** Wraps the key for the target before anything is written; any failure creates nothing. */
  const prepareGrant = async (targetUserId: string): Promise<ProjectGrant | null> => {
    try {
      const actorId = session?.user?.id;
      if (!actorId) throw new Error('You are signed out. Reload and try again.');
      return await prepareProjectGrant({ privateKey, actorId, project, workspace, targetUserId });
    } catch (keyErr) {
      toast.error(
        `${GRANT_FAILED} ${errorMessage(keyErr) ?? 'The project key could not be wrapped for this person.'}`,
      );
      return null;
    }
  };

  const saveGrant = async (userId: string, role: string, encryptedProjectKey: string) => {
    try {
      await addProjectMember(workspace.id, project.id, { userId, role, encryptedProjectKey });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all(workspace.id) });
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(workspace.id) });
      return true;
    } catch (err) {
      toast.error(errorMessage(err) ?? 'The project access could not be saved.');
      return false;
    }
  };

  const assign = async (userId: string, role: string): Promise<boolean> => {
    const grant = await prepareGrant(userId);
    return grant ? saveGrant(userId, role, grant.encryptedProjectKey) : false;
  };

  /** Granting a pending invite is an explicit step: the key is prepared first and sent on confirm. */
  const beginGrant = async (member: ProjectMemberItem): Promise<PendingGrant | null> => {
    const targetUserId = memberUserId(member);
    if (!targetUserId) {
      toast.error('Member user ID not found');
      return null;
    }
    const grant = await prepareGrant(targetUserId);
    return grant ? { ...grant, member } : null;
  };

  const confirmGrant = (pending: PendingGrant): Promise<boolean> =>
    saveGrant(
      memberUserId(pending.member),
      pending.member.role || 'editor',
      pending.encryptedProjectKey,
    );

  const changeRole = async (member: ProjectMemberItem, role: string) => {
    try {
      await updateProjectMemberRole(workspace.id, project.id, memberUserId(member), { role });
      invalidateMembers();
    } catch (err) {
      toast.error(
        errorMessage(err) ?? `Could not change the role of ${member.name ?? 'this member'}.`,
      );
    }
  };

  const removeMember = async (member: ProjectMemberItem) => {
    try {
      const result = await removeProjectMember(workspace.id, project.id, memberUserId(member));
      invalidateMembers();
      const dueIds = rotationDueIds(result);
      if (!dueIds) return;
      if (isAdministrator) {
        await runRotation(dueIds);
      } else {
        toast.success(
          'Removed. The project key is replaced the next time a workspace owner or admin opens this workspace.',
        );
      }
    } catch (err) {
      toast.error(errorMessage(err) ?? `Could not remove ${member.name ?? 'this member'}.`);
    }
  };

  return { assign, beginGrant, confirmGrant, changeRole, removeMember };
}
