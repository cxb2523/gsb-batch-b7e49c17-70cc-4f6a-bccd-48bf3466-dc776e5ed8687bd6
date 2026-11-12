import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import {
  isWorkspaceAdministrator,
  isWorkspaceOwner,
  type ProjectRole,
  type WorkspaceRole,
} from './roles.js';

/**
 * The one authorization policy in the backend.
 *
 * Pure: no database, no Nest, no request. `AccessService` loads the two roles and calls this; the
 * guard asks the resulting ability whether the route's stated action is allowed. Nothing else in
 * `backend/src` decides who may do what.
 *
 * "Admin+" means a workspace owner or admin. "Assigned" means a `ProjectMember` row exists.
 */

export type AccessAction =
  'read' | 'create' | 'update' | 'delete' | 'share' | 'transfer' | 'manage';

export type AccessSubject =
  'Workspace' | 'Member' | 'Invitation' | 'Project' | 'ProjectMember' | 'Board' | 'all';

export type AppAbility = MongoAbility<[AccessAction, AccessSubject]>;

export interface AbilityContext {
  workspaceRole: WorkspaceRole | null;
  projectRole: ProjectRole | null;
  /** A `ProjectMember` row exists for the caller. Owners and admins are always assigned. */
  isAssignedToProject?: boolean;
}

export function defineAbilityFor({
  workspaceRole,
  projectRole,
  isAssignedToProject = false,
}: AbilityContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (!workspaceRole) {
    return build();
  }

  // Every member of a workspace may read its name and their own role.
  can('read', 'Workspace');

  if (isWorkspaceAdministrator(workspaceRole)) {
    can('update', 'Workspace');
    // Only the owner may delete the workspace or hand it over.
    if (workspaceRole === 'owner') {
      can('delete', 'Workspace');
      can('transfer', 'Workspace');
    }

    can(['create', 'read', 'delete'], 'Invitation');
    can(['read', 'create', 'update', 'delete'], 'Project');
    can('read', 'Member');
    can('read', 'ProjectMember');
    can('manage', 'ProjectMember');
    can(['read', 'create', 'update', 'delete', 'share'], 'Board');

    can('update', 'Member');
    can('delete', 'Member');

    return build();
  }

  // Inside a project, power is exactly the project role. A workspace Editor or Viewer with no
  // project grant has no access to the project at all.
  const assigned = isAssignedToProject && projectRole !== null;
  if (!assigned) {
    return build();
  }

  can('read', 'Project');
  can('read', 'ProjectMember');
  can('read', 'Board');

  if (projectRole === 'admin') {
    can('update', 'Project');
    can('manage', 'ProjectMember');
    can(['create', 'update', 'delete', 'share'], 'Board');
  } else if (projectRole === 'editor') {
    can(['create', 'update', 'delete', 'share'], 'Board');
  }

  return build();
}

/**
 * The rule table's one target-sensitive rule: an Owner is never changed or removed through the
 * member routes. The only way an Owner changes is `transferOwnership`.
 * The route-level ability says an Admin+ may manage members; this decides which member.
 */
export function canActOnMember(workspaceRole: WorkspaceRole | null, targetRole: string): boolean {
  if (!isWorkspaceAdministrator(workspaceRole)) {
    return false;
  }
  return !isWorkspaceOwner(targetRole);
}
