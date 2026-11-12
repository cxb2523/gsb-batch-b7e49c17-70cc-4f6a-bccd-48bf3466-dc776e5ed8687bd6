import { isWorkspaceAdministrator } from './roles.js';

export interface WorkspaceMembership {
  role: string;
}

/**
 * A person with no memberships may create their first workspace. After that, only a workspace
 * Owner or Admin may create more; a user whose only roles are Editor or Viewer may not.
 *
 * When an instance-level workspace limit is configured, creating more workspaces is refused
 * once the user's owned workspaces count reaches the limit.
 */
export function canCreateWorkspace(
  memberships: readonly WorkspaceMembership[],
  limitWorkspacesPerAccount?: number,
): boolean {
  if (limitWorkspacesPerAccount !== undefined) {
    const owned = memberships.filter((membership) => membership.role === 'owner').length;
    if (owned >= limitWorkspacesPerAccount) {
      return false;
    }
  }
  if (memberships.length === 0) {
    return true;
  }
  return memberships.some((membership) => isWorkspaceAdministrator(membership.role));
}
