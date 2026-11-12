/**
 * The product's role vocabulary, in one place.
 *
 * Four roles exist at workspace level and three at project level. Every other module imports
 * these values, so a role is never spelled as a string literal anywhere else in `backend/src`.
 * Owner is workspace-only; an owner or admin is a workspace administrator and is an admin inside
 * every project through the workspace key.
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_ROLES = ['admin', 'editor', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Invitations may hand out a project role, not an administrative one. */
export const INVITATION_ROLES = ['editor', 'viewer'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** Named values for the places that need one specific role without spelling it. */
export const WORKSPACE_OWNER_ROLE = 'owner' satisfies WorkspaceRole;
export const WORKSPACE_ADMIN_ROLE = 'admin' satisfies WorkspaceRole;
/** Owners and admins: the roles that hold the workspace key and see every project. */
export const WORKSPACE_ADMINISTRATOR_ROLES = [WORKSPACE_OWNER_ROLE, WORKSPACE_ADMIN_ROLE] as const;
export const DEFAULT_INVITATION_ROLE = 'editor' satisfies InvitationRole;
export const PROJECT_ADMIN_ROLE = 'admin' satisfies ProjectRole;

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value);
}

export function isInvitationRole(value: unknown): value is InvitationRole {
  return typeof value === 'string' && (INVITATION_ROLES as readonly string[]).includes(value);
}

/** Owners and admins: they hold the workspace key and are Admin in every project. */
export function isWorkspaceAdministrator(role: unknown): boolean {
  return role === 'owner' || role === 'admin';
}

export function isWorkspaceOwner(role: unknown): boolean {
  return role === 'owner';
}

/** Exactly `admin`: a demotion from admin is what takes the wrapped workspace key away. */
export function isWorkspaceAdminRole(role: unknown): boolean {
  return role === 'admin';
}

/** The project role an invitation grants: viewers stay viewers, everyone else gets editor. */
export function projectRoleForInvitation(role: unknown): ProjectRole {
  return role === 'viewer' ? 'viewer' : 'editor';
}

/** Invitation rows may be null on legacy data; the product default is Editor. */
export function invitationRoleOrDefault(role: unknown): InvitationRole {
  return isInvitationRole(role) ? role : 'editor';
}
